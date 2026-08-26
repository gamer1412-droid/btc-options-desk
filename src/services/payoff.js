export function normalizePayoffSetup(setup = {}, currentSpot = 0) {
  const positionSize = Number(setup.suggestedSize || setup.size || 0.01);
  const isStrangle = setup.strategy === "STRANGLE" || setup.strategy === "SKEWED_STRANGLE" || Boolean(setup.putLeg && setup.callLeg);
  const isShortPut = !isStrangle && (setup.strategy === "SHORT_PUT" || setup.type === "PUT" || Boolean(setup.putLeg));
  const putStrike = Number(setup.putLeg?.strike ?? (isShortPut ? setup.strike : setup.putStrike) ?? currentSpot * 0.9);
  const callStrike = Number(setup.callLeg?.strike ?? setup.callStrike ?? currentSpot * 1.1);
  const premiumPerBtc = Number(
    setup.premiumPerBtc ??
    setup.totalPremium ??
    setup.totalPremiumUSD ??
    setup.premiumUSD ??
    (setup.premium != null ? Number(setup.premium) / Math.max(positionSize, 0.00000001) : 0)
  );

  return {
    positionSize,
    isStrangle,
    isShortPut,
    putStrike,
    callStrike,
    premiumPerBtc,
    maxDollarProfit: premiumPerBtc * positionSize,
    lowerBreakeven: putStrike - premiumPerBtc,
    upperBreakeven: isStrangle ? callStrike + premiumPerBtc : null,
  };
}

export function calculateExpiryPayoff({ spot, putStrike, callStrike, premiumPerBtc, positionSize, isStrangle }) {
  let intrinsicLossPerBtc = 0;
  if (spot < putStrike) intrinsicLossPerBtc += putStrike - spot;
  if (isStrangle && spot > callStrike) intrinsicLossPerBtc += spot - callStrike;
  return (premiumPerBtc - intrinsicLossPerBtc) * positionSize;
}

