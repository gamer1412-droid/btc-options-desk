import { useState } from "react";
import { T } from "../tokens.js";
import { fmtUSD, pnlColor, deltaColor, statusColor } from "../utils.js";
import { Pill } from "./Pill.jsx";
import { closeOptionPosition } from "../services/trade.js";

// Grid column definition — shared between header and rows
export const POSITION_GRID_COLS = "85px 85px 50px 65px 65px 60px 75px 85px 85px 130px";

export function PositionRow({ pos, onAnalyze, onPositionClosed }) {
  const [hovered, setHovered] = useState(false);
  const [closing, setClosing] = useState(false);
  const isCall = pos.type.includes("Call");
  const profit = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;
  const posThetaDollar = Math.abs(pos.theta) * (pos.size || 1);

  const handleClose = async () => {
    if (!window.confirm(`ยืนยันการส่งคำสั่งปิดสัญญา ${pos.id} (${pos.size} BTC) ที่ราคาตลาด/Limit หรือไม่?`)) {
      return;
    }
    setClosing(true);
    try {
      await closeOptionPosition(pos);
      alert(`✅ ส่งคำสั่งปิดสัญญา ${pos.id} สำเร็จ!`);
      if (onPositionClosed) onPositionClosed();
    } catch (err) {
      alert(`❌ ปิดสัญญาไม่สำเร็จ: ${err.message}`);
    } finally {
      setClosing(false);
    }
  };

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
        {fmtUSD(pos.strike, 0)}
      </span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>
        {pos.dte}d
      </span>
      <span style={{ color: deltaColor(pos.delta), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
        {pos.delta > 0 ? "+" : ""}{pos.delta.toFixed(2)}
      </span>
      <span style={{ color: T.green, fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
        +{posThetaDollar < 1 ? posThetaDollar.toFixed(2) : posThetaDollar.toFixed(1)}/d
      </span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>
        {pos.iv.toFixed(1)}%
      </span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>
        {fmtUSD(pos.premium, 2)}
      </span>
      <div>
        <div style={{ color: pnlColor(pos.pnl), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
          {pos.pnl > 0 ? "+" : ""}{fmtUSD(pos.pnl, 2)}
        </div>
        <div style={{ fontSize: 10, color: profit >= 0 ? T.green : T.red, fontFamily: T.font, opacity: 0.85 }}>
          {profit > 0 ? "+" : ""}{profit.toFixed(1)}%
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

      {/* Action Buttons: AI + 1-Click Close */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button
          id={`analyze-btn-${pos.id}`}
          onClick={() => onAnalyze(pos)}
          title="วิเคราะห์ Position ด้วย AI"
          style={{
            background: T.greenDim,
            border: `1px solid ${T.greenMid}`,
            color: T.green,
            borderRadius: 5,
            padding: "4px 7px",
            cursor: "pointer",
            fontFamily: T.fontSans,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            transition: "all 0.2s ease",
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

        <button
          id={`close-btn-${pos.id}`}
          onClick={handleClose}
          disabled={closing}
          title="ส่งคำสั่งซื้อปิดสัญญานี้ทันที (1-Click Close)"
          style={{
            background: profit >= 50 ? T.greenDim : T.redDim,
            border: `1px solid ${profit >= 50 ? T.greenMid : T.red + "44"}`,
            color: profit >= 50 ? T.green : T.red,
            borderRadius: 5,
            padding: "4px 8px",
            cursor: closing ? "not-allowed" : "pointer",
            fontFamily: T.fontSans,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            opacity: closing ? 0.6 : 1,
            transition: "all 0.2s ease",
          }}
        >
          <span>{profit >= 50 ? "🎯" : "🔴"}</span>
          <span>{closing ? "..." : profit >= 50 ? "TP" : "CLOSE"}</span>
        </button>
      </div>
    </div>
  );
}
