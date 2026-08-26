import { T } from "../tokens.js";
import { Pill } from "./Pill.jsx";
import { fmtUSD } from "../utils.js";
import { STRATEGY_CONFIG } from "../config/strategyConfig.js";

export function CapacityWidget({ capacity }) {
  if (!capacity) return null;

  const {
    headline,
    badgeColor,
    actionText,
    remainingLots,
    maxLotsByCash,
    marginPct,
    availableBalance,
    equity,
    marginPerLot,
    stress,
  } = capacity;

  const colorMap = {
    green: T.green,
    amber: T.amber,
    red: T.red,
    blue: T.blue,
    textSecondary: T.textSecondary,
  };

  const activeColor = colorMap[badgeColor] || T.amber;

  return (
    <div style={{
      background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
      border: `1px solid ${activeColor}38`,
      borderLeft: `4px solid ${activeColor}`,
      borderRadius: 12,
      padding: "16px 20px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 16,
      boxShadow: `0 4px 20px rgba(0,0,0,0.3), 0 0 15px ${activeColor}10`,
      position: "relative",
    }}>
      <div style={{ flex: 1, minWidth: 280 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{
            color: activeColor,
            fontFamily: T.fontSans,
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: 0.5,
          }}>
            {headline}
          </span>
          <Pill color={activeColor}>
            {remainingLots > 0 ? `เปิดได้อีก ${remainingLots} ไม้ (0.01 BTC)` : "เต็มโควตา / งดเปิด"}
          </Pill>
        </div>

        <div style={{
          color: T.textSecondary,
          fontSize: 12,
          fontFamily: T.fontSans,
          lineHeight: 1.5,
        }}>
          {actionText}
        </div>
      </div>

      {/* Quick Stats Pill Group */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "10px 14px",
      }}>
        <div>
          <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>
            MARGIN ว่าง
          </div>
          <div style={{ color: T.green, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
            {fmtUSD(availableBalance)}
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: T.border }} />

        <div>
          <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>
            SPOT STRESS ±20%
          </div>
          <div style={{ color: stress?.available && stress.worstLossPct > 10 ? T.red : T.textPrimary, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
            {stress?.available ? `-${stress.worstLossPct}%` : "N/A"}
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: T.border }} />

        <div>
          <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>
            MARGIN USED
          </div>
          <div style={{
            color: marginPct >= STRATEGY_CONFIG.sizing.maxTotalMarginPct ? T.red : marginPct >= STRATEGY_CONFIG.sizing.cautionMarginPct ? T.amber : T.textPrimary,
            fontFamily: T.font, fontSize: 14, fontWeight: 700,
          }}>
            {marginPct}% <span style={{ fontSize: 10, color: T.textSecondary, fontWeight: 400 }}>/ {STRATEGY_CONFIG.sizing.maxTotalMarginPct}% Hard Max</span>
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: T.border }} />

        <div>
          <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>
            EST. 1 ไม้
          </div>
          <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
            ≈${marginPerLot}
          </div>
        </div>
      </div>
    </div>
  );
}
