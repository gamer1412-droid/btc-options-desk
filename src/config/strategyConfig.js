// ─── Central Strategy Configuration v3.0 (Regime-Aware Multi-Profile) ────────
// BTC Option Desk — Production Trading Rules Specification v3.0

export const RISK_PROFILES = {
  CONSERVATIVE: {
    key: "CONSERVATIVE",
    label: "🛡️ CONSERVATIVE (Wide Buffer)",
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
    label: "⚡ BALANCED ALPHA (Theta Fast)",
    desc: "Delta 0.18–0.25, DTE 10–16 วัน Theta ละลายไว ปิด 35% หมุนเร็ว (แนะนำ)",
    deltaMin: 0.18,
    deltaMax: 0.25,
    bullishPutMax: 0.27,
    dtePreferredMin: 10,
    dtePreferredMax: 16,
    dteMin: 8,
    dteMax: 28,
    takeProfitPct: 35,
  },
  HIGH_YIELD: {
    key: "HIGH_YIELD",
    label: "🔥 HIGH YIELD (Higher Gamma Risk)",
    desc: "Delta 0.25–0.28, DTE 7–14 วัน เก็บกระแสเงินสดก้อนโต หมุนเงินเร็วสุดขีด",
    deltaMin: 0.23,
    deltaMax: 0.30,
    bullishPutMax: 0.30,
    dtePreferredMin: 7,
    dtePreferredMax: 14,
    dteMin: 7,
    dteMax: 21,
    takeProfitPct: 50,
  },
};

export const STRATEGY_CONFIG = {
  version: "3.0",
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
    ivrMin: 35,             // IV Rank >= 35% — premium หนา คุ้ม tail risk
    ivpMin: 40,
    lowIvpSizeMultiplier: 0.50,
  },

  // 3. Days to Expiry (DTE) Entry (Fast Theta Zone)
  dte: {
    min: 8,
    max: 28,
    preferredMin: 10,
    preferredMax: 16,
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
    cautionMarginPct: 30.0,       // Above this level, halve new-position size
    maxTotalMarginPct: 35.0,      // Absolute hard ceiling for naked short premium
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
    mainTpPct: 35,          // 35% of original premium -> CLOSE & Rotate (หมุนเร็ว)
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

  // 12. Event Filter
  events: {
    blockBeforeCPI_FOMC_Days: 1,
  },

  // 13. Liquidity / Spread Filter
  liquidity: {
    maxSpreadPct: 5,        // BLOCK if (ask-bid)/markPrice*100 > 5%
    warnSpreadPct: 3,       // WARNING if 3-5%
    minVolume: 1,           // minimum 24h volume (contracts) — if API provides it
  },
};
