import { T } from "./tokens.js";

// ─── Formatters ───────────────────────────────────────────────────────────────
export const fmt = (n, dec = 2) => {
  if (n == null || isNaN(n)) return "-";
  const num = Number(n);
  return num.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

export const fmtUSD = (n, dec = null) => {
  if (n == null || isNaN(n)) return "$-";
  const num = Number(n);
  // Auto-detect decimals: >= 1000 with no cents -> 0 decimals, else 2 decimals for precision
  const d = dec !== null ? dec : (Math.abs(num) >= 1000 && num % 1 === 0 ? 0 : 2);
  const formatted = fmt(Math.abs(num), d);
  return num < 0 ? `-$${formatted}` : `$${formatted}`;
};

// ─── Color helpers ────────────────────────────────────────────────────────────
export const pnlColor = (v) => (v > 0 ? T.green : v < 0 ? T.red : T.textSecondary);
export const deltaColor = (d) => {
  const a = Math.abs(d);
  if (a >= 0.50) return T.red;
  if (a >= 0.35) return T.amber;
  return T.green;
};
export const statusColor = (s) => ({ healthy: T.green, warning: T.amber, danger: T.red, defensive: T.red }[s] ?? T.textSecondary);

// ─── Position health classifier v2.0 ──────────────────────────────────────────
export function classify(pos) {
  const absDelta = Math.abs(pos.delta || 0);
  const dte = pos.dte ?? 999;
  const pnl = pos.pnl || 0;
  const premium = pos.premium || 0;

  if ((premium > 0 && pnl < 0 && Math.abs(pnl) >= premium * 2.0) || dte <= 2 || absDelta >= 0.50) {
    return "danger";
  }
  if (absDelta >= 0.35 || dte <= 4) {
    return "warning";
  }
  return "healthy";
}

// ─── Safe HTML escape ─────────────────────────────────────────────────────────
// Prevents XSS by escaping raw text before we inject our own safe HTML tags.
export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── Markdown-lite renderer (safe subset only) ───────────────────────────────
// Used in AnalysisPanel to render AI text without XSS risk.
// Only injects HTML for patterns WE define — not from raw AI output.
export function renderAnalysisHtml(rawText) {
  const escaped = escapeHtml(rawText);

  return escaped
    // **bold** → styled strong
    .replace(/\*\*(.*?)\*\*/g, `<strong style="color:${T.green};font-family:${T.font};letter-spacing:1px">$1</strong>`)
    // Action keywords
    .replace(/(HOLD|CLOSE NOW|ROLL OUT|ADJUST)/g, (m) => {
      const c = m === "HOLD" ? T.green : m === "CLOSE NOW" ? T.red : T.amber;
      return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;border-radius:4px;padding:2px 8px;font-family:${T.font};font-weight:700;font-size:12px;letter-spacing:1px">${m}</span>`;
    })
    // Status keywords
    .replace(/(HEALTHY|WARNING|DANGER)/g, (m) => {
      const c = m === "HEALTHY" ? T.green : m === "WARNING" ? T.amber : T.red;
      return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;border-radius:4px;padding:2px 8px;font-family:${T.font};font-weight:700;font-size:12px;letter-spacing:1px">${m}</span>`;
    });
}
