import test from "node:test";
import assert from "node:assert/strict";
import { normalizePayoffSetup, calculateExpiryPayoff } from "../src/services/payoff.js";
import { markPaperTrade } from "../src/services/paperTrading.js";
import { calculatePortfolioCapacity, calculatePortfolioStress, calculatePositionSize } from "../src/services/sizing.js";
import { mapBinancePosition } from "../src/services/binance.js";
import { requireAppAuth, requireCronAuth } from "../lib/security.js";
import { calculateEMA, calculateRealizedVol, buildMarketIndicators } from "../lib/marketIndicators.js";
import { classifyMarketRegime, stabilizeMarketRegime } from "../src/services/marketRegime.js";
import { scanEntryOpportunities } from "../src/services/scanner.js";
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
