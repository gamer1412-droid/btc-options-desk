import { useState } from "react";
import { T } from "../tokens.js";
import { fmtUSD } from "../utils.js";
import { Pill } from "./Pill.jsx";
import { sendTelegram } from "../services/alerts.js";

export function ScannerTab({ opportunities, btcPrice, ivRank, onAnalyzeStrangle }) {
  const [sentMap, setSentMap] = useState({});

  const handleSendTelegram = async (opp) => {
    setSentMap(prev => ({ ...prev, [opp.id]: "sending" }));
    try {
      await sendTelegram("strangle_signal", opp);
      setSentMap(prev => ({ ...prev, [opp.id]: "sent" }));
      setTimeout(() => {
        setSentMap(prev => ({ ...prev, [opp.id]: null }));
      }, 4000);
    } catch (e) {
      setSentMap(prev => ({ ...prev, [opp.id]: "error" }));
    }
  };

  return (
    <div style={{ padding: "0 24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Criteria Banner */}
      <div style={{
        background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10,
        padding: "16px 20px", display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 16,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>🎯</span>
            <span style={{ color: T.green, fontWeight: 700, fontSize: 13, letterSpacing: 2, fontFamily: T.font }}>
              SHORT STRANGLE ENTRY SCANNER
            </span>
          </div>
          <div style={{ color: T.textSecondary, fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
            สแกนหาคู่สัญญาจาก Binance Options ตามเกณฑ์ Delta (Put: -0.22, Call: +0.18) และ DTE (14–28 วัน) อัตโนมัติ
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Pill color={T.green}>DTE 14–28d</Pill>
          <Pill color={T.amber}>PUT Δ -0.20~-0.25</Pill>
          <Pill color={T.blue}>CALL Δ +0.15~-0.20</Pill>
        </div>
      </div>

      {opportunities.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: T.textMuted, fontFamily: T.font, fontSize: 13, background: T.bg1, borderRadius: 10, border: `1px solid ${T.border}` }}>
          ⏳ กำลังสแกนตลาด หรือยังไม่พบคู่สัญญาที่เข้าเกณฑ์ Delta / DTE ในขณะนี้...
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
          {opportunities.map((opp) => {
            const isSent = sentMap[opp.id] === "sent";
            const isSending = sentMap[opp.id] === "sending";

            return (
              <div key={opp.id} style={{
                background: T.bg1, border: `1px solid ${opp.isIdealDTE ? T.greenMid : T.border}`,
                borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16,
                boxShadow: opp.isIdealDTE ? `0 0 20px ${T.green}11` : "none",
                position: "relative",
              }}>
                {/* Card Top */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: T.textPrimary, fontFamily: T.font, fontWeight: 700, fontSize: 15 }}>
                      📅 {opp.expiry}
                    </span>
                    <Pill color={opp.isIdealDTE ? T.green : T.textSecondary}>
                      {opp.dte} วัน {opp.isIdealDTE ? "★ IDEAL" : ""}
                    </Pill>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1 }}>BTC SPOT</div>
                    <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
                      {fmtUSD(opp.btcPrice)}
                    </div>
                  </div>
                </div>

                {/* Two Legs */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {/* Put Leg */}
                  <div style={{
                    background: T.bg2, border: `1px solid ${T.amber}33`,
                    borderLeft: `3px solid ${T.amber}`, borderRadius: 8, padding: 12,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ color: T.amber, fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>SHORT PUT</span>
                      <span style={{ color: T.textSecondary, fontSize: 10 }}>-{opp.putDistancePct}%</span>
                    </div>
                    <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 17, fontWeight: 700 }}>
                      {fmtUSD(opp.putStrike)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: T.textSecondary, fontFamily: T.font }}>
                      <span>Delta: <strong style={{ color: T.amber }}>{opp.putDelta}</strong></span>
                      <span>Mark: <strong style={{ color: T.green }}>${opp.putMark}</strong></span>
                    </div>
                  </div>

                  {/* Call Leg */}
                  <div style={{
                    background: T.bg2, border: `1px solid ${T.blue}33`,
                    borderLeft: `3px solid ${T.blue}`, borderRadius: 8, padding: 12,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ color: T.blue, fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>SHORT CALL</span>
                      <span style={{ color: T.textSecondary, fontSize: 10 }}>+{opp.callDistancePct}%</span>
                    </div>
                    <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 17, fontWeight: 700 }}>
                      {fmtUSD(opp.callStrike)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: T.textSecondary, fontFamily: T.font }}>
                      <span>Delta: <strong style={{ color: T.blue }}>+{opp.callDelta}</strong></span>
                      <span>Mark: <strong style={{ color: T.green }}>${opp.callMark}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Strangle Summary */}
                <div style={{
                  background: T.bg3, borderRadius: 8, padding: "12px 14px",
                  display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10,
                }}>
                  <div>
                    <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1 }}>PREMIUM รวม</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 16, fontWeight: 700 }}>
                      +${opp.totalPremium} <span style={{ fontSize: 10, color: T.textSecondary }}>/ 1 BTC</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1 }}>THETA DECAY</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                      +${opp.totalTheta} <span style={{ fontSize: 10, color: T.textSecondary }}>/ วัน</span>
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1 }}>SAFE ZONE (BREAKEVEN)</div>
                    <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 12 }}>
                      ${opp.breakevenLow?.toLocaleString()} – ${opp.breakevenHigh?.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
                  <button
                    onClick={() => onAnalyzeStrangle(opp)}
                    style={{
                      flex: 1, background: T.greenDim, border: `1px solid ${T.greenMid}`,
                      color: T.green, borderRadius: 6, padding: "8px 12px", cursor: "pointer",
                      fontFamily: T.font, fontSize: 11, fontWeight: 700, letterSpacing: 1,
                    }}
                  >
                    🧠 AI ANALYZE SETUP
                  </button>

                  <button
                    onClick={() => handleSendTelegram(opp)}
                    disabled={isSending}
                    style={{
                      background: isSent ? T.green : T.bg2,
                      border: `1px solid ${isSent ? T.green : T.border}`,
                      color: isSent ? T.bg0 : T.textPrimary,
                      borderRadius: 6, padding: "8px 14px", cursor: "pointer",
                      fontFamily: T.font, fontSize: 11, fontWeight: 700, letterSpacing: 1,
                      display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <span>📨</span>
                    {isSending ? "SENDING..." : isSent ? "✓ SENT" : "SEND TELEGRAM"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
