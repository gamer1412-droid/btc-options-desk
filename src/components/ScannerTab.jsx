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
        <div style={{ padding: 48, textAlign: "center", color: T.textMuted, fontFamily: T.fontSans, fontSize: 14, background: T.bg1, borderRadius: 12, border: `1px solid ${T.border}` }}>
          ⏳ กำลังสแกนหาจังหวะที่เข้าเกณฑ์ปลอดภัย หรือไม่พบคู่สัญญาในหมวดนี้ขณะนี้...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {filteredOpps.map((opp, idx) => {
            const isSent = sentMap[opp.id] === "sent";
            const isSending = sentMap[opp.id] === "sending";
            const isShortPut = opp.strategy === "SHORT_PUT";

            const evaluation = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
            const sizing = calculatePositionSize(accountInfo, opp, btcPrice, evaluation.sizeMultiplier);
            const chosenSize = selectedSize[opp.id] ?? (sizing.defaultLot?.size ?? 0.01);
            const chosenLot = sizing.lots?.find(l => l.size === chosenSize) || sizing.defaultLot;
            const isExpanded = Boolean(expandedDetails[opp.id]);
            const isSimulated = simulatedFeedback === opp.id;
            const isTopPick = idx === 0 && !evaluation.isBlocked;

            const apy = opp.annualizedYield || (opp.totalPremium ? Math.round((opp.totalPremium / (btcPrice * 0.18)) * (365 / (opp.dte || 14)) * 100) : 45);

            return (
              <div
                key={opp.id}
                style={{
                  background: isTopPick
                    ? `linear-gradient(135deg, rgba(0, 240, 168, 0.14) 0%, rgba(13, 20, 30, 0.98) 100%)`
                    : T.bg1,
                  border: isTopPick
                    ? `2px solid ${T.green}`
                    : `1px solid ${evaluation.isBlocked ? T.red + "40" : evaluation.isPassed ? T.borderHover : T.border}`,
                  borderRadius: 14,
                  padding: isTopPick ? "20px 22px" : "18px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  boxShadow: isTopPick
                    ? `0 8px 30px rgba(0, 240, 168, 0.22), 0 0 20px rgba(0, 240, 168, 0.15)`
                    : "0 2px 10px rgba(0,0,0,0.2)",
                  position: "relative",
                  transition: "all 0.2s ease",
                }}
              >
                {/* 🌟 Top Pick Outstanding Ribbon */}
                {isTopPick && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: `linear-gradient(90deg, ${T.green}, #00b380)`,
                    color: "#05080c",
                    padding: "6px 14px",
                    borderRadius: 8,
                    fontWeight: 900,
                    fontSize: 13,
                    letterSpacing: 1,
                    fontFamily: T.fontSans,
                    boxShadow: "0 2px 12px rgba(0,240,168,0.4)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>⭐</span>
                      <span>สัญญาที่แนะนำให้เปิดมากที่สุด ณ ตอนนี้ (TOP PICK — AI RECOMMENDED)</span>
                    </div>
                    <span style={{
                      background: "#05080c",
                      color: T.green,
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 900,
                      fontFamily: T.font,
                    }}>
                      อันดับ 1
                    </span>
                  </div>
                )}

                {/* 1. Header: Strategy + Expiry + Status Pill */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      background: isTopPick ? T.green : (opp.badgeColor || T.green),
                      color: isTopPick ? "#05080c" : "#05080c",
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 900,
                      letterSpacing: 0.5,
                      fontFamily: T.fontSans,
                    }}>
                      {opp.badgeText || opp.strategyName}
                    </span>

                    <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 800, fontSize: 15 }}>
                      📅 Expiry: {opp.expiry}
                    </span>

                    <span style={{
                      background: opp.isPreferredDTE ? T.greenDim : T.bg2,
                      color: opp.isPreferredDTE ? T.green : T.textSecondary,
                      border: `1px solid ${opp.isPreferredDTE ? T.greenMid : T.border}`,
                      borderRadius: 6, padding: "3px 8px", fontSize: 12, fontFamily: T.font, fontWeight: 700,
                    }}>
                      {opp.dte} วัน {opp.isPreferredDTE ? "★ โซน Theta เร็ว" : ""}
                    </span>

                    {opp.isFullyHeld && (
                      <span style={{ background: T.blueDim, color: T.blue, padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                        ✓ มีในพอร์ตแล้ว
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      background: evaluation.isBlocked ? T.redDim : evaluation.isWarning ? T.amberDim : T.greenDim,
                      color: evaluation.isBlocked ? T.red : evaluation.isWarning ? T.amber : T.green,
                      border: `1px solid ${evaluation.isBlocked ? T.red + "44" : evaluation.isWarning ? T.amber + "44" : T.greenMid}`,
                      borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 800, fontFamily: T.font,
                    }}>
                      {evaluation.isBlocked ? "❌ BLOCKED" : evaluation.isWarning ? "⚠️ WARN" : "✅ 100% READY"}
                    </span>

                    <span style={{
                      background: apy >= 65 ? `linear-gradient(135deg, ${T.amber}, #d97706)` : `linear-gradient(135deg, ${T.green}, #00b380)`,
                      color: "#05080c",
                      borderRadius: 6, padding: "4px 12px", fontSize: 13, fontWeight: 900, fontFamily: T.font,
                      boxShadow: `0 0 12px ${apy >= 65 ? "rgba(251,191,36,0.4)" : "rgba(0,240,168,0.3)"}`,
                    }}>
                      ~{apy}% APY
                    </span>
                  </div>
                </div>

                {/* 2. Strikes & Financial Metrics (Large, High-Contrast & Readable) */}
                <div style={{
                  background: isTopPick ? "rgba(5, 8, 12, 0.75)" : T.bg0,
                  borderRadius: 10,
                  padding: "14px 18px",
                  border: `1px solid ${isTopPick ? T.green + "44" : T.border}`,
                  display: "grid",
                  gridTemplateColumns: isShortPut ? "1.4fr 1fr 1fr 1fr" : "1.2fr 1.2fr 1fr 1fr",
                  gap: 12,
                  alignItems: "center",
                }}>
                  {isShortPut ? (
                    <div>
                      <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, fontWeight: 600 }}>📍 SHORT PUT STRIKE</div>
                      <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 22, fontWeight: 900, marginTop: 2 }}>
                        {fmtUSD(opp.putStrike)}
                      </div>
                      <div style={{ color: T.green, fontSize: 12, fontFamily: T.font, fontWeight: 700, marginTop: 2 }}>
                        -{opp.putDistancePct}% ปลอดภัยต่ำกว่าราคา Spot
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, fontWeight: 600 }}>📍 SHORT PUT</div>
                        <div style={{ color: T.amber, fontFamily: T.font, fontSize: 18, fontWeight: 900, marginTop: 2 }}>
                          {fmtUSD(opp.putStrike)}
                        </div>
                        <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.font, marginTop: 2 }}>
                          -{opp.putDistancePct}% OTM
                        </div>
                      </div>
                      <div>
                        <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, fontWeight: 600 }}>📍 SHORT CALL</div>
                        <div style={{ color: T.blue, fontFamily: T.font, fontSize: 18, fontWeight: 900, marginTop: 2 }}>
                          {fmtUSD(opp.callStrike)}
                        </div>
                        <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.font, marginTop: 2 }}>
                          +{opp.callDistancePct}% OTM
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, fontWeight: 600 }}>💰 PREMIUM รับสุทธิ</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 19, fontWeight: 900, marginTop: 2 }}>
                      +${opp.totalPremium}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2 }}>USD / 1 BTC</div>
                  </div>

                  <div>
                    <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, fontWeight: 600 }}>⏱️ THETA DECAY</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 18, fontWeight: 800, marginTop: 2 }}>
                      +${opp.totalTheta}
                    </div>
                    <div style={{ color: T.textMuted, fontSize: 11, marginTop: 2 }}>USD / วัน</div>
                  </div>

                  <div>
                    <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, fontWeight: 600 }}>📐 DELTA & IV</div>
                    <div style={{ color: T.amber, fontFamily: T.font, fontSize: 16, fontWeight: 800, marginTop: 2 }}>
                      {isShortPut ? opp.putDelta : `${opp.putDelta} / +${opp.callDelta}`}
                    </div>
                    <div style={{ color: T.purple, fontSize: 11, fontFamily: T.font, marginTop: 2 }}>
                      IV {opp.putIV}%
                    </div>
                  </div>
                </div>

                {/* 3. Position Size Quick Selector */}
                {sizing.available && (
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 10,
                    background: isTopPick ? "rgba(0, 240, 168, 0.08)" : T.bg2,
                    border: `1px solid ${isTopPick ? T.green + "33" : T.border}`,
                    borderRadius: 8,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontFamily: T.fontSans,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ color: T.textSecondary, fontWeight: 700 }}>เลือกขนาดสัญญา:</span>
                      {sizing.lots.filter(l => l.canAfford || l.size <= 0.05).slice(0, 5).map(lot => {
                        const isSelected = chosenSize === lot.size;
                        const isRec = sizing.recommendedLot?.size === lot.size && !evaluation.isBlocked;
                        return (
                          <button
                            key={lot.size}
                            onClick={() => {
                              SoundFX.playClick();
                              setSelectedSize(prev => ({ ...prev, [opp.id]: lot.size }));
                            }}
                            style={{
                              background: isSelected ? (isTopPick ? T.green : T.greenDim) : T.bg0,
                              border: `1px solid ${isSelected ? T.green : T.border}`,
                              color: isSelected ? (isTopPick ? "#05080c" : T.green) : T.textSecondary,
                              borderRadius: 6,
                              padding: "4px 10px",
                              cursor: "pointer",
                              fontSize: 12,
                              fontFamily: T.font,
                              fontWeight: 800,
                              transition: "all 0.15s ease",
                            }}
                          >
                            {lot.label} BTC {isRec && "★"}
                          </button>
                        );
                      })}
                    </div>

                    {chosenLot && (
                      <div style={{ color: T.textSecondary, fontSize: 12, fontFamily: T.font }}>
                        Margin ที่ใช้: <strong style={{ color: T.amber }}>${chosenLot.marginRequired.toLocaleString()}</strong> · รับ Premium: <strong style={{ color: T.green }}>+${chosenLot.premiumReceived.toLocaleString()} USD</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Action Buttons Toolbar */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                  <button
                    onClick={() => {
                      SoundFX.playClick();
                      onOpenPayoff?.({ ...opp, suggestedSize: chosenSize });
                    }}
                    title="เปิด Payoff Simulator ดูกราฟกำไรขาดทุน"
                    style={{
                      background: T.bg2,
                      border: `1px solid ${T.blue}44`,
                      color: T.blue,
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 800,
                      fontFamily: T.fontSans,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      transition: "all 0.15s ease",
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
                      border: `1px solid ${isSimulated ? T.green : T.purple}44`,
                      color: isSimulated ? "#05080c" : T.purple,
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 800,
                      fontFamily: T.fontSans,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>⚡</span>
                    <span>{isSimulated ? "✓ SIMULATED" : "PAPER TRADE"}</span>
                  </button>

                  <button
                    onClick={() => {
                      SoundFX.playClick();
                      onAnalyzeStrangle(opp);
                    }}
                    title="AI วิเคราะห์ความเสี่ยงเชิงลึก"
                    style={{
                      background: isTopPick ? T.greenDim : T.bg2,
                      border: `1px solid ${isTopPick ? T.greenMid : T.borderHover}`,
                      color: isTopPick ? T.green : T.textPrimary,
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 800,
                      fontFamily: T.fontSans,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>🧠</span>
                    <span>AI ANALYZE</span>
                  </button>

                  <button
                    onClick={() => handleSendTelegram(opp)}
                    disabled={isSending || evaluation.isBlocked}
                    title="ส่งสัญญาณเข้า Telegram"
                    style={{
                      background: isSent ? T.green : isTopPick ? `linear-gradient(135deg, ${T.green}, #00b380)` : T.bg2,
                      border: `1px solid ${isSent ? T.green : isTopPick ? T.green : T.border}`,
                      color: isSent || isTopPick ? "#05080c" : evaluation.isBlocked ? T.textMuted : T.textPrimary,
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: evaluation.isBlocked ? "not-allowed" : "pointer",
                      fontSize: 12,
                      fontWeight: 900,
                      fontFamily: T.fontSans,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      opacity: evaluation.isBlocked ? 0.5 : 1,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>📨</span>
                    <span>{isSending ? "SENDING..." : isSent ? "✓ SENT" : "SEND ALERT"}</span>
                  </button>
                </div>

                {/* 5. Optional Collapsible Rules Details */}
                <div style={{ borderTop: `1px solid ${isTopPick ? T.green + "33" : T.border}`, paddingTop: 8 }}>
                  <button
                    onClick={() => toggleDetails(opp.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: isTopPick ? T.green : T.textMuted,
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: T.fontSans,
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{isExpanded ? "▲ ซ่อนผลตรวจกฎความปลอดภัย" : "▼ ดูผลตรวจกฎความปลอดภัย (6 Rules Checklist)"}</span>
                  </button>

                  {isExpanded && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, background: T.bg0, padding: 12, borderRadius: 8, border: `1px solid ${T.border}` }}>
                      {evaluation.checks.map((chk, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: T.fontSans }}>
                          <span style={{ color: T.textSecondary }}>{chk.icon} {chk.rule}:</span>
                          <span style={{
                            color: chk.status === "PASS" ? T.green : chk.status === "WARNING" ? T.amber : T.red,
                            fontFamily: T.font,
                            fontWeight: 700,
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

