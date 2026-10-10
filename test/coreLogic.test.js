import test from "node:test";
import assert from "node:assert/strict";
import { normalizePayoffSetup, calculateExpiryPayoff } from "../src/services/payoff.js";
import { markPaperTrade } from "../src/services/paperTrading.js";
import { calculatePortfolioCapacity, calculatePortfolioStress, calculatePositionSize, calculateDeltaHedge } from "../src/services/sizing.js";
import { mapBinancePosition } from "../src/services/binance.js";
import { requireAppAuth, requireCronAuth } from "../lib/security.js";
import { calculateEMA, calculateRealizedVol, buildMarketIndicators, calculateHistoricalVolRank } from "../lib/marketIndicators.js";
import { ensureBackfilledHistory, getIvRank, getIvPercentile } from "../src/services/ivHistory.js";
import { deltaColor, classify } from "../src/utils.js";
import { classifyMarketRegime, stabilizeMarketRegime } from "../src/services/marketRegime.js";
import { scanEntryOpportunities, calculateMaxPain } from "../src/services/scanner.js";
import { checkAlerts, DEFAULT_ALERT_PREFERENCES } from "../src/services/alerts.js";
import { sendTelegramMessage } from "../api/cron.js";

test("normalizes scanner premium per BTC and calculates strangle breakevens", () => {
  const setup = normalizePayoffSetup({
    strategy: "STRANGLE",
    putStrike: 90_000,
    callStrike: 110_000,
    totalPremium: 2_000,
    suggestedSize: 0.01,
  }, 100_000);
  assert.equal(setup.maxDollarProfit, 20);
  assert.equal(setup.lowerBreakeven, 88_000);
  assert.equal(setup.upperBreakeven, 112_000);
  assert.equal(calculateExpiryPayoff({ spot: 100_000, ...setup }), 20);
  assert.equal(calculateExpiryPayoff({ spot: 85_000, ...setup }), -30);
});

test("marks a short paper trade from live option marks", () => {
  const trade = {
    status: "OPEN",
    size: 0.01,
    legs: [
      { symbol: "BTC-P", entryPrice: 1_000, markPrice: 1_000 },
      { symbol: "BTC-C", entryPrice: 500, markPrice: 500 },
    ],
  };
  const marked = markPaperTrade(trade, new Map([
    ["BTC-P", { markPrice: 700 }],
    ["BTC-C", { markPrice: 400 }],
  ]));
  assert.equal(marked.currentPnl, 4);
  assert.equal(marked.pricingStatus, "LIVE_MARK");
});

test("maps signed portfolio Greeks for a short option", () => {
  const position = mapBinancePosition(
    { symbol: "BTC-300101-90000-P", quantity: "-0.02", entryPrice: "1000" },
    { markPrice: "800", delta: "-0.20", gamma: "0.00001", theta: "-50", vega: "10", markIV: "0.60" },
  );
  assert.equal(position.positionDelta, 0.004);
  assert.ok(Math.abs(position.positionGamma - (-0.0000002)) < 1e-15);
});

test("calculates delta-gamma portfolio stress only with complete Greeks", () => {
  const stress = calculatePortfolioStress(
    [{ positionDelta: 0.02, positionGamma: -0.000001 }],
    100_000,
    10_000,
  );
  assert.equal(stress.available, true);
  assert.equal(stress.scenarios.length, 6);
  assert.ok(stress.worstLossPct > 0);
});

test("portfolio capacity fails closed without account data", () => {
  const capacity = calculatePortfolioCapacity(null, [], 100_000, { change24h: 1 }, []);
  assert.equal(capacity.verdict, "BLOCKED");
  assert.equal(capacity.remainingLots, 0);
});

test("position sizing does not claim affordability without account data", () => {
  const sizing = calculatePositionSize(null, { strategy: "SHORT_PUT", totalPremium: 1_000 }, 100_000);
  assert.equal(sizing.hasRealAccount, false);
  assert.equal(sizing.recommendedLot, null);
  assert.equal(sizing.lots.some(lot => lot.canAfford), false);
});

test("portfolio capacity allows the caution zone but enforces the 35 percent hard ceiling", () => {
  const cautionCapacity = calculatePortfolioCapacity(
    { equity: 10_000, availableBalance: 5_000, marginUsed: 3_100, marginPct: 31 },
    [],
    100_000,
    { change24h: 1 },
    [],
  );
  assert.notEqual(cautionCapacity.verdict, "BLOCKED");
  assert.ok(cautionCapacity.remainingLots > 0);

  const capacity = calculatePortfolioCapacity(
    { equity: 10_000, availableBalance: 5_000, marginUsed: 3_600, marginPct: 36 },
    [],
    100_000,
    { change24h: 1 },
    [{ isFullyHeld: false, isPreferredDTE: true }],
  );
  assert.equal(capacity.verdict, "BLOCKED");
  assert.equal(capacity.remainingLots, 0);
});

test("private API auth is open by default without dashboard unlock requirement", () => {
  assert.equal(requireAppAuth(), true);
});

test("cron always requires CRON_SECRET", () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-test-secret";
  let responseStatus = null;
  const response = {
    status(code) { responseStatus = code; return this; },
    json() { return this; },
  };
  assert.equal(requireCronAuth({ headers: { authorization: "Bearer wrong" } }, response), false);
  assert.equal(responseStatus, 401);
  assert.equal(requireCronAuth({ headers: { authorization: "Bearer cron-test-secret" } }, response), true);
  if (previous == null) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
});

test("market indicators calculate EMA and annualized realized volatility", () => {
  const closes = Array.from({ length: 60 }, (_, index) => 100 + index);
  assert.ok(calculateEMA(closes, 20) > 140);
  assert.ok(calculateRealizedVol(closes, 30) > 0);

  const klines = closes.map((close, index) => [index, close - 1, close + 2, close - 2, close]);
  const indicators = buildMarketIndicators(klines, 160);
  assert.ok(Number.isFinite(indicators.ema50));
  assert.ok(Number.isFinite(indicators.adx14));
  assert.ok(Number.isFinite(indicators.realizedVol30));
});

test("regime engine selects range high IV and limits strategy to strangle", () => {
  const regime = classifyMarketRegime({
    price: 100_000,
    change24h: 0.5,
    ema20: 99_500,
    ema50: 99_000,
    distFromEMA20: 0.5,
    distFromEMA50: 1,
    adx14: 16,
    realizedVol7: 38,
    realizedVol30: 40,
    marketIv: 55,
  });
  assert.equal(regime.regime, "RANGE_HIGH_IV");
  assert.deepEqual(regime.allowedStrategies, ["STRANGLE"]);
  assert.equal(regime.isNoTrade, false);
});

test("regime engine fails closed during crisis and when data is incomplete", () => {
  const crisis = classifyMarketRegime({
    price: 100_000,
    change24h: -8,
    ema20: 105_000,
    ema50: 106_000,
    distFromEMA20: -4.8,
    distFromEMA50: -5.7,
    adx14: 35,
    realizedVol7: 110,
    realizedVol30: 60,
    marketIv: 90,
  });
  assert.equal(crisis.regime, "CRISIS");
  assert.equal(crisis.isNoTrade, true);
  assert.equal(classifyMarketRegime({ price: 100_000 }).regime, "DATA_INCOMPLETE");
});

test("risk-on regime transitions require confirmation but no-trade is immediate", () => {
  const base = classifyMarketRegime({ price: 100_000 });
  const bull = {
    regime: "BULL_TREND", label: "BULL TREND", color: "#0f0", confidence: 80,
    allowedStrategies: ["SHORT_PUT"], sizeMultiplier: 0.75, isNoTrade: false, reasons: [],
  };
  let state = stabilizeMarketRegime(base);
  state = stabilizeMarketRegime(bull, state, 3);
  assert.equal(state.stable.regime, "DATA_INCOMPLETE");
  state = stabilizeMarketRegime(bull, state, 3);
  state = stabilizeMarketRegime(bull, state, 3);
  assert.equal(state.stable.regime, "BULL_TREND");

  const crisis = { ...bull, regime: "CRISIS", label: "CRISIS", isNoTrade: true, allowedStrategies: [], sizeMultiplier: 0 };
  state = stabilizeMarketRegime(crisis, state, 3);
  assert.equal(state.stable.regime, "CRISIS");
});

test("scanner produces no entry opportunities in a no-trade regime", () => {
  const marks = [{ symbol: "BTC-300101-90000-P", delta: -0.2, theta: -20, markPrice: 1000, markIV: 0.6 }];
  const noTradeRegime = classifyMarketRegime({ price: 100_000 });
  const results = scanEntryOpportunities(marks, 100_000, 60, [], { regime: noTradeRegime });
  assert.deepEqual(results, []);
});

test("position alerts use the configured 35 percent take-profit target", () => {
  const alerts = checkAlerts([{
    id: "BTC-300101-90000-P",
    type: "Short Put",
    premium: 100,
    currentPrice: 50,
    pnl: 50,
    dte: 10,
    delta: -0.2,
  }], new Set(), DEFAULT_ALERT_PREFERENCES);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertLevel, "TAKE_PROFIT");
  assert.match(alerts[0].reason, />= 35%/);
});

test("server cron formats and sends entry signals to Telegram", async () => {
  const previousFetch = global.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  let sentPayload = null;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "123";
  global.fetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const result = await sendTelegramMessage("short_put_signal", {
      expiry: "2030-01-01",
      dte: 14,
      btcPrice: 100_000,
      marketIv: 60,
      putStrike: 90_000,
      putDelta: "-0.20",
      totalPremium: 1_000,
      totalTheta: 30,
      putDistancePct: "10.0",
      breakevenLow: 89_000,
    });
    assert.equal(result.ok, true);
    assert.match(sentPayload.text, /ENTRY SIGNAL/);
    assert.equal(sentPayload.chat_id, "123");
  } finally {
    global.fetch = previousFetch;
    if (previousToken == null) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousChat == null) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = previousChat;
  }
});

test("calculateHistoricalVolRank returns valid IV rank and percentile from daily klines", () => {
  const klines = [];
  let price = 60000;
  for (let i = 0; i < 120; i++) {
    const dailyReturn = (i % 2 === 0 ? 0.015 : -0.012) * (1 + (i % 5) * 0.2);
    price = price * (1 + dailyReturn);
    klines.push([
      Date.now() - (120 - i) * 86400000,
      String(price * 0.99),
      String(price * 1.02),
      String(price * 0.98),
      String(price),
    ]);
  }
  const result = calculateHistoricalVolRank(55, klines, 90);
  assert.ok(result.ivRank >= 0 && result.ivRank <= 100);
  assert.ok(result.ivPercentile >= 0 && result.ivPercentile <= 100);
  assert.ok(result.minVol <= result.maxVol);
  assert.ok(result.count >= 7);

  // Edge case: empty klines returns null
  const emptyResult = calculateHistoricalVolRank(55, [], 90);
  assert.equal(emptyResult, null);
});

test("ensureBackfilledHistory seeds synthetic days and produces valid IV Rank in browser mock", () => {
  const originalWindow = global.window;
  const store = new Map();
  global.window = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    const seeded = ensureBackfilledHistory(55);
    assert.ok(seeded.length >= 6);
    const rank = getIvRank(55);
    const percentile = getIvPercentile(55);
    assert.ok(typeof rank === "number" && rank >= 0 && rank <= 100);
    assert.ok(typeof percentile === "number" && percentile >= 0 && percentile <= 100);
  } finally {
    global.window = originalWindow;
  }
});

test("normalizePayoffSetup handles Short Call, Short Put, and Strangle positions correctly", () => {
  // Short Call open position
  const callSetup = normalizePayoffSetup({
    type: "Short Call",
    strike: 105000,
    entryPrice: 1200,
    currentPrice: 800,
    size: 0.05,
  }, 100000);
  assert.equal(callSetup.isShortCall, true);
  assert.equal(callSetup.callStrike, 105000);
  assert.equal(callSetup.upperBreakeven, 106200); // 105000 + 1200
  assert.equal(callSetup.maxDollarProfit, 60); // 1200 * 0.05
  // Spot above breakeven results in loss
  assert.ok(calculateExpiryPayoff({ spot: 110000, ...callSetup }) < 0);
  // Spot below strike retains full premium
  assert.equal(calculateExpiryPayoff({ spot: 100000, ...callSetup }), 60);

  // Short Put open position
  const putSetup = normalizePayoffSetup({
    type: "Short Put",
    strike: 92000,
    entryPrice: 1500,
    currentPrice: 900,
    size: 0.02,
  }, 100000);
  assert.equal(putSetup.isShortPut, true);
  assert.equal(putSetup.putStrike, 92000);
  assert.equal(putSetup.lowerBreakeven, 90500); // 92000 - 1500
  assert.equal(putSetup.maxDollarProfit, 30); // 1500 * 0.02
  assert.equal(calculateExpiryPayoff({ spot: 95000, ...putSetup }), 30);
  assert.ok(calculateExpiryPayoff({ spot: 88000, ...putSetup }) < 0);
});

test("utils deltaColor and classify align with v3.0 rules", () => {
  // Delta warning thresholds: warning at 0.38, danger at 0.52
  assert.equal(deltaColor(0.20), "#00f0a8"); // safe green
  assert.equal(deltaColor(0.40), "#fbbf24"); // warning amber (>= 0.38)
  assert.equal(deltaColor(0.55), "#ff3366"); // danger red (>= 0.52)

  // Classify position health: delta 0.40 warning, delta 0.55 danger, dte <= 2 danger
  assert.equal(classify({ delta: 0.20, dte: 10, pnl: 20, premium: 100 }), "healthy");
  assert.equal(classify({ delta: 0.40, dte: 10, pnl: -10, premium: 100 }), "warning");
  assert.equal(classify({ delta: 0.55, dte: 10, pnl: -10, premium: 100 }), "danger");
  assert.equal(classify({ delta: 0.20, dte: 2, pnl: 10, premium: 100 }), "danger");
  assert.equal(classify({ delta: 0.20, dte: 4, pnl: 10, premium: 100 }), "warning");
});

test("calculateDeltaHedge computes exact Futures rebalancing quantities and urgency", () => {
  // Empty positions
  const empty = calculateDeltaHedge([], 100_000);
  assert.equal(empty.available, false);
  assert.equal(empty.hedgeAction, "NONE");

  // Neutral portfolio (+0.02 delta)
  const neutral = calculateDeltaHedge([{ positionDelta: 0.02 }], 100_000);
  assert.equal(neutral.available, true);
  assert.equal(neutral.urgency, "NEUTRAL");
  assert.equal(neutral.hedgeAction, "SHORT");
  assert.equal(neutral.hedgeQtyBtc, 0.02);

  // Caution portfolio (+0.20 delta >= 0.18 threshold)
  const caution = calculateDeltaHedge([{ positionDelta: 0.20 }], 100_000);
  assert.equal(caution.urgency, "CAUTION");
  assert.equal(caution.hedgeAction, "SHORT");
  assert.equal(caution.hedgeQtyBtc, 0.20);
  assert.equal(caution.hedgeNotionalUsd, 20_000);

  // Hedge required portfolio (-0.35 delta <= -0.25 limit)
  const urgent = calculateDeltaHedge([{ positionDelta: -0.35 }], 100_000);
  assert.equal(urgent.urgency, "HEDGE_REQUIRED");
  assert.equal(urgent.hedgeAction, "LONG");
  assert.equal(urgent.hedgeQtyBtc, 0.35);
  assert.equal(urgent.hedgeNotionalUsd, 35_000);
});

test("calculatePortfolioStress evaluates multi-dimensional spot-gamma and vega shock matrix", () => {
  const positions = [
    { positionDelta: 0.05, positionGamma: -0.000002, positionVega: -15 },
  ];
  const stress = calculatePortfolioStress(positions, 100_000, 20_000);
  assert.equal(stress.available, true);
  assert.equal(stress.scenarios.length, 6);

  // Verify scenario contains coupled spot and vega shocks
  const extremeDown = stress.scenarios.find(s => s.movePct === -20);
  assert.ok(extremeDown);
  assert.equal(extremeDown.ivShock, 25);
  assert.ok(Number.isFinite(extremeDown.spotPnl));
  assert.ok(Number.isFinite(extremeDown.vegaPnl));
  assert.equal(extremeDown.combinedPnl, Math.round((extremeDown.spotPnl + extremeDown.vegaPnl) * 100) / 100);

  // Verify worst losses are quantified
  assert.ok(stress.worstLoss > 0);
  assert.ok(stress.worstLossPct > 0);
});

test("calculateMaxPain finds strike with minimal option buyer payout", () => {
  // Strikes at 90k, 95k, 100k
  const marks = [
    { symbol: "BTC-250101-90000-C", strikePrice: 90000, openInterest: 50 },
    { symbol: "BTC-250101-90000-P", strikePrice: 90000, openInterest: 5 },
    { symbol: "BTC-250101-95000-C", strikePrice: 95000, openInterest: 20 },
    { symbol: "BTC-250101-95000-P", strikePrice: 95000, openInterest: 20 },
    { symbol: "BTC-250101-100000-C", strikePrice: 100000, openInterest: 10 },
    { symbol: "BTC-250101-100000-P", strikePrice: 100000, openInterest: 60 },
  ];
  const maxPain = calculateMaxPain(marks, 95000);
  assert.ok(maxPain);
  assert.equal(maxPain.available, true);
  assert.ok(Number.isFinite(maxPain.maxPainStrike));
  assert.ok(Number.isFinite(maxPain.distancePct));
});

test("Iron Condor payoff calculation caps risk on both wings", () => {
  const setup = normalizePayoffSetup({
    strategy: "IRON_CONDOR",
    putStrike: 90_000,
    callStrike: 100_000,
    longPutStrike: 85_000,
    longCallStrike: 105_000,
    totalPremium: 1_200,
    suggestedSize: 0.01,
  }, 95_000);

  assert.equal(setup.isIronCondor, true);
  assert.equal(setup.putStrike, 90_000);
  assert.equal(setup.callStrike, 100_000);
  assert.equal(setup.longPutStrike, 85_000);
  assert.equal(setup.longCallStrike, 105_000);
  assert.equal(setup.maxDollarProfit, 12); // 1200 * 0.01
  assert.equal(setup.lowerBreakeven, 88_800); // 90000 - 1200
  assert.equal(setup.upperBreakeven, 101_200); // 100000 + 1200

  // Max profit within sweet spot
  assert.equal(calculateExpiryPayoff({ spot: 95_000, ...setup }), 12);

  // Deep downside crash beyond long put wing: loss is capped at wing width ($5000) minus premium ($1200) = $3800 * 0.01 = -$38
  const deepCrashPnl = calculateExpiryPayoff({ spot: 70_000, ...setup });
  assert.equal(deepCrashPnl, -38);

  // Deep upside rally beyond long call wing: loss is capped at -$38
  const deepRallyPnl = calculateExpiryPayoff({ spot: 120_000, ...setup });
  assert.equal(deepRallyPnl, -38);
});

