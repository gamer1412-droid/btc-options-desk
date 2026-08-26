import { STRATEGY_CONFIG } from "../config/strategyConfig.js";
import { evaluateEntryRules } from "./rulesEngine.js";

/**
 * Parse Binance /eapi/v1/account response into a clean object.
 * Supports all Binance European Options schema variations.
 */
export function parseAccountInfo(rawAccount) {
  if (!rawAccount) return null;

  const assets = rawAccount.asset ?? rawAccount.assets ?? [];

  // Find USDT asset info (or fallback to first asset or root)
  const usdt = Array.isArray(assets)
    ? (assets.find(a => (a.asset || a.currency) === "USDT") || assets[0] || {})
    : {};

  // Total Equity
  const equity = Number(
    rawAccount.equity ??
    rawAccount.totalEquity ??
    usdt.equity ??
    rawAccount.marginBalance ??
    usdt.marginBalance ??
    0
  );

  // Margin Balance (Wallet Balance)
  const balance = Number(
    rawAccount.marginBalance ??
    usdt.marginBalance ??
    rawAccount.balance ??
    usdt.walletBalance ??
    usdt.balance ??
    equity
  );

  // Available Balance / Available Margin
  const availableBalance = Number(
    rawAccount.availableMargin ??
    rawAccount.availableBalance ??
    rawAccount.available ??
    usdt.available ??
    usdt.availableBalance ??
    0
  );

  // Maintenance Margin / Margin Used
  const marginUsed = Number(
    rawAccount.maintenanceMargin ??
    rawAccount.maintMargin ??
    rawAccount.initialMargin ??
    rawAccount.locked ??
    usdt.locked ??
    usdt.maintMargin ??
    usdt.initialMargin ??
    0
  );

  // Margin Ratio %
  const marginRatioRaw = Number(
    rawAccount.marginRatio ??
    rawAccount.marginRate ??
    usdt.marginRatio ??
    0
  );
  const marginRatioPct = marginRatioRaw > 0
    ? (marginRatioRaw <= 1 ? Math.round(marginRatioRaw * 1000) / 10 : Math.round(marginRatioRaw * 10) / 10)
    : (equity > 0 && marginUsed > 0 ? Math.round((marginUsed / equity) * 1000) / 10 : 0);

  // Unrealized PnL
  const unrealizedPnl = Number(
    rawAccount.unrealizedPNL ??
    rawAccount.unrealizedPnl ??
    usdt.unrealizedPNL ??
    usdt.unrealizedPnl ??
    0
  );

  return {
    equity: Math.round(equity * 100) / 100,
    balance: Math.round(balance * 100) / 100,
    availableBalance: Math.round(availableBalance * 100) / 100,
    marginUsed: Math.round(marginUsed * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    marginPct: marginRatioPct || (equity > 0 ? Math.round((marginUsed / equity) * 100) : 0),
    hasConnected: true,
  };
}

/**
 * Standard lot sizes for Binance Options, ordered from smallest to largest.
 */
const LOT_SIZES = [0.01, 0.02, 0.03, 0.05, 0.10, 0.20, 0.50, 1.0];

export function calculatePortfolioStress(currentPositions = [], btcPrice = 0, equity = 0) {
  if (!Array.isArray(currentPositions) || currentPositions.length === 0 || btcPrice <= 0 || equity <= 0) {
    return { available: false, scenarios: [], worstLoss: null, worstLossPct: null };
  }

  const hasGreeks = currentPositions.every(p => Number.isFinite(Number(p.positionDelta)) && Number.isFinite(Number(p.positionGamma)));
  if (!hasGreeks) return { available: false, scenarios: [], worstLoss: null, worstLossPct: null };

  const scenarios = [-20, -10, -5, 5, 10, 20].map(movePct => {
    const spotMove = btcPrice * (movePct / 100);
    const estimatedPnl = currentPositions.reduce((sum, p) => {
      return sum + Number(p.positionDelta) * spotMove + 0.5 * Number(p.positionGamma) * spotMove * spotMove;
    }, 0);
    return { movePct, estimatedPnl: Math.round(estimatedPnl * 100) / 100 };
  });
  const worstPnl = Math.min(...scenarios.map(s => s.estimatedPnl));
  const worstLoss = Math.max(0, -worstPnl);
  return {
    available: true,
    method: "delta-gamma spot shock (excludes IV/skew/liquidity)",
    scenarios,
    worstLoss: Math.round(worstLoss * 100) / 100,
    worstLossPct: Math.round((worstLoss / equity) * 1000) / 10,
  };
}

/**
 * Calculate position sizing recommendations for a Short Strangle opportunity.
 *
 * @param {object} accountInfo - Parsed account info from parseAccountInfo()
 * @param {object} opp - Strangle opportunity from scanner
 * @param {number} btcPrice - Current BTC price
 * @param {number} sizeMultiplier - Multiplier from rules engine (e.g. 0.5, 0.75, 1.0)
 * @returns {object} Sizing recommendations
 */
export function calculatePositionSize(accountInfo, opp, btcPrice, sizeMultiplier = 1.0) {
  if (!opp || !btcPrice) {
    return {
      available: false,
      reason: "ไม่มีข้อมูลคู่สัญญา",
      lots: [],
    };
  }

  const cfg = STRATEGY_CONFIG;
  const equity = Number(accountInfo?.equity || 0);
  const marginUsed = Number(accountInfo?.marginUsed || 0);
  const availableBalance = Number(accountInfo?.availableBalance || 0);
  const hasRealAccount = equity > 0;

  // ─── Trading Rules v2.0 ──────────────────────────────────────────────────
  const MAX_MARGIN_PCT = cfg.sizing.maxTotalMarginPct / 100;     // Hard max of equity as total margin
  const PER_TRADE_PCT = (cfg.sizing.maxCapitalPerTradePct / 100) * sizeMultiplier; // Max 3% (adjusted by multiplier)

  const maxTotalMargin = hasRealAccount ? equity * MAX_MARGIN_PCT : 0;
  const marginHeadroom = hasRealAccount ? Math.max(0, maxTotalMargin - marginUsed) : 0;
  const perTradeMax = hasRealAccount ? equity * PER_TRADE_PCT : 0;

  // ─── Margin estimation per 1 BTC ──────────────────────────────────────────
  const isSingleLeg = opp.strategy === "SINGLE_PUT" || opp.strategy === "SINGLE_CALL" || opp.strategy === "SHORT_PUT";
  const marginPerBtc = btcPrice * (isSingleLeg ? 0.15 : 0.20);
  const totalPremiumPerBtc = opp.totalPremium || opp.markPrice || 0;
  const totalThetaPerBtc = opp.totalTheta || Math.abs(opp.theta || 0);

  // ─── Calculate lot recommendations ────────────────────────────────────────
  const lots = LOT_SIZES.map(size => {
    const marginRequired = marginPerBtc * size;
    const premiumReceived = totalPremiumPerBtc * size;
    const maxLoss = (totalPremiumPerBtc * cfg.exit.hardStopLossMultiplier) * size; // 2x premium stop-loss rule
    const riskPct = hasRealAccount ? (maxLoss / equity) * 100 : 0;
    const marginPctOfEquity = hasRealAccount ? (marginRequired / equity) * 100 : 0;
    const thetaPerDay = totalThetaPerBtc * size;

    // Can we afford this lot?
    const canAfford = hasRealAccount ? (marginRequired <= marginHeadroom && marginRequired <= availableBalance) : false;
    // Does it comply with 3% per-trade rule?
    const withinRule = hasRealAccount ? (marginRequired <= perTradeMax) : false;

    return {
      size,
      label: size.toFixed(2),
      marginRequired: Math.round(marginRequired),
      premiumReceived: Math.round(premiumReceived),
      maxLoss: Math.round(maxLoss),
      riskPct: riskPct > 0 ? riskPct.toFixed(1) : "-",
      marginPctOfEquity: marginPctOfEquity > 0 ? marginPctOfEquity.toFixed(1) : "-",
      thetaPerDay: thetaPerDay.toFixed(1),
      canAfford,
      withinRule,
      isRecommended: canAfford && withinRule && sizeMultiplier > 0,
    };
  });

  // Recommended lot
  const recommendedLots = lots.filter(l => l.isRecommended);
  const bestLot = recommendedLots.length > 0
    ? recommendedLots[recommendedLots.length - 1]
    : lots[0];

  const defaultLot = lots.find(l => l.size === cfg.sizing.defaultLotSize) || lots[0];

  return {
    available: true,
    hasRealAccount,
    equity: Math.round(equity),
    marginUsed: Math.round(marginUsed),
    marginHeadroom: Math.round(marginHeadroom),
    perTradeMax: Math.round(perTradeMax),
    maxTotalMargin: Math.round(maxTotalMargin),
    marginPerBtc: Math.round(marginPerBtc),
    sizeMultiplier,
    lots,
    recommendedLot: hasRealAccount ? bestLot : null,
    defaultLot,
  };
}

/**
 * Calculate portfolio capacity & clear Action Verdict:
 * - How many more lots can be opened?
 * - Should you enter right now or wait?
 */
export function calculatePortfolioCapacity(accountInfo, currentPositions = [], btcPrice = 65000, marketContext = {}, opportunities = []) {
  const equity = Number(accountInfo?.equity || 0);
  const availableBalance = Number(accountInfo?.availableBalance || 0);
  const marginUsed = Number(accountInfo?.marginUsed || 0);
  const hasAccountData = Boolean(accountInfo && equity > 0);
  const marginPct = accountInfo?.marginPct ?? (equity > 0 ? Math.round((marginUsed / equity) * 100) : null);
  const openCount = currentPositions.length;
  const stress = calculatePortfolioStress(currentPositions, btcPrice, equity);

  // Margin required per standard 0.01 BTC lot
  const marginPerLot = Math.round((btcPrice || 65000) * 0.20 * 0.01);       // Strangle ~ $130
  const marginPerSingleLeg = Math.round((btcPrice || 65000) * 0.15 * 0.01);  // Single leg ~ $98

  // How many lots can physically be opened based on available USDT in Binance wallet?
  const maxLotsByCash = marginPerLot > 0 ? Math.floor(availableBalance / marginPerLot) : 0;

  // How many lots according to the configured hard margin cap?
  const maxAllowedMargin = equity * (STRATEGY_CONFIG.sizing.maxTotalMarginPct / 100);
  const headroomByRule = Math.max(0, maxAllowedMargin - marginUsed);
  const maxLotsByRule = marginPerLot > 0 ? Math.floor(headroomByRule / marginPerLot) : 0;

  // Market volatility checks
  const isExtremeVolatility = Math.abs(marketContext?.change24h || 0) >= 5;
  const hasPassOpportunities = opportunities.some(o => {
    if (o.isFullyHeld || !(o.isPreferredDTE || o.isIdealDTE)) return false;
    return !evaluateEntryRules(o, marketContext, accountInfo, currentPositions).isBlocked;
  });

  let verdict = "WAIT"; // "BUY_NOW" | "CAUTION_WAIT" | "WAIT_SETUP" | "BLOCKED"
  let headline = "";
  let badgeColor = "amber";
  let actionText = "";
  let remainingLots = Math.min(maxLotsByCash, maxLotsByRule);

  if (!hasAccountData || !btcPrice) {
    verdict = "BLOCKED";
    headline = "⚪ ยังประเมินกำลังพอร์ตไม่ได้";
    actionText = "ต้องมีข้อมูล Account Equity, Available Margin และราคา BTC ที่เป็นปัจจุบันก่อน ระบบจึงจะคำนวณขนาด Position ได้";
    badgeColor = "amber";
    remainingLots = 0;
  } else if (stress.available && stress.worstLossPct > STRATEGY_CONFIG.sizing.maxTotalPortfolioRiskPct) {
    verdict = "BLOCKED";
    headline = `🔴 งดเปิดเพิ่ม — Spot Stress Loss ≈ ${stress.worstLossPct}% ของพอร์ต`;
    actionText = `เกินเพดาน Portfolio Stress Risk ${STRATEGY_CONFIG.sizing.maxTotalPortfolioRiskPct}% (ประมาณด้วย Delta-Gamma, ยังไม่รวม IV/Skew)`;
    badgeColor = "red";
    remainingLots = 0;
  } else if (isExtremeVolatility) {
    verdict = "BLOCKED";
    headline = "❌ ห้ามเปิด Position เพิ่มในขณะนี้";
    actionText = `ตลาดผันผวนรุนแรง (BTC 24h Move ${marketContext.change24h}%) ตามกฎความปลอดภัยต้องงดเปิดไม้ใหม่จนกว่าตลาดจะนิ่ง`;
    badgeColor = "red";
    remainingLots = 0;
  } else if (availableBalance < marginPerSingleLeg) {
    verdict = "BLOCKED";
    headline = "❌ ไม่สามารถเปิดไม้ใหม่ได้ (เงิน Margin ไม่พอ)";
    actionText = `เงินคงเหลือใน Options Wallet มี $${availableBalance.toFixed(1)} ซึ่งน้อยกว่า Margin ขั้นต่ำสำหรับ 0.01 BTC ($${marginPerSingleLeg})`;
    badgeColor = "red";
    remainingLots = 0;
  } else if (marginPct >= STRATEGY_CONFIG.sizing.maxTotalMarginPct || maxLotsByRule <= 0) {
    verdict = "BLOCKED";
    headline = `🔴 งดเปิด Position เพิ่ม (Margin ${marginPct}% / ${STRATEGY_CONFIG.sizing.maxTotalMarginPct}% Max)`;
    actionText = "พอร์ตชนเพดาน Margin ตามกฎแล้ว ต้องลดความเสี่ยงหรือปิด Position เดิมก่อนเปิดเพิ่ม";
    badgeColor = "red";
    remainingLots = 0;
  } else if (remainingLots > 0 && hasPassOpportunities) {
    verdict = "BUY_NOW";
    headline = `🟢 พอร์ตมี Capacity สูงสุดอีก ${remainingLots} ไม้`;
    actionText = "มีสัญญาที่ผ่านกรอบเบื้องต้น โปรดตรวจ Checklist, bid/ask และ Margin จริงบน Binance ก่อนส่งคำสั่ง";
    badgeColor = "green";
  } else if (remainingLots > 0) {
    verdict = "WAIT_SETUP";
    headline = `🔵 พอร์ตมี Capacity อีก ${remainingLots} ไม้ แต่ยังไม่มี Setup ที่ผ่านเกณฑ์`;
    actionText = "รอข้อมูลสัญญาที่ตรง Delta/DTE และตรวจสอบราคาที่ซื้อขายได้จริงก่อน";
    badgeColor = "blue";
  } else {
    verdict = "BLOCKED";
    headline = "🔴 ไม่มี Capacity สำหรับ Position ใหม่";
    actionText = "Available Margin หรือเพดานความเสี่ยงไม่เพียงพอสำหรับขนาดขั้นต่ำ 0.01 BTC";
    badgeColor = "red";
    remainingLots = 0;
  }

  return {
    verdict,
    headline,
    badgeColor,
    actionText,
    remainingLots,
    maxLotsByCash,
    maxLotsByRule,
    marginPerLot,
    marginPct,
    availableBalance,
    equity,
    openCount,
    hasAccountData,
    stress,
  };
}
