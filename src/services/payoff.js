export function normalizePayoffSetup(setup = {}, currentSpot = 0) {
  const positionSize = Number(setup.suggestedSize || setup.size || 0.01);
  const typeStr = String(setup.type || "").toUpperCase();
  const isIronCondor = setup.strategy === "IRON_CONDOR" || Boolean(setup.longPutLeg && setup.longCallLeg);
  const isStrangle = !isIronCondor && (setup.strategy === "STRANGLE" || setup.strategy === "SKEWED_STRANGLE" || Boolean(setup.putLeg && setup.callLeg));
  const isShortCall = !isIronCondor && !isStrangle && (setup.strategy === "SHORT_CALL" || typeStr.includes("CALL") || Boolean(setup.callLeg && !setup.putLeg));
  const isShortPut = !isIronCondor && !isStrangle && !isShortCall;

  const putStrike = Number(setup.putLeg?.strike ?? (isShortPut ? setup.strike : setup.putStrike) ?? currentSpot * 0.9);
  const callStrike = Number(setup.callLeg?.strike ?? (isShortCall ? setup.strike : setup.callStrike) ?? currentSpot * 1.1);

  const longPutStrike = isIronCondor ? Number(setup.longPutLeg?.strike ?? setup.longPutStrike ?? putStrike * 0.95) : null;
  const longCallStrike = isIronCondor ? Number(setup.longCallLeg?.strike ?? setup.longCallStrike ?? callStrike * 1.05) : null;

  const premiumPerBtc = Number(
    setup.premiumPerBtc ??
    setup.entryPrice ??
    setup.netCredit ??
    setup.totalPremium ??
    setup.totalPremiumUSD ??
    setup.premiumUSD ??
    (setup.premium != null ? Number(setup.premium) / Math.max(positionSize, 0.00000001) : 0)
  );

  const maxDollarProfit = Math.round(premiumPerBtc * positionSize * 100) / 100;
  let maxDollarLoss = null;
  if (isIronCondor && longPutStrike != null && longCallStrike != null) {
    const putWing = Math.max(0, putStrike - longPutStrike);
    const callWing = Math.max(0, longCallStrike - callStrike);
    const maxLossPerBtc = Math.max(putWing, callWing) - premiumPerBtc;
    maxDollarLoss = Math.round(Math.max(0, maxLossPerBtc) * positionSize * 100) / 100;
  }

  return {
    positionSize,
    isIronCondor,
    isStrangle,
    isShortPut,
    isShortCall,
    putStrike,
    callStrike,
    longPutStrike,
    longCallStrike,
    premiumPerBtc,
    maxDollarProfit,
    maxDollarLoss,
    lowerBreakeven: isShortCall ? null : Math.round(putStrike - premiumPerBtc),
    upperBreakeven: isShortPut ? null : Math.round(callStrike + premiumPerBtc),
  };
}

export function calculateExpiryPayoff({
  spot,
  putStrike,
  callStrike,
  premiumPerBtc,
  positionSize,
  isStrangle,
  isShortCall = false,
  isIronCondor = false,
  longPutStrike = null,
  longCallStrike = null,
}) {
  if (isIronCondor) {
    let lossPerBtc = 0;
    if (spot < putStrike) {
      const drop = putStrike - spot;
      const maxPutWing = (longPutStrike != null && longPutStrike < putStrike) ? putStrike - longPutStrike : drop;
      lossPerBtc += Math.min(drop, maxPutWing);
    } else if (spot > callStrike) {
      const rise = spot - callStrike;
      const maxCallWing = (longCallStrike != null && longCallStrike > callStrike) ? longCallStrike - callStrike : rise;
      lossPerBtc += Math.min(rise, maxCallWing);
    }
    return (premiumPerBtc - lossPerBtc) * positionSize;
  }

  let intrinsicLossPerBtc = 0;
  if (!isShortCall && spot < putStrike) intrinsicLossPerBtc += putStrike - spot;
  if ((isStrangle || isShortCall) && spot > callStrike) intrinsicLossPerBtc += spot - callStrike;
  return (premiumPerBtc - intrinsicLossPerBtc) * positionSize;
}


