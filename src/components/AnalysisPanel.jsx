import { useState, useEffect, useCallback, useRef } from "react";
import { T } from "../tokens.js";
import { fmtUSD, renderAnalysisHtml } from "../utils.js";
import { Pill } from "./Pill.jsx";

export function AnalysisPanel({ pos, btcPrice, ivRank, onClose }) {
  const [analysisHtml, setAnalysisHtml] = useState("");
  const [loading, setLoading] = useState(false);

  const isStrangleSetup = pos?.strategy === "STRANGLE";
  const isCall = Boolean(pos?.type?.includes("Call"));

  // Keep references to prevent 15-second background price polling from re-triggering analysis while user is reading
  const propsRef = useRef({ pos, btcPrice, ivRank });
  propsRef.current = { pos, btcPrice, ivRank };

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setAnalysisHtml("");

    const { pos: currentPos, btcPrice: currentBtcPrice, ivRank: currentIvRank } = propsRef.current;

    // ivRank comes from parent (calculated from optionMarks) — may be null
    const ivRankStr = currentIvRank != null ? `${currentIvRank}%` : "ไม่มีข้อมูล (ดู IV ของ position แทน)";

    let prompt = "";
    if (isStrangleSetup) {
      prompt = `You are an expert BTC options trader specializing in Short Strangle strategies.
Analyze this proposed SHORT STRANGLE ENTRY OPPORTUNITY on Binance Options.

MARKET DATA:
- BTC Price: $${currentBtcPrice?.toLocaleString() ?? "unknown"}
- Market IV: ${ivRankStr}

PROPOSED STRANGLE SETUP:
- Expiry: ${currentPos.expiry} (${currentPos.dte} days to expiry)
- Short Put: Strike $${Number(currentPos.putStrike).toLocaleString()} (Delta: ${currentPos.putDelta}, IV: ${currentPos.putIV}%, Mark: $${currentPos.putMark})
- Short Call: Strike $${Number(currentPos.callStrike).toLocaleString()} (Delta: +${currentPos.callDelta}, IV: ${currentPos.callIV}%, Mark: $${currentPos.callMark})
- Total Premium: ~$${currentPos.totalPremium} / 1 BTC
- Total Theta: +$${currentPos.totalTheta}/day
- Breakeven Range: $${Number(currentPos.breakevenLow).toLocaleString()} – $${Number(currentPos.breakevenHigh).toLocaleString()}

Respond in Thai language. Format your response as:

**สถานะ:** [GOOD TO ENTER / WAIT / AVOID]
**Action แนะนำ:** [OPEN POSITION / WAIT FOR BETTER IV / ADJUST STRIKE]

**การประเมินความคุ้มค่าและความเสี่ยง:** (3-4 ประโยค อธิบายความกว้างของ Safe Zone, IV และ Theta)

**แผนการจัดการ Position (Plan of Action):**
- Take Profit: [แนะนำจุดปิดทำกำไร 50% หรือเวลาที่เหมาะสม]
- Stop Loss: [แนะนำจุดตัดขาดทุนเมื่อราคาแตะ Strike หรือ 2x Premium]
- Roll Plan: [จังหวะที่ควร Roll ขยายเวลา]

**คำแนะนำการเปิดออเดอร์บน Binance:** (สรุปสิ่งที่ต้องเปิดใน Binance Options)`;
    } else {
      prompt = `You are an expert BTC options trader specializing in short premium strategies (Short Strangle).
Analyze this position and give a concise, actionable recommendation.

MARKET DATA:
- BTC Price: $${currentBtcPrice?.toLocaleString() ?? "unknown"}
- IV Rank: ${ivRankStr}

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
- Delta trigger: [ค่า delta ที่ควร action]
- TP: [% profit ที่ควร close]
- SL: [loss ที่ควร cut]

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
  }, [isStrangleSetup]);

  // Run analysis only ONCE when modal is opened, not on every background 15s poll
  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(680px, 95vw)", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: `0 0 60px ${T.green}22` }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${T.border}`, background: T.bg2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: T.green, boxShadow: `0 0 8px ${T.green}` }} />
            <span style={{ color: T.green, fontFamily: T.font, fontWeight: 700, fontSize: 14, letterSpacing: 2 }}>AI ANALYSIS ENGINE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isStrangleSetup ? (
              <>
                <Pill color={T.green}>SHORT STRANGLE</Pill>
                <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 13 }}>
                  Put {fmtUSD(pos.putStrike)} / Call {fmtUSD(pos.callStrike)}
                </span>
              </>
            ) : (
              <>
                <Pill color={isCall ? T.blue : T.amber}>{pos.type}</Pill>
                <span style={{ color: T.textPrimary, fontFamily: T.font, fontSize: 14 }}>Strike {fmtUSD(pos.strike)}</span>
              </>
            )}
            <button
              id="analysis-panel-close"
              onClick={onClose}
              style={{ background: "none", border: `1px solid ${T.border}`, color: T.textSecondary, borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: T.font, fontSize: 12 }}
            >
              ✕ ปิด
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {loading && !analysisHtml && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 40 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: T.green, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
              <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 12, letterSpacing: 2 }}>ANALYZING POSITION...</span>
            </div>
          )}
          {analysisHtml && (
            <div
              style={{ color: T.textPrimary, fontFamily: "'Inter', sans-serif", fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}
              dangerouslySetInnerHTML={{ __html: analysisHtml }}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, background: T.bg2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: T.textMuted, fontFamily: T.font, fontSize: 10, letterSpacing: 1 }}>⚠ AI ANALYSIS — ตัดสินใจเองเสมอ ไม่ใช่คำแนะนำทางการเงิน</span>
          <button
            id="analysis-panel-refresh"
            onClick={runAnalysis}
            style={{ background: T.greenDim, border: `1px solid ${T.greenMid}`, color: T.green, borderRadius: 5, padding: "6px 14px", cursor: "pointer", fontFamily: T.font, fontSize: 11, fontWeight: 700, letterSpacing: 1 }}
          >
            ↺ REFRESH
          </button>
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}
