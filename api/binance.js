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
  const query = new URLSearchParams({ ...params, timestamp, recvWindow: 5000 }).toString();
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

export default async function handler(req, res) {
  // CORS — restrict to your deployed frontend origin.
  // Set ALLOWED_ORIGIN in Vercel Environment Variables (e.g. https://btc-options-desk.vercel.app)
  // Falls back to * during local dev when env var is absent.
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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
        // GET /eapi/v1/account — options account balance/margin info
        const data = await signedGet(BINANCE_OPTIONS_BASE, "/eapi/v1/account", {}, apiKey, apiSecret);
        return res.status(200).json(data);
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

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
