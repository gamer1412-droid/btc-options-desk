import { useState, useEffect, useCallback, useRef } from "react";
import { T } from "./tokens.js";
import { fmtUSD, pnlColor } from "./utils.js";
import { mapBinancePosition } from "./services/binance.js";
import {
  sendTelegram,
  checkAlerts,
  checkPortfolioAlerts,
  checkEntryAlerts,
  getPersistedAlerts,
  savePersistedAlert,
  getAlertPreferences,
  saveAlertPreferences,
  ALERT_STORAGE_KEY,
  ENTRY_STORAGE_KEY,
} from "./services/alerts.js";
import { scanEntryOpportunities, determineOptimalMarketProfile } from "./services/scanner.js";
import { parseAccountInfo, calculatePortfolioCapacity } from "./services/sizing.js";
import { loadPaperTrades } from "./services/paperTrading.js";
import { SoundFX } from "./services/soundFx.js";
import { classifyMarketRegime, stabilizeMarketRegime } from "./services/marketRegime.js";
import { recordIv, getIvRank, getIvPercentile } from "./services/ivHistory.js";

import { MetricCard } from "./components/MetricCard.jsx";
import { Pill } from "./components/Pill.jsx";
import { PositionRow, POSITION_GRID_COLS } from "./components/PositionRow.jsx";
import { AnalysisPanel } from "./components/AnalysisPanel.jsx";
import { ScannerTab } from "./components/ScannerTab.jsx";
import { CapacityWidget } from "./components/CapacityWidget.jsx";
import PnlChart from "./components/PnlChart.jsx";
import { LiveTickerTape } from "./components/LiveTickerTape.jsx";
import { SentimentGauge } from "./components/SentimentGauge.jsx";
import { PayoffSimulator } from "./components/PayoffSimulator.jsx";
import { PaperTradingDrawer } from "./components/PaperTradingDrawer.jsx";
import { AlertSettingsModal } from "./components/AlertSettingsModal.jsx";
import { Onboarding } from "./components/Onboarding.jsx";
import { BacktestPanel } from "./components/BacktestPanel.jsx";

const REQUIRED_TOKEN =
  (typeof import.meta !== "undefined" && import.meta.env && (import.meta.env.VITE_APP_ACCESS_TOKEN || import.meta.env.APP_ACCESS_TOKEN)) || "";

const POLL_INTERVAL_MS = 15000; // refresh live data every 15 s

async function readApiJson(response, label) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`${label} ไม่พร้อมใช้งาน (กรุณารันผ่าน Vercel Functions)`);
  }
  const data = await response.json();
  if (!response.ok || data?.error) {
    const message = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(`${data?.code ? `${data.code} — ` : ""}${label}: ${message || `HTTP ${response.status}`}`);
  }
  return data;
}

// ─── Main App (War Room Experience) ───────────────────────────────────────────
export default function App() {
  const [authToken, setAuthToken] = useState(() => {
    try { return localStorage.getItem("app_token") || ""; } catch { return ""; }
  });
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");
  const isAuthed = !REQUIRED_TOKEN || authToken === REQUIRED_TOKEN;

  const [positions, setPositions]               = useState([]);
  const [opportunities, setOpportunities]       = useState([]);
  const [btcPrice, setBtcPrice]                 = useState(null);
  const [marketContext, setMarketContext]       = useState({ price: null, change24h: null, ma20: null, distFromMA20: null, marketIv: null, ivRank: null, regime: null });
  const [marketIv, setMarketIv]                 = useState(null);
  const [optionMarks, setOptionMarks]           = useState([]);
  const [connError, setConnError]               = useState(null);
  const [dataStatus, setDataStatus]             = useState("loading"); // loading | live | partial | offline
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [lastSync, setLastSync]                 = useState(null);
  const [analyzing, setAnalyzing]               = useState(null);
  const [tab, setTab]                           = useState("positions"); // "positions" | "scanner" | "rules" | "backtest"
  const [alertPrefs, setAlertPrefs]             = useState(() => getAlertPreferences());
  const [alertModalOpen, setAlertModalOpen]     = useState(false);
  const [accountInfo, setAccountInfo]           = useState(null);
  const [isMuted, setIsMuted]                   = useState(() => SoundFX.isMuted());
  const [payoffSetup, setPayoffSetup]           = useState(null);
  const [paperModalOpen, setPaperModalOpen]     = useState(false);
  const [paperCount, setPaperCount]             = useState(0);
  const [optimalProfile, setOptimalProfile]     = useState(null);
  const [showOnboarding, setShowOnboarding]     = useState(false);

  const alertedIdsRef = useRef(getPersistedAlerts(ALERT_STORAGE_KEY));
  const alertedEntryIdsRef = useRef(getPersistedAlerts(ENTRY_STORAGE_KEY));
  const regimeStateRef = useRef(null);

  // Refresh active paper trades count
  const refreshPaperCount = useCallback(() => {
    const list = loadPaperTrades();
    setPaperCount(list.filter(t => t.status === "OPEN").length);
  }, []);

  useEffect(() => {
    refreshPaperCount();
  }, [refreshPaperCount, paperModalOpen]);

  const handleUnlock = (e) => {
    e.preventDefault();
    if (tokenInput === REQUIRED_TOKEN) {
      try { localStorage.setItem("app_token", tokenInput); } catch {}
      document.cookie = `app_token=${encodeURIComponent(tokenInput)}; path=/; max-age=2592000; SameSite=Lax`;
      setAuthToken(tokenInput);
      setAuthError("");
    } else {
      setAuthError("Token ไม่ถูกต้อง");
    }
  };

  const handleLogout = () => {
    try { localStorage.removeItem("app_token"); } catch {}
    document.cookie = "app_token=; path=/; max-age=0";
    setAuthToken("");
    setTokenInput("");
  };

  const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const fetchLiveData = useCallback(async () => {
    if (REQUIRED_TOKEN && !isAuthed) return;
    try {
      const [marketData, posData, marksData, acctData] = await Promise.all([
        fetch("/api/binance?action=btcMarketContext", { headers: authHeaders })
          .then(res => readApiJson(res, "Market Context"))
          .catch(() => fetch("/api/binance?action=btcPrice", { headers: authHeaders }).then(res => readApiJson(res, "BTC Price"))),
        // Private endpoints: fetch Binance user positions and account
        fetch("/api/binance?action=optionPositions", { headers: authHeaders })
          .then(res => readApiJson(res, "Options Positions"))
          .catch(error => ({ error: error.message || "Options Positions unavailable" })),
        fetch("/api/binance?action=optionMarks", { headers: authHeaders })
          .then(res => readApiJson(res, "Options Market"))
          .catch(error => ({ error: error.message || "Options Market unavailable" })),
        fetch("/api/binance?action=optionAccount", { headers: authHeaders })
          .then(res => readApiJson(res, "Options Account"))
          .catch(() => null),
      ]);

      const dataWarnings = [];
      if (posData?.error) dataWarnings.push(`Positions: ${typeof posData.error === "string" ? posData.error : "ยังไม่ได้ตั้งค่าการยืนยันตัวตน"}`);
      if (marksData?.error) dataWarnings.push(`Option Chain: ${typeof marksData.error === "string" ? marksData.error : "ยังโหลดข้อมูลไม่ได้"}`);

      if (Array.isArray(marksData)) setOptionMarks(marksData);

      // ── Account info ──────────────────────────────────────────────────────
      let parsedAccount = null;
      if (acctData && !acctData.error) {
        parsedAccount = parseAccountInfo(acctData);
        if (parsedAccount) setAccountInfo(parsedAccount);
      }

      // ── BTC spot price & Market Context ──────────────────────────────────
      const currentBtcPrice = marketData.price || null;
      if (currentBtcPrice) setBtcPrice(currentBtcPrice);

      // ── Market IV (average of all available option marks) ──────────────────
      let currentMarketIv = null;
      if (Array.isArray(marksData) && marksData.length > 0) {
        const ivValues = marksData
          .map(m => parseFloat(m.markIV))
          .filter(v => !isNaN(v) && v > 0);
        if (ivValues.length > 0) {
          const avgIV = ivValues.reduce((s, v) => s + v, 0) / ivValues.length;
          currentMarketIv = Math.round(avgIV * 100);
          setMarketIv(currentMarketIv);
          // Record IV history for Rank / Percentile (rolling 90-day, capped at 90)
          try { recordIv(currentMarketIv); } catch {}
        }
      }

      // Derive IV Rank / Percentile from rolling history
      let derivedIvRank = null;
      let derivedIvPercentile = null;
      if (currentMarketIv != null) {
        try {
          derivedIvRank = getIvRank(currentMarketIv);
          derivedIvPercentile = getIvPercentile(currentMarketIv);
        } catch {}
      }

      const updatedMarketContext = {
        price: currentBtcPrice,
        change24h: marketData.change24h ?? null,
        ma20: marketData.ma20 ?? null,
        distFromMA20: marketData.distFromMA20 ?? null,
        ema20: marketData.ema20 ?? marketData.ma20 ?? null,
        ema50: marketData.ema50 ?? null,
        distFromEMA20: marketData.distFromEMA20 ?? marketData.distFromMA20 ?? null,
        distFromEMA50: marketData.distFromEMA50 ?? null,
        adx14: marketData.adx14 ?? null,
        realizedVol7: marketData.realizedVol7 ?? null,
        realizedVol30: marketData.realizedVol30 ?? null,
        marketIv: currentMarketIv,
        ivRank: derivedIvRank,
        ivPercentile: derivedIvPercentile,
      };
      const candidateRegime = classifyMarketRegime(updatedMarketContext);
      regimeStateRef.current = stabilizeMarketRegime(candidateRegime, regimeStateRef.current, 3);
      updatedMarketContext.regime = {
        ...regimeStateRef.current.stable,
        pendingRegime: regimeStateRef.current.pendingRegime,
        pendingCount: regimeStateRef.current.pendingCount,
      };
      setMarketContext(updatedMarketContext);

      // ── Build Greeks / Mark Lookup Map ────────────────────────────────────
      const marksMap = new Map();
      if (Array.isArray(marksData)) {
        for (const m of marksData) {
          if (m.symbol) marksMap.set(m.symbol, m);
        }
      }

      // ── Option positions ────────────────────────────────────────────────────
      let mappedPositions = [];
      if (Array.isArray(posData)) {
        mappedPositions = posData
          .filter(p => Number(p.quantity || p.positionAmount) !== 0)
          .map(p => mapBinancePosition(p, marksMap.get(p.symbol) || {}));
        setPositions(mappedPositions);
        setConnError(null);

        if (alertPrefs.enabled) {
          const triggered = checkAlerts(mappedPositions, alertedIdsRef.current, alertPrefs);
          if (triggered.length > 0) {
            SoundFX.playWarningAlert();
          }
          for (const alert of triggered) {
            alertedIdsRef.current.add(alert.alertKey);
            savePersistedAlert(alert.alertKey, ALERT_STORAGE_KEY);
            const pos = alert.pos;
            const pct = pos.premium > 0
              ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;
            sendTelegram("warning", {
              posId: pos.id,
              posType: pos.type,
              strike: pos.strike,
              delta: pos.delta,
              pnl: pos.pnl,
              pctProfit: pct.toFixed(0),
              warningReason: alert.reason,
              alertLevel: alert.alertLevel,
              tacticalAction: alert.tacticalAction,
            });
          }

          // Portfolio-level risk alerts (Margin ceiling & Net delta)
          const portAlerts = checkPortfolioAlerts(mappedPositions, parsedAccount || accountInfo, alertedIdsRef.current, alertPrefs);
          for (const pAlert of portAlerts) {
            alertedIdsRef.current.add(pAlert.alertKey);
            savePersistedAlert(pAlert.alertKey, ALERT_STORAGE_KEY);
            sendTelegram("warning", {
              posId: pAlert.posId,
              posType: pAlert.posType,
              strike: pAlert.posId,
              delta: pAlert.delta,
              pnl: pAlert.pnl,
              pctProfit: pAlert.pctProfit,
              warningReason: pAlert.reason,
              alertLevel: pAlert.alertLevel,
              tacticalAction: pAlert.tacticalAction,
            });
          }
        }
      } else if (posData.error) {
        setConnError(typeof posData.error === "string" ? posData.error : JSON.stringify(posData.error));
      }

      // ── Determine Optimal Risk & Yield Profile from Market Regime ────────
      const autoProfile = determineOptimalMarketProfile(updatedMarketContext, parsedAccount, mappedPositions);
      setOptimalProfile(autoProfile);

      // ── Scan Entry Opportunities (Adaptive Multi-Strategy with Yield Profile) ─
      if (Array.isArray(marksData) && currentBtcPrice) {
        const opps = scanEntryOpportunities(
          marksData,
          currentBtcPrice,
          currentMarketIv,
          mappedPositions,
          updatedMarketContext,
          autoProfile.key
        );
        setOpportunities(opps);

        if (alertPrefs.enabled && opps.length > 0) {
          const newEntrySignals = checkEntryAlerts(opps, alertedEntryIdsRef.current, updatedMarketContext, parsedAccount, mappedPositions, alertPrefs);
          if (newEntrySignals.length > 0) {
            SoundFX.playSuccessChime();
          }
          for (const signal of newEntrySignals) {
            alertedEntryIdsRef.current.add(signal.alertKey);
            savePersistedAlert(signal.alertKey, ENTRY_STORAGE_KEY);
            const signalType = signal.strategy === "SHORT_PUT"
              ? "short_put_signal"
              : signal.strategy === "SKEWED_STRANGLE"
              ? "skewed_strangle_signal"
              : "strangle_signal";
            sendTelegram(signalType, signal);
          }
        }
      }

      setLastSync(new Date());
      setDataStatus(parsedAccount ? "live" : "partial");
      setConnError(dataWarnings.length > 0 ? dataWarnings.join(" — ") : null);
    } catch (e) {
      setDataStatus("offline");
      setConnError(e.message || "ไม่สามารถโหลดข้อมูลล่าสุดได้");
    } finally {
      setLoadingPositions(false);
    }
  }, [alertPrefs, isAuthed, authToken]);

  useEffect(() => {
    if (REQUIRED_TOKEN && !isAuthed) return;
    fetchLiveData();
    const timer = setInterval(fetchLiveData, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchLiveData, isAuthed]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "1") setTab("positions");
      else if (e.key === "2") setTab("scanner");
      else if (e.key === "3") setTab("rules");
      else if (e.key === "4") setTab("backtest");
      else if (e.key.toLowerCase() === "m") {
        const muted = SoundFX.toggleMute();
        setIsMuted(muted);
      } else if (e.key.toLowerCase() === "p") {
        setPaperModalOpen(v => !v);
      } else if (e.key.toLowerCase() === "a") {
        setAlertModalOpen(v => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const totalPnl   = positions.reduce((s, p) => s + p.pnl, 0);
  const totalTheta = positions.reduce((s, p) => s + (Math.abs(p.theta) * (p.size || 1)), 0);
  const warnings   = positions.filter(p => p.status === "warning" || p.status === "danger").length;
  const capacity   = calculatePortfolioCapacity(accountInfo, positions, btcPrice, marketContext, opportunities);
  const hasPositionData = dataStatus === "live" || dataStatus === "partial";

  const tabStyle = (t) => ({
    padding: "10px 20px",
    cursor: "pointer",
    fontFamily: T.fontSans,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 1,
    border: "none",
    borderRadius: "8px 8px 0 0",
    background: tab === t ? `linear-gradient(180deg, ${T.bg2}, ${T.bg1})` : "transparent",
    color: tab === t ? T.green : T.textSecondary,
    borderBottom: tab === t ? `2px solid ${T.green}` : "2px solid transparent",
    boxShadow: tab === t ? `0 -4px 15px rgba(0,240,168,0.12)` : "none",
    transition: "all 0.2s ease",
  });

  if (REQUIRED_TOKEN && !isAuthed) {
    return (
      <div style={{ background: T.bg0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <form onSubmit={handleUnlock} style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 12, padding: 28, width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ color: T.textPrimary, fontWeight: 900, fontSize: 16, letterSpacing: 2, textAlign: "center" }}>⚡ BTC OPTIONS DESK</div>
          <div style={{ color: T.textSecondary, fontSize: 12, textAlign: "center" }}>กรอก Access Token เพื่อปลดล็อก Dashboard</div>
          <input
            type="password"
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            placeholder="APP_ACCESS_TOKEN"
            autoFocus
            style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", color: T.textPrimary, fontFamily: T.font, fontSize: 13, outline: "none" }}
          />
          {authError && <div style={{ color: T.red, fontSize: 12 }}>{authError}</div>}
          <button type="submit" style={{ background: T.green, color: "#05070a", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 800, cursor: "pointer", letterSpacing: 1 }}>UNLOCK</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ background: T.bg0, minHeight: "100vh", color: T.textPrimary, fontFamily: T.fontSans }}>

      {/* ── Top Wall Street Live Ticker Tape ───────────────────────────────── */}
      <LiveTickerTape
        btcPrice={btcPrice}
        marketContext={marketContext}
        marketIv={marketIv}
        topOpportunity={opportunities[0]}
      />

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 24px", background: `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
        borderBottom: `1px solid ${T.border}`,
        position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap", gap: 12,
        backdropFilter: "blur(12px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            background: dataStatus === "live" ? T.green : dataStatus === "partial" ? T.amber : T.red,
            boxShadow: `0 0 12px ${dataStatus === "live" ? T.green : dataStatus === "partial" ? T.amber : T.red}`,
            animation: "neonPulse 2s infinite",
          }} />
          <span style={{ color: T.textPrimary, fontWeight: 900, fontSize: 17, letterSpacing: 2, fontFamily: T.fontSans }}>
            ⚡ BTC OPTIONS DESK
          </span>
          <span style={{
            background: dataStatus === "live" ? T.greenDim : dataStatus === "partial" ? T.amberDim : T.redDim,
            color: dataStatus === "live" ? T.green : dataStatus === "partial" ? T.amber : T.red,
            border: `1px solid ${dataStatus === "live" ? T.greenMid : dataStatus === "partial" ? T.amber + "55" : T.red + "44"}`,
            borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: 1,
          }}>
            {dataStatus === "live" ? "LIVE" : dataStatus === "partial" ? "PARTIAL DATA" : dataStatus === "loading" ? "LOADING" : "OFFLINE"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {lastSync && (
            <span style={{ color: T.textMuted, fontSize: 11, fontFamily: T.font }}>
              Sync: {lastSync.toLocaleTimeString("th-TH")}
            </span>
          )}

          {/* Sound FX Mute/Unmute Toggle */}
          <button
            onClick={() => {
              const muted = SoundFX.toggleMute();
              setIsMuted(muted);
              if (!muted) SoundFX.playSuccessChime();
            }}
            title="Toggle Cyber SFX (Hotkey: M)"
            style={{
              background: isMuted ? T.bg2 : T.greenDim,
              border: `1px solid ${isMuted ? T.border : T.greenMid}`,
              color: isMuted ? T.textMuted : T.green,
              borderRadius: 6, padding: "5px 10px", cursor: "pointer",
              fontFamily: T.fontSans, fontSize: 11, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 5,
              transition: "all 0.2s ease",
            }}
          >
            <span>{isMuted ? "🔇 SFX OFF" : "🔊 SFX ON"}</span>
          </button>

          {/* Paper Trading Sandbox Button */}
          <button
            onClick={() => {
              SoundFX.playClick();
              setPaperModalOpen(true);
            }}
            title="Open Paper Trading Sandbox (Hotkey: P)"
            style={{
              background: paperCount > 0 ? `linear-gradient(135deg, ${T.purpleDim}, ${T.bg2})` : T.bg2,
              border: `1px solid ${paperCount > 0 ? T.purple : T.border}`,
              color: paperCount > 0 ? T.purple : T.textSecondary,
              borderRadius: 6, padding: "5px 10px", cursor: "pointer",
              fontFamily: T.fontSans, fontSize: 11, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 6,
              transition: "all 0.2s ease",
            }}
          >
            <span>🧪 SANDBOX</span>
            {paperCount > 0 && (
              <span style={{
                background: T.purple, color: "#05080c",
                borderRadius: 10, padding: "1px 6px", fontSize: 9, fontWeight: 900,
              }}>
                {paperCount}
              </span>
            )}
          </button>

          {/* Telegram alert engine button */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              id="alerts-toggle"
              onClick={() => {
                SoundFX.playClick();
                setAlertModalOpen(true);
              }}
              title="Configure 24/7 Alerts & Notification Filters (Hotkey: A)"
              style={{
                background: alertPrefs.enabled ? `linear-gradient(135deg, ${T.greenDim}, ${T.bg2})` : T.bg2,
                border: `1px solid ${alertPrefs.enabled ? T.greenMid : T.border}`,
                color: alertPrefs.enabled ? T.green : T.textMuted,
                borderRadius: 6, padding: "5px 10px", cursor: "pointer",
                fontFamily: T.fontSans, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: alertPrefs.enabled ? `0 0 10px ${T.greenDim}` : "none",
                transition: "all 0.2s ease",
              }}
            >
              <span>🔔</span>
              <span>ALERTS {dataStatus === "offline" ? "NO DATA" : alertPrefs.enabled ? "ARMED" : "MUTED"}</span>
              <span style={{
                background: alertPrefs.enabled ? T.green : T.border,
                color: "#05080c", borderRadius: 4, padding: "1px 4px", fontSize: 9, fontWeight: 900
              }}>
                v3.0
              </span>
            </button>
          </div>

          {REQUIRED_TOKEN && (
            <button
              onClick={handleLogout}
              title="Lock dashboard"
              style={{
                background: T.bg2,
                border: `1px solid ${T.border}`,
                color: T.textMuted,
                borderRadius: 6, padding: "5px 10px", cursor: "pointer",
                fontFamily: T.fontSans, fontSize: 11, fontWeight: 700,
              }}
            >
              🔒 LOCK
            </button>
          )}
          <div style={{ textAlign: "right" }}>
            <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1, fontFamily: T.fontSans }}>
              BTC / USDT {marketContext.change24h != null && dataStatus !== "offline" && (
                <span style={{ color: marketContext.change24h >= 0 ? T.green : T.red, fontWeight: 700 }}>
                  ({marketContext.change24h >= 0 ? "+" : ""}{marketContext.change24h}%)
                </span>
              )}
            </div>
            <div style={{ color: T.textPrimary, fontSize: 19, fontWeight: 900, fontFamily: T.font }}>
              {btcPrice ? fmtUSD(btcPrice, 0) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Connection error banner ──────────────────────────────────────────── */}
      {connError && (
        <div style={{ margin: "16px 24px 0", padding: 14, background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 8, color: T.red, fontSize: 12, fontFamily: T.fontSans }}>
          ⚠ ข้อมูลล่าสุดไม่พร้อมใช้งาน: {connError}
          <div style={{ color: T.textSecondary, marginTop: 6, fontSize: 11 }}>
            ตรวจสอบว่าตั้งค่า BINANCE_API_KEY / BINANCE_API_SECRET ใน Vercel Environment Variables แล้ว และ API Key เปิดสิทธิ์ "Enable Reading"
          </div>
        </div>
      )}

      {/* ── Metric Cards & Speedometer Section ────────────────────────────────── */}
      <div style={{ display: "flex", gap: 14, padding: "16px 24px", flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ flex: "2 1 540px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <MetricCard label="Account Equity" value={accountInfo ? fmtUSD(accountInfo.equity, 2) : "N/A"} color={T.blue} sub={accountInfo ? `Margin ${accountInfo.marginPct}% / 35% Hard Max` : "รอข้อมูล Options Account"} />
          <MetricCard label="Available Margin" value={accountInfo ? fmtUSD(accountInfo.availableBalance, 2) : "N/A"} color={T.green} sub={accountInfo ? `Balance ${fmtUSD(accountInfo.balance, 2)}` : "ยังประเมิน Capacity ไม่ได้"} />
          <MetricCard label="Unrealized P&L" value={hasPositionData ? `${totalPnl > 0 ? "+" : ""}${fmtUSD(totalPnl, 2)}` : "N/A"} color={hasPositionData ? pnlColor(totalPnl) : T.textMuted} sub={hasPositionData ? "รวมทุก position" : "รอข้อมูล Positions"} />
          <MetricCard label="Theta / Day" value={hasPositionData ? `+$${totalTheta < 1 ? totalTheta.toFixed(2) : totalTheta.toFixed(1)}` : "N/A"} color={hasPositionData ? T.green : T.textMuted} sub={hasPositionData ? "ค่าประมาณรายวัน" : "รอข้อมูล Greeks"} />
          <MetricCard label="Open Positions" value={hasPositionData ? positions.length : "N/A"} color={T.blue} sub={hasPositionData ? `${positions.filter(p => p.status === "healthy").length} healthy` : "รอข้อมูล Positions"} />
          <MetricCard label="Risk Alerts" value={hasPositionData ? warnings : "N/A"} color={hasPositionData && warnings > 0 ? T.red : T.textMuted} sub={!hasPositionData ? "ยังประเมินไม่ได้" : warnings > 0 ? "ต้องตัดสินใจ" : "ไม่พบ Alert ตามกฎ"} />
        </div>

        {/* IV Rank & Market Volatility Speedometer */}
        <div style={{ flex: "1 1 260px", minWidth: 260 }}>
          <SentimentGauge
            marketIv={marketIv}
            distFromMA20={marketContext.distFromMA20}
            netDelta={positions.reduce((s, p) => s + (p.positionDelta ?? ((p.delta || 0) * (p.size || 1))), 0)}
          />
        </div>
      </div>

      {/* ── Portfolio Capacity & Action Radar Widget ───────────────────────────── */}
      {accountInfo && (
        <div style={{ padding: "0 24px 16px" }}>
          <CapacityWidget capacity={capacity} />
        </div>
      )}

      {/* ── PnL Equity Curve ─────────────────────────────────────────────────── */}
      <div style={{ padding: "0 24px 16px" }}>
        <PnlChart positions={positions} />
      </div>

      {/* ── Tabs Navigation ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, marginLeft: 24, marginRight: 24, gap: 4 }}>
        <button
          id="tab-positions"
          style={tabStyle("positions")}
          onClick={() => {
            SoundFX.playClick();
            setTab("positions");
          }}
        >
          POSITIONS ({positions.length})
        </button>

        <button
          id="tab-scanner"
          style={tabStyle("scanner")}
          onClick={() => {
            SoundFX.playClick();
            setTab("scanner");
          }}
        >
          🎯 ALPHA SCANNER {opportunities.length > 0 && `(${opportunities.length})`}
        </button>

        <button
          id="tab-rules"
          style={tabStyle("rules")}
          onClick={() => {
            SoundFX.playClick();
            setTab("rules");
          }}
        >
          🛡️ RULES v3.0
        </button>
        <button
          id="tab-backtest"
          style={tabStyle("backtest")}
          onClick={() => {
            SoundFX.playClick();
            setTab("backtest");
          }}
        >
          🧪 BACKTEST
        </button>
      </div>

      {/* ── Scanner Tab ──────────────────────────────────────────────────────── */}
      {tab === "scanner" && (
        <div style={{ paddingTop: 20 }}>
          <ScannerTab
            opportunities={opportunities}
            btcPrice={btcPrice}
            marketIv={marketIv}
            marketContext={marketContext}
            accountInfo={accountInfo}
            currentPositions={positions}
            optimalProfile={optimalProfile}
            onAnalyzeStrangle={setAnalyzing}
            onOpenPayoff={(setup) => setPayoffSetup(setup)}
            onOpenPaperTrade={() => refreshPaperCount()}
          />
        </div>
      )}

      {/* ── Positions Tab ────────────────────────────────────────────────────── */}
      {tab === "positions" && (
        <div style={{ padding: "0 0 24px" }}>
          {loadingPositions ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontFamily: T.font, fontSize: 12 }}>กำลังโหลด positions...</div>
          ) : !hasPositionData ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontFamily: T.font, fontSize: 12 }}>ยังไม่มีข้อมูล positions ที่ยืนยันได้</div>
          ) : positions.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontFamily: T.font, fontSize: 12 }}>ไม่มี open positions ในขณะนี้</div>
          ) : (
            <>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <div
                  className="positions-header-desktop"
                  style={{
                    display: "grid", gridTemplateColumns: POSITION_GRID_COLS,
                    gap: 0, padding: "8px 16px", background: T.bg1,
                    borderBottom: `1px solid ${T.border}`, minWidth: 690,
                  }}
                >
                  {["TYPE", "STRIKE", "DTE", "DELTA", "THETA", "IV", "RECEIVED", "P&L", "STATUS", ""].map(h => (
                    <span key={h} style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2, fontFamily: T.font }}>{h}</span>
                  ))}
                </div>
                <div style={{ minWidth: 690 }} className="positions-rows-desktop">
                  {positions.map(pos => (
                    <PositionRow
                      key={pos.id}
                      pos={pos}
                      onAnalyze={setAnalyzing}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Rules Tab v2.5 ───────────────────────────────────────────────────── */}
      {tab === "rules" && (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 840 }}>
          <div style={{ background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`, border: `1px solid ${T.greenMid}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🛡️</span>
              <span style={{ color: T.green, fontFamily: T.font, fontWeight: 700, fontSize: 13, letterSpacing: 2 }}>
                BTC OPTION DESK — PRODUCTION TRADING RULES & MARKET REGIME SPECIFICATION v3.0
              </span>
            </div>
            <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.6, fontFamily: "'Inter', sans-serif" }}>
              ระบบถูกออกแบบเพื่อสร้าง <strong>Optimal Capital Velocity & High Yield Harvesting</strong> โดยมี 3 Risk Profiles ให้เลือกใช้ตามสภาวะตลาด พร้อมระบบคุม Tail Risk, Margin 30% Caution และ 35% Hard Cap
            </div>
          </div>

          {[
            {
              title: "1. RISK & YIELD PROFILES (เลือกระดับผลตอบแทนตามสภาวะตลาด)",
              color: T.green,
              items: [
                "🛡️ CONSERVATIVE: Delta 0.15–0.18 | DTE 18–25 วัน | TP 50% | เน้นระยะห่าง Strike และลด Gamma Risk",
                "⚡ BALANCED ALPHA: Delta 0.20–0.24 | DTE 12–20 วัน | TP 50% | ความเสี่ยงและ Premium ระดับกลาง",
                "🔥 HIGH YIELD HUNTER: Delta 0.25–0.28 | DTE 7–14 วัน | TP 50% | Premium สูงขึ้นพร้อม Gamma/Tail Risk ที่สูงขึ้น",
              ],
            },
            {
              title: "2. FAST THETA DECAY & DYNAMIC TP (การเร่งรอบหมุนเงินทุน)",
              color: T.blue,
              items: [
                "Dynamic Take Profit: ปิดทำกำไรเมื่อถึงเป้าหมาย 50% เพื่อปลดล็อค Margin ไปเปิดสัญญาใหม่",
                "Quick TP Velocity: ปิดทำกำไรเมื่อได้ 30% ภายใน 4 วันแรก (Capital Velocity Booster)",
                "DTE Exit (Gamma Defense): ปิด Position ทันทีเมื่อเหลือ DTE ≤ 2 วัน (ห้ามถือลุ้นจนหมดอายุ)",
              ],
            },
            {
              title: "3. POSITION & PORTFOLIO SIZING (การจำกัดขนาดไม้และความเสี่ยง)",
              color: T.purple,
              items: [
                "Per Position Allocation: Maximum 3.5% ของพอร์ตต่อชุด",
                "Total Margin Usage: เป้าหมายปกติ 10–30% / ช่วง 30–35% ลดขนาดใหม่ 50% / 35% เป็น Absolute Cap",
                "Total Portfolio Risk: Worst-Case Stress Risk รวมทุก Position ห้ามเกิน 10% ของพอร์ต",
                "Net Portfolio Delta: |Net Delta| ≤ 0.18 BTC ต่อ 1 BTC NAV (หากเกิน 0.25 → NO NEW ENTRY)",
              ],
            },
            {
              title: "4. STOP LOSS & DELTA DEFENSE (วินัย 100%)",
              color: T.red,
              items: [
                "Hard Stop Loss: Cut Loss เด็ดขาดทันทีเมื่อ Loss ≥ 2.0× Original Premium (ขาดทุนรวม 200%)",
                "Delta Warning: Delta ≥ 0.38 → Defensive Review",
                "Delta Action Level: Delta ≥ 0.65 → CLOSE ทันที หรือ Execute Approved Roll (สูงสุด 1 ครั้ง)",
              ],
            },
          ].map(({ title, color, items }) => (
            <div key={title} style={{ background: T.bg2, border: `1px solid ${color}33`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: 18 }}>
              <div style={{ color, fontFamily: T.font, fontWeight: 700, fontSize: 12, letterSpacing: 1.5, marginBottom: 14 }}>{title}</div>
              {items.map((it, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ color, fontSize: 13, marginTop: 1 }}>▸</span>
                  <span style={{ color: T.textSecondary, fontFamily: "'Inter', sans-serif", fontSize: 13, lineHeight: 1.5 }}>{it}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}


      {/* ── Backtest Tab ─────────────────────────────────────────────────────── */}
      {tab === "backtest" && (
        <div style={{ paddingTop: 20 }}>
          <BacktestPanel />
        </div>
      )}

      {/* ── Payoff Simulator Modal ─────────────────────────────────────────────── */}
      {payoffSetup && (
        <PayoffSimulator
          setup={payoffSetup}
          btcPrice={btcPrice}
          onClose={() => setPayoffSetup(null)}
        />
      )}

      {/* ── Paper Trading Sandbox Modal ───────────────────────────────────────── */}
      {paperModalOpen && (
        <PaperTradingDrawer
          btcPrice={btcPrice}
          optionMarks={optionMarks}
          onClose={() => setPaperModalOpen(false)}
        />
      )}

      {/* ── Onboarding Modal (first visit + no env) ─────────────────────────────── */}
      <Onboarding
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
      />

      {/* ── Alert Settings Modal ────────────────────────────────────────────── */}
      <AlertSettingsModal
        isOpen={alertModalOpen}
        onClose={() => setAlertModalOpen(false)}
        positions={positions}
        marketContext={marketContext}
        accountInfo={accountInfo}
        onPreferencesChange={(updated) => setAlertPrefs(updated)}
      />

      {/* ── Analysis Panel (modal) ───────────────────────────────────────────── */}
      {analyzing && (
        <AnalysisPanel
          pos={analyzing}
          btcPrice={btcPrice}
          marketIv={marketIv}
          onClose={() => setAnalyzing(null)}
        />
      )}

      {/* ── Global styles ────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${T.bg0}; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }

        button:focus:not(:focus-visible) { outline: none; }
        button:focus-visible {
          outline: 2px solid ${T.green};
          outline-offset: 2px;
        }

        /* — Mobile responsiveness for positions table — */
        @media (max-width: 640px) {
          .positions-header-desktop { display: none !important; }
          .positions-rows-desktop { min-width: 0 !important; }
          /* Reduce outer padding on mobile for edge-to-edge cards */
          /* App root already has responsive flex-wrap; this tightens horizontal padding */
        }
      `}</style>
    </div>
  );
}
