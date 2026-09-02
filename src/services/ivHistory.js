// ─── IV History Service — Rolling 90-Day IV Rank & Percentile ───────────────
// Stores daily IV snapshots in localStorage (key: btc_iv_history)
// Provides IV Rank = (current - min)/(max-min)*100 and IV Percentile (percentile rank)

const STORAGE_KEY = "btc_iv_history";
const MAX_ENTRIES = 90;
const MIN_ENTRIES_FOR_RANK = 7;

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadHistory() {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) => e && typeof e.iv === "number" && Number.isFinite(e.iv) && typeof e.ts === "number"
    );
  } catch {
    return [];
  }
}

function saveHistory(history) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // quota exceeded — trim and retry
    try {
      const trimmed = history.slice(-Math.floor(MAX_ENTRIES / 2));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {}
  }
}

function toDateKey(ts) {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return String(ts);
  }
}

/**
 * Record a market IV observation.
 * Deduplicates by calendar day (updates same-day entry) so 90 entries ≈ 90 days.
 * @param {number} marketIv - current market IV (e.g. 45 for 45%)
 * @returns {Array} updated history
 */
export function recordIv(marketIv) {
  const iv = Number(marketIv);
  if (!Number.isFinite(iv) || iv <= 0) return loadHistory();
  const history = loadHistory();
  const now = Date.now();
  const todayKey = toDateKey(now);

  if (history.length > 0) {
    const last = history[history.length - 1];
    const lastKey = last.date || toDateKey(last.ts);
    if (lastKey === todayKey) {
      // Update today's entry with latest IV (keep most recent)
      last.iv = Math.round(iv * 10) / 10;
      last.ts = now;
      last.date = todayKey;
      saveHistory(history);
      return history;
    }
  }

  history.push({ iv: Math.round(iv * 10) / 10, ts: now, date: todayKey });
  // cap at 90 entries (rolling window)
  const capped = history.length > MAX_ENTRIES ? history.slice(-MAX_ENTRIES) : history;
  saveHistory(capped);
  return capped;
}

/**
 * IV Rank = (current - min) / (max - min) * 100 over stored history.
 * Returns null if insufficient history (< 7 entries).
 */
export function getIvRank(currentIv) {
  const iv = Number(currentIv);
  if (!Number.isFinite(iv)) return null;
  const history = loadHistory();
  if (history.length < MIN_ENTRIES_FOR_RANK) return null;
  const values = history.map((h) => h.iv);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 50; // flat history → neutral rank
  const rank = ((iv - min) / (max - min)) * 100;
  // clamp 0-100 and round to 1 decimal
  return Math.round(Math.min(100, Math.max(0, rank)) * 10) / 10;
}

/**
 * IV Percentile = percentile rank: (# of history values <= current) / total * 100
 * Returns null if insufficient history (< 7 entries).
 */
export function getIvPercentile(currentIv) {
  const iv = Number(currentIv);
  if (!Number.isFinite(iv)) return null;
  const history = loadHistory();
  if (history.length < MIN_ENTRIES_FOR_RANK) return null;
  const count = history.filter((h) => h.iv <= iv).length;
  const pct = (count / history.length) * 100;
  return Math.round(pct * 10) / 10;
}

/**
 * Returns stats about stored IV history.
 */
export function getHistoryStats() {
  const history = loadHistory();
  const count = history.length;
  if (count === 0) {
    return {
      count: 0,
      daysOfHistory: 0,
      min: null,
      max: null,
      avg: null,
      hasEnoughData: false,
      isFallback: true,
      history: [],
    };
  }
  const values = history.map((h) => h.iv);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
  const oldest = history[0]?.ts ?? Date.now();
  const daysOfHistory = Math.ceil((Date.now() - oldest) / 86400000) || 1;
  return {
    count,
    daysOfHistory,
    min,
    max,
    avg,
    hasEnoughData: count >= MIN_ENTRIES_FOR_RANK,
    isFallback: count < MIN_ENTRIES_FOR_RANK,
    history: [...history],
  };
}

// For testing / debugging
export function clearHistory() {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function getHistory() {
  return loadHistory();
}

export const IV_HISTORY_KEY = STORAGE_KEY;
export const IV_HISTORY_MAX = MAX_ENTRIES;
export const IV_HISTORY_MIN_DAYS = MIN_ENTRIES_FOR_RANK;
