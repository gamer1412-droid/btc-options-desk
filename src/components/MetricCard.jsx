import { useState } from "react";
import { T } from "../tokens.js";

export function MetricCard({ label, value, sub, color }) {
  const [hovered, setHovered] = useState(false);
  const activeColor = color ?? T.border;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? `linear-gradient(180deg, ${T.bg3}, ${T.bg2})`
          : `linear-gradient(180deg, ${T.bg2}, ${T.bg1})`,
        border: `1px solid ${hovered ? T.borderHover : T.border}`,
        borderTop: `2px solid ${activeColor}`,
        borderRadius: 10,
        padding: "14px 18px",
        flex: 1,
        minWidth: 140,
        boxShadow: hovered
          ? `0 6px 20px rgba(0,0,0,0.4), 0 0 15px ${activeColor}15`
          : "0 2px 8px rgba(0,0,0,0.2)",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        transform: hovered ? "translateY(-1px)" : "none",
        position: "relative",
      }}
    >
      <div style={{
        color: T.textSecondary,
        fontSize: 10,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        fontFamily: T.fontSans,
        fontWeight: 600,
        marginBottom: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span>{label}</span>
      </div>
      <div style={{
        color: color ?? T.textPrimary,
        fontSize: 22,
        fontWeight: 800,
        fontFamily: T.font,
        lineHeight: 1.1,
        letterSpacing: -0.5,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          color: T.textMuted,
          fontSize: 11,
          marginTop: 6,
          fontFamily: T.fontSans,
          fontWeight: 500,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}
