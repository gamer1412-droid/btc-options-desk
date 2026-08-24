import { classify } from "../utils.js";

// Map raw Binance /eapi/v1/position response into the shape our UI expects.
// Binance option position fields: symbol, side, quantity, entryPrice, markPrice,
// unrealizedPNL, delta, theta, gamma, vega, markIV, ...
export function mapBinancePosition(raw) {
  // symbol format example: BTC-260829-100000-C
  const parts = raw.symbol?.split("-") ?? [];
  const strike = Number(parts[2]) || 0;
  const optType = parts[3] === "C" ? "Call" : "Put";
  const side = Number(raw.quantity) < 0 ? "Short" : "Long";
  const expiryRaw = parts[1]; // YYMMDD
  let expiry = "-";
  let dte = 0;
  if (expiryRaw?.length === 6) {
    const y = 2000 + Number(expiryRaw.slice(0, 2));
    const m = Number(expiryRaw.slice(2, 4));
    const d = Number(expiryRaw.slice(4, 6));
    const expDate = new Date(Date.UTC(y, m - 1, d, 8, 0, 0)); // Binance options expire 08:00 UTC
    expiry = expDate.toISOString().slice(0, 10);
    dte = Math.max(0, Math.ceil((expDate - Date.now()) / 86400000));
  }

  // Store as Number (not String) — formatting happens at render time.
  // contractMultiplier is not present in /eapi/v1/position; quantity already
  // represents the number of contracts, so we multiply price × qty directly.
  const qty = Math.abs(Number(raw.quantity));
  const premium = Math.round(Math.abs(Number(raw.entryPrice)) * qty) || 0;
  const currentPrice = Math.round(Math.abs(Number(raw.markPrice)) * qty) || 0;

  const pos = {
    id: raw.symbol,
    type: `${side} ${optType}`,
    strike,
    expiry,
    dte,
    delta: Number(raw.delta) || 0,
    theta: Number(raw.theta) || 0,
    vega: Number(raw.vega) || 0,
    // markIV is a decimal (0.65 = 65%) — multiply by 100 safely
    iv: (Number(raw.markIV) || 0) * 100,
    premium,       // Number USD
    currentPrice,  // Number USD
    pnl: Number(raw.unrealizedPNL) || 0,
    size: qty,
  };
  pos.status = classify(pos);
  return pos;
}
