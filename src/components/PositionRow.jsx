import { useState } from "react";
import { T } from "../tokens.js";
import { fmtUSD, pnlColor, deltaColor, statusColor } from "../utils.js";
import { Pill } from "./Pill.jsx";

// Grid column definition — shared between header and rows
export const POSITION_GRID_COLS = "85px 90px 50px 65px 65px 60px 75px 85px 85px 65px";

export function PositionRow({ pos, onAnalyze }) {
  const [hovered, setHovered] = useState(false);
  const isCall = pos.type.includes("Call");
  const profit = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: POSITION_GRID_COLS,
        gap: 0,
        alignItems: "center",
        padding: "10px 16px",
        borderBottom: `1px solid ${T.border}`,
        background: hovered
          ? T.bg2
          : pos.status === "warning"
          ? T.amberDim
          : pos.status === "danger"
          ? T.redDim
          : "transparent",
        transition: "background 0.15s ease",
      }}
    >
      <Pill color={isCall ? T.blue : T.amber}>{pos.type}</Pill>
      <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13, fontWeight: 600 }}>
        {fmtUSD(pos.strike)}
      </span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>
        {pos.dte}d
      </span>
      <span style={{ color: deltaColor(pos.delta), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
        {pos.delta > 0 ? "+" : ""}{pos.delta.toFixed(2)}
      </span>
      <span style={{ color: T.green, fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
        +{pos.theta.toFixed(1)}/d
      </span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>
        {pos.iv.toFixed(1)}%
      </span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>
        {fmtUSD(pos.premium)}
      </span>
      <div>
        <div style={{ color: pnlColor(pos.pnl), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
          {pos.pnl >= 0 ? "+" : ""}{fmtUSD(pos.pnl)}
        </div>
        <div style={{ fontSize: 10, color: profit >= 0 ? T.green : T.red, fontFamily: T.font, opacity: 0.85 }}>
          {profit >= 0 ? "+" : ""}{profit.toFixed(0)}%
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          width: 7, height: 7, borderRadius: "50%",
          background: statusColor(pos.status),
          boxShadow: `0 0 8px ${statusColor(pos.status)}`,
        }} />
        <span style={{
          color: statusColor(pos.status),
          fontSize: 10, fontFamily: T.font,
          textTransform: "uppercase", letterSpacing: 1, fontWeight: 700,
        }}>
          {pos.status}
        </span>
      </div>

      {/* Compact, elegant AI button */}
      <div style={{ textAlign: "right" }}>
        <button
          id={`analyze-btn-${pos.id}`}
          onClick={() => onAnalyze(pos)}
          title="วิเคราะห์ Position ด้วย AI"
          style={{
            background: T.greenDim,
            border: `1px solid ${T.greenMid}`,
            color: T.green,
            borderRadius: 5,
            padding: "4px 8px",
            cursor: "pointer",
            fontFamily: T.fontSans,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            transition: "all 0.2s ease",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = T.green;
            e.currentTarget.style.color = T.bg0;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = T.greenDim;
            e.currentTarget.style.color = T.green;
          }}
        >
          <span>🧠</span>
          <span>AI</span>
        </button>
      </div>
    </div>
  );
}
