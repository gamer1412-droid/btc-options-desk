import { useState, useEffect, useMemo } from "react";
import { T } from "../tokens.js";
import { fmtUSD, pnlColor } from "../utils.js";

export const PNL_HISTORY_KEY = "btc_pnl_history";

function safeWindow() {
  return typeof window !== "undefined" ? window : null;
}

export function loadPnlHistory() {
  const w = safeWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage.getItem(PNL_HISTORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function savePnlHistory(history) {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.setItem(PNL_HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

export function generateMockHistory(days = 30, seedPnl = 0) {
  const now = Date.now();
  const arr = [];
  // random walk ending near seedPnl if provided
  let val = seedPnl - days * 2; // start lower
  // seeded-ish drift
  for (let i = days - 1; i >= 0; i--) {
    const t = now - i * 24 * 3600 * 1000;
    // daily move: -45..+55 bias slightly up
    const drift = (Math.random() - 0.46) * 80;
    val += drift;
    // clamp some mean reversion
    if (i === 0 && seedPnl !== 0) {
      // nudge last point toward seedPnl for continuity
      val = val * 0.6 + seedPnl * 0.4;
    }
    arr.push({
      ts: t,
      date: new Date(t).toISOString().slice(0, 10),
      pnl: Math.round(val * 100) / 100,
    });
  }
  // ensure monotonic-ish last value not too wild
  return arr;
}

export function getCumulativePnlHistory(positions, paperTrades = []) {
  // Try persisted history first
  const stored = loadPnlHistory();
  if (stored && stored.length > 0) return stored;
  // calculate cumulative from current snapshot if we have positions with pnl
  const currentTotal = [...positions, ...paperTrades].reduce((s, p) => s + (Number(p.pnl ?? p.currentPnl ?? 0) || 0), 0);
  // generate mock that ends near currentTotal
  const mock = generateMockHistory(30, currentTotal || 0);
  // if we generated mock, persist
  if (mock.length) savePnlHistory(mock);
  return mock;
}

export function appendPnlPoint(history, pnlValue) {
  const now = Date.now();
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const last = history[history.length - 1];
  // if last point is today, update it instead of appending duplicate
  if (last && last.date === todayStr) {
    const updated = [...history];
    updated[updated.length - 1] = { ...last, pnl: Math.round(pnlValue * 100) / 100, ts: now };
    return updated;
  }
  return [...history, { ts: now, date: todayStr, pnl: Math.round(pnlValue * 100) / 100 }];
}

export default function PnlChart({ positions = [], paperTrades = [], height = 160 }) {
  const currentPnl = useMemo(() => {
    const posPnl = positions.reduce((s, p) => s + (Number(p.pnl) || 0), 0);
    const ptPnl = (paperTrades || []).reduce((s, p) => s + (Number(p.currentPnl ?? p.pnl) || 0), 0);
    return posPnl + ptPnl;
  }, [positions, paperTrades]);

  const [history, setHistory] = useState(() => {
    const stored = loadPnlHistory();
    if (stored) return stored;
    const mock = generateMockHistory(30, currentPnl);
    return mock;
  });

  const [range, setRange] = useState("30D"); // 7D | 30D | 90D

  // persist initial mock if nothing stored
  useEffect(() => {
    if (!loadPnlHistory() && history.length > 0) {
      savePnlHistory(history);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when currentPnl changes meaningfully, append/update today's point
  useEffect(() => {
    // only auto-track if we have real positions/paper data
    if (positions.length === 0 && (!paperTrades || paperTrades.length === 0)) return;
    // don't spam: update history in place for same day
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      // if last pnl already matches currentPnl within 0.01, skip
      if (last && Math.abs(last.pnl - currentPnl) < 0.01) return prev;
      const next = appendPnlPoint(prev, currentPnl);
      savePnlHistory(next);
      return next;
    });
  }, [currentPnl, positions.length, paperTrades]);

  const daysMap = { "7D": 7, "30D": 30, "90D": 90 };
  const visibleCount = daysMap[range] || 30;

  const visible = useMemo(() => {
    if (history.length <= visibleCount) return history;
    return history.slice(-visibleCount);
  }, [history, visibleCount]);

  const stats = useMemo(() => {
    if (!visible.length) return { min: 0, max: 0, first: 0, last: 0, change: 0, changePct: 0 };
    const vals = visible.map((d) => d.pnl);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const first = vals[0];
    const last = vals[vals.length - 1];
    const change = last - first;
    const changePct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;
    return { min, max, first, last, change, changePct };
  }, [visible]);

  const handleReset = () => {
    const mock = generateMockHistory(visibleCount, currentPnl);
    // pad to at least visibleCount length, keep older if 90D
    let next;
    if (range === "90D") {
      next = generateMockHistory(90, currentPnl);
    } else {
      next = mock;
    }
    setHistory(next);
    savePnlHistory(next);
  };

  // SVG geometry
  const W = 800;
  const H = height;
  const padL = 48;
  const padR = 16;
  const padT = 12;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const minY = stats.min;
  const maxY = stats.max;
  const rangeY = maxY - minY || 1;
  // add 10% padding so line not on edge
  const yPad = rangeY * 0.12 || 10;
  const yMin = minY - yPad;
  const yMax = maxY + yPad;
  const ySpan = yMax - yMin || 1;

  const points = visible.map((d, i) => {
    const x = padL + (visible.length === 1 ? innerW / 2 : (i / (visible.length - 1)) * innerW);
    const y = padT + (1 - (d.pnl - yMin) / ySpan) * innerH;
    return { x, y, d };
  });

  const pathD = points.length
    ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ")
    : "";
  const areaD = points.length
    ? `${pathD} L ${points[points.length - 1].x} ${padT + innerH} L ${points[0].x} ${padT + innerH} Z`
    : "";

  const zeroY = padT + (1 - (0 - yMin) / ySpan) * innerH;
  const showZero = zeroY >= padT && zeroY <= padT + innerH;

  const isPositive = stats.last >= 0;

  return (
    <div
      data-testid="pnl-chart"
      style={{
        background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
        border: `1px solid ${T.border}`,
        borderLeft: `4px solid ${isPositive ? T.green : T.red}`,
        borderRadius: 12,
        padding: "16px 20px",
        boxShadow: `0 4px 20px rgba(0,0,0,0.3)`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>PNL EQUITY CURVE</span>
            <span
              style={{
                background: isPositive ? T.greenDim : T.redDim,
                color: isPositive ? T.green : T.red,
                border: `1px solid ${isPositive ? T.greenMid : T.red + "44"}`,
                borderRadius: 6,
                padding: "2px 8px",
                fontFamily: T.font,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {fmtUSD(stats.last, 2)} {stats.change >= 0 ? "▲" : "▼"} {fmtUSD(Math.abs(stats.change), 2)}
            </span>
          </div>
          <div style={{ color: T.textMuted, fontFamily: T.fontSans, fontSize: 11, marginTop: 4 }}>
            Cumulative realized + unrealized · {range} · {visible.length} points ·{" "}
            <span style={{ color: T.textSecondary }}>{stats.min !== stats.max ? `${fmtUSD(stats.min, 0)} → ${fmtUSD(stats.max, 0)}` : "flat"}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {["7D", "30D", "90D"].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                background: range === r ? T.greenDim : T.bg1,
                border: `1px solid ${range === r ? T.greenMid : T.border}`,
                color: range === r ? T.green : T.textSecondary,
                borderRadius: 6,
                padding: "5px 10px",
                cursor: "pointer",
                fontFamily: T.fontSans,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {r}
            </button>
          ))}
          <button
            onClick={handleReset}
            title="Regenerate mock history"
            style={{
              background: T.bg1,
              border: `1px solid ${T.border}`,
              color: T.textMuted,
              borderRadius: 6,
              padding: "5px 10px",
              cursor: "pointer",
              fontFamily: T.fontSans,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            ↻ Reset
          </button>
        </div>
      </div>

      {/* SVG chart */}
      <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, overflowX: "auto" }}>
        {visible.length === 0 ? (
          <div style={{ color: T.textMuted, fontFamily: T.font, fontSize: 12, textAlign: "center", padding: 40 }}>No PnL history yet</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", minWidth: 520 }}>
            {/* grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const y = padT + t * innerH;
              return <line key={t} x1={padL} x2={W - padR} y1={y} y2={y} stroke={T.border} strokeWidth={0.7} strokeDasharray="4 4" opacity={0.9} />;
            })}
            {/* zero line */}
            {showZero && <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke={T.textMuted} strokeWidth={1} strokeDasharray="6 3" opacity={0.5} />}
            {/* area */}
            <path d={areaD} fill={isPositive ? "rgba(0,240,168,0.08)" : "rgba(255,51,102,0.08)"} stroke="none" />
            {/* line */}
            <path d={pathD} fill="none" stroke={isPositive ? T.green : T.red} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {/* dots */}
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={points.length > 60 ? 1.2 : 2.2} fill={isPositive ? T.green : T.red} stroke={T.bg1} strokeWidth={1}>
                <title>
                  {p.d.date}: {fmtUSD(p.d.pnl, 2)}
                </title>
              </circle>
            ))}
            {/* y labels */}
            <text x={padL - 8} y={padT + 4} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill={T.textMuted}>
              {fmtUSD(yMax, 0)}
            </text>
            <text x={padL - 8} y={padT + innerH / 2 + 4} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill={T.textMuted}>
              {fmtUSD((yMax + yMin) / 2, 0)}
            </text>
            <text x={padL - 8} y={padT + innerH} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill={T.textMuted}>
              {fmtUSD(yMin, 0)}
            </text>
            {/* x labels */}
            {visible.length > 0 && (
              <>
                <text x={padL} y={H - 4} textAnchor="start" fontFamily="JetBrains Mono, monospace" fontSize="10" fill={T.textMuted}>
                  {visible[0].date.slice(5)}
                </text>
                {visible.length > 2 && (
                  <text x={W / 2} y={H - 4} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="10" fill={T.textMuted}>
                    {visible[Math.floor(visible.length / 2)].date.slice(5)}
                  </text>
                )}
                <text x={W - padR} y={H - 4} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill={T.textMuted}>
                  {visible[visible.length - 1].date.slice(5)}
                </text>
              </>
            )}
          </svg>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ color: T.textSecondary, fontFamily: T.fontSans, fontSize: 11 }}>
          Last: <strong style={{ color: pnlColor(stats.last), fontFamily: T.font }}>{fmtUSD(stats.last, 2)}</strong>
        </span>
        <span style={{ color: T.textSecondary, fontFamily: T.fontSans, fontSize: 11 }}>
          Change ({range}):{" "}
          <strong style={{ color: pnlColor(stats.change), fontFamily: T.font }}>
            {stats.change >= 0 ? "+" : ""}
            {fmtUSD(stats.change, 2)}
          </strong>
        </span>
        <span style={{ color: T.textMuted, fontFamily: T.fontSans, fontSize: 11 }}>
          Range: {fmtUSD(stats.min, 0)} — {fmtUSD(stats.max, 0)}
        </span>
        <span style={{ color: T.textMuted, fontFamily: T.fontSans, fontSize: 10, marginLeft: "auto" }}>localStorage: {PNL_HISTORY_KEY}</span>
      </div>
    </div>
  );
}
