export const MARKET_REGIMES = Object.freeze({
  DATA_INCOMPLETE: "DATA_INCOMPLETE",
  CRISIS: "CRISIS",
  BREAKOUT_TRANSITION: "BREAKOUT_TRANSITION",
  BULL_TREND: "BULL_TREND",
  BEAR_TREND: "BEAR_TREND",
  RANGE_HIGH_IV: "RANGE_HIGH_IV",
  RANGE_LOW_IV: "RANGE_LOW_IV",
});

const finite = value => value != null && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const REGIME_META = {
  DATA_INCOMPLETE: {
    label: "DATA INCOMPLETE",
    color: "#94a3b8",
    action: "NO_TRADE",
    allowedStrategies: [],
    sizeMultiplier: 0,
  },
  CRISIS: {
    label: "CRISIS / CAPITAL PRESERVATION",
    color: "#ef4444",
    action: "NO_TRADE",
    allowedStrategies: [],
    sizeMultiplier: 0,
  },
  BREAKOUT_TRANSITION: {
    label: "BREAKOUT / TRANSITION",
    color: "#f59e0b",
    action: "NO_TRADE",
    allowedStrategies: [],
    sizeMultiplier: 0,
  },
  BULL_TREND: {
    label: "BULL TREND",
    color: "#00f0a8",
    action: "BULLISH_PREMIUM",
    allowedStrategies: ["SHORT_PUT", "SKEWED_STRANGLE"],
    sizeMultiplier: 0.75,
  },
  BEAR_TREND: {
    label: "BEAR TREND",
    color: "#fb7185",
    action: "NO_TRADE",
    allowedStrategies: [],
    sizeMultiplier: 0,
  },
  RANGE_HIGH_IV: {
    label: "RANGE + HIGH IV",
    color: "#c084fc",
    action: "NEUTRAL_PREMIUM",
    allowedStrategies: ["STRANGLE"],
    sizeMultiplier: 0.75,
  },
  RANGE_LOW_IV: {
    label: "RANGE + LOW IV",
    color: "#38bdf8",
    action: "NO_TRADE",
    allowedStrategies: [],
    sizeMultiplier: 0,
  },
};

function result(regime, confidence, reasons, metrics) {
  const meta = REGIME_META[regime];
  return {
    regime,
    label: meta.label,
    color: meta.color,
    action: meta.action,
    allowedStrategies: [...meta.allowedStrategies],
    sizeMultiplier: meta.sizeMultiplier,
    confidence: clamp(Math.round(confidence), 0, 100),
    reasons,
    metrics,
    isNoTrade: meta.action === "NO_TRADE",
  };
}

/**
 * Deterministic market-state classifier. Thresholds are deliberately explicit
 * so they can be walk-forward tested; an LLM is never in the trade path.
 */
export function classifyMarketRegime(marketContext = {}) {
  const metrics = {
    price: finite(marketContext.price) ? Number(marketContext.price) : null,
    change24h: finite(marketContext.change24h) ? Number(marketContext.change24h) : null,
    distFromEMA20: finite(marketContext.distFromEMA20)
      ? Number(marketContext.distFromEMA20)
      : finite(marketContext.distFromMA20) ? Number(marketContext.distFromMA20) : null,
    distFromEMA50: finite(marketContext.distFromEMA50) ? Number(marketContext.distFromEMA50) : null,
    ema20: finite(marketContext.ema20) ? Number(marketContext.ema20) : finite(marketContext.ma20) ? Number(marketContext.ma20) : null,
    ema50: finite(marketContext.ema50) ? Number(marketContext.ema50) : null,
    adx14: finite(marketContext.adx14) ? Number(marketContext.adx14) : null,
    realizedVol7: finite(marketContext.realizedVol7) ? Number(marketContext.realizedVol7) : null,
    realizedVol30: finite(marketContext.realizedVol30) ? Number(marketContext.realizedVol30) : null,
    marketIv: finite(marketContext.marketIv) ? Number(marketContext.marketIv) : null,
  };

  const required = [metrics.price, metrics.change24h, metrics.distFromEMA20, metrics.distFromEMA50,
    metrics.ema20, metrics.ema50, metrics.adx14, metrics.realizedVol7, metrics.realizedVol30, metrics.marketIv];
  if (!required.every(finite)) {
    return result(MARKET_REGIMES.DATA_INCOMPLETE, 100,
      ["ข้อมูล EMA20/EMA50, ADX, Realized Volatility หรือ Option IV ยังไม่ครบ"], metrics);
  }

  const absMove = Math.abs(metrics.change24h);
  const volAcceleration = metrics.realizedVol30 > 0 ? metrics.realizedVol7 / metrics.realizedVol30 : 1;
  const ivPremium = metrics.marketIv - metrics.realizedVol30;
  const emaAlignedBull = metrics.price > metrics.ema20 && metrics.ema20 > metrics.ema50;
  const emaAlignedBear = metrics.price < metrics.ema20 && metrics.ema20 < metrics.ema50;

  if (absMove >= 7 || metrics.realizedVol7 >= 100 || volAcceleration >= 1.8) {
    const severity = Math.max(absMove / 7, metrics.realizedVol7 / 100, volAcceleration / 1.8);
    return result(MARKET_REGIMES.CRISIS, 75 + (severity - 1) * 20, [
      `ความผันผวนเร่งตัว ${volAcceleration.toFixed(2)} เท่าของ RV30`,
      `BTC เคลื่อนไหว 24h ${metrics.change24h.toFixed(1)}% และ RV7 ${metrics.realizedVol7.toFixed(1)}%`,
    ], { ...metrics, volAcceleration, ivPremium });
  }

  if (absMove >= 4 || volAcceleration >= 1.35 || (metrics.adx14 >= 20 && metrics.adx14 < 25)) {
    return result(MARKET_REGIMES.BREAKOUT_TRANSITION, 72 + Math.max(0, absMove - 4) * 4, [
      `ตลาดกำลังเปลี่ยนสภาวะ: ADX ${metrics.adx14.toFixed(1)}, 24h ${metrics.change24h.toFixed(1)}%`,
      `RV7/RV30 = ${volAcceleration.toFixed(2)} เท่า จึงยังไม่เปิด Short Premium ใหม่`,
    ], { ...metrics, volAcceleration, ivPremium });
  }

  if (metrics.adx14 >= 25 && emaAlignedBull) {
    return result(MARKET_REGIMES.BULL_TREND, 70 + Math.min(20, (metrics.adx14 - 25) * 1.5), [
      `ราคา > EMA20 > EMA50 และ ADX ${metrics.adx14.toFixed(1)}`,
      `จำกัดกลยุทธ์ฝั่ง Bullish และลดขนาดเริ่มต้น 25%`,
    ], { ...metrics, volAcceleration, ivPremium });
  }

  if (metrics.adx14 >= 25 && emaAlignedBear) {
    return result(MARKET_REGIMES.BEAR_TREND, 70 + Math.min(20, (metrics.adx14 - 25) * 1.5), [
      `ราคา < EMA20 < EMA50 และ ADX ${metrics.adx14.toFixed(1)}`,
      `ระบบยังไม่มี Bear Call Spread แบบ Defined-risk จึงเลือก NO_TRADE`,
    ], { ...metrics, volAcceleration, ivPremium });
  }

  if (metrics.adx14 < 20 && Math.abs(metrics.distFromEMA20) <= 4) {
    if (ivPremium >= 8 && metrics.marketIv >= 35) {
      return result(MARKET_REGIMES.RANGE_HIGH_IV, 70 + Math.min(20, ivPremium / 2), [
        `ADX ${metrics.adx14.toFixed(1)} และราคาอยู่ใกล้ EMA20 (${metrics.distFromEMA20.toFixed(1)}%)`,
        `Option IV สูงกว่า RV30 อยู่ ${ivPremium.toFixed(1)} vol points`,
      ], { ...metrics, volAcceleration, ivPremium });
    }
    return result(MARKET_REGIMES.RANGE_LOW_IV, 75, [
      `ตลาด Sideway แต่ Option IV Premium เพียง ${ivPremium.toFixed(1)} vol points`,
      `พรีเมียมยังไม่ชดเชย Tail Risk ตามเกณฑ์ของระบบ`,
    ], { ...metrics, volAcceleration, ivPremium });
  }

  return result(MARKET_REGIMES.BREAKOUT_TRANSITION, 65, [
    `ตัวชี้วัดยังไม่สอดคล้องกัน: ADX ${metrics.adx14.toFixed(1)}, ระยะ EMA20 ${metrics.distFromEMA20.toFixed(1)}%`,
    "รอให้แนวโน้มหรือกรอบ Sideway ยืนยันก่อนเปิดสถานะใหม่",
  ], { ...metrics, volAcceleration, ivPremium });
}

/** Require repeated observations before switching regimes to prevent flapping. */
export function stabilizeMarketRegime(candidate, previous = null, confirmationsRequired = 3) {
  if (!previous?.stable) {
    return { stable: candidate, pendingRegime: null, pendingCount: 0, changed: true };
  }
  if (candidate.regime === previous.stable.regime) {
    return { stable: candidate, pendingRegime: null, pendingCount: 0, changed: false };
  }

  // Safety transitions are immediate; risk-on transitions require confirmation.
  if (candidate.isNoTrade) {
    return { stable: candidate, pendingRegime: null, pendingCount: 0, changed: true };
  }

  const pendingCount = previous.pendingRegime === candidate.regime ? (previous.pendingCount || 0) + 1 : 1;
  if (pendingCount >= confirmationsRequired) {
    return { stable: candidate, pendingRegime: null, pendingCount: 0, changed: true };
  }
  return { stable: previous.stable, pendingRegime: candidate.regime, pendingCount, changed: false };
}

