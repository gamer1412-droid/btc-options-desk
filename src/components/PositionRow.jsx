import { T } from "../tokens.js";
import { fmtUSD, pnlColor, deltaColor, statusColor } from "../utils.js";
import { Pill } from "./Pill.jsx";

// Grid column definition — shared between header and rows
export const POSITION_GRID_COLS = "90px 90px 55px 65px 65px 65px 80px 80px 80px auto";

export function PositionRow({ pos, onAnalyze }) {
  const isCall = pos.type.includes("Call");
  // premium and currentPrice are Numbers — arithmetic is safe
  const profit = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: POSITION_GRID_COLS,
      gap: 0, alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${T.border}`,
      background: pos.status === "warning" ? T.amberDim : pos.status === "danger" ? T.redDim : "transparent",
    }}>
      <Pill color={isCall ? T.blue : T.amber}>{pos.type}</Pill>
      <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13 }}>{fmtUSD(pos.strike)}</span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{pos.dte}d</span>
      <span style={{ color: deltaColor(pos.delta), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
        {pos.delta > 0 ? "+" : ""}{pos.delta.toFixed(2)}
      </span>
      <span style={{ color: T.green, fontFamily: T.font, fontSize: 12 }}>{pos.theta.toFixed(1)}/d</span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{pos.iv.toFixed(1)}%</span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{fmtUSD(pos.premium)}</span>
      <div>
        <div style={{ color: pnlColor(pos.pnl), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
          {pos.pnl >= 0 ? "+" : ""}{fmtUSD(pos.pnl)}
        </div>
        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.font }}>{profit.toFixed(0)}% profit</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(pos.status), boxShadow: `0 0 6px ${statusColor(pos.status)}` }} />
        <span style={{ color: statusColor(pos.status), fontSize: 11, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1 }}>{pos.status}</span>
      </div>
      <button
        id={`analyze-btn-${pos.id}`}
        onClick={() => onAnalyze(pos)}
        style={{
          background: T.greenDim, border: `1px solid ${T.greenMid}`, color: T.green,
          borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontFamily: T.font,
          fontSize: 11, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap",
        }}
      >
        AI ANALYZE
      </button>
    </div>
  );
}
