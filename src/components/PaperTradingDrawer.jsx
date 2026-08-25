import { useState, useEffect, useCallback } from "react";
import { T } from "../tokens.js";
import { fmtUSD, pnlColor } from "../utils.js";
import { SoundFX } from "../services/soundFx.js";
import {
  loadPaperTrades,
  closePaperTrade,
  clearAllPaperTrades,
  calculatePaperTradeStats,
  savePaperTrades,
} from "../services/paperTrading.js";

export function PaperTradingDrawer({
  btcPrice = 90000,
  onClose,
}) {
  const [trades, setTrades] = useState([]);

  const refreshTrades = useCallback(() => {
    const list = loadPaperTrades();

    // Re-evaluate current PnL for OPEN trades using live btcPrice
    const updated = list.map(t => {
      if (t.status === "OPEN") {
        let simulatedLoss = 0;
        for (const leg of t.legs || []) {
          if (leg.type === "PUT" && btcPrice < leg.strike) {
            simulatedLoss += (leg.strike - btcPrice) * t.size;
          } else if (leg.type === "CALL" && btcPrice > leg.strike) {
            simulatedLoss += (btcPrice - leg.strike) * t.size;
          }
        }
        // As time passes or if price stays between strikes, theta decays and trade approaches max initial premium
        const currentPnl = t.initialPremiumTotal - simulatedLoss;
        return { ...t, currentPnl };
      }
      return t;
    });

    setTrades(updated);
    savePaperTrades(updated);
  }, [btcPrice]);

  useEffect(() => {
    refreshTrades();
  }, [refreshTrades]);

  const stats = calculatePaperTradeStats(trades);

  const handleClose = (tradeId) => {
    SoundFX.playSuccessChime();
    const updated = closePaperTrade(tradeId, "MANUAL_PROFIT_TAKE");
    setTrades(updated);
  };

  const handleClear = () => {
    if (window.confirm("ยืนยันล้างประวัติการจำลองเทรดทั้งหมด?")) {
      SoundFX.playClick();
      clearAllPaperTrades();
      setTrades([]);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(3, 5, 8, 0.85)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: `linear-gradient(180deg, #111722, #0a0e14)`,
          border: `1px solid ${T.borderHover}`,
          borderRadius: 16,
          width: "100%",
          maxWidth: 780,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: `0 24px 60px rgba(0,0,0,0.8), 0 0 30px ${T.green}18`,
          padding: 24,
          position: "relative",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🧪</span>
            <div>
              <h3 style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 16, fontWeight: 800, margin: 0 }}>
                PAPER TRADING SIMULATOR SANDBOX
              </h3>
              <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans }}>
                จำลองผลตอบแทนจริงตามราคา BTC Spot และ Theta Decay โดยไม่มีความเสี่ยง
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              SoundFX.playClick();
              onClose?.();
            }}
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              color: T.textSecondary,
              borderRadius: 8,
              width: 32,
              height: 32,
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        {/* Performance Stats Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
            <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans, fontWeight: 600 }}>WIN RATE</div>
            <div style={{ color: Number(stats.winRate) >= 60 ? T.green : T.blue, fontFamily: T.font, fontSize: 18, fontWeight: 800 }}>
              {stats.winRate}%
            </div>
            <div style={{ color: T.textMuted, fontSize: 9 }}>{stats.closedTradesCount} Closed</div>
          </div>

          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
            <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans, fontWeight: 600 }}>TOTAL P&L</div>
            <div style={{ color: pnlColor(stats.totalPnl), fontFamily: T.font, fontSize: 18, fontWeight: 800 }}>
              {stats.totalPnl >= 0 ? "+" : ""}{fmtUSD(stats.totalPnl, 2)}
            </div>
            <div style={{ color: T.textMuted, fontSize: 9 }}>Realized + Unrealized</div>
          </div>

          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
            <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans, fontWeight: 600 }}>OPEN TRADES</div>
            <div style={{ color: T.blue, fontFamily: T.font, fontSize: 18, fontWeight: 800 }}>
              {stats.openTradesCount}
            </div>
            <div style={{ color: T.textMuted, fontSize: 9 }}>Active simulated</div>
          </div>

          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
            <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans, fontWeight: 600 }}>PROFIT FACTOR</div>
            <div style={{ color: T.purple, fontFamily: T.font, fontSize: 18, fontWeight: 800 }}>
              {stats.profitFactor}
            </div>
            <div style={{ color: T.textMuted, fontSize: 9 }}>Gain / Loss ratio</div>
          </div>
        </div>

        {/* Simulated Trades List */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
          {trades.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: T.textMuted, fontFamily: T.font, fontSize: 12 }}>
              ยังไม่มี Simulated Trades <br />
              <span style={{ fontSize: 11, color: T.textSecondary }}>
                ไปที่แท็บ 🎯 <strong>SCANNER</strong> แล้วกดปุ่ม <strong>"⚡ SIMULATE"</strong> เพื่อทดลองเทรด
              </span>
            </div>
          ) : (
            trades.map(trade => {
              const isOpen = trade.status === "OPEN";
              const pnl = isOpen ? trade.currentPnl : trade.finalPnl;
              const pnlPct = trade.initialPremiumTotal > 0 ? (pnl / trade.initialPremiumTotal) * 100 : 0;

              return (
                <div
                  key={trade.id}
                  style={{
                    background: T.bg2,
                    border: `1px solid ${isOpen ? T.borderHover : T.border}`,
                    borderLeft: `4px solid ${isOpen ? T.green : T.textMuted}`,
                    borderRadius: 8,
                    padding: "12px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        background: isOpen ? T.greenDim : T.bg3,
                        color: isOpen ? T.green : T.textMuted,
                        border: `1px solid ${isOpen ? T.greenMid : T.border}`,
                        borderRadius: 4,
                        padding: "1px 6px",
                        fontSize: 9,
                        fontWeight: 800,
                        fontFamily: T.font,
                      }}>
                        {trade.status}
                      </span>
                      <strong style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13 }}>
                        {trade.strategyTitle || trade.strategy} ({trade.size} BTC)
                      </strong>
                      <span style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans }}>
                        DTE: {trade.dte}d
                      </span>
                    </div>

                    <div style={{ color: T.textMuted, fontSize: 11, marginTop: 4, fontFamily: T.font }}>
                      Entry BTC: {fmtUSD(trade.entryBtcPrice, 0)} │ Premium Collected: +{fmtUSD(trade.initialPremiumTotal, 2)}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: pnlColor(pnl), fontFamily: T.font, fontSize: 15, fontWeight: 800 }}>
                        {pnl >= 0 ? "+" : ""}{fmtUSD(pnl, 2)}
                      </div>
                      <div style={{ color: pnlColor(pnl), fontSize: 10, fontFamily: T.font, fontWeight: 600 }}>
                        ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
                      </div>
                    </div>

                    {isOpen && (
                      <button
                        onClick={() => handleClose(trade.id)}
                        style={{
                          background: `linear-gradient(135deg, ${T.green}, #00b380)`,
                          border: "none",
                          color: "#05080c",
                          borderRadius: 6,
                          padding: "6px 12px",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: "pointer",
                          fontFamily: T.fontSans,
                        }}
                      >
                        CLOSE & TP
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {trades.length > 0 && (
            <button
              onClick={handleClear}
              style={{
                background: "transparent",
                border: "none",
                color: T.red,
                fontSize: 11,
                cursor: "pointer",
                fontFamily: T.fontSans,
                textDecoration: "underline",
              }}
            >
              Clear All Sandbox History
            </button>
          )}

          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={() => {
                SoundFX.playClick();
                onClose?.();
              }}
              style={{
                background: T.bg2,
                border: `1px solid ${T.border}`,
                color: T.textPrimary,
                borderRadius: 6,
                padding: "6px 18px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: T.fontSans,
              }}
            >
              Close Sandbox
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
