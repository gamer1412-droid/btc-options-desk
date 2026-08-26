// api/cron.js — 24/7 Automated Serverless Alert Engine & Portfolio Health Checker
// Runs periodically via Vercel Cron or direct trigger.

import crypto from "crypto";
import { requireCronAuth } from "../lib/security.js";
import { claimAlert } from "../lib/alertState.js";
import { buildMarketIndicators } from "../lib/marketIndicators.js";
import { classifyMarketRegime } from "../src/services/marketRegime.js";
import { scanEntryOpportunities, determineOptimalMarketProfile } from "../src/services/scanner.js";
import { evaluateEntryRules } from "../src/services/rulesEngine.js";
import { checkAlerts, DEFAULT_ALERT_PREFERENCES } from "../src/services/alerts.js";
import { parseAccountInfo } from "../src/services/sizing.js";

const BINANCE_OPTIONS_BASE = "https://eapi.binance.com";
const BINANCE_SPOT_BASE = "https://api.binance.com";

function sign(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

async function signedGet(base, path, params, apiKey, apiSecret) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp, recvWindow: 60000 }).toString();
  const signature = sign(query, apiSecret);
  const url = `${base}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function sendTelegramMessage(type, data) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "");
  if (!botToken || !chatId) return { skipped: true, reason: "No credentials" };

  const appUrl = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://btc-options-desk.vercel.app");
  const binanceUrl = "https://www.binance.com/en/options";
  let message = "";
  const buttons = [
    [
      { text: "📊 เปิด Options Desk", url: appUrl },
      { text: "⚡ เทรดบน Binance", url: binanceUrl },
    ],
  ];

  if (type === "daily_briefing") {
    const d = data || {};
    const pnlSign = (d.totalPnl || 0) >= 0 ? "+" : "";
    const pnlEmoji = (d.totalPnl || 0) >= 0 ? "🟢" : "🔴";
    const deltaPosture = Math.abs(d.netDelta || 0) <= 0.2
      ? "⚖️ Delta Neutral (ปลอดภัย)"
      : (d.netDelta > 0 ? "🐂 Bullish Skewed" : "🐻 Bearish Skewed");

    message = `📊 *DAILY PORTFOLIO BRIEFING — BTC Options Desk*
━━━━━━━━━━━━━━━━━━━━━
₿ *BTC Spot:* $${Number(d.btcPrice || 0).toLocaleString()} (${d.change24h >= 0 ? "+" : ""}${d.change24h}%)
📈 *Chain Avg IV:* ${d.marketIv ?? "N/A"}% | *Port Delta:* \`${d.netDelta || 0}\` (${deltaPosture})
🧭 *Market Regime:* ${d.regimeLabel || "DATA INCOMPLETE"} (${d.regimeConfidence ?? 0}%)
🚦 *New Entry:* ${d.regimeAction === "NO_TRADE" ? "⛔ NO_TRADE" : "✅ " + d.regimeAction}

💼 *Portfolio Health:*
  • สัญญาเปิดอยู่: *${d.positionCount || 0} Positions*
  • รวม P&L: ${pnlEmoji} *${pnlSign}$${Number(d.totalPnl || 0).toLocaleString()} USD*
  • Theta Income: *+$${Number(d.totalTheta || 0).toLocaleString()} / วัน*
  • DTE ต่ำสุด: *${d.minDte || 0} วัน* ${d.minDte && d.minDte <= 2 ? "⚠️ (ใกล้หมดอายุ!)" : ""}
  • Margin Ratio: *${d.marginRatio ? (d.marginRatio * 100).toFixed(1) + "%" : "Safe"}*

${d.criticalCount > 0 ? `🚨 *ต้องตรวจสอบ:* มี ${d.criticalCount} สัญญาที่ใกล้กรอบ Action Level!` : "✨ *สถานะพอร์ต:* ทุกสัญญายังอยู่ในกรอบความปลอดภัยตามแผน"}
━━━━━━━━━━━━━━━━━━━━━
_ระบบสรุปข้อมูลอัตโนมัติ 24/7_`;
  } else if (type === "warning") {
    const d = data || {};
    const isStopLoss = d.warningReason?.includes("STOP");
    const isTP = d.warningReason?.includes("TAKE PROFIT") || d.alertLevel === "TAKE_PROFIT" || Number(d.pctProfit) >= 50;
    const isDteExit = d.warningReason?.includes("DTE EXIT");
    const isCritical = d.alertLevel === "CRITICAL";
    const emoji = isTP ? "🎯" : isDteExit ? "⏰" : (isStopLoss || isCritical) ? "🚨" : "⚠️";
    const headerTitle = isTP ? "TAKE PROFIT TARGET" : isDteExit ? "DTE EXPIRY EXIT" : (isStopLoss || isCritical) ? "CRITICAL RISK DEFENSE" : "DEFENSIVE REVIEW";

    message = `${emoji} *${headerTitle} — ${d.posType || "OPTION"}*
━━━━━━━━━━━━━━━━━━━━━
📍 *Contract:* \`${d.posId || d.strike}\`
📐 *Current Delta:* \`${d.delta}\` ${Math.abs(d.delta || 0) >= 0.4 ? "🔴" : "🟡"}
💰 *Current P&L:* ${d.pnl >= 0 ? "+" : ""}$${d.pnl} (${d.pctProfit}% profit)

⚠️ *Status:*
${d.warningReason}

💡 *Tactical Action:*
${d.tacticalAction || (isTP ? "ปิดทำกำไรตามเป้าหมายของระบบเพื่อเคลียร์ Margin" : "ตรวจสอบกราฟและพิจารณา Roll หรือปิดสัญญาตามวินัย")}
━━━━━━━━━━━━━━━━━━━━━
⚡ _ระบบตรวจจับอัตโนมัติ 24/7_`;
  } else if (type === "short_put_signal") {
    const d = data || {};
    message = `🟢 *ENTRY SIGNAL — BTC Bullish Short Put*
━━━━━━━━━━━━━━━━━━━━━
📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice || 0).toLocaleString()} | IV: ${d.marketIv ?? "N/A"}%
📍 *Short Put:* $${Number(d.putStrike || d.strike || 0).toLocaleString()} | Delta \`${d.putDelta || d.delta}\`
💰 *Premium:* ~$${d.totalPremium} / 1 BTC | Theta: +$${d.totalTheta}/วัน
🛡️ *Buffer:* ${d.putDistancePct}% | Breakeven: $${Number(d.breakevenLow || 0).toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━
_ผ่าน Market Regime และกฎความเสี่ยงแล้ว — ตรวจราคา execute จริงก่อนเปิดสถานะ_`;
  } else if (type === "skewed_strangle_signal") {
    const d = data || {};
    message = `⚡ *ENTRY SIGNAL — BTC Skewed Strangle*
━━━━━━━━━━━━━━━━━━━━━
📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice || 0).toLocaleString()} | IV: ${d.marketIv ?? "N/A"}%
📍 *Short Put:* $${Number(d.putStrike || 0).toLocaleString()} | Delta \`${d.putDelta}\`
📍 *Wide Short Call:* $${Number(d.callStrike || 0).toLocaleString()} | Delta \`+${d.callDelta}\`
💰 *Premium:* ~$${d.totalPremium} / 1 BTC | Theta: +$${d.totalTheta}/วัน
🛡️ *Safe Zone:* $${Number(d.breakevenLow || 0).toLocaleString()} — $${Number(d.breakevenHigh || 0).toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━
_ผ่าน Market Regime และกฎความเสี่ยงแล้ว — ตรวจราคา execute จริงก่อนเปิดสถานะ_`;
  } else if (type === "strangle_signal") {
    const d = data || {};
    message = `🟣 *ENTRY SIGNAL — BTC Short Strangle*
━━━━━━━━━━━━━━━━━━━━━
📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice || 0).toLocaleString()} | IV: ${d.marketIv ?? "N/A"}%
📍 *Short Put:* $${Number(d.putStrike || 0).toLocaleString()} | Delta \`${d.putDelta}\`
📍 *Short Call:* $${Number(d.callStrike || 0).toLocaleString()} | Delta \`+${d.callDelta}\`
💰 *Premium:* ~$${d.totalPremium} / 1 BTC | Theta: +$${d.totalTheta}/วัน
🛡️ *Safe Zone:* $${Number(d.breakevenLow || 0).toLocaleString()} — $${Number(d.breakevenHigh || 0).toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━
_ผ่าน Market Regime และกฎความเสี่ยงแล้ว — ตรวจราคา execute จริงก่อนเปิดสถานะ_`;
  }

  if (!message) return { skipped: true };

  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons },
  };

  let r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let result = await r.json();
  if (!result.ok && payload.parse_mode) {
    delete payload.parse_mode;
    r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    result = await r.json();
  }
  if (!r.ok || !result.ok) throw new Error(result.description || `Telegram HTTP ${r.status}`);
  return result;
}

export default async function handler(req, res) {
  // Authorization check for Vercel Cron or custom trigger
  if (!requireCronAuth(req, res)) return;

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const isBriefingRequested = req.query.briefing === "true";
  const alertsEnabled = process.env.CRON_ALERTS_ENABLED !== "false";
  const briefingEnabled = process.env.CRON_DAILY_BRIEFING_ENABLED !== "false";

  const results = {
    timestamp: new Date().toISOString(),
    positionsChecked: 0,
    entrySignalsChecked: 0,
    alertsDispatched: 0,
    briefingDispatched: false,
    errors: [],
  };

  try {
    // 1. Fetch Market Context & Marks
    const [tickerRes, klinesRes, marksRes] = await Promise.all([
      fetch(`${BINANCE_SPOT_BASE}/api/v3/ticker/24hr?symbol=BTCUSDT`),
      fetch(`${BINANCE_SPOT_BASE}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=120`),
      fetch(`${BINANCE_OPTIONS_BASE}/eapi/v1/mark?underlying=BTCUSDT`).catch(() => ({ json: async () => [] })),
    ]);

    const ticker = await tickerRes.json();
    const klines = await klinesRes.json();
    const marksData = await marksRes.json();

    const currentBtcPrice = parseFloat(ticker.lastPrice) || 0;
    const change24h = parseFloat(ticker.priceChangePercent) || 0;
    const indicators = buildMarketIndicators(klines, currentBtcPrice);

    let avgMarketIv = null;
    const marksMap = new Map();
    if (Array.isArray(marksData) && marksData.length > 0) {
      const ivValues = marksData.map(m => parseFloat(m.markIV)).filter(v => !isNaN(v) && v > 0);
      if (ivValues.length > 0) avgMarketIv = Math.round((ivValues.reduce((s, v) => s + v, 0) / ivValues.length) * 100);
      for (const m of marksData) {
        if (m.symbol) marksMap.set(m.symbol, m);
      }
    }

    const marketContext = {
      price: currentBtcPrice,
      change24h: Math.round(change24h * 100) / 100,
      ma20: indicators.ema20 ?? null,
      distFromMA20: indicators.distFromEMA20 ?? null,
      ema20: indicators.ema20 ?? null,
      ema50: indicators.ema50 ?? null,
      distFromEMA20: indicators.distFromEMA20 ?? null,
      distFromEMA50: indicators.distFromEMA50 ?? null,
      adx14: indicators.adx14 ?? null,
      realizedVol7: indicators.realizedVol7 ?? null,
      realizedVol30: indicators.realizedVol30 ?? null,
      marketIv: avgMarketIv,
      ivRank: null,
    };
    const marketRegime = classifyMarketRegime(marketContext);

    // 2. Fetch User Positions & Account if API Keys are provided
    let positions = [];
    let accountInfo = null;

    if (apiKey && apiSecret) {
      try {
        const rawPositions = await signedGet(BINANCE_OPTIONS_BASE, "/eapi/v1/position", {}, apiKey, apiSecret);
        if (Array.isArray(rawPositions)) {
          positions = rawPositions
            .filter(p => Number(p.quantity || p.positionAmount) !== 0)
            .map(p => {
              const mark = marksMap.get(p.symbol) || {};
              const parts = p.symbol?.split("-") ?? [];
              const strike = Number(p.strikePrice) || Number(parts[2]) || 0;
              const optType = parts[3] === "C" ? "Call" : parts[3] === "P" ? "Put" : "Option";
              const side = (p.side === "SELL" || Number(p.quantity) < 0 || p.positionSide === "SHORT") ? "Short" : "Long";
              const qty = Math.abs(Number(p.quantity) || Number(p.positionAmount) || 0);
              const entryPrice = Math.abs(Number(p.entryPrice) || 0);
              const markPrice = Math.abs(Number(p.markPrice) || Number(mark.markPrice) || entryPrice);
              const premium = Math.round(entryPrice * qty * 100) / 100;
              const currentPrice = Math.round(markPrice * qty * 100) / 100;
              const delta = Number(p.delta ?? mark.delta ?? 0);
              const theta = Number(p.theta ?? mark.theta ?? 0);
              const gamma = Number(p.gamma ?? mark.gamma ?? 0);
              let expMs = Number(p.expiryDate) || 0;
              if (!expMs && parts[1]?.length === 6) {
                const y = 2000 + Number(parts[1].slice(0, 2));
                const m = Number(parts[1].slice(2, 4));
                const d = Number(parts[1].slice(4, 6));
                expMs = Date.UTC(y, m - 1, d, 8, 0, 0);
              }
              const dte = expMs > 0 ? Math.max(0, Math.ceil((expMs - Date.now()) / 86400000)) : 0;
              const rawPnl = p.unrealizedPNL ?? p.unrealizedPnL;
              const pnl = rawPnl != null ? Math.round(Number(rawPnl) * 100) / 100 : Math.round((side === "Short" ? premium - currentPrice : currentPrice - premium) * 100) / 100;

              return {
                id: p.symbol,
                type: `${side} ${optType}`,
                strike,
                dte,
                delta,
                theta,
                gamma,
                premium,
                currentPrice,
                pnl,
                size: qty,
                positionDelta: delta * qty * (side === "Short" ? -1 : 1),
                positionGamma: gamma * qty * (side === "Short" ? -1 : 1),
              };
            });
        }
      } catch (ePos) {
        results.errors.push(`Position fetch error: ${ePos.message}`);
      }

      try {
        const rawAccount = await signedGet(BINANCE_OPTIONS_BASE, "/eapi/v1/marginAccount", {}, apiKey, apiSecret);
        if (rawAccount && !rawAccount.error) {
          accountInfo = parseAccountInfo(rawAccount);
        }
      } catch (eAcct) {
        // ignore fallback
      }
    }

    results.positionsChecked = positions.length;

    // 3. Server-side Entry Scanner — works even when the dashboard is closed.
    // The same regime/risk gate as the browser scanner is used here.
    if (alertsEnabled && Array.isArray(marksData) && marksData.length > 0 && currentBtcPrice > 0) {
      const serverMarketContext = { ...marketContext, regime: marketRegime };
      const autoProfile = determineOptimalMarketProfile(serverMarketContext, accountInfo, positions);
      const opportunities = scanEntryOpportunities(
        marksData,
        currentBtcPrice,
        avgMarketIv,
        positions,
        serverMarketContext,
        autoProfile.key,
      );
      results.entrySignalsChecked = opportunities.length;

      // Send at most one best entry signal per cron run, with a persistent cooldown.
      const bestOpportunity = opportunities.find(opportunity => {
        const evaluation = evaluateEntryRules(opportunity, serverMarketContext, accountInfo, positions);
        if (evaluation.isBlocked) return false;
        opportunity.evaluation = evaluation;
        return true;
      });
      if (bestOpportunity) {
        const entryKey = `entry:${bestOpportunity.id}:${bestOpportunity.strategy}:${marketRegime.regime}`;
        const shouldSendEntry = await claimAlert(entryKey, 8 * 60 * 60);
        if (shouldSendEntry) {
          const signalType = bestOpportunity.strategy === "SHORT_PUT"
            ? "short_put_signal"
            : bestOpportunity.strategy === "SKEWED_STRANGLE"
              ? "skewed_strangle_signal"
              : "strangle_signal";
          await sendTelegramMessage(signalType, bestOpportunity);
          results.alertsDispatched++;
          results.entrySignalDispatched = bestOpportunity.id;
        }
      }
    }

    // 4. Evaluate Positions for Critical Risk / Take Profit
    const serverPositionAlerts = alertsEnabled
      ? checkAlerts(positions, new Set(), DEFAULT_ALERT_PREFERENCES)
      : [];
    for (const alert of serverPositionAlerts) {
      const pos = alert.pos;
      const pct = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;
      const alertStateKey = `position:${alert.alertKey}`;
      const shouldSend = await claimAlert(alertStateKey, 8 * 60 * 60);
      if (!shouldSend) continue;
      await sendTelegramMessage("warning", {
        posId: pos.id,
        posType: pos.type,
        strike: pos.strike,
        delta: pos.delta,
        pnl: pos.pnl,
        pctProfit: pct.toFixed(0),
        warningReason: alert.reason,
        alertLevel: alert.alertLevel,
        tacticalAction: alert.tacticalAction,
      });
      results.alertsDispatched++;
    }

    // 5. Daily Briefing Trigger (if requested or at 08:00 UTC / 15:00 UTC)
    const currentUtcHour = new Date().getUTCHours();
    const currentUtcMin = new Date().getUTCMinutes();
    const isScheduledBriefingTime = (currentUtcHour === 1 || currentUtcHour === 8) && currentUtcMin < 15;

    if (briefingEnabled && (isBriefingRequested || isScheduledBriefingTime)) {
      const now = new Date();
      const briefingKey = `briefing:${now.toISOString().slice(0, 10)}:${now.getUTCHours()}`;
      const shouldSendBriefing = await claimAlert(briefingKey, 20 * 60 * 60);
      if (!shouldSendBriefing) {
        return res.status(200).json({ ...results, briefingSkipped: "already_sent" });
      }
      const totalPnl = positions.reduce((s, p) => s + (p.pnl || 0), 0);
      const totalTheta = positions.reduce((s, p) => s + (Math.abs(p.theta || 0) * (p.size || 1)), 0);
      const netDelta = positions.reduce((s, p) => s + (p.positionDelta ?? ((p.delta || 0) * (p.size || 1))), 0);
      const minDte = positions.length > 0 ? Math.min(...positions.map(p => p.dte || 999)) : 0;
      const criticalCount = positions.filter(p => Math.abs(p.delta) >= 0.50 || (p.dte && p.dte <= 2)).length;

      const briefingData = {
        btcPrice: currentBtcPrice,
        change24h,
        marketIv: avgMarketIv,
        positionCount: positions.length,
        totalPnl: Math.round(totalPnl),
        totalTheta: Math.round(totalTheta),
        netDelta: Math.round(netDelta * 100) / 100,
        minDte: minDte === 999 ? 0 : minDte,
        criticalCount,
        marginRatio: accountInfo ? accountInfo.marginRatio : 0,
        regimeLabel: marketRegime.label,
        regimeConfidence: marketRegime.confidence,
        regimeAction: marketRegime.action,
      };

      await sendTelegramMessage("daily_briefing", briefingData);
      results.briefingDispatched = true;
    }

    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message, results });
  }
}
