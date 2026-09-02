import { useState, useMemo, useCallback } from "react";
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
  const [expandedCard, setExpandedCard] = useState({});
  const [strategyFilter, setStrategyFilter] = useState("AUTO");
  const [simulatedFeedback, setSimulatedFeedback] = useState(null);
  const [sortMode, setSortMode] = useState("score"); // score | premium | breach
  const [highlightId, setHighlightId] = useState(null);

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
      setTimeout(() => setSentMap(prev => ({ ...prev, [opp.id]: null })), 4000);
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
    if (onOpenPaperTrade) onOpenPaperTrade();
  };

  const toggleChecklist = (id) => {
    SoundFX.playClick();
    setExpandedChecklist(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const toggleCard = (id) => {
    SoundFX.playClick();
    setExpandedCard(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleHighlight = useCallback((id) => {
    setHighlightId(id);
    SoundFX.playClick();
    const el = document.getElementById(`opp-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlightId(null), 2200);
  }, []);

  // Base filtered by strategy tab
  const baseFiltered = useMemo(() => {
    if (!Array.isArray(opportunities)) return [];
    if (strategyFilter === "ALL") return opportunities;
    if (strategyFilter === "AUTO") {
      const allowed = regime?.allowedStrategies || [];
      return opportunities.filter(o => allowed.includes(o.strategy));
    }
    return opportunities.filter(o => o.strategy === strategyFilter);
  }, [opportunities, strategyFilter, regime]);

  // Sorting
  const filteredOpps = useMemo(() => {
    const arr = [...baseFiltered];
    if (sortMode === "premium") return arr.sort((a, b) => (b.totalPremium || 0) - (a.totalPremium || 0));
    if (sortMode === "breach") {
      const breachDist = (o) => {
        const pd = Number(o.putDistancePct);
        const cd = o.callDistancePct != null ? Number(o.callDistancePct) : 999;
        if (o.strategy === "SHORT_PUT") return pd;
        return Math.min(pd, cd);
      };
      return arr.sort((a, b) => breachDist(a) - breachDist(b));
    }
    // score default
    return arr.sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [baseFiltered, sortMode]);

  // Top pick + comparison top 3 (always by score, independent of sortMode for stability)
  const topPickId = useMemo(() => {
    for (const opp of filteredOpps) {
      const evalRes = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
      if (!evalRes.isBlocked && !opp.isFullyHeld) return opp.id;
    }
    return filteredOpps[0]?.id || null;
  }, [filteredOpps, marketContext, accountInfo, currentPositions]);

  const top3 = useMemo(() => {
    const byScore = [...baseFiltered].sort((a, b) => (b.score || 0) - (a.score || 0));
    return byScore.slice(0, 3);
  }, [baseFiltered]);

  return (
    <div style={{ padding: "0 16px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── compact comparison bar (top 3) ─────────────────────────────── */}
      {top3.length > 0 && (
        <div style={{
          background: `linear-gradient(135deg, ${T.bg1}, ${T.bg0})`,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 800, fontSize: 11, letterSpacing: 1 }}>
              ⚡ TOP 3 PICKS — เปรียบเทียบเร็ว (คลิกเพื่อเลื่อน)
            </span>
            <span style={{ color: T.textMuted, fontSize: 10, fontFamily: T.fontSans }}>
              จัดอันดับตาม Score · {baseFiltered.length} สัญญาในโหมด {strategyFilter}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            {top3.map((opp, idx) => {
              const isTop = opp.id === topPickId;
              const rankColor = idx === 0 ? T.green : idx === 1 ? T.blue : T.purple;
              const evalR = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
              return (
                <button
                  key={opp.id}
                  onClick={() => handleHighlight(opp.id)}
                  style={{
                    textAlign: "left",
                    background: isTop ? `${T.greenDim}` : T.bg2,
                    border: `1px solid ${isTop ? T.green : T.border}`,
                    borderLeft: `3px solid ${rankColor}`,
                    borderRadius: 8,
                    padding: "8px 10px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    transition: "all 0.15s",
                    boxShadow: isTop ? `0 0 12px ${T.green}25` : "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: rankColor, fontWeight: 900, fontSize: 11, fontFamily: T.font }}>#{idx + 1} {opp.strategy === "SHORT_PUT" ? "SHORT PUT" : opp.strategy === "SKEWED_STRANGLE" ? "SKEWED" : "STRANGLE"}</span>
                    <span style={{ color: evalR.isBlocked ? T.red : evalR.isWarning ? T.amber : T.green, fontSize: 9, fontWeight: 800, fontFamily: T.fontSans }}>
                      {evalR.isBlocked ? "BLOCKED" : evalR.isWarning ? "WARNING" : "PASS"} · Score {Math.round(opp.score || 0)}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10, fontFamily: T.font, fontSize: 11, flexWrap: "wrap" }}>
                    <span style={{ color: T.green, fontWeight: 800 }}>${opp.totalPremium} prem</span>
                    <span style={{ color: T.textSecondary }}>{opp.dte}d</span>
                    <span style={{ color: T.textMuted }}>{opp.expiry}</span>
                  </div>
                  <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.font }}>
                    Put {fmtUSD(opp.putStrike)} <span style={{ color: T.textMuted }}>Δ{opp.putDelta}</span>
                    {opp.callStrike ? <span> · Call {fmtUSD(opp.callStrike)}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── AI Auto-Selected Market Regime Card (kept compact) ─────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
        border: `1px solid ${currentOptimal.tagColor}55`,
        borderLeft: `4px solid ${currentOptimal.tagColor}`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: `0 4px 20px rgba(0,0,0,0.3), 0 0 16px ${currentOptimal.tagColor}12`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14 }}>🧭</span>
              <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 900, fontSize: 11, letterSpacing: 1.2 }}>RULE-BASED MARKET REGIME</span>
              <span style={{
                background: `${currentOptimal.tagColor}22`, color: currentOptimal.tagColor,
                border: `1px solid ${currentOptimal.tagColor}60`, borderRadius: 6, padding: "1px 6px",
                fontSize: 9, fontWeight: 900, fontFamily: T.font, letterSpacing: 0.8,
              }}>{regime?.label || currentOptimal.tag} · {regime?.confidence ?? 0}% {currentOptimal.metrics?.dataComplete ? "(AUTO)" : "(WAIT)"}</span>
            </div>
            <div style={{ color: T.textSecondary, fontSize: 12, fontFamily: T.fontSans, lineHeight: 1.5 }}>{currentOptimal.rationale}</div>
          </div>
          <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 12px", display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 180 }}>
            <div style={{ color: T.textSecondary, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>{regime?.isNoTrade ? "REGIME ACTION" : "PROFILE TARGET"}</div>
            <div style={{ color: currentOptimal.tagColor, fontFamily: T.font, fontSize: 13, fontWeight: 900, marginTop: 2, textAlign: "right" }}>
              {regime?.isNoTrade ? "NO_TRADE" : `Δ ${activeProfile.deltaMin}–${activeProfile.deltaMax} / DTE ${activeProfile.dtePreferredMin}–${activeProfile.dtePreferredMax}d`}
            </div>
          </div>
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}`,
        }}>
          {[
            ["MARKET TREND (VS MA20)", marketContext.distFromMA20 == null ? "N/A" : `${marketContext.distFromMA20 >= 0 ? "+" : ""}${marketContext.distFromMA20.toFixed(1)}% ${isBullishRegime ? "🔥 Bull" : isBearishRegime ? "⚠️ Bear" : "⚖️ Sideway"}`, marketContext.distFromMA20 == null ? T.textMuted : marketContext.distFromMA20 >= 0 ? T.green : T.red],
            ["ADX14", marketContext.adx14 != null ? `${Number(marketContext.adx14).toFixed(1)} ${marketContext.adx14 >= 25 ? "Trending" : marketContext.adx14 < 20 ? "Range" : "Transition"}` : "N/A", T.textPrimary],
            ["REALIZED VOL 7D/30D", marketContext.realizedVol7 != null && marketContext.realizedVol30 != null ? `${Number(marketContext.realizedVol7).toFixed(1)}% / ${Number(marketContext.realizedVol30).toFixed(1)}%` : "N/A", T.textPrimary],
            ["OPTION AVG IV", marketIv != null ? `${marketIv}%` : "N/A", marketIv >= 40 ? T.purple : T.blue],
          ].map(([label, val, color]) => (
            <div key={label} style={{ background: T.bg0, padding: "6px 10px", borderRadius: 6, border: `1px solid ${T.border}` }}>
              <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 0.8, fontFamily: T.fontSans }}>{label}</div>
              <div style={{ color, fontFamily: T.font, fontSize: 11, fontWeight: 700, marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ color: T.textMuted, fontSize: 10, lineHeight: 1.4, fontFamily: T.fontSans }}>
        * Annualized ROM ประมาณจาก Mark Price + Margin สมมติ 15–18% ยังไม่รวม spread/slippage/fees — ตรวจราคาจริงบน Binance ก่อนส่งคำสั่ง
      </div>

      {/* ── Strategy Filter + Sort Toggle ───────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", background: T.bg1, padding: 5, borderRadius: 10, border: `1px solid ${T.border}`, flex: 1 }}>
          {[
            { key: "AUTO", label: `🧭 AUTO${regime?.isNoTrade ? " — NO_TRADE" : isBullishRegime ? " — BULL" : ""}`, color: regime?.isNoTrade ? T.red : T.green },
            { key: "SHORT_PUT", label: "🟢 SHORT PUT", color: T.green },
            { key: "SKEWED_STRANGLE", label: "⚡ SKEWED", color: T.blue },
            { key: "STRANGLE", label: "⚖️ STRANGLE", color: T.purple },
            { key: "ALL", label: `ALL (${opportunities.length})`, color: T.textSecondary },
          ].map(tab => {
            const isActive = strategyFilter === tab.key;
            return (
              <button key={tab.key} onClick={() => { SoundFX.playClick(); setStrategyFilter(tab.key); }}
                style={{
                  padding: "6px 10px", borderRadius: 7,
                  border: `1px solid ${isActive ? tab.color : "transparent"}`,
                  background: isActive ? `${tab.color}18` : "transparent",
                  color: isActive ? tab.color : T.textSecondary,
                  fontFamily: T.fontSans, fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>{tab.label}</button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 4, background: T.bg1, padding: 4, borderRadius: 8, border: `1px solid ${T.border}`, alignItems: "center" }}>
          <span style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans, letterSpacing: 0.8, padding: "0 4px" }}>SORT:</span>
          {[
            ["score", "⭐ Score"],
            ["premium", "💰 Premium"],
            ["breach", "📍 Closest Breach"],
          ].map(([key, label]) => (
            <button key={key} onClick={() => { SoundFX.playClick(); setSortMode(key); }}
              style={{
                padding: "5px 10px", borderRadius: 6, fontFamily: T.fontSans, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: sortMode === key ? T.bg2 : "transparent",
                border: `1px solid ${sortMode === key ? T.borderActive : "transparent"}`,
                color: sortMode === key ? T.textPrimary : T.textSecondary,
              }}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── Opportunities Grid ──────────────────────────────────────────── */}
      {filteredOpps.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontFamily: T.fontSans, fontSize: 12, background: T.bg1, borderRadius: 12, border: `1px solid ${T.border}` }}>
          {regime?.isNoTrade ? `⛔ NO_TRADE — ${regime.label}: ${regime.reasons?.[0] || "รอตลาดยืนยันใหม่"}` : "⏳ ไม่พบคู่สัญญาที่ผ่านทั้ง Regime และกฎความเสี่ยง"}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
          {filteredOpps.map((opp) => {
            const isSent = sentMap[opp.id] === "sent";
            const isSending = sentMap[opp.id] === "sending";
            const isShortPut = opp.strategy === "SHORT_PUT";
            const evaluation = evaluateEntryRules(opp, marketContext, accountInfo, currentPositions);
            const sizing = calculatePositionSize(accountInfo, opp, btcPrice, evaluation.sizeMultiplier);
            const chosenSize = selectedSize[opp.id] ?? (sizing.defaultLot?.size ?? 0.01);
            const chosenLot = sizing.lots?.find(l => l.size === chosenSize) || sizing.defaultLot;
            const isChecklistOpen = Boolean(expandedChecklist[opp.id]);
            const isCardOpen = Boolean(expandedCard[opp.id]);
            const isSimulated = simulatedFeedback === opp.id;
            const isTopPick = opp.id === topPickId && !evaluation.isBlocked && !opp.isFullyHeld;
            const isHighlighted = highlightId === opp.id;
            const apy = opp.annualizedYield || (opp.totalPremium ? Math.round((opp.totalPremium / (btcPrice * 0.18)) * (365 / (opp.dte || 14)) * 100) : 45);
            const beText = isShortPut ? fmtUSD(opp.breakevenLow) : `${fmtUSD(opp.breakevenLow)} / ${fmtUSD(opp.breakevenHigh)}`;
            const breachLabel = isShortPut ? `-${opp.putDistancePct}%` : `-${opp.putDistancePct}% / +${opp.callDistancePct}%`;

            return (
              <div
                key={opp.id}
                id={`opp-${opp.id}`}
                style={{
                  background: isHighlighted ? `linear-gradient(180deg, ${T.greenDim}, ${T.bg0})` : isTopPick ? `linear-gradient(135deg, rgba(0,240,168,0.12) 0%, ${T.bg0} 100%)` : `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
                  border: isHighlighted ? `2px solid ${T.green}` : isTopPick ? `1.5px solid ${T.green}` : `1px solid ${evaluation.isBlocked ? T.red + "30" : evaluation.isPassed ? (opp.badgeColor || T.greenMid) : T.border}`,
                  borderRadius: 12,
                  padding: 14,
                  display: "flex", flexDirection: "column", gap: 8,
                  boxShadow: isHighlighted ? `0 0 20px ${T.green}55` : isTopPick ? `0 6px 20px rgba(0,240,168,0.18)` : "0 3px 12px rgba(0,0,0,0.2)",
                  position: "relative",
                  transition: "all 0.2s ease",
                }}
              >
                {/* APY pill */}
                <div style={{
                  position: "absolute", top: -9, right: 12,
                  background: apy >= 65 ? `linear-gradient(135deg, ${T.amber}, #d97706)` : `linear-gradient(135deg, ${T.green}, #00b380)`,
                  color: "#05080c", padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 900, fontFamily: T.font,
                  boxShadow: `0 0 10px ${apy >= 65 ? "rgba(251,191,36,0.4)" : "rgba(0,240,168,0.3)"}`, letterSpacing: 0.4,
                }}>{apy >= 65 ? "⚠️" : "◈"} ~{apy}% ROM*</div>

                {isTopPick && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: `linear-gradient(90deg, ${T.green}, #00b380)`, color: "#05080c",
                    padding: "4px 10px", borderRadius: 6, fontWeight: 900, fontSize: 10, letterSpacing: 0.8, fontFamily: T.fontSans,
                  }}>
                    <span>⭐ TOP PICK — ต้องตรวจราคา/Margin จริงก่อน</span>
                    <span style={{ background: "#05080c", color: T.green, padding: "1px 6px", borderRadius: 4, fontSize: 9, fontFamily: T.font }}>#1</span>
                  </div>
                )}

                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, paddingBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Pill color={opp.badgeColor || T.green}>{opp.badgeText || opp.strategyName}</Pill>
                    <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 700, fontSize: 12 }}>{opp.expiry}</span>
                    <Pill color={opp.isPreferredDTE ? T.green : opp.isIdealDTE ? T.blue : T.textSecondary}>{opp.dte}d {opp.isPreferredDTE ? "★" : opp.isIdealDTE ? "IDEAL" : ""}</Pill>
                    {opp.isFullyHeld ? <span style={{ background: T.blueDim, color: T.blue, border: `1px solid ${T.blue}60`, borderRadius: 5, padding: "1px 6px", fontSize: 10, fontWeight: 800 }}>✓ Held</span> : opp.isPutHeld || opp.isCallHeld ? <span style={{ background: T.amberDim, color: T.amber, border: `1px solid ${T.amber}60`, borderRadius: 5, padding: "1px 6px", fontSize: 10, fontWeight: 800 }}>✓ 1 Leg Held</span> : null}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: T.textMuted, fontSize: 9, fontFamily: T.fontSans }}>BTC {fmtUSD(opp.btcPrice)}</span>
                    <button onClick={() => toggleCard(opp.id)} style={{
                      background: isCardOpen ? T.bg2 : "transparent", border: `1px solid ${T.border}`, color: T.textSecondary,
                      borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: T.fontSans, fontSize: 10, fontWeight: 700,
                    }}>{isCardOpen ? "▲ Collapse" : "▼ Details"}</button>
                  </div>
                </div>

                {/* Quick summary row — always visible, large numbers */}
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6,
                  background: isTopPick ? "rgba(0,240,168,0.06)" : T.bg2, borderRadius: 8, padding: "8px 10px",
                  border: `1px solid ${isTopPick ? T.green + "28" : T.border}`,
                }}>
                  <div>
                    <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 0.8, fontFamily: T.fontSans }}>PREMIUM</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 15, fontWeight: 900, lineHeight: 1.1 }}>+${opp.totalPremium}</div>
                    <div style={{ color: T.textMuted, fontSize: 8, fontFamily: T.fontSans }}>/1 BTC</div>
                  </div>
                  <div>
                    <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 0.8, fontFamily: T.fontSans }}>THETA / วัน</div>
                    <div style={{ color: T.green, fontFamily: T.font, fontSize: 15, fontWeight: 900, lineHeight: 1.1 }}>+${opp.totalTheta}</div>
                    <div style={{ color: T.textMuted, fontSize: 8, fontFamily: T.fontSans }}>decay</div>
                  </div>
                  <div>
                    <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 0.8, fontFamily: T.fontSans }}>BREAKEVEN</div>
                    <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 11, fontWeight: 800, lineHeight: 1.2 }}>{beText}</div>
                    <div style={{ color: T.textMuted, fontSize: 8, fontFamily: T.fontSans }} title={breachLabel}>{breachLabel}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: T.textMuted, fontSize: 8, letterSpacing: 0.8, fontFamily: T.fontSans }}>SCORE / DTE</div>
                    <div style={{ color: T.amber, fontFamily: T.font, fontSize: 13, fontWeight: 900, lineHeight: 1.1 }}>{Math.round(opp.score || 0)}</div>
                    <div style={{ color: T.textSecondary, fontSize: 9, fontFamily: T.font }}>{opp.dte}d · {opp.isPreferredDTE ? "FAST Θ" : `${Math.round(opp.annualizedYield || apy)}%`}</div>
                  </div>
                </div>
                {/* Spread / Liquidity small text */}
                {(opp.spreadPct != null || opp.maxSpreadPct != null || opp.putSpreadPct != null) && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontFamily: "JetBrains Mono, monospace", fontSize: 9, color: (()=>{ const s = opp.maxSpreadPct ?? opp.spreadPct ?? opp.putSpreadPct ?? 0; if(s>5) return "#ef4444"; if(s>=3) return "#f59e0b"; return "#6b7280"; })(), marginTop: 2 }}>
                    {opp.strategy === "SHORT_PUT" ? (
                      <span>Spread {opp.spreadPct != null ? opp.spreadPct.toFixed(1) : "—"}%{opp.bidPrice!=null&&opp.askPrice!=null?` · Bid ${opp.bidPrice} / Ask ${opp.askPrice}`:""} {opp.volume!=null?` · Vol ${opp.volume}`:""}</span>
                    ) : (
                      <span>Spread Put {opp.putSpreadPct != null ? opp.putSpreadPct.toFixed(1) : "—"}% · Call {opp.callSpreadPct != null ? opp.callSpreadPct.toFixed(1) : "—"}% · Max {opp.maxSpreadPct != null ? opp.maxSpreadPct.toFixed(1) : "—"}%</span>
                    )}
                    <span style={{ color: (()=>{ const s = opp.maxSpreadPct ?? opp.spreadPct ?? 0; if(s>5) return "#ef4444"; if(s>=3) return "#f59e0b"; return "#10b981"; })() }}>{(()=>{ const s = opp.maxSpreadPct ?? opp.spreadPct ?? 0; if(s>5) return "⛔ Low Liquidity"; if(s>=3) return "⚠️ Medium"; if(s!=null) return "✓ Liquid"; return ""; })()}</span>
                  </div>
                )}

                {/* Decision banner — compact */}
                <div style={{
                  background: evaluation.isBlocked ? T.redDim : evaluation.isWarning ? T.amberDim : T.greenDim,
                  border: `1px solid ${evaluation.isBlocked ? T.red + "30" : evaluation.isWarning ? T.amber + "30" : T.greenMid}`,
                  borderRadius: 7, padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, color: evaluation.isBlocked ? T.red : evaluation.isWarning ? T.amber : T.green, fontFamily: T.fontSans, fontWeight: 800, fontSize: 10 }}>
                      <span>{evaluation.isBlocked ? "❌" : evaluation.isWarning ? "⚠️" : "✅"}</span>
                      {evaluation.isBlocked ? (opp.isFullyHeld ? "BLOCKED (Held)" : "BLOCKED") : evaluation.isWarning ? `PASS WITH WARNING (${Math.round(evaluation.sizeMultiplier * 100)}%)` : "PASS (100%)"}
                    </span>
                    <button onClick={() => toggleChecklist(opp.id)} style={{
                      background: "none", border: "none", color: T.textSecondary, cursor: "pointer", fontFamily: T.fontSans, fontSize: 10, textDecoration: "underline", whiteSpace: "nowrap",
                    }}>{isChecklistOpen ? "ซ่อน Checklist ▲" : "Checklist ▼"}</button>
                  </div>
                  {!isChecklistOpen && evaluation.reasons.length > 0 && (
                    <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans, lineHeight: 1.3 }}>{evaluation.reasons.slice(0, 1).map((r, i) => <div key={i}>{r}</div>)}</div>
                  )}
                  {isChecklistOpen && (
                    <div style={{ marginTop: 4, paddingTop: 6, borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 4 }}>
                      {evaluation.checks.map((chk, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, fontFamily: T.fontSans, gap: 8 }}>
                          <span style={{ color: T.textSecondary }}>{chk.icon} {chk.rule}</span>
                          <span style={{ color: chk.status === "PASS" ? T.green : chk.status === "WARNING" ? T.amber : T.red, fontFamily: T.font, fontWeight: 600, textAlign: "right" }}>{chk.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Expandable details — legs + sizing */}
                {isCardOpen && (
                  <>
                    {isShortPut ? (
                      <div style={{ background: isTopPick ? "rgba(0,240,168,0.06)" : T.bg2, border: `1px solid ${isTopPick ? T.green + "33" : T.green + "22"}`, borderLeft: `3px solid ${T.green}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ color: T.green, fontWeight: 800, fontSize: 10, letterSpacing: 0.8, fontFamily: T.fontSans }}>SHORT PUT</div>
                            <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 17, fontWeight: 800 }}>{fmtUSD(opp.putStrike)}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: T.textSecondary, fontSize: 9, fontFamily: T.fontSans }}>BUFFER</div>
                            <div style={{ color: T.green, fontFamily: T.font, fontSize: 13, fontWeight: 800 }}>-{opp.putDistancePct}%</div>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, background: T.bg1, padding: "6px 8px", borderRadius: 6, fontSize: 10, fontFamily: T.font }}>
                          <div><span style={{ color: T.textSecondary, fontSize: 8, display: "block" }}>DELTA</span><strong style={{ color: T.amber }}>{opp.putDelta}</strong></div>
                          <div><span style={{ color: T.textSecondary, fontSize: 8, display: "block" }}>IV</span><strong style={{ color: T.purple }}>{opp.putIV}%</strong></div>
                          <div><span style={{ color: T.textSecondary, fontSize: 8, display: "block" }}>MARK</span><strong style={{ color: T.green }}>+${opp.putMark}</strong></div>
                          <div><span style={{ color: T.textSecondary, fontSize: 8, display: "block" }}>THETA</span><strong style={{ color: T.green }}>+${opp.totalTheta}</strong></div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div style={{ background: T.bg2, border: `1px solid ${T.amber}22`, borderLeft: `3px solid ${T.amber}`, borderRadius: 7, padding: 9 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ color: T.amber, fontWeight: 700, fontSize: 10, fontFamily: T.fontSans }}>PUT</span>
                            <span style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.font }}>-{opp.putDistancePct}%</span>
                          </div>
                          <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 15, fontWeight: 800 }}>{fmtUSD(opp.putStrike)}</div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: T.textSecondary, fontFamily: T.font }}>
                            <span>Δ <strong style={{ color: T.amber }}>{opp.putDelta}</strong></span>
                            <span>+${opp.putMark}</span>
                          </div>
                        </div>
                        <div style={{ background: T.bg2, border: `1px solid ${T.blue}22`, borderLeft: `3px solid ${T.blue}`, borderRadius: 7, padding: 9 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ color: T.blue, fontWeight: 700, fontSize: 10, fontFamily: T.fontSans }}>{opp.strategy === "SKEWED_STRANGLE" ? "WIDE CALL" : "CALL"}</span>
                            <span style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.font }}>+{opp.callDistancePct}%</span>
                          </div>
                          <div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 15, fontWeight: 800 }}>{fmtUSD(opp.callStrike)}</div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: T.textSecondary, fontFamily: T.font }}>
                            <span>Δ <strong style={{ color: T.blue }}>+{opp.callDelta}</strong></span>
                            <span>+${opp.callMark}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sizing — inside expanded area now */}
                    {sizing.available && (
                      <div style={{ background: `linear-gradient(135deg, ${T.bg2}, ${T.bg3})`, border: `1px solid ${T.blue}18`, borderRadius: 7, padding: "8px 10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ color: T.blue, fontWeight: 700, fontSize: 9, letterSpacing: 1, fontFamily: T.fontSans }}>📐 SIZING</span>
                          {sizing.recommendedLot && !evaluation.isBlocked && <Pill color={T.green}>★ {sizing.recommendedLot.label} BTC</Pill>}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                          {sizing.lots.filter(l => l.canAfford || l.size <= 0.05).map(lot => {
                            const isSelected = lot.size === chosenSize;
                            const isRec = sizing.recommendedLot?.size === lot.size && !evaluation.isBlocked;
                            return (
                              <button key={lot.size} disabled={!lot.canAfford}
                                onClick={() => { SoundFX.playClick(); setSelectedSize(prev => ({ ...prev, [opp.id]: lot.size })); }}
                                style={{
                                  padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontFamily: T.font, fontSize: 10, fontWeight: 700,
                                  background: isSelected ? (lot.canAfford ? T.greenDim : T.redDim) : T.bg1,
                                  border: `1px solid ${isSelected ? (lot.canAfford ? T.greenMid : T.red + "33") : T.border}`,
                                  color: isSelected ? (lot.canAfford ? T.green : T.red) : (lot.canAfford ? T.textSecondary : T.textMuted),
                                  opacity: lot.canAfford ? 1 : 0.45,
                                }}>{lot.label} {isRec && "★"}</button>
                            );
                          })}
                        </div>
                        {chosenLot && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, background: T.bg1, borderRadius: 6, padding: "7px 10px" }}>
                            <div><div style={{ color: T.textSecondary, fontSize: 7, letterSpacing: 0.8, fontFamily: T.fontSans }}>SIZE</div><div style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 12, fontWeight: 700 }}>{chosenLot.label} BTC</div></div>
                            <div><div style={{ color: T.textSecondary, fontSize: 7, letterSpacing: 0.8, fontFamily: T.fontSans }}>MARGIN ≈</div><div style={{ color: T.amber, fontFamily: T.font, fontSize: 12, fontWeight: 700 }}>${chosenLot.marginRequired.toLocaleString()}</div></div>
                            <div><div style={{ color: T.textSecondary, fontSize: 7, letterSpacing: 0.8, fontFamily: T.fontSans }}>PREMIUM</div><div style={{ color: T.green, fontFamily: T.font, fontSize: 12, fontWeight: 700 }}>+${chosenLot.premiumReceived.toLocaleString()}</div></div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Size quick hint when collapsed + sizing available */}
                {!isCardOpen && sizing.available && chosenLot && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", color: T.textMuted, fontSize: 10, fontFamily: T.fontSans }}>
                    <span>Size: <strong style={{ color: T.textPrimary, fontFamily: T.font }}>{chosenLot.label} BTC</strong> · Margin ~${chosenLot.marginRequired.toLocaleString()} · Premium +${chosenLot.premiumReceived.toLocaleString()}</span>
                    <button onClick={() => toggleCard(opp.id)} style={{ background: "none", border: `1px solid ${T.border}`, color: T.blue, borderRadius: 5, padding: "2px 6px", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>Edit size</button>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: "auto" }}>
                  <button onClick={() => { SoundFX.playClick(); onOpenPayoff?.({ ...opp, suggestedSize: chosenSize }); }}
                    style={{ background: T.bg2, border: `1px solid ${T.blue}33`, color: T.blue, borderRadius: 7, padding: "7px 8px", cursor: "pointer", fontFamily: T.fontSans, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <span>📊</span> PAYOFF
                  </button>
                  <button onClick={() => handleSimulate(opp, chosenSize)}
                    style={{ background: isSimulated ? T.green : `linear-gradient(135deg, ${T.purpleDim}, ${T.bg2})`, border: `1px solid ${isSimulated ? T.green : T.purple}44`, color: isSimulated ? "#05080c" : T.purple, borderRadius: 7, padding: "7px 8px", cursor: "pointer", fontFamily: T.fontSans, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <span>⚡</span> {isSimulated ? "✓ SIMULATED" : "PAPER TRADE"}
                  </button>
                  <button onClick={() => { SoundFX.playClick(); onAnalyzeStrangle(opp); }}
                    style={{ background: T.greenDim, border: `1px solid ${T.greenMid}`, color: T.green, borderRadius: 7, padding: "7px 8px", cursor: "pointer", fontFamily: T.fontSans, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <span>🧠</span> AI ANALYZE
                  </button>
                  <button onClick={() => handleSendTelegram(opp)} disabled={isSending || evaluation.isBlocked}
                    style={{
                      background: isSent ? T.green : isTopPick ? `linear-gradient(135deg, ${T.green}, #00b380)` : evaluation.isBlocked ? T.bg3 : T.bg2,
                      border: `1px solid ${isSent ? T.green : isTopPick ? T.green : T.border}`,
                      color: isSent || isTopPick ? "#05080c" : evaluation.isBlocked ? T.textMuted : T.textPrimary,
                      borderRadius: 7, padding: "7px 8px", cursor: evaluation.isBlocked ? "not-allowed" : "pointer",
                      fontFamily: T.fontSans, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, opacity: evaluation.isBlocked ? 0.5 : 1,
                    }}>
                    <span>📨</span> {isSending ? "SENDING..." : isSent ? "✓ SENT" : "TELEGRAM"}
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
