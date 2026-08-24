import { useState, useEffect, useCallback, useRef } from "react";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const T = {
  bg0: "#0a0c0f", bg1: "#111318", bg2: "#181c23", bg3: "#1f2430",
  border: "#252b38",
  green: "#00d4aa", greenDim: "#00d4aa22", greenMid: "#00d4aa55",
  amber: "#f5a623", amberDim: "#f5a62322",
  red: "#ff4d6a", redDim: "#ff4d6a22",
  blue: "#4d9fff", blueDim: "#4d9fff22",
  textPrimary: "#e8eaf0", textSecondary: "#7a8499", textMuted: "#3d4455",
  font: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
};

const POLL_INTERVAL_MS = 15000; // refresh live data every 15s

// ─── Telegram Alert ───────────────────────────────────────────────────────────
async function sendTelegram(type, data = {}) {
  try {
    await fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
  } catch (e) {
    console.error("Telegram error:", e.message);
  }
}

// Alert criteria — เช็คทุกรอบ poll แล้วส่งได้แค่ครั้งเดียวต่อ position จนกว่าจะ reset
function checkAlerts(positions, alertedIds) {
  const newAlerts = [];
  for (const pos of positions) {
    if (alertedIds.has(pos.id)) continue; // ส่งแล้ว ไม่ส่งซ้ำ
    const absDelta = Math.abs(pos.delta);
    const pct = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;

    if (absDelta >= 0.40) {
      newAlerts.push({ pos, reason: `⚠️ Delta ${pos.delta.toFixed(2)} — ถึง 0.40 แล้ว ควร Roll หรือ Close` });
    } else if (pct >= 50) {
      newAlerts.push({ pos, reason: `✅ Profit ${pct.toFixed(0)}% — ถึง TP แล้ว ควร Close` });
    } else if (pos.pnl < 0 && Math.abs(pos.pnl) >= pos.premium * 2) {
      newAlerts.push({ pos, reason: `🚨 Loss = 2× premium — STOP LOSS ด่วน!` });
    } else if (pos.dte <= 2) {
      newAlerts.push({ pos, reason: `⏰ เหลือ ${pos.dte} วัน — Gamma risk สูง ควร Close` });
    }
  }
  return newAlerts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n, dec = 0) =>
  n?.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) ?? "-";
const fmtUSD = (n) => `$${fmt(n, 0)}`;
const pnlColor = (v) => (v > 0 ? T.green : v < 0 ? T.red : T.textSecondary);
const deltaColor = (d) => {
  const a = Math.abs(d);
  if (a >= 0.38) return T.red;
  if (a >= 0.28) return T.amber;
  return T.green;
};
const statusColor = (s) => ({ healthy: T.green, warning: T.amber, danger: T.red }[s] ?? T.textSecondary);

// Classify position health from delta + dte, since Binance doesn't give you a "status" field
function classify(pos) {
  const absDelta = Math.abs(pos.delta);
  if (absDelta >= 0.40 || pos.dte <= 1) return "danger";
  if (absDelta >= 0.28 || pos.dte <= 3) return "warning";
  return "healthy";
}

// Map raw Binance /eapi/v1/position response into the shape our UI expects.
// Binance option position fields: symbol, side, quantity, entryPrice, markPrice,
// unrealizedPNL, delta, theta, gamma, vega, ...
function mapBinancePosition(raw) {
  // symbol format example: BTC-260829-100000-C
  const parts = raw.symbol?.split("-") ?? [];
  const strike = Number(parts[2]) || 0;
  const optType = parts[3] === "C" ? "Call" : "Put";
  const side = Number(raw.quantity) < 0 ? "Short" : "Long";
  const expiryRaw = parts[1]; // YYMMDD
  let expiry = "-";
  let dte = 0;
  if (expiryRaw?.length === 6) {
    const y = 2000 + Number(expiryRaw.slice(0, 2));
    const m = Number(expiryRaw.slice(2, 4));
    const d = Number(expiryRaw.slice(4, 6));
    const expDate = new Date(Date.UTC(y, m - 1, d, 8, 0, 0)); // Binance options expire 08:00 UTC
    expiry = expDate.toISOString().slice(0, 10);
    dte = Math.max(0, Math.ceil((expDate - Date.now()) / 86400000));
  }
  const premium = Math.abs(Number(raw.entryPrice) * Number(raw.quantity) * (raw.contractMultiplier || 1)) || 0;
  const currentValue = Math.abs(Number(raw.markPrice) * Number(raw.quantity) * (raw.contractMultiplier || 1)) || 0;
  const pos = {
    id: raw.symbol,
    type: `${side} ${optType}`,
    strike,
    expiry,
    dte,
    delta: Number(raw.delta) || 0,
    theta: Number(raw.theta) || 0,
    vega: Number(raw.vega) || 0,
    iv: Number(raw.markIV) * 100 || 0,
    premium: premium.toFixed(0),
    currentPrice: currentValue.toFixed(0),
    pnl: Number(raw.unrealizedPNL) || 0,
    size: Math.abs(Number(raw.quantity)),
  };
  pos.status = classify(pos);
  return pos;
}

// ─── Sub-components (identical visual language to the artifact) ───────────────
function Pill({ color, children }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontFamily: T.font,
      fontWeight: 700, letterSpacing: 1,
    }}>{children}</span>
  );
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8,
      padding: "14px 18px", flex: 1, minWidth: 130, borderTop: `2px solid ${color ?? T.border}`,
    }}>
      <div style={{ color: T.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontFamily: T.font, marginBottom: 6 }}>{label}</div>
      <div style={{ color: color ?? T.textPrimary, fontSize: 22, fontWeight: 700, fontFamily: T.font, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4, fontFamily: T.font }}>{sub}</div>}
    </div>
  );
}

function PositionRow({ pos, onAnalyze }) {
  const isCall = pos.type.includes("Call");
  const profit = pos.premium > 0 ? ((pos.premium - pos.currentPrice) / pos.premium) * 100 : 0;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "90px 90px 55px 65px 65px 65px 80px 80px 80px auto",
      gap: 0, alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${T.border}`,
      background: pos.status === "warning" ? T.amberDim : pos.status === "danger" ? T.redDim : "transparent",
    }}>
      <Pill color={isCall ? T.blue : T.amber}>{pos.type}</Pill>
      <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13 }}>{fmtUSD(pos.strike)}</span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{pos.dte}d</span>
      <span style={{ color: deltaColor(pos.delta), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
        {pos.delta > 0 ? "+" : ""}{pos.delta.toFixed(2)}
      </span>
      <span style={{ color: T.green, fontFamily: T.font, fontSize: 12 }}>{pos.theta.toFixed(1)}/d</span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{pos.iv.toFixed(1)}%</span>
      <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12 }}>{fmtUSD(pos.premium)}</span>
      <div>
        <div style={{ color: pnlColor(pos.pnl), fontFamily: T.font, fontSize: 13, fontWeight: 700 }}>
          {pos.pnl >= 0 ? "+" : ""}{fmtUSD(pos.pnl)}
        </div>
        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.font }}>{profit.toFixed(0)}% profit</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(pos.status), boxShadow: `0 0 6px ${statusColor(pos.status)}` }} />
        <span style={{ color: statusColor(pos.status), fontSize: 11, fontFamily: T.font, textTransform: "uppercase", letterSpacing: 1 }}>{pos.status}</span>
      </div>
      <button onClick={() => onAnalyze(pos)} style={{
        background: T.greenDim, border: `1px solid ${T.greenMid}`, color: T.green,
        borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontFamily: T.font,
        fontSize: 11, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap",
      }}>AI ANALYZE</button>
    </div>
  );
}

function AnalysisPanel({ pos, btcPrice, ivRank, onClose }) {
  const [streamText, setStreamText] = useState("");
  const [loading, setLoading] = useState(false);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setStreamText("");

    const prompt = `You are an expert BTC options trader specializing in short premium strategies (Short Strangle).
Analyze this position and give a concise, actionable recommendation.

MARKET DATA:
- BTC Price: $${btcPrice?.toLocaleString() ?? "unknown"}
- IV Rank: ${ivRank ?? "unknown"}%

POSITION:
- Type: ${pos.type}
- Strike: $${Number(pos.strike).toLocaleString()}
- DTE: ${pos.dte} days
- Delta: ${pos.delta}
- Theta: $${pos.theta}/day
- Vega: ${pos.vega}
- IV: ${pos.iv?.toFixed?.(1) ?? pos.iv}%
- Premium received: $${pos.premium}
- Current value: $${pos.currentPrice}
- Unrealized P&L: ${pos.pnl >= 0 ? "+" : ""}$${pos.pnl}

Respond in Thai language. Format your response as:

**สถานะ:** [HEALTHY / WARNING / DANGER]
**Action แนะนำ:** [HOLD / CLOSE NOW / ROLL OUT / ADJUST]

**เหตุผล:** (2-3 ประโยค อธิบายสถานะ position)

**จุดเฝ้าระวัง:**
- Delta trigger: [ค่า delta ที่ควร action]
- TP: [% profit ที่ควร close]
- SL: [loss ที่ควร cut]

**หากราคา BTC เคลื่อนไหว:**
- ถ้าขึ้น: [แนะนำอะไร]
- ถ้าลง: [แนะนำอะไร]`;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      setStreamText(data.text || data.error?.error?.message || "ไม่สามารถวิเคราะห์ได้");
    } catch (e) {
      setStreamText("เกิดข้อผิดพลาด: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [pos, btcPrice, ivRank]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  const isCall = pos.type.includes("Call");

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(680px, 95vw)", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: `0 0 60px ${T.green}22` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${T.border}`, background: T.bg2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: T.green, boxShadow: `0 0 8px ${T.green}` }} />
            <span style={{ color: T.green, fontFamily: T.font, fontWeight: 700, fontSize: 14, letterSpacing: 2 }}>AI ANALYSIS ENGINE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Pill color={isCall ? T.blue : T.amber}>{pos.type}</Pill>
            <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 14 }}>Strike {fmtUSD(pos.strike)}</span>
            <button onClick={onClose} style={{ background: "none", border: `1px solid ${T.border}`, color: T.textSecondary, borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: T.font, fontSize: 12 }}>✕ ปิด</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {loading && !streamText && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 40 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: T.green, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
              <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12, letterSpacing: 2 }}>ANALYZING POSITION...</span>
            </div>
          )}
          {streamText && (
            <div style={{ color: T.textPrimary, fontFamily: "'Inter', sans-serif", fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}
              dangerouslySetInnerHTML={{
                __html: streamText
                  .replace(/\*\*(.*?)\*\*/g, `<strong style="color:${T.green};font-family:${T.font};letter-spacing:1px">$1</strong>`)
                  .replace(/(HOLD|CLOSE NOW|ROLL OUT|ADJUST)/g, (m) => {
                    const c = m === "HOLD" ? T.green : m === "CLOSE NOW" ? T.red : T.amber;
                    return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;border-radius:4px;padding:2px 8px;font-family:${T.font};font-weight:700;font-size:12px;letter-spacing:1px">${m}</span>`;
                  })
                  .replace(/(HEALTHY|WARNING|DANGER)/g, (m) => {
                    const c = m === "HEALTHY" ? T.green : m === "WARNING" ? T.amber : T.red;
                    return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;border-radius:4px;padding:2px 8px;font-family:${T.font};font-weight:700;font-size:12px;letter-spacing:1px">${m}</span>`;
                  })
              }}
            />
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, background: T.bg2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: T.textMuted, fontFamily: T.font, fontSize: 10, letterSpacing: 1 }}>⚠ AI ANALYSIS — ตัดสินใจเองเสมอ ไม่ใช่คำแนะนำทางการเงิน</span>
          <button onClick={runAnalysis} style={{ background: T.greenDim, border: `1px solid ${T.greenMid}`, color: T.green, borderRadius: 5, padding: "6px 14px", cursor: "pointer", fontFamily: T.font, fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>↺ REFRESH</button>
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [positions, setPositions] = useState([]);
  const [btcPrice, setBtcPrice] = useState(null);
  const [connError, setConnError] = useState(null);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [analyzing, setAnalyzing] = useState(null);
  const [tab, setTab] = useState("positions");
  const [telegramStatus, setTelegramStatus] = useState(null); // "ok" | "error" | null
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const alertedIdsRef = useRef(new Set());
  const pollRef = useRef(null);

  const fetchLiveData = useCallback(async () => {
    try {
      const [priceRes, posRes] = await Promise.all([
        fetch("/api/binance?action=btcPrice"),
        fetch("/api/binance?action=optionPositions"),
      ]);
      const priceData = await priceRes.json();
      const posData = await posRes.json();

      if (priceData.price) setBtcPrice(priceData.price);

      if (Array.isArray(posData)) {
        const mapped = posData
          .filter((p) => Number(p.quantity) !== 0)
          .map(mapBinancePosition);
        setPositions(mapped);
        setConnError(null);

        // ─── Telegram alert check ───────────────────────────────────────
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
        // ───────────────────────────────────────────────────────────────

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
    pollRef.current = setInterval(fetchLiveData, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [fetchLiveData]);

  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const totalTheta = positions.reduce((s, p) => s + Math.abs(p.theta), 0);
  const warnings = positions.filter(p => p.status === "warning" || p.status === "danger").length;

  const tabStyle = (t) => ({
    padding: "8px 20px", cursor: "pointer", fontFamily: T.font, fontSize: 12,
    fontWeight: 700, letterSpacing: 2, border: "none",
    background: tab === t ? T.greenDim : "transparent",
    color: tab === t ? T.green : T.textSecondary,
    borderBottom: tab === t ? `2px solid ${T.green}` : "2px solid transparent",
  });

  return (
    <div style={{ background: T.bg0, minHeight: "100vh", color: T.textPrimary, fontFamily: T.font }}>
      {/* Top Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", background: T.bg1, borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap", gap: 8 }}>
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
            <button onClick={() => setAlertsEnabled(v => !v)} style={{
              background: alertsEnabled ? T.greenDim : T.bg3,
              border: `1px solid ${alertsEnabled ? T.greenMid : T.border}`,
              color: alertsEnabled ? T.green : T.textMuted,
              borderRadius: 5, padding: "4px 10px", cursor: "pointer",
              fontFamily: T.font, fontSize: 10, fontWeight: 700, letterSpacing: 1,
            }}>
              ALERTS {alertsEnabled ? "ON" : "OFF"}
            </button>
            <button onClick={async () => {
              const r = await fetch("/api/telegram", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "test" }),
              });
              const d = await r.json();
              setTelegramStatus(d.ok ? "ok" : "error");
              setTimeout(() => setTelegramStatus(null), 3000);
            }} style={{
              background: T.bg3, border: `1px solid ${T.border}`,
              color: telegramStatus === "ok" ? T.green : telegramStatus === "error" ? T.red : T.textSecondary,
              borderRadius: 5, padding: "4px 10px", cursor: "pointer",
              fontFamily: T.font, fontSize: 10, letterSpacing: 1,
            }}>
              {telegramStatus === "ok" ? "✓ SENT" : telegramStatus === "error" ? "✗ FAIL" : "TEST"}
            </button>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2 }}>BTC / USDT</div>
            <div style={{ color: T.textPrimary, fontSize: 18, fontWeight: 700 }}>{btcPrice ? fmtUSD(btcPrice) : "—"}</div>
          </div>
        </div>
      </div>

      {connError && (
        <div style={{ margin: "16px 24px 0", padding: 14, background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 8, color: T.red, fontSize: 12, fontFamily: T.font }}>
          ⚠ เชื่อมต่อ Binance ไม่สำเร็จ: {connError}
          <div style={{ color: T.textSecondary, marginTop: 6, fontSize: 11 }}>
            ตรวจสอบว่าตั้งค่า BINANCE_API_KEY / BINANCE_API_SECRET ใน Vercel Environment Variables แล้ว และ API Key เปิดสิทธิ์ "Enable Reading"
          </div>
        </div>
      )}

      {/* Metric Cards */}
      <div style={{ display: "flex", gap: 12, padding: "16px 24px", flexWrap: "wrap" }}>
        <MetricCard label="Unrealized P&L" value={`${totalPnl >= 0 ? "+" : ""}${fmtUSD(totalPnl.toFixed(0))}`} color={pnlColor(totalPnl)} sub="รวมทุก position" />
        <MetricCard label="Theta / Day" value={`$${totalTheta.toFixed(0)}`} color={T.green} sub="รายได้ต่อวัน" />
        <MetricCard label="Open Positions" value={positions.length} color={T.blue} sub={`${positions.filter(p => p.status === "healthy").length} healthy`} />
        <MetricCard label="Warnings" value={warnings} color={warnings > 0 ? T.amber : T.textMuted} sub={warnings > 0 ? "ต้องติดตาม" : "ทุก position ปกติ"} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, marginLeft: 24 }}>
        <button style={tabStyle("positions")} onClick={() => setTab("positions")}>POSITIONS</button>
        <button style={tabStyle("rules")} onClick={() => setTab("rules")}>RULES</button>
      </div>

      {tab === "positions" && (
        <div style={{ padding: "0 0 24px" }}>
          {loadingPositions ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontFamily: T.font, fontSize: 12 }}>กำลังโหลด positions...</div>
          ) : positions.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontFamily: T.font, fontSize: 12 }}>ไม่มี open positions ในขณะนี้</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "90px 90px 55px 65px 65px 65px 80px 80px 80px auto", gap: 0, padding: "8px 16px", background: T.bg1, borderBottom: `1px solid ${T.border}` }}>
                {["TYPE", "STRIKE", "DTE", "DELTA", "THETA", "IV", "RECEIVED", "P&L", "STATUS", ""].map(h => (
                  <span key={h} style={{ color: T.textMuted, fontSize: 9, letterSpacing: 2, fontFamily: T.font }}>{h}</span>
                ))}
              </div>
              {positions.map(pos => <PositionRow key={pos.id} pos={pos} onAnalyze={setAnalyzing} />)}
            </>
          )}

          <div style={{ margin: "20px 24px 0", padding: 16, background: T.amberDim, border: `1px solid ${T.amber}44`, borderRadius: 8, display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ color: T.amber, fontSize: 10, letterSpacing: 2, fontFamily: T.font, marginBottom: 6, width: "100%" }}>⚡ QUICK RULES</div>
            {[
              { rule: "CLOSE TP", desc: "เมื่อ profit ≥ 50%" },
              { rule: "ROLL OUT", desc: "เมื่อ Delta ≥ 0.40" },
              { rule: "STOP LOSS", desc: "เมื่อ loss = 2× premium" },
              { rule: "GAMMA RISK", desc: "Close ก่อน expiry 2 วัน" },
            ].map(({ rule, desc }) => (
              <div key={rule} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill color={T.amber}>{rule}</Pill>
                <span style={{ color: T.textSecondary, fontSize: 12, fontFamily: T.font }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "rules" && (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 700 }}>
          {[
            { title: "ENTRY RULES", color: T.green, rules: [
              "Delta Call: 0.15–0.20 | Delta Put: 0.20–0.25",
              "IV Rank > 30% — ถ้าต่ำกว่านี้ premium ไม่คุ้ม",
              "DTE: 7–21 วัน — Theta decay เร็วที่สุด",
              "Position size: ไม่เกิน 5% ของพอร์ต ต่อ 1 strangle",
              "ห้าม entry ภายใน 48 ชม. ก่อน major news (FOMC, CPI)",
            ]},
            { title: "EXIT / TP RULES", color: T.blue, rules: [
              "Close เมื่อ profit ≥ 50% — Tasty Trade Rule",
              "Close เมื่อ profit ≥ 25–30% ถ้าถึงก่อน 50% DTE",
              "Close เมื่อเหลือ DTE 1–2 วัน — Gamma risk สูง",
              "อย่าถือจน expiry ไม่ว่ากรณีใด",
            ]},
            { title: "ROLL / ADJUST RULES", color: T.amber, rules: [
              "Roll เมื่อ Delta ของ leg ใดถึง 0.40+",
              "Roll Out in Time: เพิ่ม DTE เพื่อเก็บ credit เพิ่ม",
              "Roll Strike: ขยับ strike ให้ห่างราคาปัจจุบัน",
              "แปลงเป็น Iron Condor: ซื้อ wing จำกัด max loss",
              "ถ้า BTC ขึ้น/ลง >5% ใน 1 วัน — หยุดประเมินก่อน",
            ]},
            { title: "STOP LOSS RULES", color: T.red, rules: [
              "Close ทันที เมื่อ loss = 2× premium ที่รับมา",
              "ถ้า Delta รวมทั้ง position > 0.50 — พิจารณา hedge",
              "ถ้าราคา BTC ทะลุ Strike — ประเมิน roll หรือ cut",
              "ไม่มีข้อยกเว้น ไม่ใช้ดุลพินิจ — ทำตาม rule เท่านั้น",
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

      {analyzing && <AnalysisPanel pos={analyzing} btcPrice={btcPrice} onClose={() => setAnalyzing(null)} />}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${T.bg0}; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
        button:focus { outline: none; }
      `}</style>
    </div>
  );
}
