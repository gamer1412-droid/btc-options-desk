import { useState, useMemo } from "react";
import { T } from "../tokens.js";
import { fmtUSD } from "../utils.js";
import { Pill } from "./Pill.jsx";
import { sendTelegram } from "../services/alerts.js";
import { calculatePositionSize } from "../services/sizing.js";
import { evaluateEntryRules } from "../services/rulesEngine.js";
import { openPaperTrade } from "../services/paperTrading.js";
import { SoundFX } from "../services/soundFx.js";
import { RISK_PROFILES } from "../config/strategyConfig.js";
import { determineOptimalMarketProfile } from "../services/scanner.js";

export function ScannerTab({
  opportunities = [],
  btcPrice,
  ivRank,
  marketContext = {},
  accountInfo,
  currentPositions = [],
  optimalProfile = null,
  onAnalyzeStrangle,
  onOpenPayoff,
  onOpenPaperTrade,
}) {
  const [sentMap, setSentMap] = useState({});
  const [selectedSize, setSelectedSize] = useState({});
  const [expandedDetails, setExpandedDetails] = useState({});
  const [strategyFilter, setStrategyFilter] = useState("AUTO");
  const [simulatedFeedback, setSimulatedFeedback] = useState(null);

  // Compute or fallback to optimal profile analysis
  const currentOptimal = useMemo(() => {
    return optimalProfile || determineOptimalMarketProfile(marketContext, accountInfo, currentPositions);
  }, [optimalProfile, marketContext, accountInfo, currentPositions]);

  const activeProfile = currentOptimal.profile || RISK_PROFILES.BALANCED_ALPHA;
  const isBullishRegime = marketContext.distFromMA20 != null && marketContext.distFromMA20 > 7.0;
  const isBearishRegime = marketContext.distFromMA20 != null && marketContext.distFromMA20 < -7.0;

  const handleSendTelegram = async (opp) => {
    SoundFX.playClick();
    setSentMap(prev => ({ ...prev, [opp.id]: "sending" }));
    try {
      const signalType = opp.strategy === "SHORT_PUT"
        ? "short_put_signal"
        : opp.strategy === "SKEWED_STRANGLE"
        ? "skewed_strangle_signal"
        : "strangle_signal";
      await sendTelegram(signalType, opp);
      SoundFX.playSuccessChime();
      setSentMap(prev => ({ ...prev, [opp.id]: "sent" }));
      setTimeout(() => {
        setSentMap(prev => ({ ...prev, [opp.id]: null }));
      }, 4000);
    } catch {
      SoundFX.playWarningAlert();
      setSentMap(prev => ({ ...prev, [opp.id]: "error" }));
    }
  };

  const handleSimulate = (opp, size) => {
    SoundFX.playSuccessChime();
    openPaperTrade(opp, size);
    setSimulatedFeedback(opp.id);
    setTimeout(() => setSimulatedFeedback(null), 3500);
    if (onOpenPaperTrade) {
      onOpenPaperTrade();
    }
  };

  const toggleDetails = (id) => {
    SoundFX.playClick();
    setExpandedDetails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredOpps = useMemo(() => {
    if (!Array.isArray(opportunities)) return [];
    if (strategyFilter === "ALL") return opportunities;
    if (strategyFilter === "AUTO") {
      if (isBullishRegime) {
        return opportunities.filter(o => o.strategy === "SHORT_PUT" || o.strategy === "SKEWED_STRANGLE");
      }
      return opportunities.filter(o => o.strategy === "STRANGLE" || o.strategy === "SHORT_PUT");
    }
    return opportunities.filter(o => o.strategy === strategyFilter);
  }, [opportunities, strategyFilter, isBullishRegime]);

  return (
    <div style={{ padding: "0 24px 32px", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Consolidated AI Strategy & Market Status Banner ───────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
        border: `1px solid ${currentOptimal.tagColor}44`,
        borderRadius: 12,
        padding: "14px 18px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{
            background: `${currentOptimal.tagColor}18`,
            color: currentOptimal.tagColor,
            border: `1px solid ${currentOptimal.tagColor}50`,
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 800,
            fontFamily: T.font,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <span>🎯</span>
            <span>{currentOptimal.tag}</span>
          </div>

          <div style={{ color: T.textSecondary, fontSize: 12, fontFamily: T.fontSans }}>
            {currentOptimal.rationale}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontSans }}>
            MA20: <strong style={{ color: (marketContext.distFromMA20 ?? 0) >= 0 ? T.green : T.red }}>
              {(marketContext.distFromMA20 ?? 0) >= 0 ? "+" : ""}{(marketContext.distFromMA20 ?? 0).toFixed(1)}%
            </strong>
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontSans }}>
            IVR: <strong style={{ color: T.purple }}>{ivRank || marketContext.ivRank || 45}%</strong>
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontSans }}>
            Target: <strong style={{ color: currentOptimal.tagColor }}>{activeProfile.desc.split(",")[0]}</strong>
          </div>
        </div>
      </div>

      {/* ── Compact Strategy Filters ────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
      }}>
        <div style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          background: T.bg1,
          padding: 4,
          borderRadius: 8,
          border: `1px solid ${T.border}`,
        }}>
          {[
            { key: "AUTO", label: `⚡ แนะนำ (${filteredOpps.length})`, color: T.green },
            { key: "SHORT_PUT", label: "🟢 Short Put", color: T.green },
            { key: "SKEWED_STRANGLE", label: "⚡ Skewed Strangle", color: T.blue },
            { key: "STRANGLE", label: "⚖️ Strangle", color: T.purple },
            { key: "ALL", label: `ทั้งหมด (${opportunities.length})`, color: T.textSecondary },
          ].map(tab => {
            const isActive = strategyFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  SoundFX.playClick();
                  setStrategyFilter(tab.key);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${isActive ? tab.color : "transparent"}`,
                  background: isActive ? `${tab.color}15` : "transparent",
                  color: isActive ? tab.color : T.textSecondary,
                  fontFamily: T.fontSans,
                  fontSize: 11,
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

        <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontSans }}>
          แสดง <strong>{filteredOpps.length}</strong> สัญญาที่ตรงเกณฑ์
        </span>
      </div>

      {/* ── Opportunities Grid ──────────────────────────────────────────────── */}
      {filteredOpps.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: T.textMuted, fontFamily: T.fontSans, fontSize: 13, background: T.bg1, borderRadius: 12, border: `1px solid ${T.border}` }}>
          ⏳ กำลังสแกนหาจังหวะที่เข้าเกณฑ์ปลอดภัย หรือไม่พบคู่สัญญาในหมวดนี้ขณะนี้...
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 14 }}>
          {filteredOpps.map((opp) => {
            const isSent = sentMap[opp.id] === "sent";
            const isSending = sentMap[opp.id] === "sending";
            const isShortPut = opp.strategy === "SHORT_PUT";

            const evaluation = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
            const sizing = calculatePositionSize(accountInfo, opp, btcPrice, evaluation.sizeMultiplier);
            const chosenSize = selectedSize[opp.id] ?? (sizing.defaultLot?.size ?? 0.01);
            const chosenLot = sizing.lots?.find(l => l.size === chosenSize) || sizing.defaultLot;
            const isExpanded = Boolean(expandedDetails[opp.id]);
            const isSimulated = simulatedFeedback === opp.id;

            const apy = opp.annualizedYield || (opp.totalPremium ? Math.round((opp.totalPremium / (btcPrice * 0.18)) * (365 / (opp.dte || 14)) * 100) : 45);

            return (
              <div
                key={opp.id}
                style={{
                  background: T.bg1,
                  border: `1px solid ${evaluation.isBlocked ? T.red + "30" : evaluation.isPassed ? T.borderHover : T.border}`,
                  borderRadius: 12,
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
                  transition: "all 0.2s ease",
                }}
              >
                {/* 1. Header: Strategy + Expiry + Status Pill */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Pill color={opp.badgeColor || T.green}>
                      {opp.badgeText || opp.strategyName}
                    </Pill>
                    <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 700, fontSize: 13 }}>
                      {opp.expiry}
                    </span>
                    <span style={{
                      background: opp.isPreferredDTE ? T.greenDim : T.bg2,
                      color: opp.isPreferredDTE ? T.green : T.textSecondary,
                      borderRadius: 4, padding: "2px 6px", fontSize: 10, fontFamily: T.font, fontWeight: 700,
                    }}>
                      {opp.dte} วัน {opp.isPreferredDTE ? "★" : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      background: evaluation.isBlocked ? T.redDim : evaluation.isWarning ? T.amberDim : T.greenDim,
                      color: evaluation.isBlocked ? T.red : evaluation.isWarning ? T.amber : T.green,
                      borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 800, fontFamily: T.font,
                    }}>
                      {evaluation.isBlocked ? "BLOCKED" : evaluation.isWarning ? "WARN" : "READY"}
                    </span>
                    <span style={{
                      background: apy >= 65 ? T.amberDim : T.greenDim,
                      color: apy >= 65 ? T.amber : T.green,
                      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 900, fontFamily: T.font,
                    }}>
                      ~{apy}% APY
                    </span>
                  </div>
                </div>

                {/* 2. Strikes & Financial Metrics (Clean Compact Grid) */}
                <div style={{
                  background: T.bg0,
                  borderRadius: 8,
                  padding: "10px 14px",
                  border: `1px solid ${T.border}`,
                  display: "grid",
                  gridTemplateColumns: isShortPut ? "1.5fr 1fr 1fr 1fr" : "1.2fr 1.2fr 1fr 1fr",
                  gap: 8,
                  alignItems: "center",
                }}>
                  {isShortPut ? (
                    <div>
                      <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>PUT STRIKE</div>
                      <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 15, fontWeight: 800 }}>
                        {fmtUSD(opp.putStrike)}
                      </div>
                      <div style={{ color: T.green, fontSize: 10, fontFamily: T.font }}>-{opp.putDistancePct}% OTM</div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>PUT STRIKE</div>
                        <div style={{ color: T.amber, fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
                          {fmtUSD(opp.putStrike)}
                        </div>
                        <div style={{ color: T.textSecondary, fontSize: 9, fontFamily: T.font }}>-{opp.putDistancePct}%</div>
                      </div>
                      <div>
                        <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>CALL STRIKE</div>
                        <div style={{ color: T.blue, fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
                          {fmtUSD(opp.callStrike)}
                        </div>
                        <div style={{ color: T.textSecondary, fontSize: 9, fontFamily: T.font }}>+{opp.callDistancePct}%</div>
                      </div>
                    </>
                  )}

                  <div>
                    <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>PREMIUM</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 13, fontWeight: 800 }}>
                      +${opp.totalPremium}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 9 }}>/ 1 BTC</div>
                  </div>

                  <div>
                    <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>THETA/วัน</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
                      +${opp.totalTheta}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 9 }}>Decay</div>
                  </div>

                  <div>
                    <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>DELTA</div>
                    <div style={{ color: T.amber, fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
                      {isShortPut ? opp.putDelta : `${opp.putDelta} / +${opp.callDelta}`}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 9 }}>IV {opp.putIV}%</div>
                  </div>
                </div>

                {/* 3. Compact Position Size Selector */}
                {sizing.available && (
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: T.bg2,
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontFamily: T.fontSans,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: T.textSecondary }}>ขนาดไม้:</span>
                      {sizing.lots.filter(l => l.canAfford || l.size <= 0.05).slice(0, 4).map(lot => (
                        <button
                          key={lot.size}
                          onClick={() => {
                            SoundFX.playClick();
                            setSelectedSize(prev => ({ ...prev, [opp.id]: lot.size }));
                          }}
                          style={{
                            background: chosenSize === lot.size ? T.greenDim : T.bg0,
                            border: `1px solid ${chosenSize === lot.size ? T.greenMid : T.border}`,
                            color: chosenSize === lot.size ? T.green : T.textSecondary,
                            borderRadius: 4,
                            padding: "2px 6px",
                            cursor: "pointer",
                            fontSize: 10,
                            fontFamily: T.font,
                            fontWeight: 700,
                          }}
                        >
                          {lot.label}
                        </button>
                      ))}
                    </div>

                    {chosenLot && (
                      <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.font }}>
                        Margin: <strong style={{ color: T.amber }}>${chosenLot.marginRequired}</strong> · รับ: <strong style={{ color: T.green }}>+${chosenLot.premiumReceived}</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Action Buttons Toolbar */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                  <button
                    onClick={() => {
                      SoundFX.playClick();
                      onOpenPayoff?.({ ...opp, suggestedSize: chosenSize });
                    }}
                    title="เปิด Payoff Simulator ดูกราฟกำไรขาดทุน"
                    style={{
                      background: T.bg2,
                      border: `1px solid ${T.blue}33`,
                      color: T.blue,
                      borderRadius: 6,
                      padding: "6px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: T.fontSans,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    <span>📊</span>
                    <span>PAYOFF</span>
                  </button>

                  <button
                    onClick={() => handleSimulate(opp, chosenSize)}
                    title="ทดลองเทรดจำลอง Paper Trading"
                    style={{
                      background: isSimulated ? T.green : T.bg2,
                      border: `1px solid ${isSimulated ? T.green : T.purple}33`,
                      color: isSimulated ? "#05080c" : T.purple,
                      borderRadius: 6,
                      padding: "6px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: T.fontSans,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    <span>⚡</span>
                    <span>{isSimulated ? "DONE" : "PAPER"}</span>
                  </button>

                  <button
                    onClick={() => {
                      SoundFX.playClick();
                      onAnalyzeStrangle(opp);
                    }}
                    title="AI วิเคราะห์ความเสี่ยงเชิงลึก"
                    style={{
                      background: T.greenDim,
                      border: `1px solid ${T.greenMid}`,
                      color: T.green,
                      borderRadius: 6,
                      padding: "6px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: T.fontSans,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    <span>🧠</span>
                    <span>AI RISK</span>
                  </button>

                  <button
                    onClick={() => handleSendTelegram(opp)}
                    disabled={isSending || evaluation.isBlocked}
                    title="ส่งสัญญาณเข้า Telegram"
                    style={{
                      background: isSent ? T.green : evaluation.isBlocked ? T.bg3 : T.bg2,
                      border: `1px solid ${isSent ? T.green : T.border}`,
                      color: isSent ? T.bg0 : evaluation.isBlocked ? T.textMuted : T.textPrimary,
                      borderRadius: 6,
                      padding: "6px 8px",
                      cursor: evaluation.isBlocked ? "not-allowed" : "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: T.fontSans,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      opacity: evaluation.isBlocked ? 0.5 : 1,
                    }}
                  >
                    <span>📨</span>
                    <span>{isSending ? "..." : isSent ? "SENT" : "ALERT"}</span>
                  </button>
                </div>

                {/* 5. Optional Collapsible Rules Details */}
                <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 6 }}>
                  <button
                    onClick={() => toggleDetails(opp.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: T.textMuted,
                      cursor: "pointer",
                      fontSize: 10,
                      fontFamily: T.fontSans,
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{isExpanded ? "▲ ซ่อนรายละเอียดกฎ" : "▼ ดูผลตรวจกฎความปลอดภัย (6 ข้อ)"}</span>
                  </button>

                  {isExpanded && (
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, background: T.bg0, padding: 8, borderRadius: 6 }}>
                      {evaluation.checks.map((chk, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: T.fontSans }}>
                          <span style={{ color: T.textSecondary }}>{chk.icon} {chk.rule}:</span>
                          <span style={{
                            color: chk.status === "PASS" ? T.green : chk.status === "WARNING" ? T.amber : T.red,
                            fontFamily: T.font,
                          }}>
                            {chk.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

