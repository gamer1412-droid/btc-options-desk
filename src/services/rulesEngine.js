// ─── Rules Engine v2.0 ──────────────────────────────────────────────────────
// Evaluates Entry, Risk, and Management rules strictly according to STRATEGY_CONFIG v2.0
// Produces transparent machine-readable decisions and human-readable feedback.

import { STRATEGY_CONFIG } from "../config/strategyConfig.js";

/**
 * Evaluates an entry opportunity against all v2.0 strategy rules.
 *
 * @param {object} opp - The Strangle opportunity object
 * @param {object} marketContext - { btcPrice, change24h, ma20, distFromMA20, ivRank, ivPercentile }
 * @param {object} accountInfo - { equity, marginUsed, availableBalance }
 * @param {Array} currentPositions - List of currently open positions
 * @returns {object} Evaluation result { decision: 'PASS'|'WARNING'|'BLOCKED', sizeMultiplier, checks: [], reasons: [] }
 */
export function evaluateEntryRules(opp, marketContext = {}, accountInfo = null, currentPositions = []) {
  const cfg = STRATEGY_CONFIG;
  const checks = [];
  const reasons = [];
  let isBlocked = false;
  let hasWarning = false;
  let sizeMultiplier = 1.0;

  // ── 0. Portfolio Holding Check ──────────────────────────────────────────
  if (opp.isFullyHeld) {
    isBlocked = true;
    checks.push({
      rule: "Portfolio Holding",
      status: "BLOCKED",
      message: "ถือคู่นี้ในพอร์ตครบทั้ง 2 ขาแล้ว",
      icon: "❌",
    });
    reasons.push("❌ คุณถือสัญญาคู่นี้ในพอร์ตอยู่แล้ว (No Double Entry)");
  } else if (opp.isPartiallyHeld) {
    hasWarning = true;
    checks.push({
      rule: "Portfolio Holding",
      status: "WARNING",
      message: "ถือสัญญาขาใดขาหนึ่งในพอร์ตแล้ว",
      icon: "⚠️",
    });
    reasons.push("⚠️ ถือขาใดขาหนึ่งอยู่ในพอร์ตแล้ว (ตรวจเช็ค Balance Delta ก่อนเข้าเพิ่ม)");
  }

  // ── 1. DTE Entry Check ──────────────────────────────────────────────────
  const dte = opp.dte;
  if (dte < cfg.dte.min) {
    isBlocked = true;
    checks.push({
      rule: "DTE Window",
      status: "BLOCKED",
      message: `DTE = ${dte} วัน (< ${cfg.dte.min} วัน) — Gamma Risk สูงเกินไป`,
      icon: "❌",
    });
    reasons.push(`❌ DTE = ${dte} วัน (ต่ำกว่าเกณฑ์ขั้นต่ำ ${cfg.dte.min} วัน)`);
  } else if (dte > cfg.dte.max) {
    isBlocked = true;
    checks.push({
      rule: "DTE Window",
      status: "BLOCKED",
      message: `DTE = ${dte} วัน (> ${cfg.dte.max} วัน) — ไม่ใช่ Main Strategy`,
      icon: "❌",
    });
    reasons.push(`❌ DTE = ${dte} วัน (เกินกรอบ Main Strategy ${cfg.dte.max} วัน)`);
  } else if (dte >= cfg.dte.preferredMin && dte <= cfg.dte.preferredMax) {
    checks.push({
      rule: "DTE Window",
      status: "PASS",
      message: `DTE = ${dte} วัน (อยู่ในโซน Preferred ${cfg.dte.preferredMin}–${cfg.dte.preferredMax} วัน)`,
      icon: "✅",
    });
  } else if (dte >= cfg.dte.shortDteMin && dte <= cfg.dte.shortDteMax) {
    hasWarning = true;
    sizeMultiplier *= cfg.dte.shortDteMultiplier; // Reduce size 25%
    checks.push({
      rule: "DTE Window",
      status: "WARNING",
      message: `DTE = ${dte} วัน (14–17 วัน → ลดขนาด Position 25%)`,
      icon: "⚠️",
    });
    reasons.push(`⚠️ DTE = ${dte} วัน (ช่วง 14–17 วัน ลด Position Size 25%)`);
  } else {
    checks.push({
      rule: "DTE Window",
      status: "PASS",
      message: `DTE = ${dte} วัน (ผ่านเกณฑ์ 14–28 วัน)`,
      icon: "✅",
    });
  }

  // ── 2. Call Delta Check ─────────────────────────────────────────────────
  const callDelta = Math.abs(Number(opp.callDelta));
  if (callDelta > cfg.delta.call.maxEntry) {
    isBlocked = true;
    checks.push({
      rule: "Short Call Delta",
      status: "BLOCKED",
      message: `Call Delta = +${callDelta.toFixed(2)} (> ${cfg.delta.call.maxEntry})`,
      icon: "❌",
    });
    reasons.push(`❌ Call Delta = +${callDelta.toFixed(2)} (เกินเพดานสูงสุด ${cfg.delta.call.maxEntry})`);
  } else if (callDelta >= cfg.delta.call.preferredMin && callDelta <= cfg.delta.call.preferredMax) {
    checks.push({
      rule: "Short Call Delta",
      status: "PASS",
      message: `Call Delta = +${callDelta.toFixed(2)} (ตรงเกณฑ์ Preferred 0.15–0.20)`,
      icon: "✅",
    });
  } else {
    checks.push({
      rule: "Short Call Delta",
      status: "PASS",
      message: `Call Delta = +${callDelta.toFixed(2)} (ผ่านเกณฑ์ <= 0.20)`,
      icon: "✅",
    });
  }

  // ── 3. Put Delta Check ──────────────────────────────────────────────────
  const putDelta = Math.abs(Number(opp.putDelta));
  if (putDelta > cfg.delta.put.bullishMax) {
    isBlocked = true;
    checks.push({
      rule: "Short Put Delta",
      status: "BLOCKED",
      message: `Put Delta = -${putDelta.toFixed(2)} (> ${cfg.delta.put.bullishMax})`,
      icon: "❌",
    });
    reasons.push(`❌ Put Delta = -${putDelta.toFixed(2)} (เกินเพดานสูงสุด ${cfg.delta.put.bullishMax})`);
  } else if (putDelta > cfg.delta.put.maxEntry) {
    hasWarning = true;
    checks.push({
      rule: "Short Put Delta",
      status: "WARNING",
      message: `Put Delta = -${putDelta.toFixed(2)} (เข้าข่าย Bullish Exception <= 0.25)`,
      icon: "⚠️",
    });
    reasons.push(`⚠️ Put Delta = -${putDelta.toFixed(2)} (สูงกว่าปกติ 0.20 ใช้อนุโลมเฉพาะ Bullish)`);
  } else {
    checks.push({
      rule: "Short Put Delta",
      status: "PASS",
      message: `Put Delta = -${putDelta.toFixed(2)} (ตรงเกณฑ์ Preferred 0.15–0.20)`,
      icon: "✅",
    });
  }

  // ── 4. Implied Volatility (IV) Filter ──────────────────────────────────
  const ivRank = marketContext.ivRank ?? opp.ivRank ?? null;
  if (ivRank != null) {
    if (ivRank < cfg.iv.ivrMin) {
      isBlocked = true;
      checks.push({
        rule: "IV Rank Filter",
        status: "BLOCKED",
        message: `IV Rank = ${ivRank}% (< ${cfg.iv.ivrMin}%) — Premium ไม่คุ้ม Tail Risk`,
        icon: "❌",
      });
      reasons.push(`❌ IV Rank = ${ivRank}% (ต่ำกว่าเกณฑ์ ${cfg.iv.ivrMin}% → ห้ามเปิด Position)`);
    } else {
      checks.push({
        rule: "IV Rank Filter",
        status: "PASS",
        message: `IV Rank = ${ivRank}% (>= ${cfg.iv.ivrMin}%)`,
        icon: "✅",
      });
    }
  }

  // ── 5. Market Regime (Distance from MA20) ──────────────────────────────
  const distFromMA20 = marketContext.distFromMA20 != null ? Math.abs(marketContext.distFromMA20) : null;
  if (distFromMA20 != null) {
    if (distFromMA20 > cfg.regime.extremeNoEntryPct) {
      isBlocked = true;
      checks.push({
        rule: "Market Regime (MA20)",
        status: "BLOCKED",
        message: `BTC ห่างจาก MA20 = ${distFromMA20.toFixed(1)}% (> 10% Extreme Trend)`,
        icon: "❌",
      });
      reasons.push(`❌ BTC ห่างจาก MA20 = ${distFromMA20.toFixed(1)}% (> 10% Strong Trend เสี่ยงโดนลาก)`);
    } else if (distFromMA20 > cfg.regime.normalMaxPct) {
      hasWarning = true;
      sizeMultiplier *= cfg.regime.elevatedMaxPct > 0 ? 0.50 : 1.0;
      checks.push({
        rule: "Market Regime (MA20)",
        status: "WARNING",
        message: `BTC ห่างจาก MA20 = ${distFromMA20.toFixed(1)}% (7–10% Elevated Trend → ลด Size 50%)`,
        icon: "⚠️",
      });
      reasons.push(`⚠️ BTC ห่างจาก MA20 = ${distFromMA20.toFixed(1)}% (Elevated Trend → ลด Size 50%)`);
    } else {
      checks.push({
        rule: "Market Regime (MA20)",
        status: "PASS",
        message: `BTC ห่างจาก MA20 = ${distFromMA20.toFixed(1)}% (<= 7% Normal Regime)`,
        icon: "✅",
      });
    }
  }

  // ── 6. Daily Volatility Safety ──────────────────────────────────────────
  const dailyMove = marketContext.change24h != null ? Math.abs(marketContext.change24h) : null;
  if (dailyMove != null) {
    if (dailyMove >= cfg.volatilitySafety.maxDailyMovePct) {
      isBlocked = true;
      checks.push({
        rule: "Daily Volatility",
        status: "BLOCKED",
        message: `BTC 24h Move = ±${dailyMove.toFixed(1)}% (>= 5% Volatility Spike)`,
        icon: "❌",
      });
      reasons.push(`❌ BTC แกว่งตัว 24h = ±${dailyMove.toFixed(1)}% (>= 5% ห้ามเปิด Position เพื่อความปลอดภัย)`);
    } else {
      checks.push({
        rule: "Daily Volatility",
        status: "PASS",
        message: `BTC 24h Move = ${marketContext.change24h >= 0 ? "+" : ""}${marketContext.change24h}% (< ±5%)`,
        icon: "✅",
      });
    }
  }

  // ── 7. Portfolio Margin Limit (Max 30%) ─────────────────────────────────
  if (accountInfo && accountInfo.equity > 0) {
    const marginPct = accountInfo.marginPct;
    if (marginPct >= cfg.sizing.maxTotalMarginPct) {
      isBlocked = true;
      checks.push({
        rule: "Total Margin Limit",
        status: "BLOCKED",
        message: `Margin Used = ${marginPct}% (>= ${cfg.sizing.maxTotalMarginPct}% Hard Ceiling)`,
        icon: "❌",
      });
      reasons.push(`❌ Margin Used ปัจจุบัน = ${marginPct}% (ชนเพดานสูงสุด ${cfg.sizing.maxTotalMarginPct}%)`);
    } else {
      checks.push({
        rule: "Total Margin Limit",
        status: "PASS",
        message: `Margin Used = ${marginPct}% (< ${cfg.sizing.maxTotalMarginPct}%)`,
        icon: "✅",
      });
    }
  }

  // ── 8. Net Portfolio Delta Limit ────────────────────────────────────────
  if (Array.isArray(currentPositions) && currentPositions.length > 0) {
    const netDelta = currentPositions.reduce((s, p) => s + (p.delta * (p.size || 1)), 0);
    const absNetDelta = Math.abs(netDelta);
    if (absNetDelta > cfg.portfolioDelta.hardLimit) {
      isBlocked = true;
      checks.push({
        rule: "Portfolio Delta Limit",
        status: "BLOCKED",
        message: `Net Portfolio Delta = ${netDelta.toFixed(2)} BTC (> ${cfg.portfolioDelta.hardLimit})`,
        icon: "❌",
      });
      reasons.push(`❌ Net Portfolio Delta = ${netDelta.toFixed(2)} BTC (เกิน Hard Limit ${cfg.portfolioDelta.hardLimit})`);
    } else if (absNetDelta > cfg.portfolioDelta.warningThreshold) {
      hasWarning = true;
      checks.push({
        rule: "Portfolio Delta Limit",
        status: "WARNING",
        message: `Net Portfolio Delta = ${netDelta.toFixed(2)} BTC (> ${cfg.portfolioDelta.warningThreshold})`,
        icon: "⚠️",
      });
      reasons.push(`⚠️ Net Portfolio Delta = ${netDelta.toFixed(2)} BTC (เอียงทิศทางเกิน 0.15)`);
    }
  }

  // ── Final Decision ──────────────────────────────────────────────────────
  let decision = "PASS";
  if (isBlocked) {
    decision = "BLOCKED";
    sizeMultiplier = 0.0;
  } else if (hasWarning) {
    decision = "WARNING";
  }

  return {
    decision,
    sizeMultiplier: Math.round(sizeMultiplier * 100) / 100,
    checks,
    reasons,
    isPassed: decision === "PASS",
    isWarning: decision === "WARNING",
    isBlocked: decision === "BLOCKED",
  };
}

/**
 * Classifies an active position into the v2.0 State Machine.
 * States: NORMAL -> WARNING -> DEFENSIVE -> ROLL_PENDING -> ROLLED -> EXIT
 */
export function classifyPositionState(pos) {
  const cfg = STRATEGY_CONFIG;
  const absDelta = Math.abs(pos.delta || 0);
  const dte = pos.dte ?? 999;
  const pnl = pos.pnl || 0;
  const premium = pos.premium || 0;
  const rollCount = pos.rollCount || 0;

  // 1. Hard Stop Exit
  if (premium > 0 && pnl < 0 && Math.abs(pnl) >= premium * cfg.exit.hardStopLossMultiplier) {
    return { state: "EXIT", level: "danger", label: "🚨 HARD STOP LOSS (Loss >= 2x Premium)" };
  }

  // 2. DTE Exit
  if (dte <= cfg.exit.dteStop) {
    return { state: "EXIT", level: "danger", label: `⏰ DTE EXIT (เหลือ ${dte} วัน ห้ามถือข้าม Expiry)` };
  }

  // 3. Take Profit
  const profitPct = premium > 0 ? ((premium - pos.currentPrice) / premium) * 100 : 0;
  if (profitPct >= cfg.exit.mainTpPct) {
    return { state: "EXIT", level: "success", label: `🎯 TAKE PROFIT (กำไร ${profitPct.toFixed(0)}% >= 50%)` };
  }

  // 4. Delta >= 0.65 (Action Level)
  if (absDelta >= cfg.defense.actionDelta) {
    if (rollCount < cfg.roll.maxRollsPerPosition) {
      return { state: "ROLL_PENDING", level: "danger", label: `🚨 ACTION REQUIRED (Delta ${absDelta.toFixed(2)} >= 0.65 — Close / Roll 1 ครั้ง)` };
    }
    return { state: "EXIT", level: "danger", label: `🚨 HARD CLOSE (Delta ${absDelta.toFixed(2)} >= 0.65 — ใช้สิทธิ์ Roll ไปแล้ว)` };
  }

  // 5. Delta >= 0.50 (Defensive Mode)
  if (absDelta >= cfg.defense.strongWarningDelta) {
    return { state: "DEFENSIVE", level: "danger", label: `⚠️ DEFENSIVE MODE (Delta ${absDelta.toFixed(2)} >= 0.50 — เตรียม Close / Roll)` };
  }

  // 6. Delta >= 0.35 (Warning)
  if (absDelta >= cfg.defense.warningDelta) {
    return { state: "WARNING", level: "warning", label: `⚠️ WARNING (Delta ${absDelta.toFixed(2)} >= 0.35 — เฝ้าระวัง)` };
  }

  return { state: "NORMAL", level: "healthy", label: "✅ NORMAL (อยู่ในเกณฑ์ปกติ)" };
}
