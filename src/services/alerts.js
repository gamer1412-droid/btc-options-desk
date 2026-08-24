// ─── Telegram sender ──────────────────────────────────────────────────────────
export async function sendTelegram(type, data = {}) {
  try {
    await fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
  } catch (e) {
    console.error("Telegram error:", e.message);
  }
}

// ─── Alert criteria ───────────────────────────────────────────────────────────
// Called every poll cycle. Sends at most once per position until app resets.
export function checkAlerts(positions, alertedIds) {
  const newAlerts = [];
  for (const pos of positions) {
    if (alertedIds.has(pos.id)) continue; // already alerted, skip
    const absDelta = Math.abs(pos.delta);
    // premium and currentPrice are now Numbers — safe arithmetic
    const pct = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;

    if (absDelta >= 0.40) {
      newAlerts.push({ pos, reason: `⚠️ Delta ${pos.delta.toFixed(2)} — ถึง 0.40 แล้ว ควร Roll หรือ Close` });
    } else if (pct >= 50) {
      newAlerts.push({ pos, reason: `✅ Profit ${pct.toFixed(0)}% — ถึง TP แล้ว ควร Close` });
    } else if (pos.pnl < 0 && Math.abs(pos.pnl) >= pos.premium * 2) {
      newAlerts.push({ pos, reason: `🚨 Loss = 2× premium — STOP LOSS ด่วน!` });
    } else if (pos.dte <= 2) {
      newAlerts.push({ pos, reason: `⏰ เหลือ ${pos.dte} วัน — Gamma risk สูง ควร Close` });
    }
  }
  return newAlerts;
}
