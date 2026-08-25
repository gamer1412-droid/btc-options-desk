// Vercel Serverless Function — proxies Binance API requests
//
// WHY THIS EXISTS:
// 1. Binance blocks direct browser calls (CORS) — this proxy runs server-side.
// 2. Your Binance API Secret must NEVER be exposed to the browser. It stays
//    here as a Vercel Environment Variable and signs requests server-side.
//
// SETUP:
// 1. In Vercel dashboard → Project Settings → Environment Variables, add:
//      BINANCE_API_KEY    = your read-only API key
//      BINANCE_API_SECRET = your read-only API secret
// 2. On Binance → API Management, create a key with ONLY "Enable Reading"
//    checked. Do NOT enable trading or withdrawals.
//
// ENDPOINTS THIS PROXIES:
//   GET /api/binance?action=optionPositions   -> open options positions
//   GET /api/binance?action=optionAccount     -> options account info
//   GET /api/binance?action=btcPrice          -> current BTC price (public, no auth)
//   GET /api/binance?action=optionMarks       -> mark price / greeks for BTC options

import crypto from "crypto";

const BINANCE_OPTIONS_BASE = "https://eapi.binance.com";
const BINANCE_SPOT_BASE = "https://api.binance.com";

function sign(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

async function signedGet(base, path, params, apiKey, apiSecret) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp, recvWindow: 60000 }).toString();
  const signature = sign(query, apiSecret);
  const url = `${base}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function signedPost(base, path, params, apiKey, apiSecret) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp, recvWindow: 60000 }).toString();
  const signature = sign(query, apiSecret);
  const url = `${base}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function signedDelete(base, path, params, apiKey, apiSecret) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp, recvWindow: 60000 }).toString();
  const signature = sign(query, apiSecret);
  const url = `${base}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance API error ${res.status}: ${body}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  // CORS — restrict to your deployed frontend origin.
  // Set ALLOWED_ORIGIN in Vercel Environment Variables (e.g. https://btc-options-desk.vercel.app)
  // Falls back to * during local dev when env var is absent.
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  try {
    switch (action) {
      case "btcPrice": {
        // Public endpoint, no auth needed
        const r = await fetch(`${BINANCE_SPOT_BASE}/api/v3/ticker/price?symbol=BTCUSDT`);
        const data = await r.json();
        return res.status(200).json({ price: parseFloat(data.price) });
      }

      case "btcMarketContext": {
        // Public endpoint — fetch 24h ticker and 20 daily klines for MA20 regime calculation
        const [tickerRes, klinesRes] = await Promise.all([
          fetch(`${BINANCE_SPOT_BASE}/api/v3/ticker/24hr?symbol=BTCUSDT`),
          fetch(`${BINANCE_SPOT_BASE}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=20`),
        ]);
        const ticker = await tickerRes.json();
        const klines = await klinesRes.json();

        let ma20 = null;
        let distFromMA20 = 0;
        const currentPrice = parseFloat(ticker.lastPrice);
        const change24h = parseFloat(ticker.priceChangePercent);

        if (Array.isArray(klines) && klines.length > 0) {
          const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v));
          if (closes.length > 0) {
            ma20 = closes.reduce((a, b) => a + b, 0) / closes.length;
            distFromMA20 = ((currentPrice - ma20) / ma20) * 100;
          }
        }

        return res.status(200).json({
          price: currentPrice,
          change24h: Math.round(change24h * 100) / 100,
          ma20: ma20 ? Math.round(ma20) : null,
          distFromMA20: Math.round(distFromMA20 * 10) / 10,
        });
      }

      case "optionPositions": {
        if (!apiKey || !apiSecret) {
          return res.status(500).json({ error: "Missing BINANCE_API_KEY / BINANCE_API_SECRET env vars" });
        }
        // GET /eapi/v1/position — current option positions
        const data = await signedGet(BINANCE_OPTIONS_BASE, "/eapi/v1/position", {}, apiKey, apiSecret);
        return res.status(200).json(data);
      }

      case "optionAccount": {
        if (!apiKey || !apiSecret) {
          return res.status(500).json({ error: "Missing BINANCE_API_KEY / BINANCE_API_SECRET env vars" });
        }
        // GET /eapi/v1/marginAccount — Binance European Options margin account info
        try {
          const data = await signedGet(BINANCE_OPTIONS_BASE, "/eapi/v1/marginAccount", {}, apiKey, apiSecret);
          return res.status(200).json(data);
        } catch (e1) {
          // Fallback to /eapi/v1/account if marginAccount is unavailable
          const fallback = await signedGet(BINANCE_OPTIONS_BASE, "/eapi/v1/account", {}, apiKey, apiSecret);
          return res.status(200).json(fallback);
        }
      }

      case "optionMarks": {
        // Public endpoint — mark price, greeks for all BTC option contracts
        const r = await fetch(`${BINANCE_OPTIONS_BASE}/eapi/v1/mark?underlying=BTCUSDT`);
        const data = await r.json();
        return res.status(200).json(data);
      }

      case "optionOrders": {
        if (!apiKey || !apiSecret) {
          return res.status(500).json({ error: "Missing BINANCE_API_KEY / BINANCE_API_SECRET env vars" });
        }
        // GET /eapi/v1/historyOrders — recent order history for trade log
        const data = await signedGet(BINANCE_OPTIONS_BASE, "/eapi/v1/historyOrders", { limit: 50 }, apiKey, apiSecret);
        return res.status(200).json(data);
      }

      case "placeOrder": {
        if (req.method !== "POST") return res.status(405).json({ error: "Use POST for placeOrder" });
        if (!apiKey || !apiSecret) {
          return res.status(500).json({ error: "Missing BINANCE_API_KEY / BINANCE_API_SECRET env vars" });
        }

        const { symbol, side, type = "LIMIT", quantity, price, timeInForce = "GTC" } = req.body || {};
        if (!symbol || !side || !quantity || !price) {
          return res.status(400).json({ error: "Missing required order parameters: symbol, side, quantity, price" });
        }

        // Hard safety limits: max 0.05 BTC per execution
        const parsedQty = Math.min(Math.abs(Number(quantity)), 0.05);
        const parsedPrice = Math.round(Math.abs(Number(price)) * 10) / 10;

        const orderParams = {
          symbol,
          side: side.toUpperCase(),
          type: type.toUpperCase(),
          quantity: parsedQty.toString(),
          price: parsedPrice.toString(),
          timeInForce,
        };

        const result = await signedPost(BINANCE_OPTIONS_BASE, "/eapi/v1/order", orderParams, apiKey, apiSecret);
        return res.status(200).json({ ok: true, result });
      }

      case "closePosition": {
        if (req.method !== "POST") return res.status(405).json({ error: "Use POST for closePosition" });
        if (!apiKey || !apiSecret) {
          return res.status(500).json({ error: "Missing BINANCE_API_KEY / BINANCE_API_SECRET env vars" });
        }

        const { symbol, side, quantity, price } = req.body || {};
        if (!symbol || !side || !quantity) {
          return res.status(400).json({ error: "Missing required close parameters: symbol, side, quantity" });
        }

        const parsedQty = Math.min(Math.abs(Number(quantity)), 0.05);
        const parsedPrice = price ? Math.round(Math.abs(Number(price)) * 10) / 10 : 0.1;

        const orderParams = {
          symbol,
          side: side.toUpperCase(),
          type: "LIMIT",
          quantity: parsedQty.toString(),
          price: parsedPrice.toString(),
          timeInForce: "GTC",
        };

        const result = await signedPost(BINANCE_OPTIONS_BASE, "/eapi/v1/order", orderParams, apiKey, apiSecret);
        return res.status(200).json({ ok: true, result });
      }

      case "cancelOrder": {
        if (req.method !== "DELETE" && req.method !== "POST") return res.status(405).json({ error: "Use DELETE for cancelOrder" });
        if (!apiKey || !apiSecret) {
          return res.status(500).json({ error: "Missing BINANCE_API_KEY / BINANCE_API_SECRET env vars" });
        }

        const { symbol, orderId } = req.query || req.body || {};
        if (!symbol || !orderId) {
          return res.status(400).json({ error: "Missing required cancel parameters: symbol, orderId" });
        }

        const result = await signedDelete(BINANCE_OPTIONS_BASE, "/eapi/v1/order", { symbol, orderId }, apiKey, apiSecret);
        return res.status(200).json({ ok: true, result });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
