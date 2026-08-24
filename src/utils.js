import { T } from "./tokens.js";

// ─── Formatters ───────────────────────────────────────────────────────────────
export const fmt = (n, dec = 0) =>
  n?.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) ?? "-";
export const fmtUSD = (n) => `$${fmt(n, 0)}`;

// ─── Color helpers ────────────────────────────────────────────────────────────
export const pnlColor = (v) => (v > 0 ? T.green : v < 0 ? T.red : T.textSecondary);
export const deltaColor = (d) => {
  const a = Math.abs(d);
  if (a >= 0.38) return T.red;
  if (a >= 0.28) return T.amber;
  return T.green;
};
export const statusColor = (s) => ({ healthy: T.green, warning: T.amber, danger: T.red }[s] ?? T.textSecondary);

// ─── Position health classifier ────────────────────────────────────────────────
export function classify(pos) {
  const absDelta = Math.abs(pos.delta);
  if (absDelta >= 0.40 || pos.dte <= 1) return "danger";
  if (absDelta >= 0.28 || pos.dte <= 3) return "warning";
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
