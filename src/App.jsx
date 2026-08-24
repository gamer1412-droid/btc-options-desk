import { useState, useEffect, useCallback, useRef } from "react";
import { T } from "./tokens.js";
import { fmtUSD, pnlColor } from "./utils.js";
import { mapBinancePosition } from "./services/binance.js";
import { sendTelegram, checkAlerts, checkEntryAlerts } from "./services/alerts.js";
import { scanEntryOpportunities } from "./services/scanner.js";
import { MetricCard } from "./components/MetricCard.jsx";
import { Pill } from "./components/Pill.jsx";
import { PositionRow, POSITION_GRID_COLS } from "./components/PositionRow.jsx";
import { AnalysisPanel } from "./components/AnalysisPanel.jsx";
import { ScannerTab } from "./components/ScannerTab.jsx";

const POLL_INTERVAL_MS = 15000; // refresh live data every 15 s

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [positions, setPositions]               = useState([]);
  const [opportunities, setOpportunities]       = useState([]);
  const [btcPrice, setBtcPrice]                 = useState(null);
  const [ivRank, setIvRank]                     = useState(null); // market-wide BTC IV (avg of ATM options)
  const [connError, setConnError]               = useState(null);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [lastSync, setLastSync]                 = useState(null);
  const [analyzing, setAnalyzing]               = useState(null);
  const [tab, setTab]                           = useState("positions"); // "positions" | "scanner" | "rules"
  const [telegramStatus, setTelegramStatus]     = useState(null); // "ok" | "error" | null
  const [alertsEnabled, setAlertsEnabled]       = useState(true);
  const alertedIdsRef = useRef(new Set());
  const alertedEntryIdsRef = useRef(new Set());

  const fetchLiveData = useCallback(async () => {
    try {
      const [priceRes, posRes, marksRes] = await Promise.all([
        fetch("/api/binance?action=btcPrice"),
        fetch("/api/binance?action=optionPositions"),
        fetch("/api/binance?action=optionMarks"),
      ]);
      const priceData = await priceRes.json();
      const posData   = await posRes.json();
      const marksData = await marksRes.json();

      // ── BTC spot price ──────────────────────────────────────────────────────
      const currentBtcPrice = priceData.price || null;
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

      // ── Build Greeks / Mark Lookup Map ────────────────────────────────────
      const marksMap = new Map();
      if (Array.isArray(marksData)) {
        for (const m of marksData) {
          if (m.symbol) marksMap.set(m.symbol, m);
        }
      }

      // ── Scan Entry Opportunities (Short Strangle Candidates) ──────────────
      if (Array.isArray(marksData) && currentBtcPrice) {
        const opps = scanEntryOpportunities(marksData, currentBtcPrice, currentIvRank);
        setOpportunities(opps);

        // Auto-send Telegram Entry Signal when high-probability setup appears
        if (alertsEnabled && opps.length > 0) {
          const newEntrySignals = checkEntryAlerts(opps, alertedEntryIdsRef.current);
          for (const signal of newEntrySignals) {
            sendTelegram("strangle_signal", signal);
          }
        }
      }

      // ── Option positions ────────────────────────────────────────────────────
      if (Array.isArray(posData)) {
        const mapped = posData
          .filter(p => Number(p.quantity || p.positionAmount) !== 0)
          .map(p => mapBinancePosition(p, marksMap.get(p.symbol) || {}));
        setPositions(mapped);
        setConnError(null);

        if (alertsEnabled) {
          const triggered = checkAlerts(mapped, alertedIdsRef.current);
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

  const totalPnl   = positions.reduce((s, p) => s + p.pnl, 0);
  const totalTheta = positions.reduce((s, p) => s + Math.abs(p.theta), 0);
  const warnings   = positions.filter(p => p.status === "warning" || p.status === "danger").length;

  const tabStyle = (t) => ({
    padding: "8px 20px", cursor: "pointer", fontFamily: T.font, fontSize: 12,
    fontWeight: 700, letterSpacing: 2, border: "none",
    background: tab === t ? T.greenDim : "transparent",
    color: tab === t ? T.green : T.textSecondary,
    borderBottom: tab === t ? `2px solid ${T.green}` : "2px solid transparent",
  });

  return (
    <div style={{ background: T.bg0, minHeight: "100vh", color: T.textPrimary, fontFamily: T.font }}>

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 24px", background: T.bg1, borderBottom: `1px solid ${T.border}`,
        position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: connError ? T.red : T.green, boxShadow: `0 0 8px ${connError ? T.red : T.green}` }} />
          <span style={{ color: connError ? T.red : T.green, fontWeight: 700, fontSize: 14, letterSpacing: 3 }}>BTC OPTIONS DESK</span>
          <span style={{ color: T.textMuted, fontSize: 11, letterSpacing: 1 }}>
            {connError ? "CONNECTION ERROR" : loadingPositions ? "CONNECTING..." : "LIVE — BINANCE"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {lastSync && (
            <span style={{ color: T.textMuted, fontSize: 10 }}>
              Sync: {lastSync.toLocaleTimeString("th-TH")}
            </span>
          )}

          {/* Telegram alert toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12 }}>📨</span>
            <button
              id="alerts-toggle"
              onClick={() => setAlertsEnabled(v => !v)}
              style={{
                background: alertsEnabled ? T.greenDim : T.bg3,
                border: `1px solid ${alertsEnabled ? T.greenMid : T.border}`,
                color: alertsEnabled ? T.green : T.textMuted,
                borderRadius: 5, padding: "4px 10px", cursor: "pointer",
                fontFamily: T.font, fontSize: 10, fontWeight: 700, letterSpacing: 1,
              }}
            >
              ALERTS {alertsEnabled ? "ON" : "OFF"}
            </button>

            <button
              id="telegram-test"
              onClick={async () => {
                const r = await fetch("/api/telegram", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ type: "test" }),
                });
                const d = await r.json();
                setTelegramStatus(d.ok ? "ok" : "error");
                setTimeout(() => setTelegramStatus(null), 3000);
              }}
              style={{
                background: T.bg3, border: `1px solid ${T.border}`,
                color: telegramStatus === "ok" ? T.green : telegramStatus === "error" ? T.red : T.textSecondary,
                borderRadius: 5, padding: "4px 10px", cursor: "pointer",
                fontFamily: T.font, fontSize: 10, letterSpacing: 1,
              }}
            >
              {telegramStatus === "ok" ? "✓ SENT" : telegramStatus === "error" ? "✗ FAIL" : "TEST"}
            </button>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2 }}>BTC / USDT</div>
            <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 700 }}>{btcPrice ? fmtUSD(btcPrice) : "—"}</div>
          </div>
        </div>
      </div>

      {/* ── Connection error banner ──────────────────────────────────────────── */}
      {connError && (
        <div style={{ margin: "16px 24px 0", padding: 14, background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 8, color: T.red, fontSize: 12, fontFamily: T.font }}>
          ⚠ เชื่อมต่อ Binance ไม่สำเร็จ: {connError}
          <div style={{ color: T.textSecondary, marginTop: 6, fontSize: 11 }}>
            ตรวจสอบว่าตั้งค่า BINANCE_API_KEY / BINANCE_API_SECRET ใน Vercel Environment Variables แล้ว และ API Key เปิดสิทธิ์ "Enable Reading"
          </div>
        </div>
      )}

      {/* ── Metric Cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, padding: "16px 24px", flexWrap: "wrap" }}>
        <MetricCard label="Unrealized P&L" value={`${totalPnl >= 0 ? "+" : ""}${fmtUSD(totalPnl)}`} color={pnlColor(totalPnl)} sub="รวมทุก position" />
        <MetricCard label="Theta / Day" value={`$${totalTheta.toFixed(0)}`} color={T.green} sub="รายได้ต่อวัน" />
        <MetricCard label="Open Positions" value={positions.length} color={T.blue} sub={`${positions.filter(p => p.status === "healthy").length} healthy`} />
        <MetricCard label="Warnings" value={warnings} color={warnings > 0 ? T.amber : T.textMuted} sub={warnings > 0 ? "ต้องติดตาม" : "ทุก position ปกติ"} />
        {ivRank != null && (
          <MetricCard label="Market IV (avg)" value={`${ivRank}%`} color={ivRank > 80 ? T.green : ivRank > 50 ? T.amber : T.textMuted} sub="IV เฉลี่ยตลาด BTC" />
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, marginLeft: 24, gap: 4 }}>
        <button id="tab-positions" style={tabStyle("positions")} onClick={() => setTab("positions")}>
          POSITIONS ({positions.length})
        </button>

        <button id="tab-scanner" style={tabStyle("scanner")} onClick={() => setTab("scanner")}>
          🎯 SCANNER {opportunities.length > 0 && `(${opportunities.length})`}
        </button>

        <button id="tab-rules" style={tabStyle("rules")} onClick={() => setTab("rules")}>
          RULES
        </button>
      </div>

      {/* ── Scanner Tab ──────────────────────────────────────────────────────── */}
      {tab === "scanner" && (
        <div style={{ paddingTop: 20 }}>
          <ScannerTab
            opportunities={opportunities}
            btcPrice={btcPrice}
            ivRank={ivRank}
            onAnalyzeStrangle={setAnalyzing}
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
                    <PositionRow key={pos.id} pos={pos} onAnalyze={setAnalyzing} />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Quick rules reminder */}
          <div style={{ margin: "20px 24px 0", padding: 16, background: T.amberDim, border: `1px solid ${T.amber}44`, borderRadius: 8, display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ color: T.amber, fontSize: 10, letterSpacing: 2, fontFamily: T.font, marginBottom: 6, width: "100%" }}>⚡ QUICK RULES</div>
            {[
              { rule: "CLOSE TP",     desc: "เมื่อ profit ≥ 50% หรือ ≥ 25–30% ในสัปดาห์แรก" },
              { rule: "ROLL CREDIT",  desc: "เมื่อ Delta ≥ 0.35–0.40 (Roll ต้องได้ Net Credit เสมอ)" },
              { rule: "STOP LOSS",    desc: "เมื่อ Loss = 2× premium หรือ Delta ทะลุ > 0.50" },
              { rule: "GAMMA RISK",   desc: "Close ก่อน expiry 2 วัน (ห้ามถือลุ้นจนหมดอายุ)" },
            ].map(({ rule, desc }) => (
              <div key={rule} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill color={T.amber}>{rule}</Pill>
                <span style={{ color: T.textSecondary, fontSize: 12, fontFamily: T.font }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Rules Tab ───────────────────────────────────────────────────────── */}
      {tab === "rules" && (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 740 }}>
          {[
            { title: "ENTRY RULES (การเปิด Position)", color: T.green, rules: [
              "Delta Call: 0.15–0.20 | Delta Put: 0.20–0.25 (Win rate ทางสถิติ ~75–80%)",
              "IV Rank > 30% — หากต่ำกว่านี้ค่า Premium ไม่คุ้มกับความเสี่ยงความผันผวน",
              "DTE: 14–28 วัน — สัดส่วน Theta Decay สูงควบคู่กับ Gamma Risk ในระดับควบคุมได้",
              "Position Size: ไม่เกิน 5% ของพอร์ตต่อชุด / Total Margin รวมทั้งพอร์ตไม่เกิน 40%",
              "หลีกเลี่ยงการเปิด Position ภายใน 48 ชม. ก่อนข่าวใหญ่ (FOMC, CPI) และก่อน Monthly Expiry",
            ]},
            { title: "EXIT / TP RULES (การปิดทำกำไร)", color: T.blue, rules: [
              "TP หลัก: ปิดทำกำไรทันทีเมื่อได้ ≥ 50% ของ Premium ที่รับมา (Tastytrade 50% Rule)",
              "Quick TP: ปิดทำกำไรเมื่อได้ ≥ 25–30% หากกำไรถึงเป้าหมายภายในสัปดาห์แรก",
              "DTE Stop: ปิด Position เมื่อเหลือ DTE ≤ 2 วัน เพื่อตัด Gamma Explosion",
              "ห้ามถือ Position ลุ้นจนถึงวินาทีหมดอายุ (08:00 UTC) ไม่ว่ากรณีใดทั้งสิ้น",
            ]},
            { title: "ROLL / ADJUST RULES (การปรับแก้ Position)", color: T.amber, rules: [
              "Delta Trigger: เริ่มพิจารณา Roll เมื่อขาใดขาหนึ่งแตะ Delta ≥ 0.35–0.40",
              "Roll Out & Away: ขยายวันหมดอายุเพิ่ม (DTE) พร้อมขยับ Strike ให้ห่างราคาปัจจุบัน",
              "Golden Rule of Rolling: การ Roll ต้องได้รับ Net Credit เพิ่มเสมอ (ห้ามยอมจ่าย Net Debit)",
              "Untested Side: ขยับ Strike ขาที่ปลอดภัยเข้ามาใกล้ราคาปัจจุบันเพื่อเก็บ Premium เพิ่มชดเชย",
              "กรณีฉุกเฉิน: แปลงเป็น Iron Condor โดยการซื้อ Long OTM wing เพื่อจำกัด Max Loss",
            ]},
            { title: "STOP LOSS RULES (การตัดขาดทุนอย่างเด็ดขาด)", color: T.red, rules: [
              "Hard Stop: Cut Loss ทันทีเมื่อ Loss = 2× Premium ที่ได้รับมา (ขาดทุนรวม 200%)",
              "Strike Breach: หากราคา Spot ทะลุ Strike และ Delta พุ่งเกิน 0.50 ให้ Cut Loss ทันที",
              "ใช้วินัย 100% ไม่มีข้อยกเว้น ไม่ใช้ดุลพินิจ หรือหวังว่าราคาจะกลับตัว",
              "หาก BTC แกว่งเกิน ±5% ภายในวันเดียว ให้หยุดเปิด Position ใหม่และประเมินพอร์ตทันที",
            ]},
          ].map(({ title, color, rules }) => (
            <div key={title} style={{ background: T.bg2, border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: 16 }}>
              <div style={{ color, fontFamily: T.font, fontWeight: 700, fontSize: 11, letterSpacing: 2, marginBottom: 12 }}>{title}</div>
              {rules.map(r => (
                <div key={r} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ color, fontSize: 12, marginTop: 1 }}>▸</span>
                  <span style={{ color: T.textSecondary, fontFamily: "'Inter', sans-serif", fontSize: 13, lineHeight: 1.5 }}>{r}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
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
        @keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${T.bg0}; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }

        /* Accessibility: show focus ring only for keyboard nav, not mouse clicks */
        button:focus:not(:focus-visible) { outline: none; }
        button:focus-visible {
          outline: 2px solid ${T.green};
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
