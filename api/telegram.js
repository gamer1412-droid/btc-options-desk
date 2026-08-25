import crypto from "crypto";

const BINANCE_OPTIONS_BASE = "https://eapi.binance.com";

function sign(queryString, secret) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
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

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = String(process.env.TELEGRAM_CHAT_ID);
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  if (!botToken || !chatId) {
    return res.status(500).json({ error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" });
  }

  // ─── Handle Telegram Webhook Callback Query (Button Clicks) ───────────────
  if (req.body?.callback_query) {
    const cb = req.body.callback_query;
    const fromId = String(cb.from?.id || cb.message?.chat?.id);
    const callbackData = cb.data || "";

    // Auth verification: only authorized user can execute trades
    if (fromId !== chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id, text: "⛔ Unauthorized", show_alert: true }),
      });
      return res.status(200).json({ ok: true });
    }

    try {
      if (callbackData.startsWith("trade:open:")) {
        // format: trade:open:<symbol>:<price>:<qty>
        const [, , symbol, rawPrice, rawQty] = callbackData.split(":");
        const price = Math.round(Number(rawPrice) * 10) / 10;
        const qty = Math.min(Number(rawQty || 0.01), 0.05);

        if (!apiKey || !apiSecret) {
          throw new Error("Missing BINANCE_API_KEY / SECRET for trade execution");
        }

        const orderResult = await signedPost(
          BINANCE_OPTIONS_BASE,
          "/eapi/v1/order",
          {
            symbol,
            side: "SELL",
            type: "LIMIT",
            quantity: qty.toString(),
            price: price.toString(),
            timeInForce: "GTC",
          },
          apiKey,
          apiSecret
        );

        // Answer popup
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: cb.id,
            text: `✅ ยิงคำสั่งสำเร็จ: ${symbol} @ $${price} (${qty} BTC)`,
            show_alert: true,
          }),
        });

        // Send confirmation receipt message
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎯 *1-CLICK ORDER EXECUTED!*\n\n• Contract: \`${symbol}\`\n• Action: *SELL / SHORT*\n• Price: *$${price}*\n• Size: *${qty} BTC*\n• Order ID: \`${orderResult.orderId || "FILLED"}\`\n\n_ระบบกำลังติดตาม Position ให้เรียบร้อยครับ_`,
            parse_mode: "Markdown",
          }),
        });

        return res.status(200).json({ ok: true, orderResult });
      }

      if (callbackData.startsWith("trade:close:")) {
        // format: trade:close:<symbol>:<qty>
        const [, , symbol, rawQty] = callbackData.split(":");
        const qty = Math.min(Number(rawQty || 0.01), 0.05);

        if (!apiKey || !apiSecret) {
          throw new Error("Missing BINANCE_API_KEY / SECRET for trade execution");
        }

        const closeResult = await signedPost(
          BINANCE_OPTIONS_BASE,
          "/eapi/v1/order",
          {
            symbol,
            side: "BUY",
            type: "LIMIT",
            quantity: qty.toString(),
            price: "0.1", // close at market/minimum price limit
            timeInForce: "GTC",
          },
          apiKey,
          apiSecret
        );

        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: cb.id,
            text: `✅ ส่งคำสั่งปิดสัญญาสำเร็จ: ${symbol}`,
            show_alert: true,
          }),
        });

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🔴 *POSITION CLOSED!*\n\n• Contract: \`${symbol}\`\n• Action: *BUY TO CLOSE*\n• Size: *${qty} BTC*\n\n_ปิดทำกำไร/ตัดขาดทุนเรียบร้อยครับ_`,
            parse_mode: "Markdown",
          }),
        });

        return res.status(200).json({ ok: true, closeResult });
      }
    } catch (err) {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: cb.id,
          text: `❌ ล้มเหลว: ${err.message}`,
          show_alert: true,
        }),
      });
      return res.status(200).json({ error: err.message });
    }
  }

  // ─── Handle Outgoing Alert Messages ───────────────────────────────────────
  const { type, data } = req.body || {};
  let message = "";
  let replyMarkup = null;

  if (type === "test") {
    message = "✅ *BTC Options Desk* เชื่อมต่อสำเร็จแล้วครับ!";
  }

  else if (type === "short_put_signal" || (type === "signal" && data?.strategy === "SHORT_PUT")) {
    const d = data;
    const putSymbol = d.put?.symbol || d.symbol;
    const markPrice = d.putMark || d.markPrice || d.totalPremium;

    message = `🟢 *ENTRY SIGNAL — BTC Bullish Short Put* ⭐

📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice).toLocaleString()}
📊 *Market IV:* ${d.ivRank || d.avgIV}%

📍 *Short Put:*
  • Strike: *$${Number(d.putStrike || d.strike).toLocaleString()}*
  • Delta: \`${d.putDelta || d.delta}\` | IV: ${d.putIV || d.iv}%
  • Mark Price: $${markPrice}
  • ระยะปลอดภัย (Buffer): *${d.putDistancePct}%* จากราคาปัจจุบัน

💰 *Premium รับ:* ~$${d.totalPremium} USD / 1 BTC
⏱ *Theta Decay:* +$${d.totalTheta}/วัน
🛡️ *Breakeven Price:* $${Number(d.breakevenLow).toLocaleString()}

💡 *เหตุผล:* ตลาด Bullish + IV สูง (${d.ivRank}%) ขาย Put เก็บ Premium สูงโดยไม่มี Upside Risk`;

    if (putSymbol) {
      replyMarkup = {
        inline_keyboard: [
          [
            {
              text: "⚡ 1-Click Open (0.01 BTC)",
              callback_data: `trade:open:${putSymbol}:${markPrice}:0.01`,
            },
          ],
        ],
      };
    }
  }

  else if (type === "skewed_strangle_signal" || (type === "signal" && data?.strategy === "SKEWED_STRANGLE")) {
    const d = data;
    message = `⚡ *ENTRY SIGNAL — BTC Skewed Strangle (Bullish)*

📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice).toLocaleString()}
📊 *Market IV:* ${d.ivRank || d.avgIV}%

📍 *Short Put:*
  • Strike: *$${Number(d.putStrike).toLocaleString()}*
  • Delta: \`${d.putDelta}\` | IV: ${d.putIV}%

📍 *Wide Short Call:*
  • Strike: *$${Number(d.callStrike).toLocaleString()}* (Buffer +${d.callDistancePct}%)
  • Delta: \`+${d.callDelta}\` (OTM กว้างพิเศษ)

💰 *รวม Premium รับ:* ~$${d.totalPremium} / 1 BTC
⏱ *Theta Decay:* +$${d.totalTheta}/วัน
🛡️ *Safe Zone:* $${Number(d.breakevenLow).toLocaleString()} — $${Number(d.breakevenHigh).toLocaleString()}

💡 *เหตุผล:* กลยุทธ์เอียงข้าง Bullish ขยายขอบเขต Short Call กว้างพิเศษเพื่อรับเทรนด์`;

    if (d.put?.symbol) {
      replyMarkup = {
        inline_keyboard: [
          [
            {
              text: "⚡ 1-Click Open Put (0.01 BTC)",
              callback_data: `trade:open:${d.put.symbol}:${d.putMark}:0.01`,
            },
          ],
        ],
      };
    }
  }

  else if (type === "strangle_signal" || (type === "signal" && data?.strategy === "STRANGLE")) {
    const d = data;
    message = `🟢 *ENTRY SIGNAL — BTC Short Strangle*

📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice).toLocaleString()}
📊 *Market IV:* ${d.ivRank || d.avgIV}%

📍 *Short Put:*
  • Strike: *$${Number(d.putStrike).toLocaleString()}*
  • Delta: \`${d.putDelta}\` | IV: ${d.putIV}%
  • Mark: $${d.putMark}

📍 *Short Call:*
  • Strike: *$${Number(d.callStrike).toLocaleString()}*
  • Delta: \`+${d.callDelta}\` | IV: ${d.callIV}%
  • Mark: $${d.callMark}

💰 *รวม Premium รับ:* ~$${d.totalPremium} / 1 BTC
⏱ *Theta Decay:* +$${d.totalTheta}/วัน
🛡️ *Safe Zone (Breakeven):*
  $${Number(d.breakevenLow).toLocaleString()} — $${Number(d.breakevenHigh).toLocaleString()}

💡 *เหตุผล:* เข้าเกณฑ์ Delta (Call 0.15-0.20, Put 0.15-0.20) และ DTE ตามกฎ Entry`;

    if (d.put?.symbol) {
      replyMarkup = {
        inline_keyboard: [
          [
            {
              text: "⚡ 1-Click Open Put Leg (0.01 BTC)",
              callback_data: `trade:open:${d.put.symbol}:${d.putMark}:0.01`,
            },
          ],
        ],
      };
    }
  }

  else if (type === "warning") {
    const d = data;
    const isCritical = d.warningReason?.includes("STOP") || d.warningReason?.includes("DANGER");
    const isTP = d.warningReason?.includes("TAKE PROFIT") || Number(d.pctProfit) >= 50;
    const emoji = isTP ? "🎯" : isCritical ? "🚨" : "⚠️";

    message = `${emoji} *${isTP ? "TAKE PROFIT TARGET" : isCritical ? "CRITICAL WARNING" : "WARNING"} — ${d.posType}*

📍 *Contract:* \`${d.posId || d.strike}\`
📐 *Delta:* ${d.delta} ${Math.abs(d.delta) >= 0.4 ? "🔴 สูงเกิน!" : ""}
💰 *P&L:* ${d.pnl >= 0 ? "+" : ""}$${d.pnl}  (${d.pctProfit}% profit)

⚡ *${d.warningReason}*`;

    if (d.posId) {
      replyMarkup = {
        inline_keyboard: [
          [
            {
              text: isTP ? "🎯 1-Click Take Profit" : "🔴 1-Click Close Position",
              callback_data: `trade:close:${d.posId}:0.01`,
            },
          ],
        ],
      };
    }
  }

  if (!message) return res.status(400).json({ error: "Unknown alert type" });

  try {
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    let r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let result = await r.json();

    // Fallback: if markdown parsing fails, retry with clean plain text
    if (!result.ok && payload.parse_mode) {
      payload.parse_mode = undefined;
      r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      result = await r.json();
    }

    if (!result.ok) throw new Error(result.description);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

