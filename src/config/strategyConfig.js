// ─── Central Strategy Configuration v2.5 (Yield Boost & Multi-Profile) ────────
// BTC Option Desk — Production Trading Rules Specification v2.5

export const RISK_PROFILES = {
  CONSERVATIVE: {
    key: "CONSERVATIVE",
    label: "🛡️ CONSERVATIVE (Safe 25-35% APY)",
    desc: "Delta ไกลมาก 0.15–0.18, DTE 18–25 วัน เน้นความปลอดภัยสูงสุด",
    deltaMin: 0.14,
    deltaMax: 0.19,
    bullishPutMax: 0.22,
    dtePreferredMin: 18,
    dtePreferredMax: 25,
    dteMin: 14,
    dteMax: 30,
    takeProfitPct: 50,
  },
  BALANCED_ALPHA: {
    key: "BALANCED_ALPHA",
    label: "⚡ BALANCED ALPHA (50-65% APY)",
    desc: "Delta 0.20–0.24, DTE 12–20 วัน เก็บ Premium หนา Theta ไว (แนะนำ)",
    deltaMin: 0.18,
    deltaMax: 0.25,
    bullishPutMax: 0.27,
    dtePreferredMin: 12,
    dtePreferredMax: 20,
    dteMin: 10,
    dteMax: 28,
    takeProfitPct: 45,
  },
  HIGH_YIELD: {
    key: "HIGH_YIELD",
    label: "🔥 HIGH YIELD (80-110% APY)",
    desc: "Delta 0.25–0.28, DTE 7–14 วัน เก็บกระแสเงินสดก้อนโต หมุนเงินเร็วสุดขีด",
    deltaMin: 0.23,
    deltaMax: 0.30,
    bullishPutMax: 0.30,
    dtePreferredMin: 7,
    dtePreferredMax: 14,
    dteMin: 7,
    dteMax: 21,
    takeProfitPct: 40,
  },
};

export const STRATEGY_CONFIG = {
  version: "2.5",
  name: "BTC Option Desk Yield Boost Production Rules",
  activeProfile: "BALANCED_ALPHA",

  // 1. Entry Delta Filters (Balanced Alpha Default)
  delta: {
    call: {
      preferredMin: 0.18,
      preferredMax: 0.24,
      maxEntry: 0.26,
    },
    put: {
      preferredMin: 0.18,
      preferredMax: 0.24,
      maxEntry: 0.26,
      bullishMax: 0.28,
    },
  },

  // 2. Implied Volatility (IV) Filter
  iv: {
    ivrMin: 28,             // IV Rank >= 28%
    ivpMin: 35,
    lowIvpSizeMultiplier: 0.50,
  },

  // 3. Days to Expiry (DTE) Entry (Fast Theta Zone)
  dte: {
    min: 8,
    max: 28,
    preferredMin: 12,
    preferredMax: 20,
    shortDteMin: 8,
    shortDteMax: 11,
    shortDteMultiplier: 0.80,
  },

  // 4. Market Regime (Distance from BTC 20-Day Moving Average)
  regime: {
    normalMaxPct: 7.0,
    elevatedMaxPct: 10.0,
    extremeNoEntryPct: 12.0,
  },

  // 5. Daily Volatility Safety Filter
  volatilitySafety: {
    maxDailyMovePct: 6.0,
  },

  // 6. Position & Portfolio Sizing
  sizing: {
    maxCapitalPerTradePct: 3.5,
    maxTotalMarginPct: 30.0,
    maxTotalPortfolioRiskPct: 10.0,
    defaultLotSize: 0.01,
  },

  // 7. Net Portfolio Delta
  portfolioDelta: {
    warningThreshold: 0.18,
    hardLimit: 0.25,
  },

  // 8. Dynamic Take Profit Rules
  exit: {
    mainTpPct: 45,          // 45% of original premium -> CLOSE & Rotate
    quickTpPct: 30,         // 30% within <= 4 calendar days -> CLOSE
    quickTpDays: 4,
    dteStop: 2,
    hardStopLossMultiplier: 2.0,
  },

  // 9. Delta Defense & Strike Breach
  defense: {
    warningDelta: 0.38,
    strongWarningDelta: 0.52,
    actionDelta: 0.65,
  },

  // 10. Roll Rules
  roll: {
    maxRollsPerPosition: 1,
    requireNetCredit: true,
  },

  // 11. Drawdown Controls
  drawdown: {
    dailyLossLimitPct: 3.5,
    monthlyLossHalfSizePct: 10.0,
    monthlyLossStopPct: 15.0,
    consecutiveLossHalfSize: 3,
    consecutiveLossPause: 5,
  },
};
