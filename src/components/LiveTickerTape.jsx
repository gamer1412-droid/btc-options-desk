import { memo } from "react";
import { T } from "../tokens.js";
import { fmtUSD } from "../utils.js";

export const LiveTickerTape = memo(function LiveTickerTape({
  btcPrice,
  marketContext = {},
  ivRank,
  topOpportunity,
}) {
  const change24h = marketContext.change24h ?? 0;
  const isUp = change24h >= 0;
  const distMA = marketContext.distFromMA20 ?? 0;

  const regimeText = distMA > 7.0
    ? "BULLISH EXPANSION 🚀"
    : distMA < -7.0
    ? "BEARISH PRESSURE 🔻"
    : "BALANCED RANGE ⚖️";

  const regimeColor = distMA > 7.0
    ? T.green
    : distMA < -7.0
    ? T.red
    : T.blue;

  const items = [
    {
      label: "BTC/USDT",
      value: btcPrice ? fmtUSD(btcPrice, 0) : "---",
      change: `${isUp ? "+" : ""}${change24h.toFixed(2)}%`,
      color: isUp ? T.green : T.red,
      badge: isUp ? "▲ BULL" : "▼ BEAR",
    },
    {
      label: "IV RANK",
      value: ivRank != null ? `${ivRank}%` : "32%",
      change: ivRank >= 30 ? "OPTIMAL SELL" : "LOW VOL",
      color: ivRank >= 50 ? T.purple : ivRank >= 30 ? T.green : T.textMuted,
      badge: "VOL",
    },
    {
      label: "REGIME (MA20)",
      value: regimeText,
      change: `${distMA > 0 ? "+" : ""}${distMA.toFixed(1)}% vs MA20`,
      color: regimeColor,
      badge: "TREND",
    },
    {
      label: "ALPHA RADAR",
      value: topOpportunity
        ? `${topOpportunity.strategyTitle || topOpportunity.strategy} (${topOpportunity.dte}d)`
        : "SCANNING ORBIT...",
      change: topOpportunity ? `Est. Yield ~${topOpportunity.annualizedYield || "38"}% APY` : "LIVE",
      color: T.green,
      badge: "HOT",
    },
    {
      label: "PROTOCOL RULE",
      value: "SURVIVE FIRST, PROFIT SECOND",
      change: "MAX 30% MARGIN / 100% DISCIPLINE",
      color: T.amber,
      badge: "RULE",
    },
  ];

  // Duplicate list to create a seamless infinite marquee
  const marqueeItems = [...items, ...items];

  return (
    <div
      style={{
        background: `linear-gradient(90deg, #05070a 0%, #0d1219 50%, #05070a 100%)`,
        borderBottom: `1px solid ${T.border}`,
        overflow: "hidden",
        position: "relative",
        height: 32,
        display: "flex",
        alignItems: "center",
        zIndex: 9,
      }}
    >
      {/* Live Badge On Left */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          padding: "0 12px",
          background: `linear-gradient(90deg, #070a0f 80%, transparent)`,
          display: "flex",
          alignItems: "center",
          gap: 6,
          zIndex: 2,
        }}
      >
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: T.green,
            boxShadow: `0 0 8px ${T.green}`,
            animation: "pulse 1.5s infinite",
          }}
        />
        <span
          style={{
            color: T.green,
            fontFamily: T.font,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1.5,
          }}
        >
          FEED
        </span>
      </div>

      {/* Scrolling Content */}
      <div
        className="ticker-track"
        style={{
          display: "flex",
          whiteSpace: "nowrap",
          animation: "marquee 35s linear infinite",
          paddingLeft: 70,
        }}
      >
        {marqueeItems.map((item, idx) => (
          <div
            key={idx}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginRight: 36,
              fontSize: 11,
              fontFamily: T.font,
            }}
          >
            <span
              style={{
                background: `${item.color}18`,
                color: item.color,
                border: `1px solid ${item.color}40`,
                borderRadius: 4,
                padding: "1px 5px",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              {item.badge}
            </span>
            <span style={{ color: T.textSecondary, fontWeight: 500 }}>
              {item.label}:
            </span>
            <span style={{ color: T.textPrimary, fontWeight: 700 }}>
              {item.value}
            </span>
            <span style={{ color: item.color, fontWeight: 600, fontSize: 10 }}>
              [{item.change}]
            </span>
            <span style={{ color: T.borderHover, margin: "0 6px" }}>│</span>
          </div>
        ))}
      </div>

      {/* Global CSS for Marquee */}
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
});
