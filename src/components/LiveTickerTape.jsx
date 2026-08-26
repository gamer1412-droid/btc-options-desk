import { memo } from "react";
import { T } from "../tokens.js";
import { fmtUSD } from "../utils.js";

export const LiveTickerTape = memo(function LiveTickerTape({
  btcPrice,
  marketContext = {},
  marketIv,
  topOpportunity,
}) {
  const hasMarketChange = marketContext.change24h != null && Number.isFinite(Number(marketContext.change24h));
  const change24h = hasMarketChange ? Number(marketContext.change24h) : null;
  const isUp = change24h >= 0;
  const hasDistMA = marketContext.distFromMA20 != null && Number.isFinite(Number(marketContext.distFromMA20));
  const distMA = hasDistMA ? Number(marketContext.distFromMA20) : null;

  const regimeText = !hasDistMA ? "DATA UNAVAILABLE" : distMA > 7.0
    ? "BULLISH EXPANSION 🚀"
    : distMA < -7.0
    ? "BEARISH PRESSURE 🔻"
    : "BALANCED RANGE ⚖️";

  const regimeColor = !hasDistMA ? T.textMuted : distMA > 7.0
    ? T.green
    : distMA < -7.0
    ? T.red
    : T.blue;

  const items = [
    {
      label: "BTC/USDT",
      value: btcPrice ? fmtUSD(btcPrice, 0) : "---",
      change: hasMarketChange ? `${isUp ? "+" : ""}${change24h.toFixed(2)}%` : "N/A",
      color: !hasMarketChange ? T.textMuted : isUp ? T.green : T.red,
      badge: !hasMarketChange ? "FEED" : isUp ? "▲ BULL" : "▼ BEAR",
    },
    {
      label: "CHAIN AVG IV",
      value: marketIv != null ? `${marketIv}%` : "N/A",
      change: marketIv != null ? "CURRENT IV — NOT IV RANK" : "NO DATA",
      color: marketIv >= 50 ? T.purple : marketIv != null ? T.blue : T.textMuted,
      badge: "VOL",
    },
    {
      label: "REGIME (MA20)",
      value: regimeText,
      change: hasDistMA ? `${distMA > 0 ? "+" : ""}${distMA.toFixed(1)}% vs MA20` : "N/A",
      color: regimeColor,
      badge: "TREND",
    },
    {
      label: "ALPHA RADAR",
      value: topOpportunity
        ? `${topOpportunity.strategyTitle || topOpportunity.strategy} (${topOpportunity.dte}d)`
        : "SCANNING ORBIT...",
      change: topOpportunity ? `Est. annualized ROM ~${topOpportunity.annualizedYield}%` : "WAITING FOR DATA",
      color: T.green,
      badge: "HOT",
    },
    {
      label: "PROTOCOL RULE",
      value: "SURVIVE FIRST, PROFIT SECOND",
      change: "30% CAUTION / 35% HARD MAX MARGIN",
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
