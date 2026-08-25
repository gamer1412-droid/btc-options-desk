// ─── Paper Trading & Strategy Simulator Engine ─────────────────────────────
const STORAGE_KEY = "btc_desk_paper_trades_v1";

export function loadPaperTrades() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePaperTrades(trades) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  } catch {}
}

export function openPaperTrade(opp, size = 1) {
  const trades = loadPaperTrades();
  const newTrade = {
    id: "PT-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    openedAt: new Date().toISOString(),
    status: "OPEN", // "OPEN" | "CLOSED"
    strategy: opp.strategy || "SHORT_PUT",
    strategyTitle: opp.strategyTitle || opp.strategy,
    dte: opp.dte,
    expiryDate: opp.expiryDate,
    size: Number(size) || 1,
    entryBtcPrice: opp.btcPrice,
    initialPremiumTotal: (opp.totalPremiumUSD || opp.premiumUSD || 0) * (Number(size) || 1),
    currentPnl: 0,
    legs: [
      opp.putLeg && {
        type: "PUT",
        symbol: opp.putLeg.symbol,
        strike: opp.putLeg.strike,
        delta: opp.putLeg.delta,
        entryPrice: opp.putLeg.markPrice,
        markPrice: opp.putLeg.markPrice,
      },
      opp.callLeg && {
        type: "CALL",
        symbol: opp.callLeg.symbol,
        strike: opp.callLeg.strike,
        delta: opp.callLeg.delta,
        entryPrice: opp.callLeg.markPrice,
        markPrice: opp.callLeg.markPrice,
      },
    ].filter(Boolean),
  };

  trades.unshift(newTrade);
  savePaperTrades(trades);
  return newTrade;
}

export function closePaperTrade(tradeId, reason = "MANUAL_EXIT") {
  const trades = loadPaperTrades();
  const updated = trades.map(t => {
    if (t.id === tradeId && t.status === "OPEN") {
      return {
        ...t,
        status: "CLOSED",
        closedAt: new Date().toISOString(),
        closeReason: reason,
        finalPnl: t.currentPnl,
      };
    }
    return t;
  });
  savePaperTrades(updated);
  return updated;
}

export function clearAllPaperTrades() {
  savePaperTrades([]);
  return [];
}

export function calculatePaperTradeStats(trades = []) {
  const closed = trades.filter(t => t.status === "CLOSED");
  const open = trades.filter(t => t.status === "OPEN");

  const totalClosed = closed.length;
  const wins = closed.filter(t => (t.finalPnl || 0) > 0);
  const losses = closed.filter(t => (t.finalPnl || 0) < 0);

  const winRate = totalClosed > 0 ? (wins.length / totalClosed) * 100 : 0;
  const realizedPnl = closed.reduce((s, t) => s + (t.finalPnl || 0), 0);
  const unrealizedPnl = open.reduce((s, t) => s + (t.currentPnl || 0), 0);

  const totalGains = wins.reduce((s, t) => s + (t.finalPnl || 0), 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.finalPnl || 0), 0));
  const profitFactor = totalLosses > 0 ? (totalGains / totalLosses).toFixed(2) : totalGains > 0 ? "∞" : "0.00";

  return {
    totalTrades: trades.length,
    openTradesCount: open.length,
    closedTradesCount: totalClosed,
    winRate: winRate.toFixed(1),
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    profitFactor,
  };
}
