// ─── Entry Signal Scanner ───────────────────────────────────────────────────
// Scans Binance Options market marks to find Short Strangle opportunities matching Entry Rules:
// 1. DTE: 14–28 days (fallback 7–35 days)
// 2. Put Delta: -0.20 to -0.25 (target ~ -0.22)
// 3. Call Delta: +0.15 to +0.20 (target ~ +0.18)
// 4. Market IV > 30%

export function scanEntryOpportunities(marksData, btcPrice, ivRank = null, currentPositions = []) {
  if (!Array.isArray(marksData) || marksData.length === 0 || !btcPrice) {
    return [];
  }

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

    // Only look at DTE between 7 and 35 days (ideal: 14–28 days)
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

  const strangles = [];

  for (const [expiry, { puts, calls, dte }] of byExpiry.entries()) {
    // Filter candidate Puts: delta ideally between -0.25 and -0.18
    const candidatePuts = puts
      .filter(p => p.delta <= -0.14 && p.delta >= -0.32 && p.strike < btcPrice)
      .sort((a, b) => Math.abs(a.delta - (-0.22)) - Math.abs(b.delta - (-0.22)));

    // Filter candidate Calls: delta ideally between +0.15 and +0.22
    const candidateCalls = calls
      .filter(c => c.delta >= 0.12 && c.delta <= 0.28 && c.strike > btcPrice)
      .sort((a, b) => Math.abs(a.delta - 0.18) - Math.abs(b.delta - 0.18));

    if (candidatePuts.length > 0 && candidateCalls.length > 0) {
      const bestPut = candidatePuts[0];
      const bestCall = candidateCalls[0];

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

      // Score: prefer 14-28 DTE, higher premium, well-centered delta
      const isIdealDTE = dte >= 14 && dte <= 28;
      const score = (isIdealDTE ? 100 : 50) + totalPremium / 10;

      strangles.push({
        id: `STRANGLE-${bestPut.symbol}_${bestCall.symbol}`,
        strategy: "STRANGLE",
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
        isIdealDTE,
        isPutHeld,
        isCallHeld,
        isFullyHeld,
        isPartiallyHeld,
        score,
      });
    }
  }

  // Sort by score descending (best setup first)
  return strangles.sort((a, b) => b.score - a.score);
}

