import { STRATEGY_CONFIG } from "../config/strategyConfig.js";
import { evaluateEntryRules } from "./rulesEngine.js";

const ALERT_STORAGE_KEY = "btc_options_desk_alerted_positions_v2";
const ENTRY_STORAGE_KEY = "btc_options_desk_alerted_entries_v2";
const ALERT_PREFS_KEY   = "btc_options_desk_alert_preferences_v1";
const ALERT_COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 hours cooldown per alert state level

export const DEFAULT_ALERT_PREFERENCES = {
  enabled: true,
  criticalDefense: true, // Stop Loss (2x), Delta >= 0.65, DTE <= 2
  warningDefense: true,  // Delta >= 0.35, Delta >= 0.50
  takeProfit: true,      // Profit reaches the configured main TP target
  entrySignals: true,    // High quality entry scanner signals
  dailyBriefing: true,   // Daily portfolio briefing digest
};

// ─── Preferences Helpers ──────────────────────────────────────────────────────
export function getAlertPreferences() {
  try {
    const raw = localStorage.getItem(ALERT_PREFS_KEY);
    if (!raw) return { ...DEFAULT_ALERT_PREFERENCES };
    return { ...DEFAULT_ALERT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_ALERT_PREFERENCES };
  }
}

export function saveAlertPreferences(prefs) {
  try {
    localStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

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

export function clearPersistedAlerts() {
  try {
    localStorage.removeItem(ALERT_STORAGE_KEY);
    localStorage.removeItem(ENTRY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export { ALERT_STORAGE_KEY, ENTRY_STORAGE_KEY, ALERT_PREFS_KEY };

// ─── Telegram sender ──────────────────────────────────────────────────────────
export async function sendTelegram(type, data = {}) {
  try {
    const res = await fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
    const jsonResult = await res.json().catch(() => ({}));
    if (!res.ok || jsonResult?.error) throw new Error(jsonResult?.error || `Telegram HTTP ${res.status}`);
    return jsonResult;
  } catch (e) {
    console.error("Telegram error:", e.message);
    return { error: e.message };
  }
}

// ─── Alert criteria v2.5 (State-Aware Severity Escalation) ─────────────────────
// Evaluates active positions against Defense, TP, Stop Loss, and DTE rules.
// Uses composite keys (pos.id + "::" + level) to prevent minor warnings from blocking critical alerts!
export function checkAlerts(positions, alertedIds, prefs = DEFAULT_ALERT_PREFERENCES) {
  const cfg = STRATEGY_CONFIG;
  const newAlerts = [];

  if (!prefs.enabled) return newAlerts;

  for (const pos of positions) {
    const absDelta = Math.abs(pos.delta);
    const pct = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;

    // 1. Hard Stop Loss (2.0x Premium) — Critical
    const stopLossKey = `${pos.id}::STOP_LOSS`;
    if (prefs.criticalDefense && pos.pnl < 0 && Math.abs(pos.pnl) >= pos.premium * cfg.exit.hardStopLossMultiplier) {
      if (!alertedIds.has(stopLossKey)) {
        newAlerts.push({
          pos,
          alertKey: stopLossKey,
          alertLevel: "CRITICAL",
          tacticalAction: "ปิดสถานะทันทีเพื่อตัดขาดทุนตามวินัย 2× Premium",
          reason: `🚨 HARD STOP LOSS: ขาดทุนแตะ 2× Premium (${pos.pnl} USD) — ปิดตำแหน่งทันที!`,
        });
        continue;
      }
    }

    // 2. DTE Exit (<= 2 days) — Critical
    const dteKey = `${pos.id}::DTE_EXIT`;
    if (prefs.criticalDefense && pos.dte <= cfg.exit.dteStop) {
      if (!alertedIds.has(dteKey)) {
        newAlerts.push({
          pos,
          alertKey: dteKey,
          alertLevel: "CRITICAL",
          tacticalAction: "ปิดทำกำไร/ตัดความเสี่ยงก่อนวันหมดอายุ หลีกเลี่ยง Gamma Risk",
          reason: `⏰ DTE EXIT: เหลือ ${pos.dte} วัน — ห้ามถือข้าม Expiry (Gamma Risk สูง)`,
        });
        continue;
      }
    }

    // 3. Main Take Profit — use the central strategy configuration
    const tpKey = `${pos.id}::TP_${cfg.exit.mainTpPct}`;
    if (prefs.takeProfit && pct >= cfg.exit.mainTpPct) {
      if (!alertedIds.has(tpKey)) {
        newAlerts.push({
          pos,
          alertKey: tpKey,
          alertLevel: "TAKE_PROFIT",
          tacticalAction: `ปิดทำกำไรเมื่อถึง ${cfg.exit.mainTpPct}% ตามระบบเพื่อเคลียร์ Margin ไปเปิดรอบใหม่`,
          reason: `🎯 TAKE PROFIT: กำไร ${pct.toFixed(0)}% (>= ${cfg.exit.mainTpPct}%) — ปิดทำกำไรตามแผน`,
        });
        continue;
      }
    }

    // 4. Delta Defense Action Level (>= 0.65) — Critical Action
    const delta65Key = `${pos.id}::DELTA_65`;
    if (prefs.criticalDefense && absDelta >= cfg.defense.actionDelta) {
      if (!alertedIds.has(delta65Key)) {
        newAlerts.push({
          pos,
          alertKey: delta65Key,
          alertLevel: "CRITICAL",
          tacticalAction: "ปิดทำกำไรขาที่ปลอดภัย และ Roll ขาที่ถูกทดสอบออกไป หรือปิดทั้งคู่",
          reason: `🚨 ACTION REQUIRED: Delta ${pos.delta.toFixed(2)} >= 0.65 — ต้อง Close หรือ Roll 1 ครั้ง`,
        });
        continue;
      }
    }

    // 5. Delta Defense Mode (>= 0.50) — Warning Mode
    const delta50Key = `${pos.id}::DELTA_50`;
    if (prefs.warningDefense && absDelta >= cfg.defense.strongWarningDelta) {
      if (!alertedIds.has(delta50Key)) {
        newAlerts.push({
          pos,
          alertKey: delta50Key,
          alertLevel: "WARNING",
          tacticalAction: "เตรียมตั้ง Limit Order ปิด หรือเตรียม Roll ขาตรงข้ามเข้ามาชดเชย",
          reason: `⚠️ DEFENSIVE MODE: Delta ${pos.delta.toFixed(2)} >= 0.50 — เตรียม Close / Roll`,
        });
        continue;
      }
    }

    // 6. Delta Warning (>= 0.35) — Early Review
    const delta35Key = `${pos.id}::DELTA_35`;
    if (prefs.warningDefense && absDelta >= cfg.defense.warningDelta) {
      if (!alertedIds.has(delta35Key)) {
        newAlerts.push({
          pos,
          alertKey: delta35Key,
          alertLevel: "REVIEW",
          tacticalAction: "เฝ้าระวังและติดตามระดับราคา BTC ต่อเนื่อง",
          reason: `⚠️ DEFENSIVE REVIEW: Delta ${pos.delta.toFixed(2)} >= 0.35 — เริ่มเฝ้าระวัง`,
        });
        continue;
      }
    }
  }

  return newAlerts;
}

// ─── Entry Signal Criteria v2.5 ──────────────────────────────────────────────
// Evaluates opportunities through rulesEngine and only sends alerts for non-blocked setups.
export function checkEntryAlerts(opportunities, alertedEntryIds, marketContext = {}, accountInfo = null, currentPositions = [], prefs = DEFAULT_ALERT_PREFERENCES) {
  const newSignals = [];
  if (!prefs.enabled || !prefs.entrySignals) return newSignals;
  if (!Array.isArray(opportunities) || opportunities.length === 0) return newSignals;

  for (const opp of opportunities) {
    const oppKey = `${opp.id}::${opp.strategy || "STRANGLE"}`;
    if (alertedEntryIds.has(oppKey)) continue;

    // Evaluate full rules engine
    const evaluation = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
    if (evaluation.isBlocked) continue;

    newSignals.push({
      ...opp,
      alertKey: oppKey,
      evaluation,
    });
    alertedEntryIds.add(oppKey);
    // Alert at most 1 best opportunity per scan cycle to prevent spam
    break;
  }

  return newSignals;
}

// ─── Daily Portfolio Briefing Generator ──────────────────────────────────────
export function buildDailyBriefingData(positions = [], marketContext = {}, accountInfo = null) {
  const totalPnl = positions.reduce((s, p) => s + (p.pnl || 0), 0);
  const totalTheta = positions.reduce((s, p) => s + (Math.abs(p.theta || 0) * (p.size || 1)), 0);
  const netDelta = positions.reduce((s, p) => s + (p.positionDelta ?? ((p.delta || 0) * (p.size || 1))), 0);
  const minDte = positions.length > 0 ? Math.min(...positions.map(p => p.dte || 999)) : 0;
  const criticalCount = positions.filter(p => Math.abs(p.delta) >= 0.50 || (p.dte && p.dte <= 2)).length;

  return {
    btcPrice: marketContext.price || 0,
    change24h: marketContext.change24h || 0,
    marketIv: marketContext.marketIv ?? null,
    ivRank: marketContext.ivRank ?? null,
    positionCount: positions.length,
    totalPnl: Math.round(totalPnl),
    totalTheta: Math.round(totalTheta),
    netDelta: Math.round(netDelta * 100) / 100,
    minDte: minDte === 999 ? 0 : minDte,
    criticalCount,
    marginRatio: accountInfo ? (accountInfo.marginRatio || 0) : 0,
    equity: accountInfo ? Math.round(accountInfo.equity || 0) : 0,
  };
}
