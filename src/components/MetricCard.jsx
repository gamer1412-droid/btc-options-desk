import { T } from "../tokens.js";

export function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8,
      padding: "14px 18px", flex: 1, minWidth: 130, borderTop: `2px solid ${color ?? T.border}`,
    }}>
      <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontFamily: T.font, marginBottom: 6 }}>{label}</div>
      <div style={{ color: color ?? T.textPrimary, fontSize: 22, fontWeight: 700, fontFamily: T.font, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4, fontFamily: T.font }}>{sub}</div>}
    </div>
  );
}
