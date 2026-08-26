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
  marketIv,
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
  const [expandedChecklist, setExpandedChecklist] = useState({});
  const [strategyFilter, setStrategyFilter] = useState("AUTO");
  const [simulatedFeedback, setSimulatedFeedback] = useState(null);

  // Compute or fallback to optimal profile analysis
  const currentOptimal = useMemo(() => {
    return optimalProfile || determineOptimalMarketProfile(marketContext, accountInfo, currentPositions);
  }, [optimalProfile, marketContext, accountInfo, currentPositions]);

  const activeProfile = currentOptimal.profile || RISK_PROFILES.BALANCED_ALPHA;
  const regime = currentOptimal.regime || marketContext.regime;
  const isBullishRegime = regime?.regime === "BULL_TREND";
  const isBearishRegime = regime?.regime === "BEAR_TREND";

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

  const toggleChecklist = (id) => {
    SoundFX.playClick();
    setExpandedChecklist(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredOpps = useMemo(() => {
    if (!Array.isArray(opportunities)) return [];
    if (strategyFilter === "ALL") return opportunities;
    if (strategyFilter === "AUTO") {
      const allowed = regime?.allowedStrategies || [];
      return opportunities.filter(o => allowed.includes(o.strategy));
    }
    return opportunities.filter(o => o.strategy === strategyFilter);
  }, [opportunities, strategyFilter, regime]);

  // Find index of the first viable top pick (not blocked/held)
  const topPickId = useMemo(() => {
    for (const opp of filteredOpps) {
      const evalRes = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
      if (!evalRes.isBlocked && !opp.isFullyHeld) {
        return opp.id;
      }
    }
    return filteredOpps[0]?.id || null;
  }, [filteredOpps, marketContext, accountInfo, currentPositions]);

  return (
    <div style={{ padding: "0 24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── AI Auto-Selected Market Regime & Optimal Strategy Card ───────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
        border: `1px solid ${currentOptimal.tagColor}55`,
        borderLeft: `4px solid ${currentOptimal.tagColor}`,
        borderRadius: 14,
        padding: "18px 22px",
        boxShadow: `0 4px 25px rgba(0,0,0,0.35), 0 0 20px ${currentOptimal.tagColor}15`,
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 18 }}>🧭</span>
              <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 900, fontSize: 13, letterSpacing: 1.5 }}>
                RULE-BASED MARKET REGIME — กรอบกลยุทธ์อัตโนมัติ
              </span>
              <span style={{
                background: `${currentOptimal.tagColor}22`,
                color: currentOptimal.tagColor,
                border: `1px solid ${currentOptimal.tagColor}60`,
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 10,
                fontWeight: 900,
                fontFamily: T.font,
                letterSpacing: 1,
              }}>
                {regime?.label || currentOptimal.tag} · {regime?.confidence ?? 0}% {currentOptimal.metrics?.dataComplete ? "(AUTO)" : "(WAIT FOR DATA)"}
              </span>
            </div>

            <div style={{ color: T.textSecondary, fontSize: 13, fontFamily: T.fontSans, lineHeight: 1.6, maxWidth: 780, marginTop: 4 }}>
              {currentOptimal.rationale}
            </div>
          </div>

          <div style={{
            background: T.bg1,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: "10px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
          }}>
            <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1, fontFamily: T.fontSans }}>
              {regime?.isNoTrade ? "REGIME ACTION" : "PROFILE TARGET (NOT GUARANTEED)"}
            </div>
            <div style={{ color: currentOptimal.tagColor, fontFamily: T.font, fontSize: 18, fontWeight: 900, marginTop: 2 }}>
              {regime?.isNoTrade ? "NO_TRADE" : `Delta ${activeProfile.deltaMin}–${activeProfile.deltaMax} / DTE ${activeProfile.dtePreferredMin}–${activeProfile.dtePreferredMax}d`}
            </div>
          </div>
        </div>

        {/* Real-Time Market Conditions Breakdown Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
          marginTop: 14,
          paddingTop: 12,
          borderTop: `1px solid ${T.border}`,
        }}>
          <div style={{ background: T.bg0, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}` }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>MARKET TREND (VS MA20)</div>
            <div style={{ color: marketContext.distFromMA20 == null ? T.textMuted : marketContext.distFromMA20 >= 0 ? T.green : T.red, fontFamily: T.font, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {marketContext.distFromMA20 == null ? "N/A — รอข้อมูล MA20" : `${marketContext.distFromMA20 >= 0 ? "+" : ""}${marketContext.distFromMA20.toFixed(1)}% ${isBullishRegime ? "🔥 Bullish" : isBearishRegime ? "⚠️ Bearish" : "⚖️ Sideway"}`}
            </div>
          </div>

          <div style={{ background: T.bg0, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}` }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>TREND STRENGTH / ADX14</div>
            <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {marketContext.adx14 != null ? `${Number(marketContext.adx14).toFixed(1)} ${marketContext.adx14 >= 25 ? "Trending" : marketContext.adx14 < 20 ? "Range" : "Transition"}` : "N/A"}
            </div>
          </div>

          <div style={{ background: T.bg0, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}` }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>REALIZED VOL 7D / 30D</div>
            <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {marketContext.realizedVol7 != null && marketContext.realizedVol30 != null ? `${Number(marketContext.realizedVol7).toFixed(1)}% / ${Number(marketContext.realizedVol30).toFixed(1)}%` : "N/A"}
            </div>
          </div>

          <div style={{ background: T.bg0, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}` }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>OPTION CHAIN AVG IV</div>
            <div style={{ color: marketIv >= 40 ? T.purple : T.blue, fontFamily: T.font, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {marketIv != null ? `${marketIv}% (Current IV, not IV Rank)` : "N/A — รอข้อมูลตลาด"}
            </div>
          </div>

          <div style={{ background: T.bg0, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}` }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>TARGET DELTA / DTE</div>
            <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {regime?.isNoTrade ? "N/A — NO_TRADE" : `Delta ${activeProfile.deltaMin}–${activeProfile.deltaMax} | DTE ${activeProfile.dtePreferredMin}–${activeProfile.dtePreferredMax}d`}
            </div>
          </div>

          <div style={{ background: T.bg0, padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}` }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>DYNAMIC TP TARGET</div>
            <div style={{ color: T.green, fontFamily: T.font, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {regime?.isNoTrade ? "N/A — NO_TRADE" : `${activeProfile.takeProfitPct}% Profit (Auto Rotate)`}
            </div>
          </div>
        </div>
      </div>

      <div style={{ color: T.textMuted, fontSize: 11, lineHeight: 1.5, fontFamily: T.fontSans }}>
        * Annualized ROM เป็นค่าประมาณจาก Mark Price และ Margin สมมติ 15–18% ยังไม่รวม bid/ask spread, slippage, fees, การเปลี่ยนแปลง Margin และ Tail Loss — ตรวจราคาที่ execute ได้จริงบน Binance ทุกครั้ง
      </div>

      {/* ── Strategy Filter Tabs ────────────────────────────────────────────── */}
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
          { key: "AUTO", label: `🧭 สแกนตาม Regime (AUTO)${regime?.isNoTrade ? " — NO_TRADE" : isBullishRegime ? " — BULLISH" : ""}`, color: regime?.isNoTrade ? T.red : T.green },
          { key: "SHORT_PUT", label: "🟢 BULLISH SHORT PUT ⭐", color: T.green },
          { key: "SKEWED_STRANGLE", label: "⚡ SKEWED STRANGLE", color: T.blue },
          { key: "STRANGLE", label: "⚖️ SHORT STRANGLE (Sideway)", color: T.purple },
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

      {/* ── Opportunities List (Full Rich Details + Highlighted Top Pick) ───── */}
      {filteredOpps.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: T.textMuted, fontFamily: T.fontSans, fontSize: 13, background: T.bg1, borderRadius: 12, border: `1px solid ${T.border}` }}>
          {regime?.isNoTrade
            ? `⛔ NO_TRADE — ${regime.label}: ${regime.reasons?.[0] || "รอให้ตลาดยืนยันสภาวะใหม่"}`
            : "⏳ ไม่พบคู่สัญญาที่ผ่านทั้ง Regime และกฎความเสี่ยงในขณะนี้"}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 18 }}>
          {filteredOpps.map((opp) => {
            const isSent = sentMap[opp.id] === "sent";
            const isSending = sentMap[opp.id] === "sending";
            const isShortPut = opp.strategy === "SHORT_PUT";

            const evaluation = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
            const sizing = calculatePositionSize(accountInfo, opp, btcPrice, evaluation.sizeMultiplier);
            const chosenSize = selectedSize[opp.id] ?? (sizing.defaultLot?.size ?? 0.01);
            const chosenLot = sizing.lots?.find(l => l.size === chosenSize) || sizing.defaultLot;
            const isChecklistOpen = Boolean(expandedChecklist[opp.id]);
            const isSimulated = simulatedFeedback === opp.id;

            const isTopPick = opp.id === topPickId && !evaluation.isBlocked && !opp.isFullyHeld;
            const apy = opp.annualizedYield || (opp.totalPremium ? Math.round((opp.totalPremium / (btcPrice * 0.18)) * (365 / (opp.dte || 14)) * 100) : 45);

            return (
              <div
                key={opp.id}
                style={{
                  background: isTopPick
                    ? `linear-gradient(135deg, rgba(0, 240, 168, 0.16) 0%, rgba(10, 18, 28, 0.98) 100%)`
                    : `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
                  border: isTopPick
                    ? `2px solid ${T.green}`
                    : `1px solid ${evaluation.isBlocked ? T.red + "35" : evaluation.isPassed ? (opp.badgeColor || T.greenMid) : T.border}`,
                  borderRadius: 14,
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  boxShadow: isTopPick
                    ? `0 8px 32px rgba(0, 240, 168, 0.25), 0 0 25px rgba(0, 240, 168, 0.2)`
                    : evaluation.isPassed
                    ? `0 8px 28px rgba(0,0,0,0.4), 0 0 25px ${(opp.badgeColor || T.green)}18`
                    : "0 4px 16px rgba(0,0,0,0.2)",
                  position: "relative",
                  transition: "all 0.2s ease",
                }}
              >
                {/* Estimated annualized return-on-assumed-margin banner */}
                <div style={{
                  position: "absolute",
                  top: -11,
                  right: 20,
                  background: apy >= 65
                    ? `linear-gradient(135deg, ${T.amber}, #d97706)`
                    : `linear-gradient(135deg, ${T.green}, #00b380)`,
                  color: "#05080c",
                  padding: "3px 12px",
                  borderRadius: 20,
                  fontSize: 10,
                  fontWeight: 900,
                  fontFamily: T.font,
                  boxShadow: `0 0 15px ${apy >= 65 ? "rgba(251, 191, 36, 0.5)" : "rgba(0, 240, 168, 0.4)"}`,
                  letterSpacing: 0.5,
                }}>
                  {apy >= 65 ? "⚠️" : "◈"} EST. ANN. ROM ~{apy}%*
                </div>

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
                    fontSize: 12,
                    letterSpacing: 1,
                    fontFamily: T.fontSans,
                    boxShadow: "0 2px 12px rgba(0,240,168,0.4)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15 }}>⭐</span>
                      <span>อันดับสูงสุดตามกฎเบื้องต้น — ต้องตรวจราคาและ Margin จริงก่อน</span>
                    </div>
                    <span style={{
                      background: "#05080c",
                      color: T.green,
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 900,
                      fontFamily: T.font,
                    }}>
                      อันดับ 1
                    </span>
                  </div>
                )}

                {/* Card Top Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pill color={opp.badgeColor || T.green}>
                      {opp.badgeText || opp.strategyName || "STRATEGY"}
                    </Pill>
                    <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 700, fontSize: 14 }}>
                      📅 Expiry: {opp.expiry}
                    </span>
                    <Pill color={opp.isPreferredDTE ? T.green : opp.isIdealDTE ? T.blue : T.textSecondary}>
                      {opp.dte} วัน {opp.isPreferredDTE ? "★ FAST THETA" : opp.isIdealDTE ? "IDEAL" : ""}
                    </Pill>

                    {/* Prominent Position Held Badge */}
                    {opp.isFullyHeld ? (
                      <span style={{
                        background: `linear-gradient(135deg, ${T.blueDim}, ${T.blueMid})`,
                        color: T.blue,
                        border: `1px solid ${T.blue}`,
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 800,
                        fontFamily: T.fontSans,
                        boxShadow: `0 0 10px ${T.blue}40`,
                      }}>
                        ✓ เปิด Position นี้ไปแล้ว (ถืออยู่ในพอร์ต)
                      </span>
                    ) : opp.isPutHeld ? (
                      <span style={{
                        background: T.amberDim,
                        color: T.amber,
                        border: `1px solid ${T.amber}60`,
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 800,
                      }}>
                        ✓ มี Put ในพอร์ตแล้ว
                      </span>
                    ) : opp.isCallHeld ? (
                      <span style={{
                        background: T.blueDim,
                        color: T.blue,
                        border: `1px solid ${T.blue}60`,
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 800,
                      }}>
                        ✓ มี Call ในพอร์ตแล้ว
                      </span>
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
                          ? (opp.isFullyHeld ? "ENTRY DECISION: BLOCKED (ถืออยู่ในพอร์ตแล้ว)" : "ENTRY DECISION: BLOCKED")
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

                  {evaluation.reasons.length > 0 && !isChecklistOpen && (
                    <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, marginTop: 2, lineHeight: 1.4 }}>
                      {evaluation.reasons.slice(0, 2).map((r, i) => (
                        <div key={i}>{r}</div>
                      ))}
                    </div>
                  )}

                  {isChecklistOpen && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                      {evaluation.checks.map((chk, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontFamily: T.fontSans }}>
                          <span style={{ color: T.textSecondary }}>{chk.icon} {chk.rule}:</span>
                          <span style={{
                            color: chk.status === "PASS" ? T.green : chk.status === "WARNING" ? T.amber : chk.status === "BLOCKED" ? T.red : T.red,
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
                  <div style={{
                    background: isTopPick ? "rgba(0, 240, 168, 0.08)" : T.bg2,
                    border: `1px solid ${isTopPick ? T.green + "44" : T.green + "28"}`,
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
                        <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans }}>SAFETY BUFFER</div>
                        <div style={{ color: T.green, fontFamily: T.font, fontSize: 16, fontWeight: 800 }}>
                          -{opp.putDistancePct}%
                        </div>
                        <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>ต่ำกว่า Spot</div>
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
                        <strong style={{ color: T.green }}>+${opp.putMark}</strong>
                      </div>
                      <div>
                        <span style={{ color: T.textSecondary, fontSize: 9, display: "block" }}>THETA/วัน</span>
                        <strong style={{ color: T.green }}>+${opp.totalTheta}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
                        <span>Mark: <strong style={{ color: T.green }}>+${opp.putMark}</strong></span>
                      </div>
                    </div>

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
                        <span>Mark: <strong style={{ color: T.green }}>+${opp.callMark}</strong></span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Strategy Summary Metrics */}
                <div style={{
                  background: isTopPick ? "rgba(0, 240, 168, 0.06)" : T.bg2,
                  borderRadius: 8, padding: "12px 14px",
                  display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10,
                  border: `1px solid ${isTopPick ? T.green + "33" : T.border}`,
                }}>
                  <div>
                    <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>
                      {isShortPut ? "PREMIUM รับสุทธิ" : "PREMIUM รวม"}
                    </div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 17, fontWeight: 800 }}>
                      +${opp.totalPremium} <span style={{ fontSize: 10, color: T.textSecondary, fontWeight: 400 }}>/ 1 BTC</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>THETA DECAY</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 15, fontWeight: 700 }}>
                      +${opp.totalTheta} <span style={{ fontSize: 10, color: T.textSecondary, fontWeight: 400 }}>/ วัน</span>
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>
                      EST. ANNUAL YIELD
                    </div>
                    <div style={{ color: apy >= 65 ? T.amber : T.green, fontFamily: T.font, fontSize: 15, fontWeight: 800 }}>
                      ~{apy}% annualized ROM*
                    </div>
                  </div>
                </div>

                {/* Position Sizing Section */}
                {sizing.available && (
                  <div style={{
                    background: isTopPick ? "rgba(5, 8, 12, 0.6)" : `linear-gradient(135deg, ${T.bg2}, ${T.bg3})`,
                    border: `1px solid ${T.blue}24`,
                    borderRadius: 8, padding: "12px 14px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ color: T.blue, fontWeight: 700, fontSize: 10, letterSpacing: 1.5, fontFamily: T.fontSans }}>
                        📐 POSITION SIZING (คำนวณตามพอร์ตจริง)
                      </span>
                      {sizing.recommendedLot && !evaluation.isBlocked && (
                        <Pill color={T.green}>
                          ★ แนะนำ {sizing.recommendedLot.label} BTC
                        </Pill>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontSans, marginRight: 2 }}>เลือกขนาด:</span>
                      {sizing.lots.filter(l => l.canAfford || l.size <= 0.05).map(lot => {
                        const isSelected = lot.size === chosenSize;
                        const isRec = sizing.recommendedLot?.size === lot.size && !evaluation.isBlocked;
                        return (
                          <button
                            key={lot.size}
                            disabled={!lot.canAfford}
                            onClick={() => {
                              SoundFX.playClick();
                              setSelectedSize(prev => ({ ...prev, [opp.id]: lot.size }));
                            }}
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
                            {lot.label} {isRec && <span style={{ color: T.green, marginLeft: 2, fontSize: 10 }}>★</span>}
                          </button>
                        );
                      })}
                    </div>

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
                        </div>
                        <div>
                          <div style={{ color: T.textSecondary, fontSize: 8, letterSpacing: 1, fontFamily: T.fontSans }}>PREMIUM รับ</div>
                          <div style={{ color: T.green, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
                            +${chosenLot.premiumReceived.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Action Buttons Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: "auto" }}>
                  <button
                    onClick={() => {
                      SoundFX.playClick();
                      onOpenPayoff?.({ ...opp, suggestedSize: chosenSize });
                    }}
                    style={{
                      background: T.bg2,
                      border: `1px solid ${T.blue}40`,
                      color: T.blue,
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: "pointer",
                      fontFamily: T.fontSans,
                      fontSize: 12,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <span>📊</span>
                    <span>PAYOFF SIMULATOR</span>
                  </button>

                  <button
                    onClick={() => handleSimulate(opp, chosenSize)}
                    style={{
                      background: isSimulated ? T.green : `linear-gradient(135deg, ${T.purpleDim}, ${T.bg2})`,
                      border: `1px solid ${isSimulated ? T.green : T.purple}55`,
                      color: isSimulated ? "#05080c" : T.purple,
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: "pointer",
                      fontFamily: T.fontSans,
                      fontSize: 12,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <span>⚡</span>
                    <span>{isSimulated ? "✓ SIMULATED!" : "PAPER TRADE"}</span>
                  </button>

                  <button
                    onClick={() => {
                      SoundFX.playClick();
                      onAnalyzeStrangle(opp);
                    }}
                    style={{
                      background: T.greenDim,
                      border: `1px solid ${T.greenMid}`,
                      color: T.green,
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: "pointer",
                      fontFamily: T.fontSans,
                      fontSize: 12,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <span>🧠</span>
                    <span>AI ANALYZE</span>
                  </button>

                  <button
                    onClick={() => handleSendTelegram(opp)}
                    disabled={isSending || evaluation.isBlocked}
                    style={{
                      background: isSent ? T.green : isTopPick ? `linear-gradient(135deg, ${T.green}, #00b380)` : evaluation.isBlocked ? T.bg3 : T.bg2,
                      border: `1px solid ${isSent ? T.green : isTopPick ? T.green : T.border}`,
                      color: isSent || isTopPick ? "#05080c" : evaluation.isBlocked ? T.textMuted : T.textPrimary,
                      borderRadius: 8,
                      padding: "9px 12px",
                      cursor: evaluation.isBlocked ? "not-allowed" : "pointer",
                      fontFamily: T.fontSans,
                      fontSize: 12,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      opacity: evaluation.isBlocked ? 0.5 : 1,
                    }}
                  >
                    <span>📨</span>
                    <span>{isSending ? "SENDING..." : isSent ? "✓ SENT" : "SEND TELEGRAM"}</span>
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
