// api/telegram.js — ส่ง alert ไปยัง Telegram Bot พร้อม Interactive Inline Keyboard
//
// SETUP:
// 1. เปิด Telegram → ค้นหา @BotFather → /newbot → ตั้งชื่อ → รับ BOT_TOKEN
// 2. ส่งข้อความหาบอทที่สร้าง แล้วเปิด:
//    https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
//    ดู "chat":{"id": XXXX} — นั่นคือ CHAT_ID ของคุณ
// 3. ใส่ใน Vercel Environment Variables:
//    TELEGRAM_BOT_TOKEN = 123456:ABC-your-token
//    TELEGRAM_CHAT_ID   = 123456789
//    APP_URL            = https://your-desk-url.vercel.app (Optional)

import { enforceRateLimit } from "../lib/security.js";

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!enforceRateLimit(req, res, { key: "telegram", limit: 12, windowMs: 60_000 })) return;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "");

  if (!botToken || !chatId) {
    return res.status(500).json({ error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" });
  }

  const appUrl = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://btc-options-desk.vercel.app");
  const binanceUrl = "https://www.binance.com/en/options";

  const { type, data } = req.body || {};
  let message = "";
  let buttons = [
    [
      { text: "📊 เปิด Options Desk", url: appUrl },
      { text: "⚡ เทรดบน Binance", url: binanceUrl },
    ],
  ];

  if (type === "test") {
    message = `⚡ *BTC OPTIONS DESK — Test Alert*
    
✅ ระบบเชื่อมต่อกับ Telegram Bot สำเร็จแล้วครับ!
🔔 การแจ้งเตือนความเสี่ยง (Defense / TP), สัญญาณ Entry และสรุปพอร์ตประจำวันพร้อมทำงาน 24/7`;
  }

  // ─── Daily Portfolio Briefing Digest ─────────────────────────────────────────
  else if (type === "daily_briefing") {
    const d = data || {};
    const pnlSign = (d.totalPnl || 0) >= 0 ? "+" : "";
    const pnlEmoji = (d.totalPnl || 0) >= 0 ? "🟢" : "🔴";
    const deltaPosture = Math.abs(d.netDelta || 0) <= 0.2
      ? "⚖️ Delta Neutral (ปลอดภัย)"
      : (d.netDelta > 0 ? "🐂 Bullish Skewed" : "🐻 Bearish Skewed");

    message = `📊 *DAILY PORTFOLIO BRIEFING — BTC Options Desk*
━━━━━━━━━━━━━━━━━━━━━
₿ *BTC Spot:* $${Number(d.btcPrice || 0).toLocaleString()} (${d.change24h >= 0 ? "+" : ""}${d.change24h}%)
📈 *Chain Avg IV:* ${d.marketIv ?? "N/A"}% | *Port Delta:* \`${d.netDelta || 0}\` (${deltaPosture})

💼 *Portfolio Health:*
  • สัญญาเปิดอยู่: *${d.positionCount || 0} Positions*
  • รวม P&L: ${pnlEmoji} *${pnlSign}$${Number(d.totalPnl || 0).toLocaleString()} USD*
  • Theta Income: *+$${Number(d.totalTheta || 0).toLocaleString()} / วัน*
  • DTE ต่ำสุด: *${d.minDte || 0} วัน* ${d.minDte && d.minDte <= 2 ? "⚠️ (ใกล้หมดอายุ!)" : ""}
  • Margin Ratio: *${d.marginRatio ? (d.marginRatio * 100).toFixed(1) + "%" : "Safe"}*

${d.criticalCount > 0 ? `🚨 *ต้องตรวจสอบ:* มี ${d.criticalCount} สัญญาที่ใกล้กรอบ Action Level!` : "✨ *สถานะพอร์ต:* ทุกสัญญายังอยู่ในกรอบความปลอดภัยตามแผน"}
━━━━━━━━━━━━━━━━━━━━━
_ระบบสรุปข้อมูลอัตโนมัติประจำวัน_`;
  }

  // ─── Position Defense & Risk Alert ───────────────────────────────────────────
  else if (type === "warning") {
    const d = data || {};
    const isStopLoss = d.warningReason?.includes("STOP");
    const isTP = d.warningReason?.includes("TAKE PROFIT") || d.alertLevel === "TAKE_PROFIT" || Number(d.pctProfit) >= 50;
    const isDteExit = d.warningReason?.includes("DTE EXIT");
    const isCritical = d.alertLevel === "CRITICAL";
    const emoji = isTP ? "🎯" : isDteExit ? "⏰" : (isStopLoss || isCritical) ? "🚨" : "⚠️";
    const headerTitle = isTP ? "TAKE PROFIT TARGET" : isDteExit ? "DTE EXPIRY EXIT" : (isStopLoss || isCritical) ? "CRITICAL RISK DEFENSE" : "DEFENSIVE REVIEW";

    message = `${emoji} *${headerTitle} — ${d.posType || "OPTION"}*
━━━━━━━━━━━━━━━━━━━━━
📍 *Contract:* \`${d.posId || d.strike}\`
📐 *Current Delta:* \`${d.delta}\` ${Math.abs(d.delta || 0) >= 0.4 ? "🔴" : "🟡"}
💰 *Current P&L:* ${d.pnl >= 0 ? "+" : ""}$${d.pnl} (${d.pctProfit}% profit)

⚠️ *Status:*
${d.warningReason}

💡 *Tactical Action:*
${d.tacticalAction || (isTP ? "ปิดทำกำไรตามเป้าหมายของระบบเพื่อเคลียร์ Margin" : "ตรวจสอบกราฟและพิจารณา Roll หรือปิดสัญญาตามวินัย")}
━━━━━━━━━━━━━━━━━━━━━
⚡ _กดปุ่มด้านล่างเพื่อเปิดระบบหรือจัดการบน Binance ได้ทันที_`;
  }

  // ─── Entry Signals (Short Put, Skewed Strangle, Strangle) ───────────────────
  else if (type === "short_put_signal" || (type === "signal" && data?.strategy === "SHORT_PUT")) {
    const d = data || {};
    const markPrice = d.putMark || d.markPrice || d.totalPremium;

    message = `🟢 *ENTRY SIGNAL — BTC Bullish Short Put* ⭐
━━━━━━━━━━━━━━━━━━━━━
📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice).toLocaleString()} | Chain Avg IV: ${d.marketIv ?? d.avgIV ?? "N/A"}%

📍 *Short Put Contract:*
  • Strike: *$${Number(d.putStrike || d.strike).toLocaleString()}*
  • Delta: \`${d.putDelta || d.delta}\` | IV: ${d.putIV || d.iv}%
  • Mark Price: $${markPrice}
  • Buffer ระยะปลอดภัย: *${d.putDistancePct}%* จากราคาปัจจุบัน

💰 *Yield Metrics:*
  • Premium รับ: *~$${d.totalPremium} USD* / 1 BTC
  • Theta Decay: *+$${d.totalTheta}/วัน*
  • Breakeven Price: *$${Number(d.breakevenLow).toLocaleString()}*

💡 *เหตุผล:* ตลาด Bullish + Chain IV ${d.marketIv ?? "N/A"}% ขาย Put โดยไม่มี Upside Call Risk (ยังมี Downside/Tail Risk)
━━━━━━━━━━━━━━━━━━━━━
⚡ _เปิดแอป Binance เพื่อพิจารณาเข้าตามวินัยครับ_`;
  }

  else if (type === "skewed_strangle_signal" || (type === "signal" && data?.strategy === "SKEWED_STRANGLE")) {
    const d = data || {};
    message = `⚡ *ENTRY SIGNAL — BTC Skewed Strangle (Bullish)*
━━━━━━━━━━━━━━━━━━━━━
📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice).toLocaleString()} | Chain Avg IV: ${d.marketIv ?? d.avgIV ?? "N/A"}%

📍 *Short Put:*
  • Strike: *$${Number(d.putStrike).toLocaleString()}* | Delta: \`${d.putDelta}\`

📍 *Wide Short Call (OTM กว้างพิเศษ):*
  • Strike: *$${Number(d.callStrike).toLocaleString()}* (Buffer +${d.callDistancePct}%) | Delta: \`+${d.callDelta}\`

💰 *Yield Metrics:*
  • รวม Premium รับ: *~$${d.totalPremium} USD* / 1 BTC
  • Theta Decay: *+$${d.totalTheta}/วัน*
  • Safe Zone: *$${Number(d.breakevenLow).toLocaleString()} — $${Number(d.breakevenHigh).toLocaleString()}*

💡 *เหตุผล:* กลยุทธ์เอียงข้าง Bullish ขยายขอบเขต Short Call กว้างพิเศษเพื่อรับเทรนด์
━━━━━━━━━━━━━━━━━━━━━
⚡ _เปิดแอป Binance เพื่อพิจารณาเข้าตามวินัยครับ_`;
  }

  else if (type === "strangle_signal" || (type === "signal" && data?.strategy === "STRANGLE")) {
    const d = data || {};
    message = `🟢 *ENTRY SIGNAL — BTC Short Strangle*
━━━━━━━━━━━━━━━━━━━━━
📅 *Expiry:* ${d.expiry} (${d.dte} วัน)
₿ *BTC Spot:* $${Number(d.btcPrice).toLocaleString()} | Chain Avg IV: ${d.marketIv ?? d.avgIV ?? "N/A"}%

📍 *Short Put:* Strike *$${Number(d.putStrike).toLocaleString()}* (Delta \`${d.putDelta}\`)
📍 *Short Call:* Strike *$${Number(d.callStrike).toLocaleString()}* (Delta \`+${d.callDelta}\`)

💰 *Yield Metrics:*
  • รวม Premium รับ: *~$${d.totalPremium} USD* / 1 BTC
  • Theta Decay: *+$${d.totalTheta}/วัน*
  • Safe Zone: *$${Number(d.breakevenLow).toLocaleString()} — $${Number(d.breakevenHigh).toLocaleString()}*

💡 *เหตุผล:* เข้าเกณฑ์ Delta Neutral และ DTE Preferred (14–28 วัน)
━━━━━━━━━━━━━━━━━━━━━
⚡ _เปิดแอป Binance เพื่อพิจารณาเข้าตามวินัยครับ_`;
  }

  if (!message) return res.status(400).json({ error: "Unknown alert type" });

  try {
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: buttons,
      },
    };

    let r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let result = await r.json();

    // Fallback: if markdown parsing fails, retry with clean plain text
    if (!result.ok && payload.parse_mode) {
      delete payload.parse_mode;
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
