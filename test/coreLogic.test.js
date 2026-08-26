import test from "node:test";
import assert from "node:assert/strict";
import { normalizePayoffSetup, calculateExpiryPayoff } from "../src/services/payoff.js";
import { markPaperTrade } from "../src/services/paperTrading.js";
import { calculatePortfolioCapacity, calculatePortfolioStress, calculatePositionSize } from "../src/services/sizing.js";
import { mapBinancePosition } from "../src/services/binance.js";
import { requireAppAuth, requireCronAuth } from "../lib/security.js";

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

test("portfolio capacity enforces the 30 percent margin ceiling", () => {
  const capacity = calculatePortfolioCapacity(
    { equity: 10_000, availableBalance: 5_000, marginUsed: 3_100, marginPct: 31 },
    [],
    100_000,
    { change24h: 1 },
    [{ isFullyHeld: false, isPreferredDTE: true }],
  );
  assert.equal(capacity.verdict, "BLOCKED");
  assert.equal(capacity.remainingLots, 0);
});

test("private API auth fails closed in production", () => {
  const previousEnv = process.env.VERCEL_ENV;
  const previousToken = process.env.APP_ACCESS_TOKEN;
  process.env.VERCEL_ENV = "production";
  delete process.env.APP_ACCESS_TOKEN;
  let responseStatus = null;
  const response = {
    status(code) { responseStatus = code; return this; },
    json() { return this; },
  };
  assert.equal(requireAppAuth({ headers: {} }, response), false);
  assert.equal(responseStatus, 503);
  if (previousEnv == null) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousEnv;
  if (previousToken == null) delete process.env.APP_ACCESS_TOKEN; else process.env.APP_ACCESS_TOKEN = previousToken;
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
