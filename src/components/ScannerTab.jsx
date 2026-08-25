import { useState, useMemo } from "react";
import { T } from "../tokens.js";
import { fmtUSD } from "../utils.js";
import { Pill } from "./Pill.jsx";
import { sendTelegram } from "../services/alerts.js";
import { calculatePositionSize } from "../services/sizing.js";
import { evaluateEntryRules } from "../services/rulesEngine.js";

export function ScannerTab({ opportunities = [], btcPrice, ivRank, marketContext = {}, accountInfo, currentPositions = [], onAnalyzeStrangle }) {
  const [sentMap, setSentMap] = useState({});
  const [selectedSize, setSelectedSize] = useState({}); // opp.id -> selected lot size
  const [expandedChecklist, setExpandedChecklist] = useState({}); // opp.id -> boolean
  const [strategyFilter, setStrategyFilter] = useState("AUTO"); // "AUTO" | "SHORT_PUT" | "SKEWED_STRANGLE" | "STRANGLE" | "ALL"

  const isBullishRegime = marketContext.distFromMA20 != null && marketContext.distFromMA20 > 7.0;
  const isBearishRegime = marketContext.distFromMA20 != null && marketContext.distFromMA20 < -7.0;
  const isSidewayRegime = !isBullishRegime && !isBearishRegime;

  const handleSendTelegram = async (opp) => {
    setSentMap(prev => ({ ...prev, [opp.id]: "sending" }));
    try {
      const signalType = opp.strategy === "SHORT_PUT"
        ? "short_put_signal"
        : opp.strategy === "SKEWED_STRANGLE"
        ? "skewed_strangle_signal"
        : "strangle_signal";
      await sendTelegram(signalType, opp);
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

  // Filter and sort opportunities based on selected tab / AUTO mode
  const filteredOpps = useMemo(() => {
    if (!Array.isArray(opportunities)) return [];
    if (strategyFilter === "ALL") return opportunities;
    if (strategyFilter === "AUTO") {
      if (isBullishRegime) {
        // Prioritize Short Put and Skewed Strangle in Bullish market
        return opportunities.filter(o => o.strategy === "SHORT_PUT" || o.strategy === "SKEWED_STRANGLE");
      }
      return opportunities.filter(o => o.strategy === "STRANGLE" || o.strategy === "SHORT_PUT");
    }
    return opportunities.filter(o => o.strategy === strategyFilter);
  }, [opportunities, strategyFilter, isBullishRegime]);

  return (
    <div style={{ padding: "0 24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Account Balance & Margin Overview Banner */}
      {accountInfo && (
        <div style={{
          background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
          border: `1px solid ${T.blue}28`,
          borderRadius: 12,
          padding: "16px 20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 16,
          boxShadow: `0 4px 20px rgba(0,0,0,0.25)`,
        }}>
          <div>
            <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1.5, fontFamily: T.fontSans, fontWeight: 600 }}>EQUITY (พอร์ตรวม)</div>
            <div style={{ color: T.blue, fontFamily: T.font, fontSize: 20, fontWeight: 800, marginTop: 2 }}>
              {fmtUSD(accountInfo.equity)}
            </div>
          </div>
          <div>
            <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1.5, fontFamily: T.fontSans, fontWeight: 600 }}>WALLET BALANCE</div>
            <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 16, fontWeight: 700, marginTop: 4 }}>
              {fmtUSD(accountInfo.balance)}
            </div>
          </div>
          <div>
            <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1.5, fontFamily: T.fontSans, fontWeight: 600 }}>MARGIN USED (MAX 30%)</div>
            <div style={{
              color: accountInfo.marginPct > 28 ? T.red : accountInfo.marginPct > 20 ? T.amber : T.green,
              fontFamily: T.font, fontSize: 16, fontWeight: 700, marginTop: 4,
            }}>
              {fmtUSD(accountInfo.marginUsed)} <span style={{ fontSize: 11, color: T.textSecondary, fontWeight: 500 }}>({accountInfo.marginPct}% / 30%)</span>
            </div>
          </div>
          <div>
            <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1.5, fontFamily: T.fontSans, fontWeight: 600 }}>AVAILABLE (พร้อมเทรด)</div>
            <div style={{ color: T.green, fontFamily: T.font, fontSize: 16, fontWeight: 700, marginTop: 4 }}>
              {fmtUSD(accountInfo.availableBalance)}
            </div>
          </div>
          <div>
            <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1.5, fontFamily: T.fontSans, fontWeight: 600 }}>UNREALIZED P&L</div>
            <div style={{
              color: accountInfo.unrealizedPnl >= 0 ? T.green : T.red,
              fontFamily: T.font, fontSize: 16, fontWeight: 700, marginTop: 4,
            }}>
              {accountInfo.unrealizedPnl >= 0 ? "+" : ""}{fmtUSD(accountInfo.unrealizedPnl)}
            </div>
          </div>
        </div>
      )}

      {/* Market Regime Advisory Banner */}
      <div style={{
        background: isBullishRegime
          ? `linear-gradient(135deg, #064e3b33, #022c2222)`
          : isBearishRegime
          ? `linear-gradient(135deg, #7f1d1d33, #450a0a22)`
          : T.bg2,
        border: `1px solid ${isBullishRegime ? T.greenMid : isBearishRegime ? T.red + "44" : T.border}`,
        borderRadius: 12,
        padding: "16px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16,
        boxShadow: isBullishRegime ? `0 4px 20px ${T.green}15` : "none",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>{isBullishRegime ? "🚀" : isBearishRegime ? "🐻" : "🎯"}</span>
            <span style={{
              color: isBullishRegime ? T.green : isBearishRegime ? T.red : T.blue,
              fontWeight: 800, fontSize: 13, letterSpacing: 1.5, fontFamily: T.fontSans,
            }}>
              {isBullishRegime
                ? `MARKET REGIME: STRONG BULLISH (+${marketContext.distFromMA20}% จาก MA20 | IVR ${marketContext.ivRank ?? ivRank}%)`
                : isBearishRegime
                ? `MARKET REGIME: BEARISH (${marketContext.distFromMA20}% จาก MA20)`
                : "MARKET REGIME: SIDEWAY / NORMAL RANGE"}
            </span>
          </div>
          <div style={{ color: T.textSecondary, fontSize: 12, fontFamily: T.fontSans, lineHeight: 1.5 }}>
            {isBullishRegime ? (
              <span>
                💡 ตลาดกำลังมี Momentum ขาขึ้นแรง + ค่าความผันผวนสูง (High IV) แนะนำใช้กลยุทธ์ <strong style={{ color: T.green }}>Bullish Short Put</strong> หรือ <strong style={{ color: T.blue }}>Skewed Strangle</strong> เพื่อเก็บค่าพรีเมียมแพงโดยตัดความเสี่ยง Short Call โดนลาก
              </span>
            ) : isBearishRegime ? (
              <span>
                ⚠️ ตลาดหลุดต่ำกว่าเส้นค่าเฉลี่ย 20 วัน ระมัดระวังการเปิด Short Put และติดตาม Stop Loss อย่างใกล้ชิด
              </span>
            ) : (
              <span>
                สแกนหาคู่สัญญา Delta-Neutral (0.15–0.20), DTE 18–25 วัน ตามเกณฑ์ Short Strangle v2.0
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {isBullishRegime && <Pill color={T.green}>⭐ แนะนำ: BULLISH SHORT PUT</Pill>}
          <Pill color={T.amber}>DTE 18–25d</Pill>
          <Pill color={T.purple}>IVR ≥ 30%</Pill>
          <Pill color={T.blue}>DIST MA20: {marketContext.distFromMA20 != null ? `${marketContext.distFromMA20 > 0 ? "+" : ""}${marketContext.distFromMA20}%` : "-"}</Pill>
        </div>
      </div>

      {/* Strategy Filter Tabs */}
      <div style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        background: T.bg1,
        padding: 6,
        borderRadius: 10,
        border: `1px solid ${T.border}`,
      }}>
        {[
          { key: "AUTO", label: `🔥 แนะนำตามสภาวะตลาด (AUTO)${isBullishRegime ? " — BULLISH" : ""}`, color: T.green },
          { key: "SHORT_PUT", label: "🟢 BULLISH SHORT PUT ⭐", color: T.green },
          { key: "SKEWED_STRANGLE", label: "⚡ SKEWED STRANGLE", color: T.blue },
          { key: "STRANGLE", label: "⚖️ SHORT STRANGLE (Sideway)", color: T.purple },
          { key: "ALL", label: `ทั้งหมด (${opportunities.length})`, color: T.textSecondary },
        ].map(tab => {
          const isActive = strategyFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setStrategyFilter(tab.key)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: `1px solid ${isActive ? tab.color : "transparent"}`,
                background: isActive ? `${tab.color}18` : "transparent",
                color: isActive ? tab.color : T.textSecondary,
                fontFamily: T.fontSans,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Opportunities List */}
      {filteredOpps.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: T.textMuted, fontFamily: T.fontSans, fontSize: 13, background: T.bg1, borderRadius: 12, border: `1px solid ${T.border}` }}>
          ⏳ กำลังสแกนตลาด หรือไม่พบคู่สัญญาในหมวดนี้ที่เข้าเกณฑ์ในขณะนี้...
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 18 }}>
          {filteredOpps.map((opp) => {
            const isSent = sentMap[opp.id] === "sent";
            const isSending = sentMap[opp.id] === "sending";
            const isShortPut = opp.strategy === "SHORT_PUT";

            // Run Rules Engine Evaluation
            const evaluation = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
            const sizing = calculatePositionSize(accountInfo, opp, btcPrice, evaluation.sizeMultiplier);
            const chosenSize = selectedSize[opp.id] ?? (sizing.defaultLot?.size ?? 0.01);
            const chosenLot = sizing.lots?.find(l => l.size === chosenSize) || sizing.defaultLot;
            const isChecklistOpen = Boolean(expandedChecklist[opp.id]);

            return (
              <div key={opp.id} style={{
                background: `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
                border: `1px solid ${evaluation.isBlocked ? T.red + "35" : evaluation.isPassed ? (opp.badgeColor || T.greenMid) : T.border}`,
                borderRadius: 14,
                padding: 20,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                boxShadow: evaluation.isPassed
                  ? `0 6px 24px rgba(0,0,0,0.3), 0 0 25px ${(opp.badgeColor || T.green)}15`
                  : "0 4px 16px rgba(0,0,0,0.2)",
                position: "relative",
                transition: "border 0.2s ease",
              }}>
                {/* Card Top */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pill color={opp.badgeColor || T.green}>
                      {opp.badgeText || opp.strategyName || "STRATEGY"}
                    </Pill>
                    <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 700, fontSize: 14 }}>
                      📅 วันหมดอายุ (Expiry): {opp.expiry}
                    </span>
                    <Pill color={opp.isPreferredDTE ? T.green : opp.isIdealDTE ? T.blue : T.textSecondary}>
                      {opp.dte} วัน {opp.isPreferredDTE ? "★ PREFERRED" : opp.isIdealDTE ? "IDEAL" : ""}
                    </Pill>
                    {opp.isFullyHeld ? (
                      <Pill color={T.blue}>✓ ถือในพอร์ตแล้ว</Pill>
                    ) : opp.isPutHeld ? (
                      <Pill color={T.amber}>✓ มี Put ในพอร์ต</Pill>
                    ) : opp.isCallHeld ? (
                      <Pill color={T.blue}>✓ มี Call ในพอร์ต</Pill>
                    ) : null}
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1.5, fontFamily: T.fontSans }}>BTC SPOT</div>
                    <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                      {fmtUSD(opp.btcPrice)}
                    </div>
                  </div>
                </div>

                {/* Rules Engine Decision Banner */}
                <div style={{
                  background: evaluation.isBlocked ? T.redDim : evaluation.isWarning ? T.amberDim : T.greenDim,
                  border: `1px solid ${evaluation.isBlocked ? T.red + "35" : evaluation.isWarning ? T.amber + "35" : T.greenMid}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12 }}>
                        {evaluation.isBlocked ? "❌" : evaluation.isWarning ? "⚠️" : "✅"}
                      </span>
                      <span style={{
                        color: evaluation.isBlocked ? T.red : evaluation.isWarning ? T.amber : T.green,
                        fontFamily: T.fontSans, fontWeight: 700, fontSize: 11, letterSpacing: 0.5,
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
                        cursor: "pointer", fontFamily: T.fontSans, fontSize: 11, textDecoration: "underline",
                      }}
                    >
                      {isChecklistOpen ? "ซ่อน Checklist ▲" : "ดู Checklist (กฎความปลอดภัย) ▼"}
                    </button>
                  </div>

                  {/* Reasons Preview when blocked or warning */}
                  {evaluation.reasons.length > 0 && !isChecklistOpen && (
                    <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, marginTop: 2, lineHeight: 1.4 }}>
                      {evaluation.reasons.slice(0, 2).map((r, i) => (
                        <div key={i}>{r}</div>
                      ))}
                    </div>
                  )}

                  {/* Expanded Checklist */}
                  {isChecklistOpen && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                      {evaluation.checks.map((chk, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontFamily: T.fontSans }}>
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

                {/* Strategy Legs Display */}
                {isShortPut ? (
                  /* Single Leg: Short Put Card */
                  <div style={{
                    background: T.bg2,
                    border: `1px solid ${T.green}28`,
                    borderLeft: `4px solid ${T.green}`,
                    borderRadius: 10,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ color: T.green, fontWeight: 800, fontSize: 12, letterSpacing: 1, fontFamily: T.fontSans }}>
                          SHORT PUT STRIKE
                        </div>
                        <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 22, fontWeight: 800, marginTop: 2 }}>
                          {fmtUSD(opp.putStrike)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans }}>ระยะห่างปลอดภัย (SAFETY BUFFER)</div>
                        <div style={{ color: T.green, fontFamily: T.font, fontSize: 16, fontWeight: 800 }}>
                          -{opp.putDistancePct}%
                        </div>
                        <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>ต่ำกว่า Spot $80k</div>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, background: T.bg1, padding: "8px 12px", borderRadius: 6, fontSize: 11, fontFamily: T.font }}>
                      <div>
                        <span style={{ color: T.textSecondary, fontSize: 9, display: "block" }}>DELTA</span>
                        <strong style={{ color: T.amber }}>{opp.putDelta}</strong>
                      </div>
                      <div>
                        <span style={{ color: T.textSecondary, fontSize: 9, display: "block" }}>IV</span>
                        <strong style={{ color: T.purple }}>{opp.putIV}%</strong>
                      </div>
                      <div>
                        <span style={{ color: T.textSecondary, fontSize: 9, display: "block" }}>MARK PRICE</span>
                        <strong style={{ color: T.green }}>${opp.putMark}</strong>
                      </div>
                      <div>
                        <span style={{ color: T.textSecondary, fontSize: 9, display: "block" }}>THETA/วัน</span>
                        <strong style={{ color: T.green }}>+${opp.totalTheta}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Two Legs: Strangle / Skewed Strangle */
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {/* Put Leg */}
                    <div style={{
                      background: T.bg2, border: `1px solid ${T.amber}28`,
                      borderLeft: `3px solid ${T.amber}`, borderRadius: 8, padding: 12,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ color: T.amber, fontWeight: 700, fontSize: 11, letterSpacing: 1, fontFamily: T.fontSans }}>SHORT PUT</span>
                        <span style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.font }}>-{opp.putDistancePct}%</span>
                      </div>
                      <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 17, fontWeight: 800 }}>
                        {fmtUSD(opp.putStrike)}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: T.textSecondary, fontFamily: T.font }}>
                        <span>Delta: <strong style={{ color: T.amber }}>{opp.putDelta}</strong></span>
                        <span>Mark: <strong style={{ color: T.green }}>${opp.putMark}</strong></span>
                      </div>
                    </div>

                    {/* Call Leg */}
                    <div style={{
                      background: T.bg2, border: `1px solid ${T.blue}28`,
                      borderLeft: `3px solid ${T.blue}`, borderRadius: 8, padding: 12,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ color: T.blue, fontWeight: 700, fontSize: 11, letterSpacing: 1, fontFamily: T.fontSans }}>
                          {opp.strategy === "SKEWED_STRANGLE" ? "WIDE SHORT CALL" : "SHORT CALL"}
                        </span>
                        <span style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.font }}>+{opp.callDistancePct}%</span>
                      </div>
                      <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 17, fontWeight: 800 }}>
                        {fmtUSD(opp.callStrike)}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: T.textSecondary, fontFamily: T.font }}>
                        <span>Delta: <strong style={{ color: T.blue }}>+{opp.callDelta}</strong></span>
                        <span>Mark: <strong style={{ color: T.green }}>${opp.callMark}</strong></span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Strategy Summary Metrics */}
                <div style={{
                  background: T.bg2, borderRadius: 8, padding: "12px 14px",
                  display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10,
                  border: `1px solid ${T.border}`,
                }}>
                  <div>
                    <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>
                      {isShortPut ? "PREMIUM รับสุทธิ" : "PREMIUM รวม"}
                    </div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 16, fontWeight: 800 }}>
                      +${opp.totalPremium} <span style={{ fontSize: 10, color: T.textSecondary, fontWeight: 400 }}>/ 1 BTC</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>THETA DECAY</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                      +${opp.totalTheta} <span style={{ fontSize: 10, color: T.textSecondary, fontWeight: 400 }}>/ วัน</span>
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>
                      {isShortPut ? "BREAKEVEN PRICE" : "SAFE ZONE (BREAKEVEN)"}
                    </div>
                    <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
                      {isShortPut
                        ? `$${opp.breakevenLow?.toLocaleString()}`
                        : `$${opp.breakevenLow?.toLocaleString()} – $${opp.breakevenHigh?.toLocaleString()}`}
                    </div>
                  </div>
                </div>

                {/* Position Sizing Section */}
                {sizing.available && (
                  <div style={{
                    background: `linear-gradient(135deg, ${T.bg2}, ${T.bg3})`,
                    border: `1px solid ${T.blue}24`,
                    borderRadius: 8, padding: "12px 14px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ color: T.blue, fontWeight: 700, fontSize: 10, letterSpacing: 1.5, fontFamily: T.fontSans }}>
                        📐 POSITION SIZING (คำนวณตามเงินในพอร์ตจริง)
                      </span>
                      {sizing.recommendedLot && !evaluation.isBlocked && (
                        <Pill color={T.green}>
                          ★ แนะนำ {sizing.recommendedLot.label} BTC
                        </Pill>
                      )}
                    </div>

                    {/* Recommendation Callout */}
                    <div style={{
                      background: evaluation.isBlocked
                        ? T.redDim
                        : (sizing.recommendedLot ? T.greenDim : T.amberDim),
                      border: `1px solid ${evaluation.isBlocked ? T.red + "35" : T.greenMid}`,
                      borderRadius: 6,
                      padding: "8px 12px",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 6,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13 }}>⭐</span>
                        <span style={{
                          color: evaluation.isBlocked ? T.red : T.green,
                          fontFamily: T.fontSans,
                          fontWeight: 800,
                          fontSize: 12,
                        }}>
                          {evaluation.isBlocked
                            ? "งดเปิดไม้ใหม่ (ไม่ผ่านเกณฑ์ความปลอดภัย)"
                            : `ขนาดที่แนะนำ: ${sizing.recommendedLot?.label || "0.01"} BTC (เหมาะสมที่สุดสำหรับพอร์ต $${accountInfo ? Number(accountInfo.equity).toLocaleString() : "1,645"})`}
                        </span>
                      </div>
                      <span style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans }}>
                        {evaluation.isBlocked
                          ? "ดูเหตุผลใน Checklist"
                          : `ใช้ Margin ≈ $${sizing.recommendedLot?.marginRequired || 130} | Max Loss 2× ≈ -$${sizing.recommendedLot?.maxLoss || 10}`}
                      </span>
                    </div>

                    {/* Lot Size Buttons */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontSans, marginRight: 2 }}>เลือกขนาด:</span>
                      {sizing.lots.filter(l => l.canAfford || l.size <= 0.05).map(lot => {
                        const isSelected = lot.size === chosenSize;
                        const isRec = sizing.recommendedLot?.size === lot.size && !evaluation.isBlocked;
                        return (
                          <button
                            key={lot.size}
                            onClick={() => setSelectedSize(prev => ({ ...prev, [opp.id]: lot.size }))}
                            style={{
                              padding: "5px 10px", borderRadius: 6, cursor: "pointer",
                              fontFamily: T.font, fontSize: 11, fontWeight: 700,
                              background: isSelected ? (lot.canAfford ? T.greenDim : T.redDim) : T.bg1,
                              border: `1px solid ${isSelected ? (lot.canAfford ? T.greenMid : T.red + "44") : T.border}`,
                              color: isSelected ? (lot.canAfford ? T.green : T.red) : (lot.canAfford ? T.textSecondary : T.textMuted),
                              opacity: lot.canAfford ? 1 : 0.5,
                              transition: "all 0.15s ease",
                            }}
                          >
                            {lot.label} {isRec && <span style={{ color: T.green, marginLeft: 2, fontSize: 10 }}>★ แนะนำ</span>}
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
                          <div style={{ color: T.textSecondary, fontSize: 8, letterSpacing: 1, fontFamily: T.fontSans }}>AMOUNT</div>
                          <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                            {chosenLot.label} <span style={{ fontSize: 10, color: T.textSecondary }}>BTC</span>
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textSecondary, fontSize: 8, letterSpacing: 1, fontFamily: T.fontSans }}>MARGIN ≈</div>
                          <div style={{ color: T.amber, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                            ${chosenLot.marginRequired.toLocaleString()}
                          </div>
                          <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>
                            ({chosenLot.marginPctOfEquity}% of equity)
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textSecondary, fontSize: 8, letterSpacing: 1, fontFamily: T.fontSans }}>PREMIUM รับ</div>
                          <div style={{ color: T.green, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                            +${chosenLot.premiumReceived.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textSecondary, fontSize: 8, letterSpacing: 1, fontFamily: T.fontSans }}>THETA / วัน</div>
                          <div style={{ color: T.green, fontFamily: T.font, fontSize: 12, fontWeight: 700 }}>
                            +${chosenLot.thetaPerDay}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textSecondary, fontSize: 8, letterSpacing: 1, fontFamily: T.fontSans }}>MAX LOSS (2×)</div>
                          <div style={{ color: T.red, fontFamily: T.font, fontSize: 12, fontWeight: 700 }}>
                            -${chosenLot.maxLoss.toLocaleString()}
                          </div>
                          <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>
                            ({chosenLot.riskPct}% of port)
                          </div>
                        </div>
                        <div>
                          <div style={{ color: T.textSecondary, fontSize: 8, letterSpacing: 1, fontFamily: T.fontSans }}>STATUS</div>
                          <div style={{
                            color: evaluation.isBlocked ? T.red : chosenLot.isRecommended ? T.green : (!chosenLot.canAfford ? T.red : T.amber),
                            fontFamily: T.fontSans, fontSize: 10, fontWeight: 700,
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
                      flex: 1,
                      background: T.greenDim,
                      border: `1px solid ${T.greenMid}`,
                      color: T.green,
                      borderRadius: 8,
                      padding: "10px 14px",
                      cursor: "pointer",
                      fontFamily: T.fontSans,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
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
                    <span>AI ANALYZE SETUP</span>
                  </button>

                  <button
                    onClick={() => handleSendTelegram(opp)}
                    disabled={isSending || evaluation.isBlocked}
                    style={{
                      background: isSent ? T.green : evaluation.isBlocked ? T.bg3 : T.bg2,
                      border: `1px solid ${isSent ? T.green : T.border}`,
                      color: isSent ? T.bg0 : evaluation.isBlocked ? T.textMuted : T.textPrimary,
                      borderRadius: 8,
                      padding: "10px 16px",
                      cursor: evaluation.isBlocked ? "not-allowed" : "pointer",
                      fontFamily: T.fontSans,
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      opacity: evaluation.isBlocked ? 0.5 : 1,
                      transition: "all 0.2s ease",
                    }}
                  >
                    <span>📨</span>
                    <span>{isSending ? "SENDING..." : isSent ? "✓ SENT" : "TELEGRAM"}</span>
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
