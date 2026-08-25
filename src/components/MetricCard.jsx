import { useState, useEffect, useRef } from "react";
import { T } from "../tokens.js";

export function MetricCard({ label, value, sub, color }) {
  const [hovered, setHovered] = useState(false);
  const [flashing, setFlashing] = useState(null); // "green" | "red" | null
  const prevValueRef = useRef(value);
  const activeColor = color ?? T.border;

  useEffect(() => {
    if (prevValueRef.current !== undefined && prevValueRef.current !== value) {
      // Determine if value increased or decreased if numeric
      const prevNum = parseFloat(String(prevValueRef.current).replace(/[^0-9.-]+/g, ""));
      const currNum = parseFloat(String(value).replace(/[^0-9.-]+/g, ""));

      if (!isNaN(prevNum) && !isNaN(currNum)) {
        setFlashing(currNum >= prevNum ? "green" : "red");
      } else {
        setFlashing("green");
      }

      const timer = setTimeout(() => setFlashing(null), 1200);
      prevValueRef.current = value;
      return () => clearTimeout(timer);
    }
    prevValueRef.current = value;
  }, [value]);

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
        borderRadius: 12,
        padding: "14px 18px",
        flex: 1,
        minWidth: 140,
        boxShadow: hovered
          ? `0 8px 24px rgba(0,0,0,0.5), 0 0 20px ${activeColor}22`
          : "0 2px 8px rgba(0,0,0,0.25)",
        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        transform: hovered ? "translateY(-2px)" : "none",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Flashing glow indicator */}
      {flashing && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: flashing === "green" ? T.greenDim : T.redDim,
            border: `1px solid ${flashing === "green" ? T.green : T.red}`,
            borderRadius: 12,
            pointerEvents: "none",
            animation: flashing === "green" ? "flashGreen 1.2s ease-out" : "flashRed 1.2s ease-out",
          }}
        />
      )}

      <div style={{
        color: T.textSecondary,
        fontSize: 10,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        fontFamily: T.fontSans,
        fontWeight: 700,
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
        textShadow: hovered ? `0 0 12px ${activeColor}55` : "none",
        transition: "text-shadow 0.2s ease",
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
