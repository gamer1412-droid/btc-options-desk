import { classify } from "../utils.js";

// Map raw Binance /eapi/v1/position response into the shape our UI expects.
// Merges Greek values (delta, theta, vega, markIV, markPrice) from the /eapi/v1/mark endpoint.
export function mapBinancePosition(raw, mark = {}) {
  // symbol format example: BTC-260829-100000-C
  const parts = raw.symbol?.split("-") ?? [];
  const strike = Number(raw.strikePrice) || Number(parts[2]) || 0;
  const optType = parts[3] === "C" ? "Call" : parts[3] === "P" ? "Put" : (raw.side?.includes("CALL") ? "Call" : "Put");
  const side = (raw.side === "SELL" || Number(raw.quantity) < 0 || raw.positionSide === "SHORT") ? "Short" : "Long";
  const expiryRaw = parts[1]; // YYMMDD

  let expiry = "-";
  let dte = 0;
  let expMs = Number(raw.expiryDate) || 0;

  if (!expMs && expiryRaw?.length === 6) {
    const y = 2000 + Number(expiryRaw.slice(0, 2));
    const m = Number(expiryRaw.slice(2, 4));
    const d = Number(expiryRaw.slice(4, 6));
    expMs = Date.UTC(y, m - 1, d, 8, 0, 0); // Binance options expire 08:00 UTC
  }

  if (expMs > 0) {
    const expDate = new Date(expMs);
    expiry = expDate.toISOString().slice(0, 10);
    dte = Math.max(0, Math.ceil((expMs - Date.now()) / 86400000));
  }

  const qty = Math.abs(Number(raw.quantity) || Number(raw.positionAmount) || 0);
  const entryPrice = Math.abs(Number(raw.entryPrice) || 0);
  const markPrice = Math.abs(Number(raw.markPrice) || Number(mark.markPrice) || entryPrice);

  const premium = Math.round(entryPrice * qty) || 0;
  const currentPrice = Math.round(markPrice * qty) || 0;

  // Greeks from mark endpoint (since /eapi/v1/position does not include Greeks)
  const delta = Number(raw.delta ?? mark.delta ?? 0);
  const theta = Number(raw.theta ?? mark.theta ?? 0);
  const vega = Number(raw.vega ?? mark.vega ?? 0);
  const markIVRaw = Number(raw.markIV ?? mark.markIV ?? 0);
  // markIV is a decimal fraction (0.65 = 65%)
  const iv = markIVRaw > 0 ? (markIVRaw <= 5 ? markIVRaw * 100 : markIVRaw) : 0;

  const pos = {
    id: raw.symbol,
    type: `${side} ${optType}`,
    strike,
    expiry,
    dte,
    delta,
    theta,
    vega,
    iv,
    premium,       // Number USD
    currentPrice,  // Number USD
    pnl: Number(raw.unrealizedPNL) || (side === "Short" ? (premium - currentPrice) : (currentPrice - premium)),
    size: qty,
  };

  pos.status = classify(pos);
  return pos;
}

