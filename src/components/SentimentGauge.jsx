import { memo } from "react";
import { T } from "../tokens.js";

export const SentimentGauge = memo(function SentimentGauge({
  marketIv = null,
  distFromMA20 = null,
  netDelta = 0,
}) {
  const hasIV = marketIv != null && Number.isFinite(Number(marketIv));
  const safeIV = hasIV ? Math.max(0, Math.min(100, Number(marketIv))) : 0;

  // Angle from -90 to +90 degrees for a 180-deg semicircle
  const needleAngle = -90 + (safeIV / 100) * 180;

  // Zone status text
  const ivStatus = !hasIV
    ? { label: "DATA UNAVAILABLE", color: T.textMuted, desc: "รอข้อมูล Option Chain" }
    : safeIV < 30
    ? { label: "LOW VOL (WAIT)", color: T.textMuted, desc: "Premium ต่ำ ไม่คุ้มเสี่ยง" }
    : safeIV <= 70
    ? { label: "OPTIMAL ZONE ★", color: T.green, desc: "Theta Harvest สมบูรณ์แบบ" }
    : { label: "HIGH VOL SURGE ⚡", color: T.purple, desc: "Premium สูง ลด Lot Size 50%" };

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
        border: `1px solid ${T.border}`,
        borderTop: `2px solid ${ivStatus.color}`,
        borderRadius: 12,
        padding: "14px 18px",
        boxShadow: `0 4px 16px rgba(0,0,0,0.25)`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minWidth: 240,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1.5, fontFamily: T.fontSans, fontWeight: 700 }}>
          VOLATILITY SPEEDOMETER
        </span>
        <span
          style={{
            background: `${ivStatus.color}20`,
            color: ivStatus.color,
            border: `1px solid ${ivStatus.color}40`,
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 9,
            fontWeight: 800,
            fontFamily: T.font,
          }}
        >
          {ivStatus.label}
        </span>
      </div>

      {/* SVG Semicircle Dial */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", margin: "6px 0 -8px" }}>
        <svg width="180" height="95" viewBox="0 0 180 95">
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={T.blue} />
              <stop offset="30%" stopColor={T.green} />
              <stop offset="70%" stopColor={T.amber} />
              <stop offset="100%" stopColor={T.purple} />
            </linearGradient>
            <filter id="needleGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Semicircle track */}
          <path
            d="M 20 90 A 70 70 0 0 1 160 90"
            fill="none"
            stroke="#1c2432"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Active colored arc */}
          <path
            d="M 20 90 A 70 70 0 0 1 160 90"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray="220"
            strokeDashoffset={220 - (220 * safeIV) / 100}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />

          {/* Center Pivot */}
          <circle cx="90" cy="90" r="6" fill={T.textPrimary} />
          <circle cx="90" cy="90" r="3" fill={T.bg1} />

          {/* Animated Needle */}
          {hasIV && <g
            transform={`rotate(${needleAngle}, 90, 90)`}
            style={{ transition: "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          >
            <line
              x1="90"
              y1="90"
              x2="90"
              y2="28"
              stroke={T.textPrimary}
              strokeWidth="2.5"
              strokeLinecap="round"
              filter="url(#needleGlow)"
            />
            <polygon points="87,32 93,32 90,22" fill={ivStatus.color} />
          </g>}

          {/* Value in Center */}
          <text x="90" y="80" textAnchor="middle" fill={T.textPrimary} fontSize="18" fontWeight="800" fontFamily={T.font}>
            {hasIV ? `${safeIV}%` : "—"}
          </text>
          <text x="90" y="92" textAnchor="middle" fill={T.textMuted} fontSize="8" fontFamily={T.fontSans} fontWeight="600">
            CHAIN AVG IV
          </text>
        </svg>
      </div>

      {/* Subtext info */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${T.border}`, paddingTop: 6, marginTop: 4 }}>
        <span style={{ color: T.textMuted, fontSize: 10, fontFamily: T.fontSans }}>
          {ivStatus.desc}
        </span>
        <span style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.font }}>
          MA20: <strong style={{ color: distFromMA20 == null ? T.textMuted : distFromMA20 >= 0 ? T.green : T.red }}>{distFromMA20 == null ? "N/A" : `${distFromMA20 > 0 ? "+" : ""}${distFromMA20}%`}</strong>
        </span>
      </div>
    </div>
  );
});
