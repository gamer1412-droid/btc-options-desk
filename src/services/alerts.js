import { STRATEGY_CONFIG } from "../config/strategyConfig.js";
import { evaluateEntryRules } from "./rulesEngine.js";

const ALERT_STORAGE_KEY = "btc_options_desk_alerted_positions_v1";
const ENTRY_STORAGE_KEY = "btc_options_desk_alerted_entries_v1";
const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours cooldown per alert state

// ─── LocalStorage Persistent Alert History Helpers ───────────────────────────
export function getPersistedAlerts(key = ALERT_STORAGE_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const data = JSON.parse(raw);
    const now = Date.now();
    const validIds = new Set();
    const cleaned = {};

    for (const [id, timestamp] of Object.entries(data)) {
      if (now - Number(timestamp) < ALERT_COOLDOWN_MS) {
        validIds.add(id);
        cleaned[id] = timestamp;
      }
    }
    localStorage.setItem(key, JSON.stringify(cleaned));
    return validIds;
  } catch {
    return new Set();
  }
}

export function savePersistedAlert(id, key = ALERT_STORAGE_KEY) {
  try {
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : {};
    data[id] = Date.now();
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export { ALERT_STORAGE_KEY, ENTRY_STORAGE_KEY };

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

// ─── Alert criteria v2.0 ───────────────────────────────────────────────────────
// Evaluates active positions against Defense, TP, Stop Loss, and DTE rules.
export function checkAlerts(positions, alertedIds) {
  const cfg = STRATEGY_CONFIG;
  const newAlerts = [];

  for (const pos of positions) {
    if (alertedIds.has(pos.id)) continue;
    const absDelta = Math.abs(pos.delta);
    const pct = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;

    // 1. Hard Stop Loss (2.0x Premium)
    if (pos.pnl < 0 && Math.abs(pos.pnl) >= pos.premium * cfg.exit.hardStopLossMultiplier) {
      newAlerts.push({ pos, reason: `🚨 HARD STOP LOSS: ขาดทุนแตะ 2× Premium (${pos.pnl} USD) — ปิดตำแหน่งทันที!` });
    }
    // 2. DTE Exit (<= 2 days)
    else if (pos.dte <= cfg.exit.dteStop) {
      newAlerts.push({ pos, reason: `⏰ DTE EXIT: เหลือ ${pos.dte} วัน — ห้ามถือข้าม Expiry (Gamma Risk สูง)` });
    }
    // 3. Take Profit 50%
    else if (pct >= cfg.exit.mainTpPct) {
      newAlerts.push({ pos, reason: `✅ TAKE PROFIT: กำไร ${pct.toFixed(0)}% (>= 50%) — ปิดทำกำไรตามแผน` });
    }
    // 4. Delta Defense Action Level (>= 0.65)
    else if (absDelta >= cfg.defense.actionDelta) {
      newAlerts.push({ pos, reason: `🚨 ACTION REQUIRED: Delta ${pos.delta.toFixed(2)} >= 0.65 — ต้อง Close หรือ Roll 1 ครั้ง` });
    }
    // 5. Delta Defense Mode (>= 0.50)
    else if (absDelta >= cfg.defense.strongWarningDelta) {
      newAlerts.push({ pos, reason: `⚠️ DEFENSIVE MODE: Delta ${pos.delta.toFixed(2)} >= 0.50 — เตรียม Close / Roll` });
    }
    // 6. Delta Warning (>= 0.35)
    else if (absDelta >= cfg.defense.warningDelta) {
      newAlerts.push({ pos, reason: `⚠️ DEFENSIVE REVIEW: Delta ${pos.delta.toFixed(2)} >= 0.35 — เริ่มเฝ้าระวัง` });
    }
  }
  return newAlerts;
}

// ─── Entry Signal Criteria v2.0 ──────────────────────────────────────────────
// Evaluates opportunities through rulesEngine and only sends alerts for non-blocked setups.
export function checkEntryAlerts(opportunities, alertedEntryIds, marketContext = {}, accountInfo = null, currentPositions = []) {
  const newSignals = [];
  if (!Array.isArray(opportunities) || opportunities.length === 0) return newSignals;

  for (const opp of opportunities) {
    if (alertedEntryIds.has(opp.id)) continue;

    // Evaluate full rules engine
    const evaluation = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
    if (evaluation.isBlocked) continue;

    newSignals.push({
      ...opp,
      evaluation,
    });
    alertedEntryIds.add(opp.id);
    // Alert at most 1 best opportunity per scan cycle to prevent spam
    break;
  }

  return newSignals;
}


