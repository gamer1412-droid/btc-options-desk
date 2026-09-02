import { useState } from "react";
import { T } from "../tokens.js";
import { fmtUSD, pnlColor, deltaColor, statusColor } from "../utils.js";
import { Pill } from "./Pill.jsx";

// Grid column definition — shared between header and rows
export const POSITION_GRID_COLS = "85px 90px 50px 65px 65px 60px 75px 85px 85px 65px";
export const POSITION_MIN_WIDTH = 700;

export function PositionRow({ pos, onAnalyze }) {
  const [hovered, setHovered] = useState(false);
  const isCall = pos.type.includes("Call");
  const profit = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;
  const posThetaDollar = Math.abs(pos.theta) * (pos.size || 1);

  const desktopBase = {
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
    minWidth: POSITION_MIN_WIDTH,
  };

  return (
    <>
      <style>{`
        .pr-desktop { display: grid; }
        .pr-mobile { display: none; }
        @media (max-width: 640px) {
          .pr-desktop { display: none !important; }
          .pr-mobile { display: block !important; }
        }
      `}</style>

      {/* ── Desktop row: 10-col grid, horizontally scrollable via parent overflow-x-auto ── */}
      <div
        className="pr-desktop"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={desktopBase}
      >
        <Pill color={isCall ? T.blue : T.amber}>{pos.type}</Pill>
        <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13, fontWeight: 600 }}>
          {fmtUSD(pos.strike, 0)}
        </span>
        <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{pos.dte}d</span>
        <span style={{ color: deltaColor(pos.delta), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
          {pos.delta > 0 ? "+" : ""}
          {pos.delta.toFixed(2)}
        </span>
        <span style={{ color: T.green, fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
          +{posThetaDollar < 1 ? posThetaDollar.toFixed(2) : posThetaDollar.toFixed(1)}/d
        </span>
        <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{pos.iv.toFixed(1)}%</span>
        <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{fmtUSD(pos.premium, 2)}</span>
        <div>
          <div style={{ color: pnlColor(pos.pnl), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
            {pos.pnl > 0 ? "+" : ""}
            {fmtUSD(pos.pnl, 2)}
          </div>
          <div style={{ fontSize: 10, color: profit >= 0 ? T.green : T.red, fontFamily: T.font, opacity: 0.85 }}>
            {profit > 0 ? "+" : ""}
            {profit.toFixed(1)}%
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: statusColor(pos.status),
              boxShadow: `0 0 8px ${statusColor(pos.status)}`,
            }}
          />
          <span
            style={{
              color: statusColor(pos.status),
              fontSize: 10,
              fontFamily: T.font,
              textTransform: "uppercase",
              letterSpacing: 1,
              fontWeight: 700,
            }}
          >
            {pos.status}
          </span>
        </div>
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

      {/* ── Mobile card layout: stacked, thumb-friendly ── */}
      <div
        className="pr-mobile"
        onClick={() => onAnalyze(pos)}
        style={{
          background: hovered
            ? T.bg2
            : pos.status === "warning"
            ? T.amberDim
            : pos.status === "danger"
            ? T.redDim
            : T.bg1,
          borderBottom: `1px solid ${T.border}`,
          borderLeft: `3px solid ${pos.status === "danger" ? T.red : pos.status === "warning" ? T.amber : isCall ? T.blue : T.amber}`,
          padding: "12px 14px",
          cursor: "pointer",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Row 1: Type + Strike + DTE + Status */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Pill color={isCall ? T.blue : T.amber}>{pos.type}</Pill>
            <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 14, fontWeight: 800 }}>{fmtUSD(pos.strike, 0)}</span>
            <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 6px" }}>
              {pos.dte}d
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor(pos.status), boxShadow: `0 0 8px ${statusColor(pos.status)}` }} />
            <span style={{ color: statusColor(pos.status), fontSize: 10, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
              {pos.status}
            </span>
          </div>
        </div>

        {/* Row 2: Delta / Theta / IV — 3-col grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 8px", textAlign: "center" }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.font, marginBottom: 2 }}>DELTA</div>
            <div style={{ color: deltaColor(pos.delta), fontFamily: T.font, fontSize: 14, fontWeight: 800 }}>
              {pos.delta > 0 ? "+" : ""}{pos.delta.toFixed(2)}
            </div>
          </div>
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 8px", textAlign: "center" }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.font, marginBottom: 2 }}>THETA /d</div>
            <div style={{ color: T.green, fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
              +{posThetaDollar < 1 ? posThetaDollar.toFixed(2) : posThetaDollar.toFixed(1)}
            </div>
          </div>
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 8px", textAlign: "center" }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.font, marginBottom: 2 }}>IV</div>
            <div style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>{pos.iv.toFixed(1)}%</div>
          </div>
        </div>

        {/* Row 3: Received + P&L + AI button */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div>
              <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.font }}>RECEIVED</div>
              <div style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>{fmtUSD(pos.premium, 2)}</div>
            </div>
            <div>
              <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.font }}>P&L</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ color: pnlColor(pos.pnl), fontFamily: T.font, fontSize: 14, fontWeight: 800 }}>
                  {pos.pnl > 0 ? "+" : ""}{fmtUSD(pos.pnl, 2)}
                </span>
                <span style={{ fontSize: 10, color: profit >= 0 ? T.green : T.red, fontFamily: T.font, fontWeight: 600 }}>
                  ({profit > 0 ? "+" : ""}{profit.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>
          <button
            id={`analyze-btn-m-${pos.id}`}
            onClick={(e) => { e.stopPropagation(); onAnalyze(pos); }}
            style={{
              background: T.greenDim,
              border: `1px solid ${T.greenMid}`,
              color: T.green,
              borderRadius: 6,
              padding: "7px 12px",
              cursor: "pointer",
              fontFamily: T.fontSans,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.5,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
            }}
          >
            🧠 AI ANALYZE
          </button>
        </div>
      </div>
    </>
  );
}
