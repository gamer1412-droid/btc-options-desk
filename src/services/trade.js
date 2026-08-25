// ─── Trade Execution Service ──────────────────────────────────────────────────
// Provides client-side helpers to submit 1-Click Limit Orders and Close Positions on Binance.

/**
 * Place a new Option Order (Short / Write or Long) via backend proxy.
 *
 * @param {object} params
 * @param {string} params.symbol - Contract symbol e.g. "BTC-260911-74000-P"
 * @param {"SELL" | "BUY"} params.side - "SELL" to short / collect premium, "BUY" to close
 * @param {number} params.quantity - Contract lot size e.g. 0.01
 * @param {number} params.price - Limit price in USD (mark/mid price)
 * @returns {Promise<object>} Order result from Binance
 */
export async function placeOptionOrder({ symbol, side = "SELL", quantity = 0.01, price }) {
  if (!symbol) throw new Error("Missing contract symbol");
  if (!price || price <= 0) throw new Error("Invalid order price");
  if (!quantity || quantity <= 0) throw new Error("Invalid quantity");

  // Hard safety limit: max 0.05 BTC per 1-click execution
  const safeQty = Math.min(Number(quantity), 0.05);

  const res = await fetch("/api/binance?action=placeOrder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol,
      side,
      type: "LIMIT",
      quantity: safeQty,
      price: Math.round(Number(price) * 10) / 10, // Binance price tick
      timeInForce: "GTC",
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to place order`);
  }

  return data;
}

/**
 * Place a multi-leg Strangle order (sends Short Put and Short Call limit orders sequentially).
 *
 * @param {object} opp - Opportunity object
 * @param {number} quantity - Lot size
 * @returns {Promise<object>} Result containing putOrder and callOrder
 */
export async function placeStrangleOrders(opp, quantity = 0.01) {
  if (opp.strategy === "SHORT_PUT") {
    const putRes = await placeOptionOrder({
      symbol: opp.put.symbol,
      side: "SELL",
      quantity,
      price: opp.put.markPrice,
    });
    return { strategy: "SHORT_PUT", putOrder: putRes };
  }

  // Strangle / Skewed Strangle: Execute Put leg first, then Call leg
  const putRes = await placeOptionOrder({
    symbol: opp.put.symbol,
    side: "SELL",
    quantity,
    price: opp.put.markPrice,
  });

  const callRes = await placeOptionOrder({
    symbol: opp.call.symbol,
    side: "SELL",
    quantity,
    price: opp.call.markPrice,
  });

  return { strategy: opp.strategy, putOrder: putRes, callOrder: callRes };
}

/**
 * Close an active position (sends a BUY order to buy back the short position).
 *
 * @param {object} pos - Position object from positions list
 * @returns {Promise<object>} Order result from Binance
 */
export async function closeOptionPosition(pos) {
  if (!pos || !pos.id) throw new Error("Invalid position object");

  const isShort = pos.type?.toLowerCase().includes("short");
  const closeSide = isShort ? "BUY" : "SELL";
  const closePrice = Math.max(0.1, Number(pos.currentPrice) / (pos.size || 0.01));

  const res = await fetch("/api/binance?action=closePosition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: pos.id,
      side: closeSide,
      quantity: pos.size || 0.01,
      price: Math.round(closePrice * 10) / 10,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to close position`);
  }

  return data;
}
