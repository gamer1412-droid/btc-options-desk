import { useState } from "react";
import { T } from "../tokens.js";
import { fmtUSD } from "../utils.js";
import { Pill } from "./Pill.jsx";
import { sendTelegram } from "../services/alerts.js";
import { calculatePositionSize } from "../services/sizing.js";
import { evaluateEntryRules } from "../services/rulesEngine.js";

export function ScannerTab({ opportunities, btcPrice, ivRank, marketContext = {}, accountInfo, currentPositions = [], onAnalyzeStrangle }) {
  const [sentMap, setSentMap] = useState({});
  const [selectedSize, setSelectedSize] = useState({}); // opp.id -> selected lot size
  const [expandedChecklist, setExpandedChecklist] = useState({}); // opp.id -> boolean

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

  const toggleChecklist = (id) => {
    setExpandedChecklist(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div style={{ padding: "0 24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Account Balance & Risk Header Banner */}
      {accountInfo && (
        <div style={{
          background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
          border: `1px solid ${T.blue}33`,
          borderRadius: 10, padding: "14px 20px",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16,
        }}>
          <div>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2, fontFamily: T.font }}>EQUITY</div>
            <div style={{ color: T.blue, fontFamily: T.font, fontSize: 18, fontWeight: 700 }}>
              {fmtUSD(accountInfo.equity)}
            </div>
          </div>
          <div>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2, fontFamily: T.font }}>BALANCE</div>
            <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 15, fontWeight: 700 }}>
              {fmtUSD(accountInfo.balance)}
            </div>
          </div>
          <div>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2, fontFamily: T.font }}>MARGIN USED (MAX 30%)</div>
            <div style={{ color: accountInfo.marginPct > 28 ? T.red : accountInfo.marginPct > 20 ? T.amber : T.green, fontFamily: T.font, fontSize: 15, fontWeight: 700 }}>
              {fmtUSD(accountInfo.marginUsed)} <span style={{ fontSize: 11, color: T.textSecondary }}>({accountInfo.marginPct}% / 30%)</span>
            </div>
          </div>
          <div>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2, fontFamily: T.font }}>AVAILABLE</div>
            <div style={{ color: T.green, fontFamily: T.font, fontSize: 15, fontWeight: 700 }}>
              {fmtUSD(accountInfo.availableBalance)}
            </div>
          </div>
          <div>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2, fontFamily: T.font }}>UNREALIZED P&L</div>
            <div style={{ color: accountInfo.unrealizedPnl >= 0 ? T.green : T.red, fontFamily: T.font, fontSize: 15, fontWeight: 700 }}>
              {accountInfo.unrealizedPnl >= 0 ? "+" : ""}{fmtUSD(accountInfo.unrealizedPnl)}
            </div>
          </div>
        </div>
      )}

      {/* Production Rules Criteria Banner */}
      <div style={{
        background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10,
        padding: "16px 20px", display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 16,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>🎯</span>
            <span style={{ color: T.green, fontWeight: 700, fontSize: 13, letterSpacing: 2, fontFamily: T.font }}>
              PRODUCTION TRADING RULES v2.0 ENGINE
            </span>
          </div>
          <div style={{ color: T.textSecondary, fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
            ระบบตรวจสอบกฎ 10 ข้ออัตโนมัติ: Delta (0.15–0.20), DTE (18–25 วัน), IV Rank (≥30%), MA20 Regime (≤7%), Max Margin 30%, Max Trade 3%
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Pill color={T.green}>DTE 18–25d ★ PREFERRED</Pill>
          <Pill color={T.amber}>PUT Δ 0.15~0.20</Pill>
          <Pill color={T.blue}>CALL Δ 0.15~0.20</Pill>
          <Pill color={T.purple}>IVR ≥ 30%</Pill>
          {marketContext.distFromMA20 != null && (
            <Pill color={Math.abs(marketContext.distFromMA20) > 10 ? T.red : Math.abs(marketContext.distFromMA20) > 7 ? T.amber : T.green}>
              MA20: {marketContext.distFromMA20 >= 0 ? "+" : ""}{marketContext.distFromMA20}%
            </Pill>
          )}
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

            // Run v2.0 Rules Engine Evaluation
            const evaluation = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
            const sizing = calculatePositionSize(accountInfo, opp, btcPrice, evaluation.sizeMultiplier);
            const chosenSize = selectedSize[opp.id] ?? (sizing.defaultLot?.size ?? 0.01);
            const chosenLot = sizing.lots?.find(l => l.size === chosenSize) || sizing.defaultLot;
            const isChecklistOpen = Boolean(expandedChecklist[opp.id]);

            return (
              <div key={opp.id} style={{
                background: T.bg1,
                border: `1px solid ${evaluation.isBlocked ? T.red + "44" : opp.isPreferredDTE ? T.greenMid : T.border}`,
                borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16,
                boxShadow: opp.isPreferredDTE && !evaluation.isBlocked ? `0 0 20px ${T.green}11` : "none",
                position: "relative",
              }}>
                {/* Card Top */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: T.textPrimary, fontFamily: T.font, fontWeight: 700, fontSize: 15 }}>
                      📅 {opp.expiry}
                    </span>
                    <Pill color={opp.isPreferredDTE ? T.green : opp.isIdealDTE ? T.blue : T.textSecondary}>
                      {opp.dte} วัน {opp.isPreferredDTE ? "★ PREFERRED" : opp.isIdealDTE ? "IDEAL" : ""}
                    </Pill>
                    {opp.isFullyHeld ? (
                      <Pill color={T.blue}>✓ ถือในพอร์ตแล้ว (OPENED)</Pill>
                    ) : opp.isPutHeld ? (
                      <Pill color={T.amber}>✓ ถือขา Put แล้ว</Pill>
                    ) : opp.isCallHeld ? (
                      <Pill color={T.blue}>✓ ถือขา Call แล้ว</Pill>
                    ) : null}
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1 }}>BTC SPOT</div>
                    <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
                      {fmtUSD(opp.btcPrice)}
                    </div>
                  </div>
                </div>

                {/* Rules Engine Decision Banner */}
                <div style={{
                  background: evaluation.isBlocked ? T.redDim : evaluation.isWarning ? T.amberDim : T.greenDim,
                  border: `1px solid ${evaluation.isBlocked ? T.red + "44" : evaluation.isWarning ? T.amber + "44" : T.greenMid}`,
                  borderRadius: 8, padding: "10px 14px",
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12 }}>
                        {evaluation.isBlocked ? "❌" : evaluation.isWarning ? "⚠️" : "✅"}
                      </span>
                      <span style={{
                        color: evaluation.isBlocked ? T.red : evaluation.isWarning ? T.amber : T.green,
                        fontFamily: T.font, fontWeight: 700, fontSize: 11, letterSpacing: 1,
                      }}>
                        {evaluation.isBlocked
                          ? "ENTRY DECISION: BLOCKED"
                          : evaluation.isWarning
                          ? `ENTRY DECISION: PASS WITH WARNING (Size ${Math.round(evaluation.sizeMultiplier * 100)}%)`
                          : "ENTRY DECISION: PASS (100% READY)"}
                      </span>
                    </div>

                    <button
                      onClick={() => toggleChecklist(opp.id)}
                      style={{
                        background: "none", border: "none", color: T.textSecondary,
                        cursor: "pointer", fontFamily: T.font, fontSize: 10, textDecoration: "underline",
                      }}
                    >
                      {isChecklistOpen ? "ซ่อน Checklist ▲" : "ดู Checklist (10 กฎ) ▼"}
                    </button>
                  </div>

                  {/* Reasons Preview when blocked or warning */}
                  {evaluation.reasons.length > 0 && !isChecklistOpen && (
                    <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: "'Inter', sans-serif", marginTop: 2 }}>
                      {evaluation.reasons.slice(0, 2).map((r, i) => (
                        <div key={i}>{r}</div>
                      ))}
                    </div>
                  )}

                  {/* Expanded 10-rule Checklist */}
                  {isChecklistOpen && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                      {evaluation.checks.map((chk, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                          <span style={{ color: T.textSecondary }}>{chk.icon} {chk.rule}:</span>
                          <span style={{
                            color: chk.status === "PASS" ? T.green : chk.status === "WARNING" ? T.amber : T.red,
                            fontFamily: T.font, fontWeight: 600,
                          }}>
                            {chk.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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

                {/* ─── Position Sizing Section v2.0 ─────────────────────────────── */}
                {sizing.available && (
                  <div style={{
                    background: `linear-gradient(135deg, ${T.bg2}, ${T.bg3})`,
                    border: `1px solid ${T.blue}33`,
                    borderRadius: 8, padding: "12px 14px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ color: T.blue, fontWeight: 700, fontSize: 10, letterSpacing: 2, fontFamily: T.font }}>
                        📐 POSITION SIZING (MAX 3% PER TRADE)
                      </span>
                      {sizing.recommendedLot && !evaluation.isBlocked && (
                        <Pill color={T.green}>
                          แนะนำ {sizing.recommendedLot.label} BTC
                        </Pill>
                      )}
                    </div>

                    {/* Lot Size Buttons */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                      {sizing.lots.filter(l => l.canAfford || l.size <= 0.05).map(lot => {
                        const isSelected = lot.size === chosenSize;
                        const isRec = sizing.recommendedLot?.size === lot.size && !evaluation.isBlocked;
                        return (
                          <button
                            key={lot.size}
                            onClick={() => setSelectedSize(prev => ({ ...prev, [opp.id]: lot.size }))}
                            style={{
                              padding: "5px 10px", borderRadius: 5, cursor: "pointer",
                              fontFamily: T.font, fontSize: 11, fontWeight: 700,
                              letterSpacing: 1,
                              background: isSelected ? (lot.canAfford ? T.greenDim : T.redDim) : T.bg1,
                              border: `1px solid ${isSelected ? (lot.canAfford ? T.greenMid : T.red + "44") : T.border}`,
                              color: isSelected ? (lot.canAfford ? T.green : T.red) : (lot.canAfford ? T.textSecondary : T.textMuted),
                              opacity: lot.canAfford ? 1 : 0.5,
                              position: "relative",
                            }}
                          >
                            {lot.label}
                            {isRec && <span style={{ color: T.green, marginLeft: 2, fontSize: 9 }}>★</span>}
                          </button>
                        );
                      })}
                    </div>

                    {/* Selected Lot Details */}
                    {chosenLot && (
                      <div style={{
                        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 8, background: T.bg1, borderRadius: 6, padding: "10px 12px",
                      }}>
                        <div>
                          <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 1 }}>AMOUNT</div>
                          <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                            {chosenLot.label} <span style={{ fontSize: 10, color: T.textSecondary }}>BTC</span>
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 1 }}>MARGIN ≈</div>
                          <div style={{ color: T.amber, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                            ${chosenLot.marginRequired.toLocaleString()}
                          </div>
                          <div style={{ color: T.textMuted, fontSize: 9 }}>
                            ({chosenLot.marginPctOfEquity}% of equity)
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 1 }}>PREMIUM รับ</div>
                          <div style={{ color: T.green, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                            +${chosenLot.premiumReceived.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 1 }}>THETA / วัน</div>
                          <div style={{ color: T.green, fontFamily: T.font, fontSize: 12, fontWeight: 700 }}>
                            +${chosenLot.thetaPerDay}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 1 }}>MAX LOSS (2×)</div>
                          <div style={{ color: T.red, fontFamily: T.font, fontSize: 12, fontWeight: 700 }}>
                            -${chosenLot.maxLoss.toLocaleString()}
                          </div>
                          <div style={{ color: T.textMuted, fontSize: 9 }}>
                            ({chosenLot.riskPct}% of port)
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 1 }}>STATUS</div>
                          <div style={{
                            color: evaluation.isBlocked ? T.red : chosenLot.isRecommended ? T.green : (!chosenLot.canAfford ? T.red : T.amber),
                            fontFamily: T.font, fontSize: 10, fontWeight: 700,
                          }}>
                            {evaluation.isBlocked
                              ? "❌ BLOCKED"
                              : chosenLot.isRecommended
                              ? "✓ WITHIN RULES"
                              : (!chosenLot.canAfford ? "✗ OVER MARGIN" : "⚠ OVER 3% RULE")}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

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
                    disabled={isSending || evaluation.isBlocked}
                    style={{
                      background: isSent ? T.green : evaluation.isBlocked ? T.bg3 : T.bg2,
                      border: `1px solid ${isSent ? T.green : T.border}`,
                      color: isSent ? T.bg0 : evaluation.isBlocked ? T.textMuted : T.textPrimary,
                      borderRadius: 6, padding: "8px 14px", cursor: evaluation.isBlocked ? "not-allowed" : "pointer",
                      fontFamily: T.font, fontSize: 11, fontWeight: 700, letterSpacing: 1,
                      display: "flex", alignItems: "center", gap: 6, opacity: evaluation.isBlocked ? 0.6 : 1,
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
