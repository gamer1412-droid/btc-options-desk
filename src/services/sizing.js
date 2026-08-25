import { STRATEGY_CONFIG } from "../config/strategyConfig.js";

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
  const MAX_MARGIN_PCT = cfg.sizing.maxTotalMarginPct / 100;     // Max 30% of equity as total margin
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
    const canAfford = hasRealAccount ? (marginRequired <= marginHeadroom && marginRequired <= availableBalance) : true;
    // Does it comply with 3% per-trade rule?
    const withinRule = hasRealAccount ? (marginRequired <= perTradeMax) : (size <= 0.01);

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
    recommendedLot: hasRealAccount ? bestLot : defaultLot,
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
  const marginPct = accountInfo?.marginPct || (equity > 0 ? Math.round((marginUsed / equity) * 100) : 0);
  const openCount = currentPositions.length;

  // Margin required per standard 0.01 BTC lot
  const marginPerLot = Math.round((btcPrice || 65000) * 0.20 * 0.01);       // Strangle ~ $130
  const marginPerSingleLeg = Math.round((btcPrice || 65000) * 0.15 * 0.01);  // Single leg ~ $98

  // How many lots can physically be opened based on available USDT in Binance wallet?
  const maxLotsByCash = marginPerLot > 0 ? Math.floor(availableBalance / marginPerLot) : 0;

  // How many lots according to strict 30% margin cap rule?
  const maxAllowedMargin = equity * 0.30;
  const headroomByRule = Math.max(0, maxAllowedMargin - marginUsed);
  const maxLotsByRule = marginPerLot > 0 ? Math.floor(headroomByRule / marginPerLot) : 0;

  // Market volatility checks
  const isExtremeVolatility = Math.abs(marketContext?.change24h || 0) >= 5;
  const hasPassOpportunities = opportunities.some(o => !o.isFullyHeld && (o.isPreferredDTE || o.isIdealDTE));

  let verdict = "WAIT"; // "BUY_NOW" | "CAUTION_WAIT" | "WAIT_SETUP" | "BLOCKED"
  let headline = "";
  let badgeColor = "amber";
  let actionText = "";
  let remainingLots = maxLotsByCash;

  if (isExtremeVolatility) {
    verdict = "BLOCKED";
    headline = "❌ ห้ามเปิด Position เพิ่มในขณะนี้";
    actionText = `ตลาดผันผวนรุนแรง (BTC 24h Move ${marketContext.change24h}%) ตามกฎความปลอดภัยต้องงดเปิดไม้ใหม่จนกว่าตลาดจะนิ่ง`;
    badgeColor = "red";
    remainingLots = 0;
  } else if (availableBalance < marginPerSingleLeg && equity > 0) {
    verdict = "BLOCKED";
    headline = "❌ ไม่สามารถเปิดไม้ใหม่ได้ (เงิน Margin ไม่พอ)";
    actionText = `เงินคงเหลือใน Options Wallet มี $${availableBalance.toFixed(1)} ซึ่งน้อยกว่า Margin ขั้นต่ำสำหรับ 0.01 BTC ($${marginPerSingleLeg})`;
    badgeColor = "red";
    remainingLots = 0;
  } else if (marginPct > 40 && equity > 0) {
    // Current margin is over 40% (like user's 44.5%)
    verdict = "CAUTION_WAIT";
    headline = `🟡 แนะนำรอปิดทำกำไรก่อน (พอร์ตใช้ Margin ${marginPct}% แล้ว)`;
    actionText = `กระเป๋ามีเงินพอเปิดได้อีก ${maxLotsByCash} ไม้ (0.01 BTC) แต่เนื่องจาก Margin รวมปัจจุบันเกินเพดานความปลอดภัย 30% แนะนำให้รอปิด TP ไม้เดิมก่อนเปิดเพิ่ม`;
    badgeColor = "amber";
    remainingLots = maxLotsByCash;
  } else if (maxLotsByCash > 0 && hasPassOpportunities) {
    verdict = "BUY_NOW";
    headline = `🟢 ควรเปิดได้เลย (พร้อมเข้าอีก ${maxLotsByCash} ไม้)`;
    actionText = `สถานะพอร์ตพร้อม + มีคู่สัญญาผ่านเกณฑ์ DTE 18-25 วันใน Scanner แนะนำเปิดขนาด 0.01 BTC`;
    badgeColor = "green";
    remainingLots = maxLotsByCash;
  } else if (maxLotsByCash > 0) {
    verdict = "WAIT_SETUP";
    headline = `🟢 พอร์ตพร้อมเปิดได้อีก ${maxLotsByCash} ไม้ (กำลังรอจังหวะสัญญา)`;
    actionText = `เงินในพอร์ตพร้อมเทรด แต่ควรรอสแกนเจอรอบที่ตรงเกณฑ์ Delta 0.15-0.20 และ DTE 18-25 วัน`;
    badgeColor = "blue";
    remainingLots = maxLotsByCash;
  } else {
    verdict = "READY";
    headline = "🟢 พร้อมเปิดได้ 1 ไม้ (0.01 BTC)";
    actionText = "แนะนำเปิดขนาดเริ่มต้น 0.01 BTC ต่อ 1 คู่สัญญา";
    badgeColor = "green";
    remainingLots = 1;
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
  };
}


