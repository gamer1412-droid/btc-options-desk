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
  const chatId = String(process.env.TELEGRAM_CHAT_ID);

  if (!botToken || !chatId) {
    return res.status(500).json({ error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" });
  }

  const { type, data } = req.body || {};
  let message = "";

  if (type === "test") {
    message = "✅ *BTC Options Desk* เชื่อมต่อสำเร็จแล้วครับ!";
  }

  else if (type === "short_put_signal" || (type === "signal" && data?.strategy === "SHORT_PUT")) {
    const d = data;
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

💡 *เหตุผล:* ตลาด Bullish + IV สูง (${d.ivRank}%) ขาย Put เก็บ Premium สูงโดยไม่มี Upside Risk
⚡ _เปิดแอป Binance เพื่อพิจารณาเข้าตามวินัยครับ_`;
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

💡 *เหตุผล:* กลยุทธ์เอียงข้าง Bullish ขยายขอบเขต Short Call กว้างพิเศษเพื่อรับเทรนด์
⚡ _เปิดแอป Binance เพื่อพิจารณาเข้าตามวินัยครับ_`;
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

💡 *เหตุผล:* เข้าเกณฑ์ Delta (Call 0.15-0.20, Put 0.15-0.20) และ DTE ตามกฎ Entry
⚡ _เปิดแอป Binance เพื่อพิจารณาเข้าตามวินัยครับ_`;
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

⚡ *${d.warningReason}*

_เข้าไปดู position บนแอป Binance ครับ_`;
  }

  if (!message) return res.status(400).json({ error: "Unknown alert type" });

  try {
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };

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

