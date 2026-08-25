import { useState, useMemo } from "react";
import { T } from "../tokens.js";
import { fmtUSD, pnlColor } from "../utils.js";
import { SoundFX } from "../services/soundFx.js";

export function PayoffSimulator({
  setup, // Can be an opportunity or position object
  btcPrice = 90000,
  onClose,
}) {
  const currentSpot = btcPrice || 90000;
  const [simSpotOffsetPct, setSimSpotOffsetPct] = useState(0); // -30% to +30%

  // Normalize setup info
  const isStrangle = setup.strategy === "STRANGLE" || setup.strategy === "SKEWED_STRANGLE" || (setup.putLeg && setup.callLeg);
  const isShortPut = !isStrangle && (setup.strategy === "SHORT_PUT" || setup.type === "PUT" || setup.putLeg);

  const putStrike = setup.putLeg ? setup.putLeg.strike : isShortPut ? setup.strike : (setup.putStrike || currentSpot * 0.9);
  const callStrike = setup.callLeg ? setup.callLeg.strike : setup.callStrike || currentSpot * 1.1;

  const totalPremiumUSD = setup.totalPremiumUSD || setup.premiumUSD || setup.premium || 800;
  const positionSize = setup.suggestedSize || setup.size || 1;
  const maxDollarProfit = totalPremiumUSD * positionSize;

  // Breakevens
  const lowerBE = isShortPut
    ? putStrike - (totalPremiumUSD / positionSize)
    : putStrike - (totalPremiumUSD / positionSize);
  const upperBE = isStrangle ? callStrike + (totalPremiumUSD / positionSize) : null;

  // Simulated Spot Price based on slider
  const simulatedSpot = currentSpot * (1 + simSpotOffsetPct / 100);

  // Calculate Payoff at any spot price S
  const calculatePayoff = (S) => {
    let loss = 0;
    if (S < putStrike) {
      loss += (putStrike - S) * positionSize;
    }
    if (isStrangle && S > callStrike) {
      loss += (S - callStrike) * positionSize;
    }
    return maxDollarProfit - loss;
  };

  const simulatedPnl = calculatePayoff(simulatedSpot);

  // Generate SVG Points for Payoff Graph
  const chartPoints = useMemo(() => {
    const minSpot = currentSpot * 0.70;
    const maxSpot = currentSpot * 1.30;
    const steps = 40;
    const stepSize = (maxSpot - minSpot) / steps;

    const points = [];
    let minPnl = -maxDollarProfit * 2.5;
    let maxPnl = maxDollarProfit * 1.25;

    for (let i = 0; i <= steps; i++) {
      const s = minSpot + i * stepSize;
      const pnl = calculatePayoff(s);
      points.push({ s, pnl });
    }

    return { points, minSpot, maxSpot, minPnl, maxPnl };
  }, [currentSpot, putStrike, callStrike, maxDollarProfit, positionSize, isStrangle]);

  // Convert (s, pnl) to SVG coordinates (width 500, height 220)
  const W = 540;
  const H = 220;
  const padX = 40;
  const padY = 24;

  const scaleX = (s) => padX + ((s - chartPoints.minSpot) / (chartPoints.maxSpot - chartPoints.minSpot)) * (W - padX * 2);
  const scaleY = (pnl) => {
    const clamped = Math.max(chartPoints.minPnl, Math.min(chartPoints.maxPnl, pnl));
    return H - padY - ((clamped - chartPoints.minPnl) / (chartPoints.maxPnl - chartPoints.minPnl)) * (H - padY * 2);
  };

  const zeroY = scaleY(0);
  const polylineStr = chartPoints.points.map(pt => `${scaleX(pt.s)},${scaleY(pt.pnl)}`).join(" ");

  // Fill polygon under profit curve
  const profitAreaStr = `${scaleX(chartPoints.minSpot)},${zeroY} ` + polylineStr + ` ${scaleX(chartPoints.maxSpot)},${zeroY}`;

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
          maxWidth: 620,
          boxShadow: `0 24px 60px rgba(0,0,0,0.8), 0 0 30px ${T.blue}20`,
          padding: 24,
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>🎯</span>
              <h3 style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 16, fontWeight: 800, margin: 0 }}>
                INTERACTIVE PAYOFF SIMULATOR
              </h3>
              <span
                style={{
                  background: `${T.blue}20`,
                  color: T.blue,
                  border: `1px solid ${T.blue}40`,
                  borderRadius: 4,
                  padding: "2px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: T.font,
                }}
              >
                {setup.strategyTitle || setup.strategy || (isStrangle ? "STRANGLE" : "SHORT PUT")}
              </span>
            </div>
            <div style={{ color: T.textSecondary, fontSize: 12, marginTop: 4, fontFamily: T.fontSans }}>
              DTE: <strong>{setup.dte || 21}d</strong> ({setup.expiryDate || "—"}) │ Spot: <strong>{fmtUSD(currentSpot, 0)}</strong>
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* Key Metrics Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans, fontWeight: 600 }}>MAX PROFIT</div>
            <div style={{ color: T.green, fontFamily: T.font, fontSize: 16, fontWeight: 800 }}>
              +{fmtUSD(maxDollarProfit, 2)}
            </div>
          </div>
          <div>
            <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans, fontWeight: 600 }}>LOWER BREAKEVEN</div>
            <div style={{ color: T.amber, fontFamily: T.font, fontSize: 16, fontWeight: 700 }}>
              {fmtUSD(lowerBE, 0)}
            </div>
          </div>
          <div>
            <div style={{ color: T.textSecondary, fontSize: 10, fontFamily: T.fontSans, fontWeight: 600 }}>
              {upperBE ? "UPPER BREAKEVEN" : "PROTECTION BUFFER"}
            </div>
            <div style={{ color: upperBE ? T.amber : T.blue, fontFamily: T.font, fontSize: 16, fontWeight: 700 }}>
              {upperBE ? fmtUSD(upperBE, 0) : `+${((currentSpot - putStrike) / currentSpot * 100).toFixed(1)}% Safe`}
            </div>
          </div>
        </div>

        {/* SVG Interactive Payoff Diagram */}
        <div style={{ background: "#06090e", borderRadius: 10, border: `1px solid ${T.border}`, padding: "10px 6px", position: "relative" }}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <defs>
              <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.green} stopOpacity="0.35" />
                <stop offset="100%" stopColor={T.green} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Zero Axis Line */}
            <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke={T.borderHover} strokeWidth="1" strokeDasharray="3,3" />

            {/* Strike Vertical Guides */}
            <line x1={scaleX(putStrike)} y1={padY} x2={scaleX(putStrike)} y2={H - padY} stroke={T.green} strokeWidth="1" strokeDasharray="2,2" />
            <text x={scaleX(putStrike)} y={padY - 4} fill={T.green} fontSize="9" textAnchor="middle" fontFamily={T.font}>
              Put {putStrike / 1000}k
            </text>

            {isStrangle && (
              <>
                <line x1={scaleX(callStrike)} y1={padY} x2={scaleX(callStrike)} y2={H - padY} stroke={T.purple} strokeWidth="1" strokeDasharray="2,2" />
                <text x={scaleX(callStrike)} y={padY - 4} fill={T.purple} fontSize="9" textAnchor="middle" fontFamily={T.font}>
                  Call {callStrike / 1000}k
                </text>
              </>
            )}

            {/* Fill Area */}
            <polygon points={profitAreaStr} fill="url(#profitGrad)" />

            {/* Payoff Polyline */}
            <polyline fill="none" stroke={T.green} strokeWidth="2.5" points={polylineStr} strokeLinejoin="round" />

            {/* Current Spot Line */}
            <line x1={scaleX(currentSpot)} y1={padY} x2={scaleX(currentSpot)} y2={H - padY} stroke={T.blue} strokeWidth="1.5" />
            <circle cx={scaleX(currentSpot)} cy={scaleY(calculatePayoff(currentSpot))} r="4" fill={T.blue} />

            {/* Simulated Target Marker */}
            <line x1={scaleX(simulatedSpot)} y1={padY} x2={scaleX(simulatedSpot)} y2={H - padY} stroke={pnlColor(simulatedPnl)} strokeWidth="2" />
            <circle cx={scaleX(simulatedSpot)} cy={scaleY(simulatedPnl)} r="5" fill={pnlColor(simulatedPnl)} stroke="#fff" strokeWidth="1.5" />
          </svg>

          {/* Current vs Simulated Spot Tag */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", fontSize: 10, fontFamily: T.font, color: T.textMuted }}>
            <span>-30% ({fmtUSD(chartPoints.minSpot, 0)})</span>
            <span style={{ color: T.blue }}>● Current Spot ({fmtUSD(currentSpot, 0)})</span>
            <span>+30% ({fmtUSD(chartPoints.maxSpot, 0)})</span>
          </div>
        </div>

        {/* Interactive "What-If" Slider */}
        <div style={{ marginTop: 16, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: T.textSecondary, fontSize: 11, fontWeight: 700, fontFamily: T.fontSans }}>
              🎛️ "WHAT-IF" BTC PRICE SIMULATOR
            </span>
            <div style={{ fontFamily: T.font, fontSize: 13, fontWeight: 800 }}>
              <span style={{ color: simSpotOffsetPct >= 0 ? T.green : T.red }}>
                {simSpotOffsetPct >= 0 ? "+" : ""}{simSpotOffsetPct}%
              </span>
              <span style={{ color: T.textPrimary, marginLeft: 8 }}>({fmtUSD(simulatedSpot, 0)})</span>
            </div>
          </div>

          <input
            type="range"
            min="-30"
            max="30"
            step="1"
            value={simSpotOffsetPct}
            onChange={(e) => {
              setSimSpotOffsetPct(Number(e.target.value));
            }}
            style={{
              width: "100%",
              accentColor: T.green,
              cursor: "pointer",
            }}
          />

          {/* Outcome readout */}
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              background: simulatedPnl >= 0 ? T.greenDim : T.redDim,
              border: `1px solid ${simulatedPnl >= 0 ? T.greenMid : T.red + "44"}`,
              borderRadius: 6,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontSans }}>
              Estimated Expiry P&L:
            </span>
            <span style={{ fontFamily: T.font, fontSize: 16, fontWeight: 800, color: pnlColor(simulatedPnl) }}>
              {simulatedPnl >= 0 ? "+" : ""}{fmtUSD(simulatedPnl, 2)}
            </span>
          </div>
        </div>

        {/* Close Button */}
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={() => setSimSpotOffsetPct(0)}
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              color: T.textSecondary,
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: T.fontSans,
              cursor: "pointer",
            }}
          >
            Reset Spot
          </button>
          <button
            onClick={() => {
              SoundFX.playClick();
              onClose?.();
            }}
            style={{
              background: `linear-gradient(135deg, ${T.green}, #00b380)`,
              border: "none",
              color: "#05080c",
              borderRadius: 6,
              padding: "6px 20px",
              fontSize: 12,
              fontWeight: 800,
              fontFamily: T.fontSans,
              cursor: "pointer",
            }}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
