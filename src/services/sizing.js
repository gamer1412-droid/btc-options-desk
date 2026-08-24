// ─── Position Sizing Calculator ──────────────────────────────────────────────
// Calculates recommended trade amounts based on account balance and trading rules:
// - Max total margin: 40% of equity
// - Max per-trade risk: 5% of equity
// - Default starting amount: 0.01 BTC (user's preference)

/**
 * Parse Binance /eapi/v1/account response into a clean object.
 * The response contains an array of asset details; we extract USDT balances.
 */
export function parseAccountInfo(rawAccount) {
  if (!rawAccount) return null;

  // Binance eapi/v1/account returns: { asset: [...], ... }
  // or sometimes the whole response is the account object
  const assets = rawAccount.asset ?? rawAccount.assets ?? [];
  const greeks = rawAccount.greeks ?? rawAccount.optionGreeks ?? {};

  // Find USDT asset info
  const usdt = Array.isArray(assets)
    ? assets.find(a => (a.asset || a.currency) === "USDT") || {}
    : {};

  const equity = Number(rawAccount.equity ?? usdt.equity ?? 0);
  const balance = Number(rawAccount.balance ?? usdt.walletBalance ?? usdt.balance ?? 0);
  const availableBalance = Number(rawAccount.availableBalance ?? usdt.availableBalance ?? 0);
  const marginUsed = Number(rawAccount.maintMargin ?? rawAccount.marginBalance ?? 0);
  const unrealizedPnl = Number(rawAccount.unrealizedPNL ?? usdt.unrealizedPNL ?? 0);

  return {
    equity,           // Total account value (balance + unrealized P&L)
    balance,          // Wallet balance (realized)
    availableBalance, // Available for new positions
    marginUsed,       // Currently used margin
    unrealizedPnl,
    marginPct: equity > 0 ? Math.round((marginUsed / equity) * 100) : 0,
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
 * @returns {object} Sizing recommendations
 */
export function calculatePositionSize(accountInfo, opp, btcPrice) {
  if (!opp || !btcPrice) {
    return {
      available: false,
      reason: "ไม่มีข้อมูลคู่สัญญา",
      lots: [],
    };
  }

  const equity = Number(accountInfo?.equity || 0);
  const marginUsed = Number(accountInfo?.marginUsed || 0);
  const availableBalance = Number(accountInfo?.availableBalance || 0);
  const hasRealAccount = equity > 0;

  // ─── Trading Rules ────────────────────────────────────────────────────────
  const MAX_MARGIN_PCT = 0.40;     // Max 40% of equity as total margin
  const PER_TRADE_PCT = 0.05;      // Max 5% of equity per trade

  const maxTotalMargin = hasRealAccount ? equity * MAX_MARGIN_PCT : 0;
  const marginHeadroom = hasRealAccount ? Math.max(0, maxTotalMargin - marginUsed) : 0;
  const perTradeMax = hasRealAccount ? equity * PER_TRADE_PCT : 0;

  // ─── Margin estimation per 1 BTC ──────────────────────────────────────────
  // For Strangle: margin ≈ 20% of BTC price
  // For Single Leg (Put or Call): margin ≈ 15% of BTC price
  const isSingleLeg = opp.strategy === "SINGLE_PUT" || opp.strategy === "SINGLE_CALL";
  const marginPerBtc = btcPrice * (isSingleLeg ? 0.15 : 0.20);
  const totalPremiumPerBtc = opp.totalPremium || opp.markPrice || 0;
  const totalThetaPerBtc = opp.totalTheta || Math.abs(opp.theta || 0);

  // ─── Calculate lot recommendations ────────────────────────────────────────
  const lots = LOT_SIZES.map(size => {
    const marginRequired = marginPerBtc * size;
    const premiumReceived = totalPremiumPerBtc * size;
    const maxLoss = (totalPremiumPerBtc * 2) * size; // 2× premium stop-loss rule
    const riskPct = hasRealAccount ? (maxLoss / equity) * 100 : 0;
    const marginPctOfEquity = hasRealAccount ? (marginRequired / equity) * 100 : 0;
    const thetaPerDay = totalThetaPerBtc * size;

    // Can we afford this lot?
    const canAfford = hasRealAccount ? (marginRequired <= marginHeadroom && marginRequired <= availableBalance) : true;
    // Does it comply with 5% per-trade rule?
    const withinRule = hasRealAccount ? (marginRequired <= perTradeMax) : (size <= 0.02);

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
      isRecommended: canAfford && withinRule,
    };
  });

  // Recommended lot
  const recommendedLots = lots.filter(l => l.isRecommended);
  const bestLot = recommendedLots.length > 0
    ? recommendedLots[recommendedLots.length - 1]
    : lots[0];

  const defaultLot = lots.find(l => l.size === 0.01) || lots[0];

  return {
    available: true,
    hasRealAccount,
    equity: Math.round(equity),
    marginUsed: Math.round(marginUsed),
    marginHeadroom: Math.round(marginHeadroom),
    perTradeMax: Math.round(perTradeMax),
    maxTotalMargin: Math.round(maxTotalMargin),
    marginPerBtc: Math.round(marginPerBtc),
    lots,
    recommendedLot: hasRealAccount ? bestLot : defaultLot,
    defaultLot,
  };
}

