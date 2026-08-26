// ─── Rules Engine v2.1 (Adaptive Multi-Strategy) ──────────────────────────────
// Evaluates Entry, Risk, and Management rules according to Strategy Types:
// 1. SHORT_PUT (Bullish High-IV Regime Strategy)
// 2. SKEWED_STRANGLE (Bullish Skewed Strangle)
// 3. STRANGLE (Standard Delta-Neutral Strangle)

import { STRATEGY_CONFIG } from "../config/strategyConfig.js";
import { classifyMarketRegime } from "./marketRegime.js";

/**
 * Evaluates an entry opportunity against strategy rules according to its strategy type.
 *
 * @param {object} opp - The opportunity object (SHORT_PUT, SKEWED_STRANGLE, or STRANGLE)
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

  const strategy = opp.strategy || "STRANGLE";
  const isShortPut = strategy === "SHORT_PUT";
  const isSkewed = strategy === "SKEWED_STRANGLE";

  // ── Market Regime Gate (fail closed) ────────────────────────────────────
  const regime = marketContext.regime?.regime ? marketContext.regime : classifyMarketRegime(marketContext);
  if (regime.isNoTrade) {
    isBlocked = true;
    sizeMultiplier = 0;
    checks.push({
      rule: "Market Regime Gate",
      status: "BLOCKED",
      message: `${regime.label} (${regime.confidence}%) — งดเปิดสถานะใหม่`,
      icon: "⛔",
    });
    reasons.push(`⛔ Regime ${regime.label}: ${regime.reasons[0]}`);
  } else if (!regime.allowedStrategies.includes(strategy)) {
    isBlocked = true;
    sizeMultiplier = 0;
    checks.push({
      rule: "Market Regime Gate",
      status: "BLOCKED",
      message: `${strategy} ไม่เหมาะกับ ${regime.label}`,
      icon: "⛔",
    });
    reasons.push(`⛔ Regime อนุญาตเฉพาะ ${regime.allowedStrategies.join(", ") || "NO_TRADE"}`);
  } else {
    sizeMultiplier *= regime.sizeMultiplier;
    checks.push({
      rule: "Market Regime Gate",
      status: regime.sizeMultiplier < 1 ? "WARNING" : "PASS",
      message: `${regime.label} (${regime.confidence}%) — Size x${regime.sizeMultiplier.toFixed(2)}`,
      icon: regime.sizeMultiplier < 1 ? "⚠️" : "✅",
    });
    if (regime.sizeMultiplier < 1) hasWarning = true;
  }

  // ── 0. Portfolio Holding Check ──────────────────────────────────────────
  if (opp.isFullyHeld) {
    isBlocked = true;
    checks.push({
      rule: "Portfolio Holding",
      status: "BLOCKED",
      message: isShortPut ? "ถือสัญญานี้ในพอร์ตแล้ว" : "ถือคู่นี้ในพอร์ตครบทั้ง 2 ขาแล้ว",
      icon: "❌",
    });
    reasons.push(isShortPut ? "❌ คุณถือสัญญานี้ในพอร์ตอยู่แล้ว (No Double Entry)" : "❌ คุณถือสัญญาคู่นี้ในพอร์ตอยู่แล้ว (No Double Entry)");
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
  if (isShortPut) {
    checks.push({
      rule: "Short Call Delta",
      status: "PASS",
      message: "ไม่มี Short Call (ไม่มี Upside Risk ในตลาดขาขึ้น)",
      icon: "✅",
    });
  } else if (isSkewed) {
    const callDelta = Math.abs(Number(opp.callDelta));
    if (callDelta > 0.14) {
      isBlocked = true;
      checks.push({
        rule: "Short Call Delta",
        status: "BLOCKED",
        message: `Call Delta = +${callDelta.toFixed(2)} (> 0.14 สำหรับ Skewed Strangle)`,
        icon: "❌",
      });
      reasons.push(`❌ Call Delta = +${callDelta.toFixed(2)} (เกินเกณฑ์ Skewed Strangle 0.08–0.12)`);
    } else {
      checks.push({
        rule: "Short Call Delta",
        status: "PASS",
        message: `Call Delta = +${callDelta.toFixed(2)} (ตรงเกณฑ์ Wide OTM Buffer)`,
        icon: "✅",
      });
    }
  } else {
    // Standard Strangle
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
  const marketIv = marketContext.marketIv ?? opp.marketIv ?? null;
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
        message: `IV Rank = ${ivRank}% (>= ${cfg.iv.ivrMin}% พรีเมียมสูง คุ้มค่าเสี่ยง)`,
        icon: "✅",
      });
    }
  } else if (marketIv != null) {
    hasWarning = true;
    sizeMultiplier *= 0.75;
    checks.push({
      rule: "Volatility Data Quality",
      status: "WARNING",
      message: `มีเฉพาะ Chain Average IV = ${Number(marketIv).toFixed(1)}% — ยังไม่มี IV Rank จากข้อมูลย้อนหลัง`,
      icon: "⚠️",
    });
    reasons.push("⚠️ ยังไม่มี IV Rank/Percentile จริง ระบบลดขนาดแนะนำ 25% และไม่ใช้ Current IV แทน Historical IV Rank");
  } else {
    isBlocked = true;
    checks.push({
      rule: "Volatility Data Quality",
      status: "BLOCKED",
      message: "ไม่มีข้อมูล IV ที่เชื่อถือได้",
      icon: "❌",
    });
    reasons.push("❌ ไม่มีข้อมูล IV — งดเปิด Position จาก Scanner");
  }

  // ── 5. Market Regime (Distance from MA20) ──────────────────────────────
  const rawDistMA20 = marketContext.distFromMA20 != null ? marketContext.distFromMA20 : null;
  const absDistMA20 = rawDistMA20 != null ? Math.abs(rawDistMA20) : null;

  if (rawDistMA20 != null) {
    if (isShortPut) {
      // For Short Put: Upward trend is favorable (moves price away from Put strike).
      if (rawDistMA20 > 20.0) {
        hasWarning = true;
        sizeMultiplier *= 0.50;
        checks.push({
          rule: "Market Regime (MA20)",
          status: "WARNING",
          message: `BTC เหนือ MA20 = +${rawDistMA20.toFixed(1)}% (พุ่งแรงมาก แนะนำลด Size 50% เผื่อ Pullback)`,
          icon: "⚠️",
        });
        reasons.push(`⚠️ BTC วิ่งขึ้นสูงกว่า MA20 มาก (+${rawDistMA20.toFixed(1)}%) → ลด Position Size 50% เผื่อเกิดการย่อตัว`);
      } else if (rawDistMA20 >= 0) {
        checks.push({
          rule: "Market Regime (MA20)",
          status: "PASS",
          message: `BTC เหนือ MA20 = +${rawDistMA20.toFixed(1)}% (ทิศทางขาขึ้น ปลอดภัยต่อ Short Put)`,
          icon: "✅",
        });
      } else if (rawDistMA20 < -10.0) {
        isBlocked = true;
        checks.push({
          rule: "Market Regime (MA20)",
          status: "BLOCKED",
          message: `BTC ต่ำกว่า MA20 = ${rawDistMA20.toFixed(1)}% (< -10% Downtrend กดดัน Put)`,
          icon: "❌",
        });
        reasons.push(`❌ BTC อยู่ต่ำกว่า MA20 เกิน -10% (ทิศทางขาลง เสี่ยงเจาะ Put)`);
      } else {
        hasWarning = true;
        sizeMultiplier *= 0.50;
        checks.push({
          rule: "Market Regime (MA20)",
          status: "WARNING",
          message: `BTC ต่ำกว่า MA20 = ${rawDistMA20.toFixed(1)}% (ลด Size 50%)`,
          icon: "⚠️",
        });
        reasons.push(`⚠️ BTC อยู่ต่ำกว่า MA20 เล็กน้อย (${rawDistMA20.toFixed(1)}%) → ลด Size 50%`);
      }
    } else if (isSkewed) {
      // Skewed Strangle: allows upward trend up to 14% without blocking
      if (rawDistMA20 > 16.0) {
        isBlocked = true;
        checks.push({
          rule: "Market Regime (MA20)",
          status: "BLOCKED",
          message: `BTC ห่างจาก MA20 = +${rawDistMA20.toFixed(1)}% (> 16% เสี่ยงทะลุแม้ Call จะไกล)`,
          icon: "❌",
        });
        reasons.push(`❌ BTC ห่างจาก MA20 = +${rawDistMA20.toFixed(1)}% (สูงเกิน 16% แนะนำใช้ Bullish Short Put แทน)`);
      } else if (absDistMA20 > 8.0) {
        hasWarning = true;
        sizeMultiplier *= 0.50;
        checks.push({
          rule: "Market Regime (MA20)",
          status: "WARNING",
          message: `BTC ห่างจาก MA20 = ${rawDistMA20.toFixed(1)}% (Elevated Skew → ลด Size 50%)`,
          icon: "⚠️",
        });
        reasons.push(`⚠️ BTC ห่างจาก MA20 = ${rawDistMA20.toFixed(1)}% → ลด Size 50%`);
      } else {
        checks.push({
          rule: "Market Regime (MA20)",
          status: "PASS",
          message: `BTC ห่างจาก MA20 = ${rawDistMA20.toFixed(1)}% (ผ่านเกณฑ์ Skewed Strangle)`,
          icon: "✅",
        });
      }
    } else {
      // Standard Strangle: strict Delta-Neutral Regime
      if (absDistMA20 > cfg.regime.extremeNoEntryPct) {
        isBlocked = true;
        checks.push({
          rule: "Market Regime (MA20)",
          status: "BLOCKED",
          message: `BTC ห่างจาก MA20 = ${absDistMA20.toFixed(1)}% (> 10% Extreme Trend เสี่ยงลาก Call)`,
          icon: "❌",
        });
        reasons.push(`❌ BTC ห่างจาก MA20 = ${absDistMA20.toFixed(1)}% (> 10% แนะนำเปลี่ยนไปใช้ Bullish Short Put)`);
      } else if (absDistMA20 > cfg.regime.normalMaxPct) {
        hasWarning = true;
        sizeMultiplier *= 0.50;
        checks.push({
          rule: "Market Regime (MA20)",
          status: "WARNING",
          message: `BTC ห่างจาก MA20 = ${absDistMA20.toFixed(1)}% (7–10% Elevated Trend → ลด Size 50%)`,
          icon: "⚠️",
        });
        reasons.push(`⚠️ BTC ห่างจาก MA20 = ${absDistMA20.toFixed(1)}% (Elevated Trend → ลด Size 50%)`);
      } else {
        checks.push({
          rule: "Market Regime (MA20)",
          status: "PASS",
          message: `BTC ห่างจาก MA20 = ${absDistMA20.toFixed(1)}% (<= 7% Normal Sideway)`,
          icon: "✅",
        });
      }
    }
  }

  // ── 6. Daily Volatility Safety ──────────────────────────────────────────
  const dailyMove = marketContext.change24h != null ? marketContext.change24h : null;
  if (dailyMove != null) {
    if (isShortPut) {
      if (dailyMove <= -cfg.volatilitySafety.maxDailyMovePct) {
        isBlocked = true;
        checks.push({
          rule: "Daily Volatility",
          status: "BLOCKED",
          message: `BTC ร่วงลง 24h = ${dailyMove.toFixed(1)}% (<= -5% Flash Drop เสี่ยงต่อ Put)`,
          icon: "❌",
        });
        reasons.push(`❌ BTC ทุบตัวลงแรงใน 24h = ${dailyMove.toFixed(1)}% (<= -5% ห้ามเปิด Put)`);
      } else if (dailyMove >= cfg.volatilitySafety.maxDailyMovePct) {
        hasWarning = true;
        sizeMultiplier *= 0.75;
        checks.push({
          rule: "Daily Volatility",
          status: "WARNING",
          message: `BTC พุ่งขึ้น 24h = +${dailyMove.toFixed(1)}% (>= +5% พุ่งแรง ลด Size 25% เผื่อพักฐาน)`,
          icon: "⚠️",
        });
        reasons.push(`⚠️ BTC พุ่งขึ้นใน 24h = +${dailyMove.toFixed(1)}% (ลด Size 25% เผื่อการพักฐาน)`);
      } else {
        checks.push({
          rule: "Daily Volatility",
          status: "PASS",
          message: `BTC 24h Move = ${dailyMove >= 0 ? "+" : ""}${dailyMove}% (< ±5%)`,
          icon: "✅",
        });
      }
    } else {
      const absDailyMove = Math.abs(dailyMove);
      if (absDailyMove >= cfg.volatilitySafety.maxDailyMovePct) {
        isBlocked = true;
        checks.push({
          rule: "Daily Volatility",
          status: "BLOCKED",
          message: `BTC 24h Move = ±${absDailyMove.toFixed(1)}% (>= 5% Volatility Spike)`,
          icon: "❌",
        });
        reasons.push(`❌ BTC แกว่งตัว 24h = ±${absDailyMove.toFixed(1)}% (>= 5% ห้ามเปิดเพื่อความปลอดภัย)`);
      } else {
        checks.push({
          rule: "Daily Volatility",
          status: "PASS",
          message: `BTC 24h Move = ${dailyMove >= 0 ? "+" : ""}${dailyMove}% (< ±5%)`,
          icon: "✅",
        });
      }
    }
  }

  // ── 7. Portfolio Margin Limit (30% caution / 35% hard ceiling) ──────────
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
    } else if (marginPct >= cfg.sizing.cautionMarginPct) {
      hasWarning = true;
      sizeMultiplier *= 0.5;
      checks.push({
        rule: "Total Margin Limit",
        status: "WARNING",
        message: `Margin Used = ${marginPct}% — โซนระวัง ${cfg.sizing.cautionMarginPct}–${cfg.sizing.maxTotalMarginPct}% ลดขนาดใหม่ 50%`,
        icon: "⚠️",
      });
      reasons.push(`⚠️ Margin ${marginPct}% อยู่ในโซนระวัง — ลดขนาด Position ใหม่ครึ่งหนึ่ง`);
    } else {
      checks.push({
        rule: "Total Margin Limit",
        status: "PASS",
        message: `Margin Used = ${marginPct}% (< ${cfg.sizing.cautionMarginPct}% Caution)`,
        icon: "✅",
      });
    }
  }

  // ── 8. Net Portfolio Delta Limit ────────────────────────────────────────
  if (Array.isArray(currentPositions) && currentPositions.length > 0) {
    const netDelta = currentPositions.reduce((s, p) => s + (p.positionDelta ?? (p.delta * (p.size || 1))), 0);
    const navBtc = accountInfo?.equity > 0 && marketContext?.price > 0 ? accountInfo.equity / marketContext.price : null;
    const normalizedNetDelta = navBtc > 0 ? netDelta / navBtc : netDelta;
    const absNetDelta = Math.abs(normalizedNetDelta);
    if (absNetDelta > cfg.portfolioDelta.hardLimit) {
      isBlocked = true;
      checks.push({
        rule: "Portfolio Delta Limit",
        status: "BLOCKED",
        message: `Net Delta / 1 BTC NAV = ${normalizedNetDelta.toFixed(2)} (> ${cfg.portfolioDelta.hardLimit})`,
        icon: "❌",
      });
      reasons.push(`❌ Net Delta / 1 BTC NAV = ${normalizedNetDelta.toFixed(2)} (เกิน Hard Limit ${cfg.portfolioDelta.hardLimit})`);
    } else if (absNetDelta > cfg.portfolioDelta.warningThreshold) {
      hasWarning = true;
      checks.push({
        rule: "Portfolio Delta Limit",
        status: "WARNING",
        message: `Net Delta / 1 BTC NAV = ${normalizedNetDelta.toFixed(2)} (> ${cfg.portfolioDelta.warningThreshold})`,
        icon: "⚠️",
      });
      reasons.push(`⚠️ Net Delta / 1 BTC NAV = ${normalizedNetDelta.toFixed(2)} (พอร์ตเอียงทิศทาง)`);
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
