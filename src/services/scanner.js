import { STRATEGY_CONFIG, RISK_PROFILES } from "../config/strategyConfig.js";
import { classifyMarketRegime, MARKET_REGIMES } from "./marketRegime.js";

// ─── Dynamic Market Regime & Optimal Profile Selector ─────────────────────────
export function determineOptimalMarketProfile(marketContext = {}, accountInfo = null, currentPositions = []) {
  const { distFromMA20 = null, change24h = null, marketIv = null } = marketContext;
  const regime = marketContext.regime?.regime ? marketContext.regime : classifyMarketRegime(marketContext);
  const hasMarketData = [distFromMA20, change24h, marketIv].every(v => v != null && Number.isFinite(Number(v)));
  const absDist = hasMarketData ? Math.abs(Number(distFromMA20)) : 0;
  const absChange = hasMarketData ? Math.abs(Number(change24h)) : 0;
  const currentMarketIv = hasMarketData ? Number(marketIv) : null;
  const marginPct = accountInfo?.marginPct ?? 0;

  let chosenKey = "BALANCED_ALPHA";
  let rationale = "";
  let tag = "⚡ BALANCED ALPHA";
  let tagColor = "#00f0a8";

  if (regime.isNoTrade) {
    chosenKey = "CONSERVATIVE";
    tag = `⛔ ${regime.label}`;
    tagColor = regime.color;
    rationale = `${regime.reasons.join(" — ")} ระบบเลือก NO_TRADE และไม่ส่งสัญญาณเปิดสถานะใหม่`;
  }
  // 1. CONSERVATIVE TRIGGER: High Volatility, Extreme Distance, Bearish Dump, Extreme IV, or High Margin
  else if (marginPct >= 22 || regime.regime === MARKET_REGIMES.RANGE_HIGH_IV) {
    chosenKey = "CONSERVATIVE";
    tag = "🛡️ CONSERVATIVE (DEFENSIVE)";
    tagColor = "#38bdf8";
    if (marginPct >= 22) {
      rationale = `Margin ในพอร์ตค่อนข้างสูง (${marginPct}% / 30%) — ระบบเลือกแผน Conservative เพื่อจำกัดความเสี่ยง`;
    } else {
      rationale = `${regime.reasons.join(" — ")} เลือก Conservative Strangle และลดขนาดตาม Regime`;
    }
  }
  // Bull trend: directional premium only. High-yield is never auto-selected.
  else {
    chosenKey = "BALANCED_ALPHA";
    tag = "⚡ BALANCED ALPHA";
    tagColor = "#00f0a8";
    rationale = `${regime.reasons.join(" — ")} เลือกเฉพาะกลยุทธ์ Bullish ที่ผ่านกฎและลดขนาดตาม Regime`;
  }

  const profile = RISK_PROFILES[chosenKey] || RISK_PROFILES.BALANCED_ALPHA;

  return {
    key: chosenKey,
    profile,
    tag: regime.label,
    tagColor: regime.color,
    rationale,
    regime,
    metrics: {
      distFromMA20,
      change24h,
      marketIv: currentMarketIv,
      dataComplete: regime.regime !== MARKET_REGIMES.DATA_INCOMPLETE,
      marginPct,
      confidence: regime.confidence,
      allowedStrategies: regime.allowedStrategies,
      isNoTrade: regime.isNoTrade,
    },
  };
}

// ─── Entry Signal Scanner v2.5 (Yield Boost & Adaptive Multi-Strategy) ─────────
export function scanEntryOpportunities(
  marksData,
  btcPrice,
  marketIv = null,
  currentPositions = [],
  marketContext = {},
  selectedProfileKey = null
) {
  if (!Array.isArray(marksData) || marksData.length === 0 || !btcPrice) {
    return [];
  }

  const regime = marketContext.regime?.regime ? marketContext.regime : classifyMarketRegime({ ...marketContext, marketIv });
  if (regime.isNoTrade) return [];

  // If no profile key is provided or passed dynamically, auto-determine the best profile
  let activeProfileKey = selectedProfileKey;
  if (!activeProfileKey || !RISK_PROFILES[activeProfileKey]) {
    const autoSelection = determineOptimalMarketProfile(marketContext, null, currentPositions);
    activeProfileKey = autoSelection.key;
  }

  const profile = RISK_PROFILES[activeProfileKey] || RISK_PROFILES.BALANCED_ALPHA;

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

    // Scan within broad window 6 to 35 days
    if (dte < 6 || dte > 35) continue;

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
  const isBullishRegime = regime.regime === MARKET_REGIMES.BULL_TREND;

  for (const [expiry, { puts, calls, dte }] of byExpiry.entries()) {
    const isPreferredDTE = dte >= profile.dtePreferredMin && dte <= profile.dtePreferredMax;
    const isIdealDTE = dte >= profile.dteMin && dte <= profile.dteMax;
    const baseDTEScore = isPreferredDTE ? 160 : isIdealDTE ? 110 : 60;

    // Target Delta from profile
    const targetPutDelta = -(profile.deltaMin + profile.deltaMax) / 2;
    const targetCallDelta = (profile.deltaMin + profile.deltaMax) / 2;

    // ──────────────────────────────────────────────────────────────────────────
    // 1. STRATEGY: Bullish Short Put
    // ──────────────────────────────────────────────────────────────────────────
    const candidatePuts = puts
      .filter(p => Math.abs(p.delta) >= (profile.deltaMin - 0.03) && Math.abs(p.delta) <= (profile.bullishPutMax + 0.03) && p.strike < btcPrice)
      .sort((a, b) => Math.abs(a.delta - targetPutDelta) - Math.abs(b.delta - targetPutDelta));

    if (candidatePuts.length > 0) {
      const bestPut = candidatePuts[0];
      const putPremium = Math.round(bestPut.markPrice);
      const putTheta = Math.round(Math.abs(bestPut.theta));
      const breakevenLow = Math.round(bestPut.strike - putPremium);
      const putDistancePct = (((btcPrice - bestPut.strike) / btcPrice) * 100).toFixed(1);
      const estMarginReq = Math.round(btcPrice * 0.15); // ~15% margin for single short put
      const returnOnMarginPct = estMarginReq > 0 ? ((putPremium / estMarginReq) * 100).toFixed(1) : "0.0";
      const annualizedYield = dte > 0 ? Math.round((Number(returnOnMarginPct) * (365 / dte))) : 0;
      const isPutHeld = Boolean(bestPut.isHeld);

      const regimeBonus = isBullishRegime ? 70 : 0;
      const shortPutScore = baseDTEScore + regimeBonus + (putPremium / 4) + (annualizedYield / 3);

      results.push({
        id: `SHORT_PUT-${bestPut.symbol}`,
        strategy: "SHORT_PUT",
        strategyName: "BULLISH SHORT PUT",
        badgeText: "BULLISH PUT",
        badgeColor: "#00f0a8",
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
        annualizedYield,
        marketIv: marketIv ?? bestPut.iv,
        ivRank: null,
        premiumPerBtc: putPremium,
        expiryDate: expiry,
        putLeg: bestPut,
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
    const skewedPuts = puts
      .filter(p => Math.abs(p.delta) >= profile.deltaMin && Math.abs(p.delta) <= (profile.bullishPutMax + 0.02) && p.strike < btcPrice)
      .sort((a, b) => Math.abs(a.delta - targetPutDelta) - Math.abs(b.delta - targetPutDelta));

    const wideCalls = calls
      .filter(c => c.delta >= 0.07 && c.delta <= 0.15 && c.strike > btcPrice)
      .sort((a, b) => Math.abs(a.delta - 0.11) - Math.abs(b.delta - 0.11));

    if (skewedPuts.length > 0 && wideCalls.length > 0) {
      const bestSkewPut = skewedPuts[0];
      const bestSkewCall = wideCalls[0];

      const totalPremium = Math.round(bestSkewPut.markPrice + bestSkewCall.markPrice);
      const totalTheta = Math.round(Math.abs(bestSkewPut.theta) + Math.abs(bestSkewCall.theta));
      const breakevenLow = Math.round(bestSkewPut.strike - totalPremium);
      const breakevenHigh = Math.round(bestSkewCall.strike + totalPremium);

      const putDistancePct = (((btcPrice - bestSkewPut.strike) / btcPrice) * 100).toFixed(1);
      const callDistancePct = (((bestSkewCall.strike - btcPrice) / btcPrice) * 100).toFixed(1);

      const estMarginReq = Math.round(btcPrice * 0.18);
      const returnOnMarginPct = estMarginReq > 0 ? ((totalPremium / estMarginReq) * 100).toFixed(1) : "0.0";
      const annualizedYield = dte > 0 ? Math.round((Number(returnOnMarginPct) * (365 / dte))) : 0;

      const isPutHeld = Boolean(bestSkewPut.isHeld);
      const isCallHeld = Boolean(bestSkewCall.isHeld);
      const isFullyHeld = isPutHeld && isCallHeld;
      const isPartiallyHeld = isPutHeld || isCallHeld;

      const regimeBonus = isBullishRegime ? 40 : 0;
      const skewedScore = baseDTEScore + regimeBonus + (totalPremium / 6) + (annualizedYield / 3);

      results.push({
        id: `SKEWED_STRANGLE-${bestSkewPut.symbol}_${bestSkewCall.symbol}`,
        strategy: "SKEWED_STRANGLE",
        strategyName: "SKEWED STRANGLE (BULLISH)",
        badgeText: "SKEWED STRANGLE",
        badgeColor: "#38bdf8",
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
        returnOnMarginPct,
        annualizedYield,
        marketIv: marketIv ?? Math.round((bestSkewPut.iv + bestSkewCall.iv) / 2),
        ivRank: null,
        premiumPerBtc: totalPremium,
        expiryDate: expiry,
        putLeg: bestSkewPut,
        callLeg: bestSkewCall,
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
    // 3. STRATEGY: Standard Short Strangle
    // ──────────────────────────────────────────────────────────────────────────
    const stdPuts = puts
      .filter(p => Math.abs(p.delta) >= (profile.deltaMin - 0.02) && Math.abs(p.delta) <= (profile.deltaMax + 0.02) && p.strike < btcPrice)
      .sort((a, b) => Math.abs(a.delta - targetPutDelta) - Math.abs(b.delta - targetPutDelta));

    const stdCalls = calls
      .filter(c => c.delta >= (profile.deltaMin - 0.02) && c.delta <= (profile.deltaMax + 0.02) && c.strike > btcPrice)
      .sort((a, b) => Math.abs(a.delta - targetCallDelta) - Math.abs(b.delta - targetCallDelta));

    if (stdPuts.length > 0 && stdCalls.length > 0) {
      const bestPut = stdPuts[0];
      const bestCall = stdCalls[0];

      const totalPremium = Math.round(bestPut.markPrice + bestCall.markPrice);
      const totalTheta = Math.round(Math.abs(bestPut.theta) + Math.abs(bestCall.theta));
      const breakevenLow = Math.round(bestPut.strike - totalPremium);
      const breakevenHigh = Math.round(bestCall.strike + totalPremium);

      const putDistancePct = (((btcPrice - bestPut.strike) / btcPrice) * 100).toFixed(1);
      const callDistancePct = (((bestCall.strike - btcPrice) / btcPrice) * 100).toFixed(1);

      const estMarginReq = Math.round(btcPrice * 0.18);
      const returnOnMarginPct = estMarginReq > 0 ? ((totalPremium / estMarginReq) * 100).toFixed(1) : "0.0";
      const annualizedYield = dte > 0 ? Math.round((Number(returnOnMarginPct) * (365 / dte))) : 0;

      const isPutHeld = Boolean(bestPut.isHeld);
      const isCallHeld = Boolean(bestCall.isHeld);
      const isFullyHeld = isPutHeld && isCallHeld;
      const isPartiallyHeld = isPutHeld || isCallHeld;

      const strangleScore = baseDTEScore + (totalPremium / 6) + (annualizedYield / 3);

      results.push({
        id: `STRANGLE-${bestPut.symbol}_${bestCall.symbol}`,
        strategy: "STRANGLE",
        strategyName: "SHORT STRANGLE (BALANCED)",
        badgeText: "BALANCED STRANGLE",
        badgeColor: "#c084fc",
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
        returnOnMarginPct,
        annualizedYield,
        marketIv: marketIv ?? Math.round((bestPut.iv + bestCall.iv) / 2),
        ivRank: null,
        premiumPerBtc: totalPremium,
        expiryDate: expiry,
        putLeg: bestPut,
        callLeg: bestCall,
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

  return results
    .filter(opportunity => regime.allowedStrategies.includes(opportunity.strategy))
    .map(opportunity => ({ ...opportunity, marketRegime: regime.regime, regimeConfidence: regime.confidence }))
    .sort((a, b) => b.score - a.score);
}
