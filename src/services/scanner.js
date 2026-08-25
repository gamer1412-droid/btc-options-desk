import { STRATEGY_CONFIG } from "../config/strategyConfig.js";

// ─── Entry Signal Scanner v2.1 (Adaptive Multi-Strategy) ──────────────────────
// Scans Binance Options market marks to find opportunities matching Production Rules:
// 1. Bullish Short Put (Naked / Cash-Secured Put for Strong Bullish / High IV regimes)
// 2. Skewed Strangle (Bullish Strangle with Wide OTM Call)
// 3. Standard Short Strangle (Delta-Neutral for Sideway / Normal regimes)

export function scanEntryOpportunities(marksData, btcPrice, ivRank = null, currentPositions = [], marketContext = {}) {
  if (!Array.isArray(marksData) || marksData.length === 0 || !btcPrice) {
    return [];
  }

  const cfg = STRATEGY_CONFIG;
  const now = Date.now();
  const parsedContracts = [];

  // Build a set of currently held position symbols and strike-expiry keys
  const heldSymbols = new Set();
  const heldKeys = new Set();
  if (Array.isArray(currentPositions)) {
    for (const p of currentPositions) {
      if (p.id) heldSymbols.add(p.id);
      if (p.strike && p.expiry) {
        const typeStr = p.type?.toLowerCase().includes("call") ? "C" : "P";
        heldKeys.add(`${p.expiry}-${p.strike}-${typeStr}`);
      }
    }
  }

  for (const m of marksData) {
    if (!m.symbol || !m.symbol.startsWith("BTC-")) continue;

    const parts = m.symbol.split("-");
    if (parts.length < 4) continue;

    const expiryRaw = parts[1]; // YYMMDD
    if (expiryRaw.length !== 6) continue;

    const y = 2000 + Number(expiryRaw.slice(0, 2));
    const mo = Number(expiryRaw.slice(2, 4));
    const d = Number(expiryRaw.slice(4, 6));
    const expMs = Date.UTC(y, mo - 1, d, 8, 0, 0);
    const dte = Math.max(0, Math.ceil((expMs - now) / 86400000));

    // Scan within broad window 7 to 35 days (preferred 18–25 days, ideal 14–28 days)
    if (dte < 7 || dte > 35) continue;

    const strike = Number(parts[2]);
    const optType = parts[3] === "C" ? "Call" : parts[3] === "P" ? "Put" : null;
    if (!optType || !strike) continue;

    const delta = Number(m.delta) || 0;
    const theta = Number(m.theta) || 0;
    const markPrice = Number(m.markPrice) || 0;
    const rawIV = Number(m.markIV) || 0;
    const iv = rawIV > 0 ? (rawIV <= 5 ? rawIV * 100 : rawIV) : 0;

    if (markPrice <= 0) continue;

    const expiry = new Date(expMs).toISOString().slice(0, 10);
    const isHeld = heldSymbols.has(m.symbol) || heldKeys.has(`${expiry}-${strike}-${parts[3]}`);

    parsedContracts.push({
      symbol: m.symbol,
      strike,
      type: optType,
      expiry,
      dte,
      delta,
      theta,
      markPrice: Math.round(markPrice * 10) / 10,
      iv: Math.round(iv * 10) / 10,
      isHeld,
    });
  }

  // Group by expiry
  const byExpiry = new Map();
  for (const c of parsedContracts) {
    if (!byExpiry.has(c.expiry)) {
      byExpiry.set(c.expiry, { puts: [], calls: [], dte: c.dte });
    }
    const group = byExpiry.get(c.expiry);
    if (c.type === "Put") group.puts.push(c);
    else if (c.type === "Call") group.calls.push(c);
  }

  const results = [];
  const isBullishRegime = marketContext.distFromMA20 != null && marketContext.distFromMA20 > 7.0;

  for (const [expiry, { puts, calls, dte }] of byExpiry.entries()) {
    const isPreferredDTE = dte >= cfg.dte.preferredMin && dte <= cfg.dte.preferredMax; // 18-25 days
    const isIdealDTE = dte >= cfg.dte.min && dte <= cfg.dte.max; // 14-28 days
    const baseDTEScore = isPreferredDTE ? 150 : isIdealDTE ? 100 : 50;

    // ──────────────────────────────────────────────────────────────────────────
    // 1. STRATEGY: Bullish Short Put (Naked Put / Cash-Secured Put)
    // ──────────────────────────────────────────────────────────────────────────
    const candidatePuts = puts
      .filter(p => p.delta <= -0.14 && p.delta >= -0.26 && p.strike < btcPrice)
      .sort((a, b) => Math.abs(a.delta - (-0.18)) - Math.abs(b.delta - (-0.18)));

    if (candidatePuts.length > 0) {
      const bestPut = candidatePuts[0];
      const putPremium = Math.round(bestPut.markPrice);
      const putTheta = Math.round(Math.abs(bestPut.theta));
      const breakevenLow = Math.round(bestPut.strike - putPremium);
      const putDistancePct = (((btcPrice - bestPut.strike) / btcPrice) * 100).toFixed(1);
      const estMarginReq = Math.round(btcPrice * 0.15); // ~15% margin for single short put
      const returnOnMarginPct = estMarginReq > 0 ? ((putPremium / estMarginReq) * 100).toFixed(1) : "0.0";
      const isPutHeld = Boolean(bestPut.isHeld);

      // In bullish regimes, Short Put receives priority bonus score
      const regimeBonus = isBullishRegime ? 60 : 0;
      const shortPutScore = baseDTEScore + regimeBonus + putPremium / 5;

      results.push({
        id: `SHORT_PUT-${bestPut.symbol}`,
        strategy: "SHORT_PUT",
        strategyName: "BULLISH SHORT PUT",
        badgeText: "BULLISH PUT",
        badgeColor: "#10b981", // green
        expiry,
        dte,
        btcPrice: Math.round(btcPrice),
        put: bestPut,
        putStrike: bestPut.strike,
        putDelta: bestPut.delta.toFixed(2),
        putIV: bestPut.iv,
        putMark: bestPut.markPrice,
        totalPremium: putPremium,
        totalTheta: putTheta,
        breakevenLow,
        putDistancePct,
        returnOnMarginPct,
        ivRank: ivRank || bestPut.iv,
        isPreferredDTE,
        isIdealDTE,
        isPutHeld,
        isFullyHeld: isPutHeld,
        isPartiallyHeld: false,
        score: shortPutScore,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. STRATEGY: Skewed Strangle (Bullish Bias with Wide OTM Call)
    // ──────────────────────────────────────────────────────────────────────────
    // Put delta ~ 0.18–0.24, Call delta ~ 0.08–0.12 (extra wide upside buffer)
    const skewedPuts = puts
      .filter(p => p.delta <= -0.16 && p.delta >= -0.26 && p.strike < btcPrice)
      .sort((a, b) => Math.abs(a.delta - (-0.20)) - Math.abs(b.delta - (-0.20)));

    const wideCalls = calls
      .filter(c => c.delta >= 0.06 && c.delta <= 0.13 && c.strike > btcPrice)
      .sort((a, b) => Math.abs(a.delta - 0.10) - Math.abs(b.delta - 0.10));

    if (skewedPuts.length > 0 && wideCalls.length > 0) {
      const bestSkewPut = skewedPuts[0];
      const bestSkewCall = wideCalls[0];

      const totalPremium = Math.round(bestSkewPut.markPrice + bestSkewCall.markPrice);
      const totalTheta = Math.round(Math.abs(bestSkewPut.theta) + Math.abs(bestSkewCall.theta));
      const breakevenLow = Math.round(bestSkewPut.strike - totalPremium);
      const breakevenHigh = Math.round(bestSkewCall.strike + totalPremium);

      const putDistancePct = (((btcPrice - bestSkewPut.strike) / btcPrice) * 100).toFixed(1);
      const callDistancePct = (((bestSkewCall.strike - btcPrice) / btcPrice) * 100).toFixed(1);

      const isPutHeld = Boolean(bestSkewPut.isHeld);
      const isCallHeld = Boolean(bestSkewCall.isHeld);
      const isFullyHeld = isPutHeld && isCallHeld;
      const isPartiallyHeld = isPutHeld || isCallHeld;

      const regimeBonus = isBullishRegime ? 30 : 0;
      const skewedScore = baseDTEScore + regimeBonus + totalPremium / 10;

      results.push({
        id: `SKEWED_STRANGLE-${bestSkewPut.symbol}_${bestSkewCall.symbol}`,
        strategy: "SKEWED_STRANGLE",
        strategyName: "SKEWED STRANGLE (BULLISH)",
        badgeText: "SKEWED STRANGLE",
        badgeColor: "#38bdf8", // sky blue
        expiry,
        dte,
        btcPrice: Math.round(btcPrice),
        put: bestSkewPut,
        call: bestSkewCall,
        putStrike: bestSkewPut.strike,
        putDelta: bestSkewPut.delta.toFixed(2),
        putIV: bestSkewPut.iv,
        putMark: bestSkewPut.markPrice,
        callStrike: bestSkewCall.strike,
        callDelta: bestSkewCall.delta.toFixed(2),
        callIV: bestSkewCall.iv,
        callMark: bestSkewCall.markPrice,
        totalPremium,
        totalTheta,
        breakevenLow,
        breakevenHigh,
        putDistancePct,
        callDistancePct,
        ivRank: ivRank || Math.round((bestSkewPut.iv + bestSkewCall.iv) / 2),
        isPreferredDTE,
        isIdealDTE,
        isPutHeld,
        isCallHeld,
        isFullyHeld,
        isPartiallyHeld,
        score: skewedScore,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. STRATEGY: Standard Delta-Neutral Strangle (for Sideway regimes)
    // ──────────────────────────────────────────────────────────────────────────
    const stdPuts = puts
      .filter(p => p.delta <= -0.14 && p.delta >= -0.26 && p.strike < btcPrice)
      .sort((a, b) => Math.abs(a.delta - (-0.18)) - Math.abs(b.delta - (-0.18)));

    const stdCalls = calls
      .filter(c => c.delta >= 0.13 && c.delta <= 0.22 && c.strike > btcPrice)
      .sort((a, b) => Math.abs(a.delta - 0.18) - Math.abs(b.delta - 0.18));

    if (stdPuts.length > 0 && stdCalls.length > 0) {
      const bestPut = stdPuts[0];
      const bestCall = stdCalls[0];

      const totalPremium = Math.round(bestPut.markPrice + bestCall.markPrice);
      const totalTheta = Math.round(Math.abs(bestPut.theta) + Math.abs(bestCall.theta));
      const breakevenLow = Math.round(bestPut.strike - totalPremium);
      const breakevenHigh = Math.round(bestCall.strike + totalPremium);

      const putDistancePct = (((btcPrice - bestPut.strike) / btcPrice) * 100).toFixed(1);
      const callDistancePct = (((bestCall.strike - btcPrice) / btcPrice) * 100).toFixed(1);

      const isPutHeld = Boolean(bestPut.isHeld);
      const isCallHeld = Boolean(bestCall.isHeld);
      const isFullyHeld = isPutHeld && isCallHeld;
      const isPartiallyHeld = isPutHeld || isCallHeld;

      const strangleScore = baseDTEScore + totalPremium / 10;

      results.push({
        id: `STRANGLE-${bestPut.symbol}_${bestCall.symbol}`,
        strategy: "STRANGLE",
        strategyName: "SHORT STRANGLE (STANDARD)",
        badgeText: "STANDARD STRANGLE",
        badgeColor: "#a855f7", // purple
        expiry,
        dte,
        btcPrice: Math.round(btcPrice),
        put: bestPut,
        call: bestCall,
        putStrike: bestPut.strike,
        putDelta: bestPut.delta.toFixed(2),
        putIV: bestPut.iv,
        putMark: bestPut.markPrice,
        callStrike: bestCall.strike,
        callDelta: bestCall.delta.toFixed(2),
        callIV: bestCall.iv,
        callMark: bestCall.markPrice,
        totalPremium,
        totalTheta,
        breakevenLow,
        breakevenHigh,
        putDistancePct,
        callDistancePct,
        ivRank: ivRank || Math.round((bestPut.iv + bestCall.iv) / 2),
        isPreferredDTE,
        isIdealDTE,
        isPutHeld,
        isCallHeld,
        isFullyHeld,
        isPartiallyHeld,
        score: strangleScore,
      });
    }
  }

  // Sort by score descending (highest priority setup first)
  return results.sort((a, b) => b.score - a.score);
}

