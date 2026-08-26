// ─── Paper Trading & Strategy Simulator Engine ─────────────────────────────
const STORAGE_KEY = "btc_desk_paper_trades_v1";

export function loadPaperTrades() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePaperTrades(trades) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  } catch {}
}

export function openPaperTrade(opp, size = 1) {
  const trades = loadPaperTrades();
  const normalizedSize = Number(size) > 0 ? Number(size) : 0.01;
  const putLeg = opp.putLeg || opp.put || null;
  const callLeg = opp.callLeg || opp.call || null;
  const premiumPerBtc = Number(
    opp.premiumPerBtc ??
    opp.totalPremium ??
    opp.totalPremiumUSD ??
    opp.premiumUSD ??
    opp.markPrice ??
    0
  );
  const newTrade = {
    id: "PT-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    openedAt: new Date().toISOString(),
    status: "OPEN", // "OPEN" | "CLOSED"
    strategy: opp.strategy || "SHORT_PUT",
    strategyTitle: opp.strategyTitle || opp.strategy,
    dte: opp.dte,
    expiryDate: opp.expiryDate || opp.expiry || null,
    size: normalizedSize,
    entryBtcPrice: opp.btcPrice,
    premiumPerBtc,
    initialPremiumTotal: premiumPerBtc * normalizedSize,
    currentPnl: 0,
    legs: [
      putLeg && {
        type: "PUT",
        symbol: putLeg.symbol,
        strike: Number(putLeg.strike),
        delta: Number(putLeg.delta || 0),
        entryPrice: Number(putLeg.markPrice || opp.putMark || 0),
        markPrice: Number(putLeg.markPrice || opp.putMark || 0),
      },
      callLeg && {
        type: "CALL",
        symbol: callLeg.symbol,
        strike: Number(callLeg.strike),
        delta: Number(callLeg.delta || 0),
        entryPrice: Number(callLeg.markPrice || opp.callMark || 0),
        markPrice: Number(callLeg.markPrice || opp.callMark || 0),
      },
    ].filter(Boolean),
  };

  trades.unshift(newTrade);
  savePaperTrades(trades);
  return newTrade;
}

/**
 * Mark an open short-premium paper trade to current option prices.
 * P&L per leg = (entry mark - current mark) * BTC quantity.
 */
export function markPaperTrade(trade, marksBySymbol = new Map()) {
  if (!trade || trade.status !== "OPEN" || !Array.isArray(trade.legs)) return trade;

  let hasLiveMark = false;
  const legs = trade.legs.map(leg => {
    const rawMark = marksBySymbol instanceof Map
      ? marksBySymbol.get(leg.symbol)
      : marksBySymbol?.[leg.symbol];
    const nextMark = Number(rawMark?.markPrice ?? rawMark);
    if (!Number.isFinite(nextMark) || nextMark < 0) return leg;
    hasLiveMark = true;
    return { ...leg, markPrice: nextMark };
  });

  if (!hasLiveMark || legs.length === 0) {
    return { ...trade, pricingStatus: "STALE" };
  }

  const size = Number(trade.size) || 0;
  const currentPnl = legs.reduce((sum, leg) => {
    const entry = Number(leg.entryPrice) || 0;
    const mark = Number(leg.markPrice) || 0;
    return sum + ((entry - mark) * size);
  }, 0);

  return {
    ...trade,
    legs,
    currentPnl: Math.round(currentPnl * 100) / 100,
    lastMarkedAt: new Date().toISOString(),
    pricingStatus: "LIVE_MARK",
  };
}

export function closePaperTrade(tradeId, reason = "MANUAL_EXIT") {
  const trades = loadPaperTrades();
  const updated = trades.map(t => {
    if (t.id === tradeId && t.status === "OPEN") {
      return {
        ...t,
        status: "CLOSED",
        closedAt: new Date().toISOString(),
        closeReason: reason,
        finalPnl: t.currentPnl,
      };
    }
    return t;
  });
  savePaperTrades(updated);
  return updated;
}

export function clearAllPaperTrades() {
  savePaperTrades([]);
  return [];
}

export function calculatePaperTradeStats(trades = []) {
  const closed = trades.filter(t => t.status === "CLOSED");
  const open = trades.filter(t => t.status === "OPEN");

  const totalClosed = closed.length;
  const wins = closed.filter(t => (t.finalPnl || 0) > 0);
  const losses = closed.filter(t => (t.finalPnl || 0) < 0);

  const winRate = totalClosed > 0 ? (wins.length / totalClosed) * 100 : 0;
  const realizedPnl = closed.reduce((s, t) => s + (t.finalPnl || 0), 0);
  const unrealizedPnl = open.reduce((s, t) => s + (t.currentPnl || 0), 0);

  const totalGains = wins.reduce((s, t) => s + (t.finalPnl || 0), 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.finalPnl || 0), 0));
  const profitFactor = totalLosses > 0 ? (totalGains / totalLosses).toFixed(2) : totalGains > 0 ? "∞" : "0.00";

  return {
    totalTrades: trades.length,
    openTradesCount: open.length,
    closedTradesCount: totalClosed,
    winRate: winRate.toFixed(1),
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    profitFactor,
  };
}
