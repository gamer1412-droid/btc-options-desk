import { useState, useMemo } from "react";
import { T } from "../tokens.js";
import { runBacktest, generateMockBtData } from "../services/backtest.js";

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", minWidth: 140 }}>
      <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, fontFamily: "Outfit, sans-serif", fontWeight: 700 }}>{label}</div>
      <div style={{ color: color || T.textPrimary, fontFamily: "JetBrains Mono, monospace", fontSize: 18, fontWeight: 900, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: T.textMuted, fontSize: 10, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function EquitySparkline({ curve, color }) {
  if (!curve || curve.length < 2) return <div style={{ color: T.textMuted, fontSize: 11, padding: 12 }}>No equity data yet</div>;
  const w = 320, h = 72, pad = 6;
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (curve.length - 1);
  const points = curve.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const last = curve[curve.length - 1];
  const first = curve[0];
  const up = last >= first;
  const lineColor = color || (up ? T.green : T.red);
  return (
    <svg width={w} height={h} style={{ display: "block", background: T.bg1, borderRadius: 8, border: `1px solid ${T.border}` }}>
      <polyline fill="none" stroke={lineColor} strokeWidth="1.8" points={points} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
      {/* zero line if crosses */}
      {min < 0 && max > 0 && (() => {
        const y0 = h - pad - ((0 - min) / range) * (h - pad * 2);
        return <line x1={pad} x2={w - pad} y1={y0} y2={y0} stroke={T.border} strokeDasharray="3 3" />;
      })()}
    </svg>
  );
}

export function BacktestPanel() {
  const [btData, setBtData] = useState(() => generateMockBtData({ days: 90, startPrice: 65000, seed: 42 }));
  const [days, setDays] = useState(90);
  const [startPrice, setStartPrice] = useState(65000);
  const [seed, setSeed] = useState(42);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const handleGenerate = () => {
    const data = generateMockBtData({ days: Number(days) || 90, startPrice: Number(startPrice) || 65000, seed: Number(seed) || 42 });
    setBtData(data);
    setResult(null);
  };

  const handleRun = () => {
    setRunning(true);
    // allow UI to paint
    setTimeout(() => {
      try {
        const r = runBacktest({ historicalMarks: btData.historicalMarks, btcPrices: btData.btcPrices });
        setResult(r);
      } catch (e) {
        setResult({ error: e.message, trades: [], equityCurve: [] });
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  const btcSpark = useMemo(() => btData.btcPrices.slice(-60), [btData]);

  return (
    <div style={{ padding: "0 16px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      {/* Controls */}
      <div style={{ background: `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`, border: `1px solid ${T.border}`, borderLeft: `4px solid ${T.purple}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🧪</span>
            <span style={{ color: T.textPrimary, fontFamily: "Outfit, sans-serif", fontWeight: 900, fontSize: 13, letterSpacing: 1.2 }}>BACKTEST ENGINE — Synthetic Walk-Forward</span>
            <span style={{ background: T.purpleDim, color: T.purple, border: `1px solid ${T.purple}44`, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, fontFamily: "JetBrains Mono, monospace" }}>Δ × BTC MOVE PnL</span>
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, fontFamily: "Outfit, sans-serif" }}>
            TP 35% · DTE ≤2 · Stop 2× · {btData.btcPrices.length} days synthetic
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: T.textMuted, fontSize: 10, letterSpacing: 0.8, fontFamily: "Outfit, sans-serif" }}>DAYS</span>
            <input type="number" value={days} onChange={e => setDays(e.target.value)} min={30} max={365} style={{ background: T.bg0, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.textPrimary, fontFamily: "JetBrains Mono, monospace", width: 90 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: T.textMuted, fontSize: 10, letterSpacing: 0.8, fontFamily: "Outfit, sans-serif" }}>START BTC</span>
            <input type="number" value={startPrice} onChange={e => setStartPrice(e.target.value)} step={1000} style={{ background: T.bg0, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.textPrimary, fontFamily: "JetBrains Mono, monospace", width: 120 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: T.textMuted, fontSize: 10, letterSpacing: 0.8, fontFamily: "Outfit, sans-serif" }}>SEED</span>
            <input type="number" value={seed} onChange={e => setSeed(e.target.value)} style={{ background: T.bg0, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.textPrimary, fontFamily: "JetBrains Mono, monospace", width: 90 }} />
          </label>
          <button onClick={handleGenerate} style={{ background: T.bg1, border: `1px solid ${T.border}`, color: T.textSecondary, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 12 }}>↻ Regenerate</button>
          <button onClick={handleRun} disabled={running} style={{ background: running ? T.bg2 : `linear-gradient(135deg, ${T.purple}, #7c3aed)`, border: `1px solid ${T.purple}`, color: "#fff", borderRadius: 8, padding: "8px 18px", cursor: running ? "not-allowed" : "pointer", fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: 12, opacity: running ? 0.6 : 1 }}>
            {running ? "Running…" : "▶ Run Backtest"}
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: T.textMuted, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>BTC {btData.btcPrices[0]} → {btData.btcPrices[btData.btcPrices.length - 1]}</span>
            <EquitySparkline curve={btcSpark} color={T.blue} />
          </div>
        </div>
        <div style={{ color: T.textMuted, fontSize: 10, fontFamily: "Outfit, sans-serif", lineHeight: 1.4 }}>
          Synthetic daily walk + synthetic option chain (4 expiries × 6 strikes). Backtest scans entry opportunities each day via <code style={{ background: T.bg0, padding: "1px 5px", borderRadius: 4 }}>scanEntryOpportunities</code> + <code style={{ background: T.bg0, padding: "1px 5px", borderRadius: 4 }}>evaluateEntryRules</code>, holds until TP/DTE/Stop, PnL = premium − adverse Δ×BTCmove.
        </div>
      </div>

      {/* Results */}
      {result && !result.error && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Stat label="WIN RATE" value={`${result.winRate}%`} sub={`${result.wins}W / ${result.losses}L of ${result.numTrades}`} color={result.winRate >= 55 ? T.green : result.winRate >= 45 ? T.amber : T.red} />
            <Stat label="TOTAL PnL" value={`${result.totalPnl >= 0 ? "+" : ""}$${result.totalPnl}`} sub={`avg $${result.avgReturn}/trade`} color={result.totalPnl >= 0 ? T.green : T.red} />
            <Stat label="AVG PREMIUM" value={`$${result.avgPremium}`} sub={`per 1 BTC leg`} color={T.blue} />
            <Stat label="MAX DD" value={`-$${result.maxDrawdown}`} sub={`${result.maxDrawdownPct}% of notional`} color={T.red} />
            <Stat label="SHARPE-LIKE" value={result.sharpe} sub="mean/std × √252" color={result.sharpe >= 1 ? T.green : result.sharpe >= 0 ? T.amber : T.red} />
            <Stat label="TRADES" value={result.numTrades} sub={`${result.days} days walk`} color={T.textPrimary} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ color: T.textPrimary, fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: 11, letterSpacing: 1, marginBottom: 8 }}>EQUITY CURVE (cumulative PnL)</div>
              <EquitySparkline curve={result.equityCurve} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: T.textMuted, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
                <span>D0 $0</span><span>D{result.days - 1} ${result.equityCurve[result.equityCurve.length - 1] ?? 0}</span>
              </div>
            </div>
            <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ color: T.textPrimary, fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: 11, letterSpacing: 1, marginBottom: 8 }}>BTC PRICE PATH</div>
              <EquitySparkline curve={btData.btcPrices} color={T.blue} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: T.textMuted, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
                <span>${btData.btcPrices[0]}</span><span>${btData.btcPrices[btData.btcPrices.length - 1]}</span>
              </div>
            </div>
          </div>

          {/* Trade log */}
          <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: T.textPrimary, fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: 11, letterSpacing: 1 }}>TRADE LOG — {result.trades.length} trades</span>
              <span style={{ color: T.textMuted, fontSize: 10, fontFamily: "Outfit, sans-serif" }}>Simplified PnL: premium − adverse Δ×BTCmove · TP 35% · DTE ≤2 · Stop 2×</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: T.bg2, color: T.textMuted, textAlign: "left", fontSize: 9, letterSpacing: 0.8 }}>
                    <th style={{ padding: "8px 10px" }}>#</th>
                    <th style={{ padding: "8px 10px" }}>STRATEGY</th>
                    <th style={{ padding: "8px 10px" }}>ENTRY D / BTC</th>
                    <th style={{ padding: "8px 10px" }}>STRIKES</th>
                    <th style={{ padding: "8px 10px" }}>PREM</th>
                    <th style={{ padding: "8px 10px" }}>EXIT D / REASON</th>
                    <th style={{ padding: "8px 10px" }}>HOLD</th>
                    <th style={{ padding: "8px 10px" }}>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((t, i) => (
                    <tr key={t.id} style={{ borderTop: `1px solid ${T.border}`, background: i % 2 === 0 ? "transparent" : T.bg2 }}>
                      <td style={{ padding: "7px 10px", color: T.textMuted }}>{i + 1}</td>
                      <td style={{ padding: "7px 10px", color: t.strategy === "SHORT_PUT" ? T.green : t.strategy === "SKEWED_STRANGLE" ? T.blue : T.purple, fontWeight: 700 }}>{t.strategy}</td>
                      <td style={{ padding: "7px 10px", color: T.textSecondary }}>D{t.entryDay} ${t.entryBtcPrice}</td>
                      <td style={{ padding: "7px 10px", color: T.textPrimary }}>{t.putStrike ?? "—"}{t.callStrike ? ` / ${t.callStrike}` : ""}</td>
                      <td style={{ padding: "7px 10px", color: T.green }}>+${t.premium}</td>
                      <td style={{ padding: "7px 10px", color: T.textSecondary }}>D{t.exitDay} <span style={{ background: t.exitReason.startsWith("TP") ? T.greenDim : t.exitReason.startsWith("STOP") ? T.redDim : T.bg2, color: t.exitReason.startsWith("TP") ? T.green : t.exitReason.startsWith("STOP") ? T.red : T.textMuted, borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>{t.exitReason}</span></td>
                      <td style={{ padding: "7px 10px", color: T.textMuted }}>{t.daysHeld}d (DTE {t.dte}→{t.currentDte})</td>
                      <td style={{ padding: "7px 10px", color: t.pnl >= 0 ? T.green : T.red, fontWeight: 800 }}>{t.pnl >= 0 ? "+" : ""}${t.pnl} <span style={{ color: T.textMuted, fontWeight: 400 }}>({t.pnlPct}%)</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.trades.length === 0 && <div style={{ padding: 20, textAlign: "center", color: T.textMuted, fontSize: 12 }}>No trades passed entry rules in this walk.</div>}
            </div>
          </div>
        </>
      )}
      {result?.error && (
        <div style={{ background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 10, padding: 14, color: T.red, fontSize: 12 }}>Backtest error: {result.error}</div>
      )}
      {!result && (
        <div style={{ background: T.bg1, border: `1px dashed ${T.border}`, borderRadius: 10, padding: 24, textAlign: "center", color: T.textMuted, fontSize: 12, fontFamily: "Outfit, sans-serif" }}>
          Press <strong style={{ color: T.purple }}>▶ Run Backtest</strong> to simulate scanning + holding through the synthetic 90-day walk.
        </div>
      )}
    </div>
  );
}
