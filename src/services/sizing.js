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
  if (!accountInfo || !opp || !btcPrice || accountInfo.equity <= 0) {
    return {
      available: false,
      reason: "ไม่สามารถดึงข้อมูลบัญชีได้",
      lots: [],
    };
  }

  const { equity, marginUsed, availableBalance } = accountInfo;

  // ─── Trading Rules ────────────────────────────────────────────────────────
  const MAX_MARGIN_PCT = 0.40;     // Max 40% of equity as total margin
  const PER_TRADE_PCT = 0.05;      // Max 5% of equity per trade

  // Available margin headroom
  const maxTotalMargin = equity * MAX_MARGIN_PCT;
  const marginHeadroom = Math.max(0, maxTotalMargin - marginUsed);
  const perTradeMax = equity * PER_TRADE_PCT;

  // ─── Estimate margin per lot ──────────────────────────────────────────────
  // Binance Options Short Strangle margin ≈ max(put_margin, call_margin) + other_leg_premium
  // Simplified estimate: ~15-25% of notional per lot (1 lot = 1 BTC notional equivalent)
  // More conservative: use 20% of BTC price as margin per 1 BTC
  // For fractional lots: margin_per_lot = margin_per_btc × lot_size
  const marginPerBtc = btcPrice * 0.20; // ~20% of BTC price as margin estimate
  const totalPremiumPerBtc = opp.totalPremium || 0;

  // ─── Calculate lot recommendations ────────────────────────────────────────
  const lots = LOT_SIZES.map(size => {
    const marginRequired = marginPerBtc * size;
    const premiumReceived = totalPremiumPerBtc * size;
    const maxLoss = (totalPremiumPerBtc * 2) * size; // 2× premium stop-loss rule
    const riskPct = equity > 0 ? (maxLoss / equity) * 100 : 0;
    const marginPctOfEquity = equity > 0 ? (marginRequired / equity) * 100 : 0;
    const thetaPerDay = (opp.totalTheta || 0) * size;

    // Can we afford this lot?
    const canAfford = marginRequired <= marginHeadroom && marginRequired <= availableBalance;
    // Does it comply with 5% per-trade rule?
    const withinRule = marginRequired <= perTradeMax;

    return {
      size,
      label: size.toFixed(2),
      marginRequired: Math.round(marginRequired),
      premiumReceived: Math.round(premiumReceived),
      maxLoss: Math.round(maxLoss),
      riskPct: riskPct.toFixed(1),
      marginPctOfEquity: marginPctOfEquity.toFixed(1),
      thetaPerDay: thetaPerDay.toFixed(1),
      canAfford,
      withinRule,
      isRecommended: canAfford && withinRule,
    };
  });

  // Find the recommended (largest lot that fits within rules)
  const recommendedLots = lots.filter(l => l.isRecommended);
  const bestLot = recommendedLots.length > 0
    ? recommendedLots[recommendedLots.length - 1] // largest that fits
    : null;

  // Default starting lot (user prefers 0.01)
  const defaultLot = lots.find(l => l.size === 0.01) || lots[0];

  return {
    available: true,
    equity: Math.round(equity),
    marginUsed: Math.round(marginUsed),
    marginHeadroom: Math.round(marginHeadroom),
    perTradeMax: Math.round(perTradeMax),
    maxTotalMargin: Math.round(maxTotalMargin),
    marginPerBtc: Math.round(marginPerBtc),
    lots,
    recommendedLot: bestLot,
    defaultLot,
  };
}
