const finiteNumbers = values => values.map(Number).filter(Number.isFinite);

export function calculateEMA(values, period) {
  const clean = finiteNumbers(values);
  if (clean.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = clean.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of clean.slice(period)) ema = ((value - ema) * multiplier) + ema;
  return ema;
}

export function calculateRealizedVol(closes, lookback) {
  const clean = finiteNumbers(closes);
  if (clean.length < lookback + 1) return null;
  const sample = clean.slice(-(lookback + 1));
  const returns = [];
  for (let i = 1; i < sample.length; i += 1) returns.push(Math.log(sample[i] / sample[i - 1]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

export function calculateADX(klines, period = 14) {
  if (!Array.isArray(klines) || klines.length < (period * 2) + 1) return null;
  const rows = klines.map(row => ({ high: Number(row[2]), low: Number(row[3]), close: Number(row[4]) }));
  if (rows.some(row => !Number.isFinite(row.high) || !Number.isFinite(row.low) || !Number.isFinite(row.close))) return null;

  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < rows.length; i += 1) {
    const upMove = rows[i].high - rows[i - 1].high;
    const downMove = rows[i - 1].low - rows[i].low;
    tr.push(Math.max(
      rows[i].high - rows[i].low,
      Math.abs(rows[i].high - rows[i - 1].close),
      Math.abs(rows[i].low - rows[i - 1].close),
    ));
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const smooth = values => {
    const output = [];
    let current = values.slice(0, period).reduce((sum, value) => sum + value, 0);
    output.push(current);
    for (const value of values.slice(period)) {
      current = current - (current / period) + value;
      output.push(current);
    }
    return output;
  };

  const smoothTR = smooth(tr);
  const smoothPlus = smooth(plusDM);
  const smoothMinus = smooth(minusDM);
  const dx = smoothTR.map((trueRange, index) => {
    if (trueRange <= 0) return 0;
    const plusDI = (smoothPlus[index] / trueRange) * 100;
    const minusDI = (smoothMinus[index] / trueRange) * 100;
    const denominator = plusDI + minusDI;
    return denominator > 0 ? (Math.abs(plusDI - minusDI) / denominator) * 100 : 0;
  });
  if (dx.length < period) return null;
  let adx = dx.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of dx.slice(period)) adx = ((adx * (period - 1)) + value) / period;
  return adx;
}

export function buildMarketIndicators(klines, currentPrice) {
  if (!Array.isArray(klines)) return {};
  const closes = klines.map(row => Number(row[4])).filter(Number.isFinite);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const adx14 = calculateADX(klines, 14);
  const realizedVol7 = calculateRealizedVol(closes, 7);
  const realizedVol30 = calculateRealizedVol(closes, 30);
  const distance = ema => Number.isFinite(ema) && ema > 0 ? ((currentPrice - ema) / ema) * 100 : null;
  return {
    ema20,
    ema50,
    adx14,
    realizedVol7,
    realizedVol30,
    distFromEMA20: distance(ema20),
    distFromEMA50: distance(ema50),
  };
}

