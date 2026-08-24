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

  const equity = Number(
    rawAccount.equity ??
    usdt.equity ??
    rawAccount.marginBalance ??
    usdt.marginBalance ??
    rawAccount.balance ??
    usdt.walletBalance ??
    0
  );

  const balance = Number(
    rawAccount.balance ??
    usdt.walletBalance ??
    usdt.balance ??
    rawAccount.marginBalance ??
    usdt.marginBalance ??
    0
  );

  const availableBalance = Number(
    rawAccount.availableBalance ??
    rawAccount.available ??
    usdt.availableBalance ??
    usdt.available ??
    0
  );

  const marginUsed = Number(
    rawAccount.maintMargin ??
    rawAccount.initialMargin ??
    rawAccount.locked ??
    usdt.locked ??
    usdt.maintMargin ??
    usdt.initialMargin ??
    0
  );

  const unrealizedPnl = Number(
    rawAccount.unrealizedPNL ??
    usdt.unrealizedPNL ??
    0
  );

  return {
    equity: Math.round(equity * 100) / 100,
    balance: Math.round(balance * 100) / 100,
    availableBalance: Math.round(availableBalance * 100) / 100,
    marginUsed: Math.round(marginUsed * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    marginPct: equity > 0 ? Math.round((marginUsed / equity) * 100) : 0,
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
  const isSingleLeg = opp.strategy === "SINGLE_PUT" || opp.strategy === "SINGLE_CALL";
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

