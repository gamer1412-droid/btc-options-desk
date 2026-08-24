// api/telegram.js — ส่ง alert ไปยัง Telegram Bot
//
// SETUP:
// 1. เปิด Telegram → ค้นหา @BotFather → /newbot → ตั้งชื่อ → รับ BOT_TOKEN
// 2. ส่งข้อความหาบอทที่สร้าง แล้วเปิด:
//    https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
//    ดู "chat":{"id": XXXX} — นั่นคือ CHAT_ID ของคุณ
// 3. ใส่ใน Vercel Environment Variables:
//    TELEGRAM_BOT_TOKEN = 123456:ABC-your-token
//    TELEGRAM_CHAT_ID   = 123456789

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return res.status(500).json({ error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" });
  }

  const { type, data } = req.body;
  // type: "signal" | "warning" | "test"

  let message = "";

  if (type === "test") {
    message = "✅ *BTC Options Desk* เชื่อมต่อสำเร็จแล้วครับ!";
  }

  else if (type === "signal") {
    // data: { signalType, strike, expiry, dte, delta, iv, premiumEst, btcPrice, reason }
    const d = data;
    const emoji = d.signalType === "ENTRY" ? "🟢" : d.signalType === "CLOSE" ? "🔴" : "🟡";
    message = `${emoji} *${d.signalType} SIGNAL — BTC Options*

📍 *Strike:* $${Number(d.strike).toLocaleString()}
📅 *Expiry:* ${d.expiry} (${d.dte}d)
📐 *Delta:* ${d.delta}
📊 *IV:* ${d.iv}%
💰 *Premium est.:* $${d.premiumEst}
₿  *BTC Price:* $${Number(d.btcPrice).toLocaleString()}

💡 *เหตุผล:* ${d.reason}

⚡ _เปิด Binance แล้วตัดสินใจเองครับ_`;
  }

  else if (type === "warning") {
    // data: { posId, posType, strike, delta, pnl, pctProfit, warningReason }
    const d = data;
    const isCritical = d.warningReason?.includes("STOP") || d.warningReason?.includes("DANGER");
    const emoji = isCritical ? "🚨" : "⚠️";
    message = `${emoji} *${isCritical ? "CRITICAL WARNING" : "WARNING"} — ${d.posType}*

📍 *Strike:* $${Number(d.strike).toLocaleString()}
📐 *Delta:* ${d.delta} ${Math.abs(d.delta) >= 0.4 ? "🔴 สูงเกิน!" : ""}
💰 *P&L:* ${d.pnl >= 0 ? "+" : ""}$${d.pnl}  (${d.pctProfit}% profit)

⚡ *${d.warningReason}*

_เข้าไปดู position ด่วนครับ_`;
  }

  if (!message) return res.status(400).json({ error: "Unknown alert type" });

  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const result = await r.json();
    if (!result.ok) throw new Error(result.description);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
