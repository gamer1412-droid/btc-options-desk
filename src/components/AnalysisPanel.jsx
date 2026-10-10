import { useState, useEffect, useCallback, useRef } from "react";
import { T } from "../tokens.js";
import { fmtUSD, renderAnalysisHtml } from "../utils.js";
import { Pill } from "./Pill.jsx";

export function AnalysisPanel({ pos, btcPrice, marketIv, onClose }) {
  const [analysisHtml, setAnalysisHtml] = useState("");
  const [loading, setLoading] = useState(false);

  const isOpportunity = Boolean(pos?.strategy);
  const strategy = pos?.strategy;
  const isCall = Boolean(pos?.type?.includes("Call"));

  // Keep references to prevent 15-second background price polling from re-triggering analysis while user is reading
  const propsRef = useRef({ pos, btcPrice, marketIv });
  propsRef.current = { pos, btcPrice, marketIv };

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setAnalysisHtml("");

    const { pos: currentPos, btcPrice: currentBtcPrice, marketIv: currentMarketIv } = propsRef.current;
    const marketIvStr = currentMarketIv != null ? `${currentMarketIv}% (ค่าเฉลี่ย IV ปัจจุบัน)` : "ไม่มีข้อมูล";

    let prompt = "";
    if (currentPos?.strategy === "SHORT_PUT") {
      prompt = `You are an expert BTC options trader specializing in Bullish Short Put strategies.
Analyze this proposed BULLISH SHORT PUT ENTRY OPPORTUNITY on Binance Options.

MARKET DATA:
- BTC Price: $${currentBtcPrice?.toLocaleString() ?? "unknown"}
- Option Chain Average IV: ${marketIvStr}

PROPOSED SHORT PUT SETUP:
- Expiry: ${currentPos.expiry} (${currentPos.dte} days to expiry)
- Short Put Strike: $${Number(currentPos.putStrike || currentPos.strike).toLocaleString()} (Delta: ${currentPos.putDelta || currentPos.delta}, IV: ${currentPos.putIV || currentPos.iv}%, Mark: $${currentPos.putMark || currentPos.markPrice})
- Downside Buffer: ${currentPos.putDistancePct}% below current BTC spot
- Breakeven Price: $${Number(currentPos.breakevenLow).toLocaleString()}
- Total Premium: ~$${currentPos.totalPremium} / 1 BTC
- Total Theta: +$${currentPos.totalTheta}/day
- Annualized Yield (ROM): ${currentPos.annualizedYield}%

Respond in Thai language according to v3.0 Trading Rules (Take Profit target 35%, Hard Stop Loss 2x premium, DTE exit <= 2). Format your response as:

**สถานะ:** [GOOD TO ENTER / WAIT / AVOID]
**Action แนะนำ:** [OPEN SHORT PUT / WAIT FOR BETTER SPOT LEVEL / ADJUST STRIKE]

**การประเมินความคุ้มค่าและความเสี่ยง:** (3-4 ประโยค อธิบายความกว้างของ Downside Buffer, แนวรับ BTC และ Theta Decay)

**แผนการจัดการ Position (Plan of Action):**
- Take Profit: [แนะนำจุดปิดทำกำไร 35% เพื่อหมุนเงินเร็ว หรือ 30% ใน 4 วันแรก]
- Stop Loss: [แนะนำจุดตัดขาดทุน 2x Premium เมื่อราคาลงหลุด Breakeven]
- Defense Trigger: [แนะนำเฝ้าระวังเมื่อ Delta >= 0.38 และเตรียม Action เมื่อ Delta >= 0.52]

**คำแนะนำการเปิดออเดอร์บน Binance:** (สรุปสิ่งที่ต้องเปิดใน Binance Options)`;
    } else if (currentPos?.strategy === "SKEWED_STRANGLE") {
      prompt = `You are an expert BTC options trader specializing in Skewed Strangle strategies with a bullish bias.
Analyze this proposed SKEWED STRANGLE ENTRY OPPORTUNITY on Binance Options.

MARKET DATA:
- BTC Price: $${currentBtcPrice?.toLocaleString() ?? "unknown"}
- Option Chain Average IV: ${marketIvStr}

PROPOSED SKEWED STRANGLE SETUP:
- Expiry: ${currentPos.expiry} (${currentPos.dte} days to expiry)
- Short Put: Strike $${Number(currentPos.putStrike).toLocaleString()} (Delta: ${currentPos.putDelta}, Buffer: -${currentPos.putDistancePct}%)
- Wide Short Call: Strike $${Number(currentPos.callStrike).toLocaleString()} (Delta: +${currentPos.callDelta}, Buffer: +${currentPos.callDistancePct}%)
- Total Premium: ~$${currentPos.totalPremium} / 1 BTC
- Total Theta: +$${currentPos.totalTheta}/day
- Safe Zone: $${Number(currentPos.breakevenLow).toLocaleString()} – $${Number(currentPos.breakevenHigh).toLocaleString()}

Respond in Thai language according to v3.0 Trading Rules (Take Profit target 35%, Hard Stop Loss 2x premium, DTE exit <= 2). Format your response as:

**สถานะ:** [GOOD TO ENTER / WAIT / AVOID]
**Action แนะนำ:** [OPEN SKEWED STRANGLE / WAIT FOR BETTER IV / ADJUST STRIKE]

**การประเมินความคุ้มค่าและความเสี่ยง:** (3-4 ประโยค อธิบายความกว้างของ Safe Zone, ความได้เปรียบของ Call ไกลพิเศษ และ Theta)

**แผนการจัดการ Position (Plan of Action):**
- Take Profit: [แนะนำจุดปิดทำกำไร 35% เพื่อปลดล็อก Margin]
- Stop Loss: [ตัดขาดทุน 2x Premium หรือราคาหลุดกรอบ Breakeven]
- Roll Plan: [จังหวะที่ควร Roll ขาที่ถูกทดสอบ]

**คำแนะนำการเปิดออเดอร์บน Binance:** (สรุปสิ่งที่ต้องเปิดใน Binance Options)`;
    } else if (currentPos?.strategy === "STRANGLE") {
      prompt = `You are an expert BTC options trader specializing in Delta-Neutral Short Strangle strategies.
Analyze this proposed SHORT STRANGLE ENTRY OPPORTUNITY on Binance Options.

MARKET DATA:
- BTC Price: $${currentBtcPrice?.toLocaleString() ?? "unknown"}
- Option Chain Average IV: ${marketIvStr}

PROPOSED STRANGLE SETUP:
- Expiry: ${currentPos.expiry} (${currentPos.dte} days to expiry)
- Short Put: Strike $${Number(currentPos.putStrike).toLocaleString()} (Delta: ${currentPos.putDelta}, IV: ${currentPos.putIV}%, Mark: $${currentPos.putMark})
- Short Call: Strike $${Number(currentPos.callStrike).toLocaleString()} (Delta: +${currentPos.callDelta}, IV: ${currentPos.callIV}%, Mark: $${currentPos.callMark})
- Total Premium: ~$${currentPos.totalPremium} / 1 BTC
- Total Theta: +$${currentPos.totalTheta}/day
- Breakeven Range: $${Number(currentPos.breakevenLow).toLocaleString()} – $${Number(currentPos.breakevenHigh).toLocaleString()}

Respond in Thai language according to v3.0 Trading Rules (Take Profit 35%, Hard Stop Loss 2x premium, DTE exit <= 2). Format your response as:

**สถานะ:** [GOOD TO ENTER / WAIT / AVOID]
**Action แนะนำ:** [OPEN POSITION / WAIT FOR BETTER IV / ADJUST STRIKE]

**การประเมินความคุ้มค่าและความเสี่ยง:** (3-4 ประโยค อธิบายความกว้างของ Safe Zone, IV และ Theta)

**แผนการจัดการ Position (Plan of Action):**
- Take Profit: [แนะนำจุดปิดทำกำไร 35% หรือ Quick TP 30% ใน 4 วันแรก]
- Stop Loss: [แนะนำจุดตัดขาดทุนเมื่อราคาแตะ Strike หรือ 2x Premium]
- Roll Plan: [จังหวะที่ควร Roll ขยายเวลา]

**คำแนะนำการเปิดออเดอร์บน Binance:** (สรุปสิ่งที่ต้องเปิดใน Binance Options)`;
    } else {
      prompt = `You are an expert BTC options trader specializing in short premium strategies (Short Strangle, Short Put, Short Call).
Analyze this active position and give a concise, actionable recommendation according to v3.0 Trading Rules (Take Profit 35%, Stop Loss 2x premium, Delta Warning 0.38, Defensive Mode 0.52, Action Level 0.65, DTE exit <= 2).

MARKET DATA:
- BTC Price: $${currentBtcPrice?.toLocaleString() ?? "unknown"}
- Option Chain Average IV: ${marketIvStr}

POSITION:
- Type: ${currentPos.type}
- Strike: $${Number(currentPos.strike).toLocaleString()}
- DTE: ${currentPos.dte} days
- Delta: ${currentPos.delta}
- Theta: $${currentPos.theta}/day
- Vega: ${currentPos.vega}
- IV: ${currentPos.iv?.toFixed?.(1) ?? currentPos.iv}%
- Premium received: $${currentPos.premium}
- Current value: $${currentPos.currentPrice}
- Unrealized P&L: ${currentPos.pnl >= 0 ? "+" : ""}$${currentPos.pnl}

Respond in Thai language. Format your response as:

**สถานะ:** [HEALTHY / WARNING / DANGER]
**Action แนะนำ:** [HOLD / CLOSE NOW / ROLL OUT / ADJUST]

**เหตุผล:** (2-3 ประโยค อธิบายสถานะ position)

**จุดเฝ้าระวัง:**
- Delta trigger: [Delta >= 0.38 เฝ้าระวัง, Delta >= 0.52 โหมดป้องกัน, Delta >= 0.65 แอ็กชัน]
- TP: [กำไร >= 35% ปิดทันที]
- SL: [ขาดทุนแตะ 2x Premium คัททันที]
- DTE: [เหลือ <= 2 วัน ปิดทันที]

**หากราคา BTC เคลื่อนไหว:**
- ถ้าขึ้น: [แนะนำอะไร]
- ถ้าลง: [แนะนำอะไร]`;
    }

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      const rawText = data.text || data.error?.message || data.error?.error?.message || (typeof data.error === "string" ? data.error : null) || "ไม่สามารถวิเคราะห์ได้";
      // XSS fix: escape HTML first, then inject only our known-safe styled spans
      setAnalysisHtml(renderAnalysisHtml(rawText));
    } catch (e) {
      setAnalysisHtml(renderAnalysisHtml("เกิดข้อผิดพลาด: " + e.message));
    } finally {
      setLoading(false);
    }
  }, [strategy, isOpportunity]);

  // Run analysis only ONCE when modal is opened, not on every background 15s poll
  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(3, 5, 8, 0.85)",
      backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 16,
    }}>
      <div style={{
        background: `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
        border: `1px solid ${T.borderHover}`,
        borderRadius: 16,
        width: "100%", maxWidth: 740, maxHeight: "90vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 48px rgba(0,0,0,0.6), 0 0 30px rgba(0, 229, 163, 0.08)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 22px",
          borderBottom: `1px solid ${T.border}`,
          background: `linear-gradient(90deg, ${T.bg2}, ${T.bg1})`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>🧠</span>
            <span style={{ color: T.green, fontFamily: T.fontSans, fontWeight: 800, fontSize: 14, letterSpacing: 1.5 }}>
              AI QUANT ANALYSIS
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {pos?.strategy === "SHORT_PUT" ? (
              <>
                <Pill color={T.green}>BULLISH SHORT PUT</Pill>
                <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
                  Strike {fmtUSD(pos.putStrike || pos.strike, 0)} ({pos.dte}d)
                </span>
              </>
            ) : pos?.strategy === "SKEWED_STRANGLE" ? (
              <>
                <Pill color={T.blue}>SKEWED STRANGLE</Pill>
                <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
                  P{fmtUSD(pos.putStrike, 0)} / C{fmtUSD(pos.callStrike, 0)} ({pos.dte}d)
                </span>
              </>
            ) : pos?.strategy === "STRANGLE" ? (
              <>
                <Pill color={T.purple}>SHORT STRANGLE</Pill>
                <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
                  P{fmtUSD(pos.putStrike, 0)} / C{fmtUSD(pos.callStrike, 0)} ({pos.dte}d)
                </span>
              </>
            ) : (
              <>
                <Pill color={isCall ? T.blue : T.amber}>{pos.type}</Pill>
                <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13, fontWeight: 600 }}>
                  Strike {fmtUSD(pos.strike, 0)} ({pos.dte}d)
                </span>
              </>
            )}
            <button
              id="analysis-panel-close"
              onClick={onClose}
              style={{
                background: T.bg3, border: `1px solid ${T.border}`, color: T.textSecondary,
                borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontFamily: T.fontSans, fontSize: 12, fontWeight: 600,
              }}
            >
              ✕ ปิด
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {loading && !analysisHtml && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "60px 0" }}>
              <div style={{ display: "flex", gap: 8 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: T.green,
                    boxShadow: `0 0 10px ${T.green}`,
                    animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
              <span style={{ color: T.textSecondary, fontFamily: T.fontSans, fontSize: 13, letterSpacing: 2, fontWeight: 600 }}>
                กำลังประมวลผลข้อมูลตลาดและคำนวณความเสี่ยง...
              </span>
            </div>
          )}
          {analysisHtml && (
            <div
              style={{ color: T.textPrimary, fontFamily: "'Inter', sans-serif", fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-wrap" }}
              dangerouslySetInnerHTML={{ __html: analysisHtml }}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 22px",
          borderTop: `1px solid ${T.border}`,
          background: T.bg1,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 10,
        }}>
          <span style={{ color: T.textMuted, fontFamily: T.fontSans, fontSize: 11 }}>
            ⚠ AI Analysis — วิเคราะห์เพื่อเป็นข้อมูลประกอบการตัดสินใจตาม Risk Rules
          </span>
          <button
            id="analysis-panel-refresh"
            onClick={runAnalysis}
            style={{
              background: T.greenDim, border: `1px solid ${T.greenMid}`, color: T.green,
              borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontFamily: T.fontSans, fontSize: 12, fontWeight: 700,
            }}
          >
            ↺ REFRESH
          </button>
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}
