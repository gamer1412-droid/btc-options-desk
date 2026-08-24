// ─── Central Strategy Configuration v2.0 ────────────────────────────────────
// BTC Option Desk — Production Trading Rules Specification v2.0
// Centralizes all risk limits, entry/exit thresholds, and regime filters.

export const STRATEGY_CONFIG = {
  version: "2.0",
  name: "BTC Option Desk Production Trading Rules",

  // 1. Entry Delta Filters
  delta: {
    call: {
      preferredMin: 0.15,
      preferredMax: 0.20,
      maxEntry: 0.20, // Strict max
    },
    put: {
      preferredMin: 0.15,
      preferredMax: 0.20,
      maxEntry: 0.20,
      bullishMax: 0.25, // Allowed only if market regime & portfolio metrics allow
    },
  },

  // 2. Implied Volatility (IV) Filter
  iv: {
    ivrMin: 30,             // IV Rank >= 30%
    ivpMin: 40,             // IV Percentile >= 40%
    lowIvpSizeMultiplier: 0.50, // IVR >= 30 but IVP < 40 -> reduce position size 50%
  },

  // 3. Days to Expiry (DTE) Entry
  dte: {
    min: 14,
    max: 28,
    preferredMin: 18,
    preferredMax: 25,
    shortDteMin: 14,        // 14–17 DTE -> allowed but reduce position size 25%
    shortDteMax: 17,
    shortDteMultiplier: 0.75,
  },

  // 4. Market Regime (Distance from BTC 20-Day Moving Average)
  regime: {
    normalMaxPct: 7.0,      // |Distance| <= 7% -> Normal
    elevatedMaxPct: 10.0,   // 7% < |Distance| <= 10% -> Reduce size 50%
    extremeNoEntryPct: 10.0, // |Distance| > 10% -> NO NEW ENTRY
  },

  // 5. Daily Volatility Safety Filter
  volatilitySafety: {
    maxDailyMovePct: 5.0,   // Daily Move >= ±5% -> STOP NEW ENTRY
  },

  // 6. Position & Portfolio Sizing
  sizing: {
    maxCapitalPerTradePct: 3.0,  // Max 3% of portfolio per position (Never 5%)
    maxTotalMarginPct: 30.0,      // Max 30% total portfolio margin (Normal: 10–25%)
    maxTotalPortfolioRiskPct: 10.0, // Max 10% estimated worst-case stress risk
    defaultLotSize: 0.01,
  },

  // 7. Net Portfolio Delta
  portfolioDelta: {
    warningThreshold: 0.15, // |Net Delta| > 0.15 BTC / 1 BTC NAV -> Warning
    hardLimit: 0.20,        // |Net Delta| > 0.20 BTC / 1 BTC NAV -> NO NEW ENTRY
  },

  // 8. Take Profit Rules
  exit: {
    mainTpPct: 50,          // 50% of original premium received -> CLOSE
    quickTpPct: 30,         // 25–30% within <= 5 calendar days -> CLOSE
    quickTpDays: 5,
    dteStop: 2,             // DTE <= 2 days -> CLOSE (Never hold to expiry)
    hardStopLossMultiplier: 2.0, // Loss >= 2.0x original premium -> Hard Stop
  },

  // 9. Delta Defense & Strike Breach
  defense: {
    warningDelta: 0.35,       // Delta >= 0.35 -> Defensive Review
    strongWarningDelta: 0.50, // Delta >= 0.50 -> Stop adding risk / Prepare Close/Roll
    actionDelta: 0.65,        // Delta >= 0.65 -> CLOSE or Execute Approved Roll
  },

  // 10. Roll Rules
  roll: {
    maxRollsPerPosition: 1,  // Maximum 1 roll per position (Never roll again)
    requireNetCredit: true,  // Net Credit > 0 required
  },

  // 11. Drawdown & Consecutive Loss Controls (Kill Switches)
  drawdown: {
    dailyLossLimitPct: 3.0,       // Daily loss >= 3% -> NO NEW ENTRY
    monthlyLossHalfSizePct: 10.0, // Monthly DD >= 10% -> Reduce size 50%
    monthlyLossStopPct: 15.0,     // Monthly DD >= 15% -> STOP STRATEGY
    consecutiveLossHalfSize: 3,   // 3 consecutive losses -> Reduce size 50%
    consecutiveLossPause: 5,      // 5 consecutive losses -> Pause strategy
  },
};
