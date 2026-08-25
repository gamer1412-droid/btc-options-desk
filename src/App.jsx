import { useState, useEffect, useCallback, useRef } from "react";
import { T } from "./tokens.js";
import { fmtUSD, pnlColor } from "./utils.js";
import { mapBinancePosition } from "./services/binance.js";
import { sendTelegram, checkAlerts, checkEntryAlerts } from "./services/alerts.js";
import { scanEntryOpportunities } from "./services/scanner.js";
import { parseAccountInfo, calculatePortfolioCapacity } from "./services/sizing.js";
import { loadPaperTrades } from "./services/paperTrading.js";
import { SoundFX } from "./services/soundFx.js";

import { MetricCard } from "./components/MetricCard.jsx";
import { Pill } from "./components/Pill.jsx";
import { PositionRow, POSITION_GRID_COLS } from "./components/PositionRow.jsx";
import { AnalysisPanel } from "./components/AnalysisPanel.jsx";
import { ScannerTab } from "./components/ScannerTab.jsx";
import { CapacityWidget } from "./components/CapacityWidget.jsx";
import { LiveTickerTape } from "./components/LiveTickerTape.jsx";
import { SentimentGauge } from "./components/SentimentGauge.jsx";
import { PayoffSimulator } from "./components/PayoffSimulator.jsx";
import { PaperTradingDrawer } from "./components/PaperTradingDrawer.jsx";

const POLL_INTERVAL_MS = 15000; // refresh live data every 15 s

// ─── Main App (War Room Experience) ───────────────────────────────────────────
export default function App() {
  const [positions, setPositions]               = useState([]);
  const [opportunities, setOpportunities]       = useState([]);
  const [btcPrice, setBtcPrice]                 = useState(null);
  const [marketContext, setMarketContext]       = useState({ price: null, change24h: 0, ma20: null, distFromMA20: 0, ivRank: null });
  const [ivRank, setIvRank]                     = useState(null);
  const [connError, setConnError]               = useState(null);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [lastSync, setLastSync]                 = useState(null);
  const [analyzing, setAnalyzing]               = useState(null);
  const [tab, setTab]                           = useState("positions"); // "positions" | "scanner" | "rules"
  const [telegramStatus, setTelegramStatus]     = useState(null); // "ok" | "error" | null
  const [alertsEnabled, setAlertsEnabled]       = useState(true);
  const [accountInfo, setAccountInfo]           = useState(null);
  const [isMuted, setIsMuted]                   = useState(() => SoundFX.isMuted());
  const [payoffSetup, setPayoffSetup]           = useState(null); // setup object for Payoff Simulator
  const [paperModalOpen, setPaperModalOpen]     = useState(false);
  const [paperCount, setPaperCount]             = useState(0);

  const alertedIdsRef = useRef(new Set());
  const alertedEntryIdsRef = useRef(new Set());

  // Refresh active paper trades count
  const refreshPaperCount = useCallback(() => {
    const list = loadPaperTrades();
    setPaperCount(list.filter(t => t.status === "OPEN").length);
  }, []);

  useEffect(() => {
    refreshPaperCount();
  }, [refreshPaperCount, paperModalOpen]);

  const fetchLiveData = useCallback(async () => {
    try {
      const [marketRes, posRes, marksRes, acctRes] = await Promise.all([
        fetch("/api/binance?action=btcMarketContext").catch(() => fetch("/api/binance?action=btcPrice")),
        fetch("/api/binance?action=optionPositions"),
        fetch("/api/binance?action=optionMarks"),
        fetch("/api/binance?action=optionAccount").catch(() => null),
      ]);
      const marketData = await marketRes.json();
      const posData    = await posRes.json();
      const marksData  = await marksRes.json();
      const acctData   = acctRes ? await acctRes.json().catch(() => null) : null;

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
      let currentIvRank = null;
      if (Array.isArray(marksData) && marksData.length > 0) {
        const ivValues = marksData
          .map(m => parseFloat(m.markIV))
          .filter(v => !isNaN(v) && v > 0);
        if (ivValues.length > 0) {
          const avgIV = ivValues.reduce((s, v) => s + v, 0) / ivValues.length;
          currentIvRank = Math.round(avgIV * 100);
          setIvRank(currentIvRank);
        }
      }

      const updatedMarketContext = {
        price: currentBtcPrice,
        change24h: marketData.change24h ?? 0,
        ma20: marketData.ma20 ?? null,
        distFromMA20: marketData.distFromMA20 ?? 0,
        ivRank: currentIvRank,
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

        if (alertsEnabled) {
          const triggered = checkAlerts(mappedPositions, alertedIdsRef.current);
          if (triggered.length > 0) {
            SoundFX.playWarningAlert();
          }
          for (const { pos, reason } of triggered) {
            alertedIdsRef.current.add(pos.id);
            const pct = pos.premium > 0
              ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;
            sendTelegram("warning", {
              posId: pos.id,
              posType: pos.type,
              strike: pos.strike,
              delta: pos.delta,
              pnl: pos.pnl,
              pctProfit: pct.toFixed(0),
              warningReason: reason,
            });
          }
        }
      } else if (posData.error) {
        setConnError(typeof posData.error === "string" ? posData.error : JSON.stringify(posData.error));
      }

      // ── Scan Entry Opportunities (Adaptive Multi-Strategy) ───────────────
      if (Array.isArray(marksData) && currentBtcPrice) {
        const opps = scanEntryOpportunities(marksData, currentBtcPrice, currentIvRank, mappedPositions, updatedMarketContext);
        setOpportunities(opps);

        if (alertsEnabled && opps.length > 0) {
          const newEntrySignals = checkEntryAlerts(opps, alertedEntryIdsRef.current, updatedMarketContext, parsedAccount, mappedPositions);
          if (newEntrySignals.length > 0) {
            SoundFX.playSuccessChime();
          }
          for (const signal of newEntrySignals) {
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
    } catch (e) {
      setConnError(e.message);
    } finally {
      setLoadingPositions(false);
    }
  }, [alertsEnabled]);

  useEffect(() => {
    fetchLiveData();
    const timer = setInterval(fetchLiveData, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchLiveData]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "1") setTab("positions");
      else if (e.key === "2") setTab("scanner");
      else if (e.key === "3") setTab("rules");
      else if (e.key.toLowerCase() === "m") {
        const muted = SoundFX.toggleMute();
        setIsMuted(muted);
      } else if (e.key.toLowerCase() === "p") {
        setPaperModalOpen(v => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const totalPnl   = positions.reduce((s, p) => s + p.pnl, 0);
  const totalTheta = positions.reduce((s, p) => s + (Math.abs(p.theta) * (p.size || 1)), 0);
  const warnings   = positions.filter(p => p.status === "warning" || p.status === "danger").length;
  const capacity   = calculatePortfolioCapacity(accountInfo, positions, btcPrice, marketContext, opportunities);

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

  return (
    <div style={{ background: T.bg0, minHeight: "100vh", color: T.textPrimary, fontFamily: T.fontSans }}>

      {/* ── Top Wall Street Live Ticker Tape ───────────────────────────────── */}
      <LiveTickerTape
        btcPrice={btcPrice}
        marketContext={marketContext}
        ivRank={ivRank}
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
            background: connError ? T.red : T.green,
            boxShadow: `0 0 12px ${connError ? T.red : T.green}`,
            animation: "neonPulse 2s infinite",
          }} />
          <span style={{ color: T.textPrimary, fontWeight: 900, fontSize: 17, letterSpacing: 2, fontFamily: T.fontSans }}>
            ⚡ BTC OPTIONS DESK
          </span>
          <span style={{
            background: connError ? T.redDim : T.greenDim,
            color: connError ? T.red : T.green,
            border: `1px solid ${connError ? T.red + "44" : T.greenMid}`,
            borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: 1,
          }}>
            {connError ? "OFFLINE" : "WAR ROOM v2.5"}
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

          {/* Telegram alert toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              id="alerts-toggle"
              onClick={() => {
                SoundFX.playClick();
                setAlertsEnabled(v => !v);
              }}
              style={{
                background: alertsEnabled ? T.greenDim : T.bg2,
                border: `1px solid ${alertsEnabled ? T.greenMid : T.border}`,
                color: alertsEnabled ? T.green : T.textMuted,
                borderRadius: 6, padding: "5px 10px", cursor: "pointer",
                fontFamily: T.fontSans, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                display: "flex", alignItems: "center", gap: 5,
                transition: "all 0.2s ease",
              }}
            >
              <span>📨</span>
              <span>ALERTS {alertsEnabled ? "ON" : "OFF"}</span>
            </button>

            <button
              id="telegram-test"
              onClick={async () => {
                SoundFX.playClick();
                const r = await fetch("/api/telegram", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ type: "test" }),
                });
                const d = await r.json();
                if (d.ok) SoundFX.playSuccessChime();
                setTelegramStatus(d.ok ? "ok" : "error");
                setTimeout(() => setTelegramStatus(null), 3000);
              }}
              style={{
                background: T.bg2, border: `1px solid ${T.border}`,
                color: telegramStatus === "ok" ? T.green : telegramStatus === "error" ? T.red : T.textSecondary,
                borderRadius: 6, padding: "5px 10px", cursor: "pointer",
                fontFamily: T.fontSans, fontSize: 11, fontWeight: 600,
                transition: "all 0.2s ease",
              }}
            >
              {telegramStatus === "ok" ? "✓ SENT" : telegramStatus === "error" ? "✗ FAIL" : "TEST"}
            </button>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 1, fontFamily: T.fontSans }}>
              BTC / USDT {marketContext.change24h != null && (
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
          ⚠ เชื่อมต่อ Binance ไม่สำเร็จ: {connError}
          <div style={{ color: T.textSecondary, marginTop: 6, fontSize: 11 }}>
            ตรวจสอบว่าตั้งค่า BINANCE_API_KEY / BINANCE_API_SECRET ใน Vercel Environment Variables แล้ว และ API Key เปิดสิทธิ์ "Enable Reading"
          </div>
        </div>
      )}

      {/* ── Metric Cards & Speedometer Section ────────────────────────────────── */}
      <div style={{ display: "flex", gap: 14, padding: "16px 24px", flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ flex: "2 1 540px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <MetricCard label="Account Equity" value={accountInfo ? fmtUSD(accountInfo.equity, 2) : "$0.00"} color={T.blue} sub={accountInfo ? `Margin ${accountInfo.marginPct}% / 30% Max` : "Binance Options"} />
          <MetricCard label="Available Margin" value={accountInfo ? fmtUSD(accountInfo.availableBalance, 2) : "$0.00"} color={T.green} sub={accountInfo ? `Balance ${fmtUSD(accountInfo.balance, 2)}` : "พร้อมเทรด"} />
          <MetricCard label="Unrealized P&L" value={`${totalPnl > 0 ? "+" : ""}${fmtUSD(totalPnl, 2)}`} color={pnlColor(totalPnl)} sub="รวมทุก position" />
          <MetricCard label="Theta / Day" value={`+$${totalTheta < 1 ? totalTheta.toFixed(2) : totalTheta.toFixed(1)}`} color={T.green} sub="รายได้ต่อวัน" />
          <MetricCard label="Open Positions" value={positions.length} color={T.blue} sub={`${positions.filter(p => p.status === "healthy").length} healthy`} />
          <MetricCard label="Risk Alerts" value={warnings} color={warnings > 0 ? T.red : T.textMuted} sub={warnings > 0 ? "ต้องตัดสินใจ" : "ทุก position ปลอดภัย"} />
        </div>

        {/* IV Rank & Market Volatility Speedometer */}
        <div style={{ flex: "1 1 260px", minWidth: 260 }}>
          <SentimentGauge
            ivRank={ivRank || marketContext.ivRank || 45}
            distFromMA20={marketContext.distFromMA20}
            netDelta={positions.reduce((s, p) => s + (p.delta || 0) * (p.size || 1), 0)}
          />
        </div>
      </div>

      {/* ── Portfolio Capacity & Action Radar Widget ───────────────────────────── */}
      {accountInfo && (
        <div style={{ padding: "0 24px 16px" }}>
          <CapacityWidget capacity={capacity} />
        </div>
      )}

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
          🛡️ RULES v2.5
        </button>
      </div>

      {/* ── Scanner Tab ──────────────────────────────────────────────────────── */}
      {tab === "scanner" && (
        <div style={{ paddingTop: 20 }}>
          <ScannerTab
            opportunities={opportunities}
            btcPrice={btcPrice}
            ivRank={ivRank}
            marketContext={marketContext}
            accountInfo={accountInfo}
            currentPositions={positions}
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
          ) : positions.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontFamily: T.font, fontSize: 12 }}>ไม่มี open positions ในขณะนี้</div>
          ) : (
            <>
              {/* Responsive wrapper — horizontal scroll on small screens */}
              <div style={{ overflowX: "auto" }}>
                {/* Header row */}
                <div style={{
                  display: "grid", gridTemplateColumns: POSITION_GRID_COLS,
                  gap: 0, padding: "8px 16px", background: T.bg1,
                  borderBottom: `1px solid ${T.border}`, minWidth: 690,
                }}>
                  {["TYPE", "STRIKE", "DTE", "DELTA", "THETA", "IV", "RECEIVED", "P&L", "STATUS", ""].map(h => (
                    <span key={h} style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2, fontFamily: T.font }}>{h}</span>
                  ))}
                </div>
                {/* Position rows */}
                <div style={{ minWidth: 690 }}>
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

      {/* ── Rules Tab v2.0 ───────────────────────────────────────────────────── */}
      {tab === "rules" && (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 840 }}>
          <div style={{ background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`, border: `1px solid ${T.greenMid}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>🛡️</span>
              <span style={{ color: T.green, fontFamily: T.font, fontWeight: 700, fontSize: 13, letterSpacing: 2 }}>
                BTC OPTION DESK — PRODUCTION TRADING RULES SPECIFICATION v2.0
              </span>
            </div>
            <div style={{ color: T.textSecondary, fontSize: 13, lineHeight: 1.6, fontFamily: "'Inter', sans-serif" }}>
              ระบบถูกออกแบบภายใต้หลักการ <strong>"SURVIVE FIRST, PROFIT SECOND"</strong> เพื่อสร้าง Positive Expected Value, ควบคุม Tail Risk, จำกัด Drawdown, และไม่เพิ่มความเสี่ยงเพื่อไล่คืน Loss ทุกเกณฑ์ถูกแปลงเป็น Machine-readable Engine ในระบบเรียบร้อยแล้ว
            </div>
          </div>

          {[
            {
              title: "1. STRATEGY PRIORITY MATRIX (ลำดับความสำคัญเมื่อ Rules ขัดกัน)",
              color: T.green,
              items: [
                "1. Capital Preservation (การรักษาเงินต้นมาก่อนเสมอ)",
                "2. Portfolio Risk Limit (คุมความเสี่ยงรวมของพอร์ต ≤ 10%)",
                "3. Position Risk Limit (คุมความเสี่ยงต่อไม้ ≤ 3%)",
                "4. Stop Loss (วินัย 100% เมื่อ Loss = 2× Premium)",
                "5. Market Regime (กรองแนวโน้ม MA20 และความผันผวน)",
                "6. Entry Conditions (Delta 0.15–0.20, IVR ≥ 30%, DTE 18–25 วัน)",
                "7. Premium Optimization → Profit Maximization (ผลกำไรอยู่ลำดับสุดท้าย)",
              ],
            },
            {
              title: "2. ENTRY RULES (เกณฑ์การเปิด Position ใหม่)",
              color: T.blue,
              items: [
                "Call Delta: 0.15–0.20 (Maximum Entry Delta = 0.20 ห้ามเข้าหาก Call Delta > 0.20)",
                "Put Delta: 0.15–0.20 (Bullish Exception สูงสุด 0.25 เมื่อ Regime และ Risk Metrics อนุญาต)",
                "IV Filter: IV Rank ≥ 30% และ IV Percentile ≥ 40% (หาก IVR < 30% → NO ENTRY)",
                "DTE Entry: 18–25 วัน (Preferred ★) | 14–17 วัน (ลด Position Size 25%) | <14 หรือ >28 วัน (NO ENTRY)",
                "Market Regime (MA20): |Distance from MA20| ≤ 7% (Normal) | 7–10% (ลด Size 50%) | >10% (NO ENTRY)",
                "Daily Volatility Safety: หาก BTC 24h Move ≥ ±5% → STOP NEW ENTRY ทันที",
                "Event / Expiry Filter: ห้ามเปิด Position ใหม่ภายใน 48 ชม. ก่อน FOMC, CPI, และ Monthly Expiry",
              ],
            },
            {
              title: "3. POSITION & PORTFOLIO SIZING (การจำกัดขนาดไม้และความเสี่ยง)",
              color: T.purple,
              items: [
                "Per Position Allocation: Maximum 3% ของพอร์ตต่อชุด (ห้ามใช้ 5% เป็น Default)",
                "Total Margin Usage: Maximum 30% ของพอร์ต (เป้าหมายปกติ 10–25% / 30% เป็น Absolute Cap)",
                "Total Portfolio Risk: Worst-Case Stress Risk รวมทุก Position ห้ามเกิน 10% ของพอร์ต",
                "Net Portfolio Delta: |Net Delta| ≤ 0.15 BTC ต่อ 1 BTC NAV (หากเกิน 0.20 → NO NEW ENTRY)",
                "Concentration Risk: ห้ามเปิด Short Strike ในระนาบเดียวกัน หรือ Expiry เดียวกันซ้ำซ้อน",
              ],
            },
            {
              title: "4. EXIT & TAKE PROFIT RULES (การปิดทำกำไรตามวินัย)",
              color: T.green,
              items: [
                "Main Take Profit: ปิดทำกำไรทันทีเมื่อ Unrealized Profit ถึง 50% ของ Original Premium (ไม่ต้องรอหมดอายุ)",
                "Quick TP Rule: ปิดทำกำไรเมื่อได้ 25–30% หากทำกำไรถึงเป้าหมายภายใน 5 วันแรก (DaysHeld ≤ 5)",
                "DTE Exit (Gamma Defense): ปิด Position ทันทีเมื่อเหลือ DTE ≤ 2 วัน (ห้ามถือลุ้นจนถึงวินาทีหมดอายุ 08:00 UTC)",
              ],
            },
            {
              title: "5. STOP LOSS & DELTA DEFENSIVE TRIGGERS (การตัดขาดทุนและระบบตั้งรับ)",
              color: T.red,
              items: [
                "Hard Stop Loss: Cut Loss เด็ดขาดทันทีเมื่อ Loss ≥ 2.0× Original Premium (ขาดทุนรวม 200%)",
                "Delta Warning: Delta ≥ 0.35 → เข้าสู่โหมด Defensive Review",
                "Delta Strong Warning: Delta ≥ 0.50 หรือ Strike Breach → ห้ามเพิ่มความเสี่ยง / เตรียม Close หรือ Roll",
                "Delta Action Level: Delta ≥ 0.65 → CLOSE ทันที หรือ Execute Approved Roll (ห้ามรอให้ Delta กลับมาเอง)",
                "Strike Breach: หาก Spot ทะลุ Strike และ Delta ≥ 0.50 ให้ประเมิน Close หรือ Roll ทันที",
              ],
            },
            {
              title: "6. ROLL RULES (กฎเหล็กการ Roll ขยายเวลา)",
              color: T.amber,
              items: [
                "Maximum Roll: อนุญาตให้ Roll ได้สูงสุด 1 ครั้งต่อ Position เท่านั้น (หลังจาก Roll แล้วห้าม Roll ซ้ำอีกเด็ดขาด)",
                "Roll Out & Away: ต้องเพิ่ม DTE, ขยับ Strike ให้ห่าง Spot, ลด Delta, และไม่เพิ่ม Portfolio Risk",
                "Golden Net Credit Rule: การ Roll ต้องได้รับ Net Credit > 0 เสมอ (ห้ามยอมจ่าย Net Debit โดยเด็ดขาด)",
                "No Loss Avoidance Roll: ห้าม Roll เพียงเพื่อหลีกเลี่ยงการรับรู้ Loss หาก Risk พอร์ตโดยรวมสูงขึ้นให้ Cut Loss ทันที",
                "Second Breach: หาก Position ที่ถูก Roll ไปแล้วถูกทดสอบอีกครั้ง ให้ Hard Close ทันที",
              ],
            },
            {
              title: "7. DRAWDOWN & CONSECUTIVE LOSS CONTROLS (Portfolio Kill Switch)",
              color: T.red,
              items: [
                "Daily Loss Limit: Daily Portfolio Loss ≥ 3% → NO NEW ENTRY ทันที พร้อม Review ทุก Position",
                "Monthly Drawdown (Half Size): Monthly Drawdown ≥ 10% → ลด Position Size ลง 50%",
                "Monthly Drawdown (Stop Strategy): Monthly Drawdown ≥ 15% → STOP STRATEGY ทันทีและ Full Review",
                "Consecutive Losses: แพ้ติดกัน 3 ครั้ง → ลด Size 50% | แพ้ติดกัน 5 ครั้ง → Pause Strategy ทันที",
                "No Martingale / Revenge Trading: ห้าม Average Down หรือเพิ่ม Position เพื่อเอาคืน Loss ทุกกรณี",
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
          onClose={() => setPaperModalOpen(false)}
        />
      )}

      {/* ── Analysis Panel (modal) ───────────────────────────────────────────── */}
      {analyzing && (
        <AnalysisPanel
          pos={analyzing}
          btcPrice={btcPrice}
          ivRank={ivRank}
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
      `}</style>
    </div>
  );
}
