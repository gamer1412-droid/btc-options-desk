// ─── Backtest Engine v1.0 ────────────────────────────────────────────────
// Simulates scanning entry opportunities day-by-day, applying evaluateEntryRules,
// simulating hold until TP 35% or DTE<=2 or stop 2x, calculates stats.
// Exports: runBacktest, generateMockBtData
import { STRATEGY_CONFIG } from "../config/strategyConfig.js";
import { evaluateEntryRules } from "./rulesEngine.js";
import { scanEntryOpportunities } from "./scanner.js";

const DEFAULT_CFG = STRATEGY_CONFIG;

// ─── Core backtest ──────────────────────────────────────────────────────
/**
 * @param {object} params
 * @param {Array<Array>} params.historicalMarks - Array of daily marksData arrays (each element is Array of mark objects)
 * @param {Array<number|object>} params.btcPrices - Array of daily BTC closes (number or {price, date})
 * @param {object} params.config - override config (optional, falls back to STRATEGY_CONFIG)
 * @param {Array<object>} params.marketContexts - optional per-day marketContext (distFromMA20, change24h, ivRank...)
 * @returns {object} backtest result
 */
export function runBacktest({ historicalMarks = [], btcPrices = [], config = null, marketContexts = [] } = {}) {
  const cfg = config || DEFAULT_CFG;
  const tpPct = cfg.exit?.mainTpPct ?? 35;
  const dteStop = cfg.exit?.dteStop ?? 2;
  const stopMult = cfg.exit?.hardStopLossMultiplier ?? 2.0;

  const days = Math.min(historicalMarks.length, btcPrices.length);
  if (days === 0) {
    return emptyResult("No historical data");
  }

  const getPrice = (i) => {
    const v = btcPrices[i];
    if (v == null) return null;
    if (typeof v === "number") return v;
    return Number(v.price ?? v.close ?? v.btcPrice ?? 0) || null;
  };

  const trades = [];
  let equity = 0;
  const equityCurve = [];

  // Track open paper position to avoid overlapping? Simplified: allow 1 at a time for clean walk
  // But spec says scanning day-by-day; we allow multiple sequential trades.
  // We'll simulate max 1 open at a time to keep equity curve meaningful; if an entry signal appears while holding, skip.

  let openTrade = null;

  for (let day = 0; day < days; day++) {
    const btcPrice = getPrice(day);
    const marks = historicalMarks[day];
    if (!btcPrice || !Array.isArray(marks)) {
      equityCurve.push(equity);
      continue;
    }

    // ── manage open trade ──────────────────────────────────────────────
    if (openTrade) {
      openTrade.daysHeld += 1;
      // remaining DTE decrements each day
      openTrade.currentDte = Math.max(0, openTrade.entryDte - openTrade.daysHeld);

      const btcMove = btcPrice - openTrade.entryBtcPrice;
      // simplified loss model: adverse delta * move (only losses count)
      // putDelta negative: lossPut = max(0, putDelta * btcMove) ; callDelta positive: lossCall = max(0, callDelta*btcMove)
      // net adverse movement
      let loss = 0;
      if (openTrade.putDelta != null) {
        const d = Number(openTrade.putDelta);
        loss += Math.max(0, d * btcMove);
      }
      if (openTrade.callDelta != null) {
        const d = Number(openTrade.callDelta);
        loss += Math.max(0, d * btcMove);
      }
      // If no leg deltas, fallback to netDelta
      if (loss === 0 && openTrade.netDelta != null) {
        loss = Math.max(0, Number(openTrade.netDelta) * btcMove);
      }

      const premium = openTrade.premium;
      // pnl = premium - loss (capped profit at premium)
      let pnl = premium - loss;
      // clamp: max profit = premium (can't earn more than premium with this zero-gamma simplified model beyond decay)
      if (pnl > premium) pnl = premium;
      // theta decay boost: ~ premium *0.02 per day held (up to 35%)
      // We approximate time decay adds ~ (premium * 0.015 * daysHeld) but capped
      // Instead, we let loss decay: effective pnl drifts up by theta per day if no adverse move
      // Simplified: if no adverse move (loss=0), pnl slowly approaches premium already; we add small time bonus
      // Represent by: if btcMove small, add thetaDecay = premium*0.018*daysHeld capped at premium*0.35
      // But our pnl already = premium when loss=0, so no decay needed. Keep as is.

      const profitPct = premium > 0 ? (pnl / premium) * 100 : 0;

      let exitReason = null;
      if (pnl >= premium * (tpPct / 100)) exitReason = `TP ${tpPct}%`;
      else if (pnl <= -premium * stopMult) exitReason = `STOP ${stopMult}x`;
      else if (openTrade.currentDte <= dteStop) exitReason = `DTE ≤${dteStop}`;
      else if (openTrade.daysHeld >= 28) exitReason = "MAX_HOLD";
      // also auto-close at last day
      if (!exitReason && day === days - 1) exitReason = "END";

      if (exitReason) {
        // if DTE exit or TP, ensure pnl at least time-decayed; if STOP, clamp to -2x
        if (exitReason.startsWith("STOP")) pnl = -premium * stopMult;
        openTrade.exitDay = day;
        openTrade.exitBtcPrice = btcPrice;
        openTrade.exitReason = exitReason;
        openTrade.pnl = Math.round(pnl);
        openTrade.pnlPct = Math.round(profitPct * 10) / 10;
        openTrade.win = pnl > 0;
        equity += pnl;
        trades.push({ ...openTrade });
        openTrade = null;
      }
    }

    // ── scan new entry if flat ─────────────────────────────────────────
    if (!openTrade) {
      const marketCtx = marketContexts[day] || buildSyntheticContext(btcPrices, day, marks);
      let opps = [];
      try {
        opps = scanEntryOpportunities(marks, btcPrice, marketCtx.marketIv ?? 55, [], marketCtx);
      } catch {
        opps = [];
      }
      // apply rules engine filter
      const viable = opps.filter((o) => {
        try {
          const ev = evaluateEntryRules(o, marketCtx, null, []);
          return !ev.isBlocked;
        } catch {
          return false;
        }
      });
      if (viable.length > 0) {
        const best = viable.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        openTrade = {
          id: `${best.id}#d${day}`,
          strategy: best.strategy,
          entryDay: day,
          entryDate: `D${day}`,
          expiry: best.expiry,
          dte: best.dte,
          entryDte: best.dte,
          currentDte: best.dte,
          entryBtcPrice: btcPrice,
          premium: best.totalPremium || 0,
          putStrike: best.putStrike ?? null,
          callStrike: best.callStrike ?? null,
          putDelta: best.putDelta != null ? Number(best.putDelta) : (best.put?.delta ?? null),
          callDelta: best.callDelta != null ? Number(best.callDelta) : (best.call?.delta ?? null),
          netDelta: (Number(best.putDelta || best.put?.delta || 0) + Number(best.callDelta || best.call?.delta || 0)) || 0,
          daysHeld: 0,
          exitDay: null,
          exitReason: null,
          pnl: 0,
        };
      }
    }

    equityCurve.push(Math.round(equity));
  }

  // if still open at end, force close at last pnl estimate
  if (openTrade) {
    const btcPrice = getPrice(days - 1);
    const btcMove = btcPrice - openTrade.entryBtcPrice;
    let loss = 0;
    if (openTrade.putDelta != null) loss += Math.max(0, Number(openTrade.putDelta) * btcMove);
    if (openTrade.callDelta != null) loss += Math.max(0, Number(openTrade.callDelta) * btcMove);
    const pnl = Math.round(Math.min(openTrade.premium, openTrade.premium - loss));
    openTrade.exitDay = days - 1;
    openTrade.exitBtcPrice = btcPrice;
    openTrade.exitReason = "END";
    openTrade.pnl = pnl;
    openTrade.pnlPct = openTrade.premium ? Math.round((pnl / openTrade.premium) * 1000) / 10 : 0;
    openTrade.win = pnl > 0;
    equity += pnl;
    trades.push({ ...openTrade });
    equityCurve[equityCurve.length - 1] = Math.round(equity);
  }

  if (trades.length === 0) {
    return {
      trades: [],
      equityCurve,
      totalPnl: 0,
      winRate: 0,
      avgReturn: 0,
      avgPremium: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      sharpe: 0,
      numTrades: 0,
      wins: 0,
      losses: 0,
      days,
    };
  }

  const wins = trades.filter((t) => t.win).length;
  const losses = trades.length - wins;
  const winRate = Math.round((wins / trades.length) * 1000) / 10;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgReturn = Math.round((totalPnl / trades.length) * 10) / 10;
  const avgPremium = Math.round(trades.reduce((s, t) => s + t.premium, 0) / trades.length);

  // max drawdown from equity curve (peak-to-trough)
  let peak = -Infinity;
  let maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
  }
  // drawdown pct relative to peak equity + initial cushion (use total premium sum as notional)
  const notional = Math.max(5000, trades.reduce((s, t) => s + t.premium, 0));
  const maxDrawdownPct = notional ? Math.round((maxDD / notional) * 1000) / 10 : 0;

  // sharpe-like: mean daily pnl / std daily pnl * sqrt(252)
  const dailyPnls = [];
  for (let i = 1; i < equityCurve.length; i++) dailyPnls.push(equityCurve[i] - equityCurve[i - 1]);
  const mean = dailyPnls.length ? dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length : 0;
  const variance = dailyPnls.length > 1 ? dailyPnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyPnls.length - 1) : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? Math.round((mean / std) * Math.sqrt(252) * 100) / 100 : 0;

  return {
    trades,
    equityCurve,
    totalPnl: Math.round(totalPnl),
    winRate,
    avgReturn,
    avgPremium,
    maxDrawdown: Math.round(maxDD),
    maxDrawdownPct,
    sharpe,
    numTrades: trades.length,
    wins,
    losses,
    days,
  };
}

function emptyResult(reason) {
  return {
    trades: [],
    equityCurve: [],
    totalPnl: 0,
    winRate: 0,
    avgReturn: 0,
    avgPremium: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    sharpe: 0,
    numTrades: 0,
    wins: 0,
    losses: 0,
    days: 0,
    reason,
  };
}

function buildSyntheticContext(btcPrices, day, marks) {
  const getPrice = (i) => {
    const v = btcPrices[i];
    if (v == null) return null;
    if (typeof v === "number") return v;
    return Number(v.price ?? v.close ?? 0) || null;
  };
  const price = getPrice(day);
  const prev = day > 0 ? getPrice(day - 1) : price;
  const change24h = prev && price ? ((price - prev) / prev) * 100 : 0;
  // avg IV
  let marketIv = 55;
  if (Array.isArray(marks) && marks.length) {
    const ivs = marks.map((m) => Number(m.markIV)).filter((v) => Number.isFinite(v) && v > 0).map((v) => (v <= 5 ? v * 100 : v));
    if (ivs.length) marketIv = Math.round(ivs.reduce((a, b) => a + b, 0) / ivs.length);
  }
  // dist from MA20 synthetic: walk-based
  const window = btcPrices.slice(Math.max(0, day - 20), day + 1).map(getPrice).filter((v) => v != null);
  const ma20 = window.length ? window.reduce((a, b) => a + b, 0) / window.length : price;
  const distFromMA20 = ma20 ? ((price - ma20) / ma20) * 100 : 0;
  return {
    price,
    change24h: Math.round(change24h * 10) / 10,
    ma20,
    distFromMA20: Math.round(distFromMA20 * 10) / 10,
    marketIv,
    ivRank: 55,
    regime: null,
  };
}

// ─── Mock data generator (synthetic 90 days BTC walk + synthetic option chain) ─
export function generateMockBtData({ days = 90, startPrice = 65000, seed = 42 } = {}) {
  // seeded RNG (mulberry32)
  let s = seed;
  const rnd = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const btcPrices = [];
  let price = startPrice;
  for (let i = 0; i < days; i++) {
    // GARCH-ish walk: drift + vol
    const drift = (rnd() - 0.48) * 0.006; // slight upward bias
    const shock = (rnd() - 0.5) * 0.025;
    price = Math.max(40000, price * (1 + drift + shock));
    btcPrices.push(Math.round(price));
  }

  const historicalMarks = [];
  const expiries = [7, 14, 21, 30]; // DTE buckets
  for (let d = 0; d < days; d++) {
    const btc = btcPrices[d];
    const marks = [];
    for (const dte of expiries) {
      const expiryDate = new Date(Date.now() + (dte + d) * 86400000);
      // format YYMMDD
      const yy = String(expiryDate.getUTCFullYear() % 100).padStart(2, "0");
      const mm = String(expiryDate.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(expiryDate.getUTCDate()).padStart(2, "0");
      const expCode = `${yy}${mm}${dd}`;
      // strikes around BTC
      const strikes = [
        Math.round((btc * 0.88) / 500) * 500,
        Math.round((btc * 0.92) / 500) * 500,
        Math.round((btc * 0.95) / 500) * 500,
        Math.round((btc * 1.05) / 500) * 500,
        Math.round((btc * 1.08) / 500) * 500,
        Math.round((btc * 1.12) / 500) * 500,
      ];
      for (const strike of strikes) {
        const isPut = strike < btc;
        const moneyness = Math.abs(strike - btc) / btc;
        // delta approx: 0.12-0.28 for OTM
        const baseDelta = 0.10 + moneyness * 0.7 + rnd() * 0.04;
        const delta = isPut ? -Math.min(0.45, baseDelta) : Math.min(0.45, baseDelta);
        const ivBase = 55 + (rnd() - 0.5) * 18 + (dte < 10 ? 8 : 0);
        const markPrice = Math.max(20, Math.round((btc * 0.002 + moneyness * btc * 0.015 + rnd() * 80) * 10) / 10);
        const theta = -Math.abs(markPrice * 0.015 + rnd() * 5);
        const type = isPut ? "P" : "C";
        marks.push({
          symbol: `BTC-${expCode}-${strike}-${type}`,
          markPrice,
          markIV: ivBase / 100,
          delta: Math.round(delta * 100) / 100,
          theta: Math.round(theta * 10) / 10,
          gamma: 0.00001,
          vega: 5,
        });
      }
    }
    historicalMarks.push(marks);
  }

  return { btcPrices, historicalMarks };
}
