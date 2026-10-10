import { useState, useEffect, useRef, useCallback } from "react";
import { T } from "../tokens.js";
import { fmtUSD, renderAnalysisHtml } from "../utils.js";
import { SoundFX } from "../services/soundFx.js";

const DEFAULT_GREETING = `สวัสดีครับ! ผมคือ **AI Institutional Options Desk Analyst** ประจำโต๊ะเทรดของคุณ 🧠⚡

ผมเชื่อมต่อกับข้อมูลตลาดจริงของ Binance Options, ดัชนี Deribit DVOL และพอร์ตของคุณแบบ Real-time เรียบร้อยแล้ว

💡 **ตัวอย่างคำถามที่สามารถถามผมได้ทันที:**
• *"ช่วยสแกนหาจังหวะเปิด Position ที่ดีที่สุดในตลาดตอนนี้"*
• *"สรุปความเสี่ยงพอร์ตและสถานะ Net Delta ของผม"*
• *"ถ้า BTC ร่วงลงไป $80,000 พอร์ตผมจะเสียหายเท่าไหร่ และควรรับมืออย่างไร?"*
• *"สภาวะตลาดตอนนี้ควรเปิด Short Strangle หรือ Iron Condor?"*
• *"ช่วยวางแผน Roll Position ที่เริ่มเข้าโซน Warning ให้หน่อย"*

พิมพ์คำถามของคุณด้านล่าง หรือกดเลือก Quick Prompts เพื่อเริ่มต้นได้เลยครับ!`;

export function AIChatDrawer({
  isOpen,
  onClose,
  btcPrice,
  marketIv,
  marketContext = {},
  accountInfo = null,
  positions = [],
  opportunities = [],
  maxPain = null,
  deltaHedge = null,
}) {
  const [messages, setMessages] = useState(() => [
    { role: "assistant", content: DEFAULT_GREETING, timestamp: new Date() },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom of chat
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        scrollToBottom();
      }, 100);
    }
  }, [isOpen, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Build Comprehensive System Context Injection
  const buildSystemContext = useCallback(() => {
    const totalPnl = positions.reduce((s, p) => s + (p.pnl || 0), 0);
    const totalTheta = positions.reduce((s, p) => s + (Math.abs(p.theta || 0) * (p.size || 1)), 0);
    const dangerCount = positions.filter(p => p.status === "danger" || p.status === "warning").length;

    const positionsSummary = positions.length === 0
      ? "ไม่มี Position เปิดอยู่ (พอร์ตว่าง 100% Cash/Available Margin)"
      : positions.map((p, idx) => (
          `[#${idx + 1}] ${p.type} Strike $${p.strike || "N/A"} | DTE: ${p.dte}d | Delta: ${p.delta} | IV: ${p.iv}% | P&L: $${p.pnl} | Size: ${p.size} BTC | Status: ${p.status}`
        )).join("\n");

    const topOppsSummary = opportunities.slice(0, 3).map((o, idx) => (
      `[Setup #${idx + 1}] ${o.strategyName || o.strategy}: ${o.putStrike ? `Put $${o.putStrike}` : ""} ${o.callStrike ? `/ Call $${o.callStrike}` : ""} (DTE ${o.dte}d, Net Premium ~$${o.totalPremium}, RoR/ROM ${o.annualizedYield || o.returnOnRiskPct}%, Spread: ${o.spreadPct || o.maxSpreadPct || "OK"}%)`
    )).join("\n");

    return `You are the Senior Institutional Head of BTC Options Desk & Chief Risk Officer.
You communicate professionally, pragmatically, concisely, and supportively in Thai.

TRADING FRAMEWORK & SYSTEMATIC RULES v3.0:
1. Target Strategies:
   - Primary: Short Strangle (30-45 DTE, Delta 0.15-0.20 per wing)
   - Tail-Risk Guard: Iron Condors (4-legs, defined max loss)
   - Directional Bullish: Short Put (Delta 0.15-0.25 on key support)
2. Disciplined Exit Rules:
   - Take Profit: 35% of initial premium collected (or 30% if reached within first 4 days).
   - Hard Stop-Loss: 2x initial premium collected (100% loss) OR when tested leg delta reaches 0.52.
   - Defense Phase: Prepare roll/hedge when tested leg delta reaches 0.38.
   - Expiry Risk: Mandatory close when DTE <= 2 days to eliminate Gamma pinning risk.
3. Capacity Ceiling:
   - Maximum 35% initial margin utilization. Never overleverage.

LIVE DESK CONTEXT & REAL-TIME TELEMETRY:
- BTC Spot Price: ${btcPrice ? `$${btcPrice.toLocaleString()}` : "N/A"} (24h Change: ${marketContext.change24h != null ? `${marketContext.change24h}%` : "N/A"})
- Technical Regime: EMA20 = $${marketContext.ema20 || "N/A"}, EMA50 = $${marketContext.ema50 || "N/A"}, ADX14 = ${marketContext.adx14 || "N/A"}
- Implied Volatility: Option Chain Avg IV = ${marketIv != null ? `${marketIv}%` : "N/A"}
- Deribit 30D DVOL Index: ${marketContext.dvol != null ? `${marketContext.dvol}%` : "N/A"}
- Volatility Risk Premium (VRP): ${marketContext.vrp != null ? `${marketContext.vrp > 0 ? "+" : ""}${marketContext.vrp}% (${marketContext.vrp >= 0 ? "IV Rich / High Premium" : "IV Cheap"})` : "N/A"}
- Max Pain Pinning Strike: ${maxPain?.available ? `$${maxPain.maxPainStrike?.toLocaleString()} (${maxPain.distancePct > 0 ? "+" : ""}${maxPain.distancePct}% from spot)` : "N/A"}
- Delta Hedging Status: ${deltaHedge?.available ? `Net Delta: ${deltaHedge.netDelta > 0 ? "+" : ""}${deltaHedge.netDelta} Δ | Status: ${deltaHedge.urgency} | Recommended Action: ${deltaHedge.hedgeAction !== "NEUTRAL" ? `${deltaHedge.hedgeAction} ${deltaHedge.hedgeQtyBtc} BTCUSDT Perp` : "None"}` : "N/A"}
- Account Equity: ${accountInfo ? fmtUSD(accountInfo.equity, 2) : "N/A"} (Available: ${accountInfo ? fmtUSD(accountInfo.availableBalance, 2) : "N/A"}, Margin Used: ${accountInfo ? `${accountInfo.marginPct}%` : "N/A"})
- Portfolio Net Unrealized P&L: $${totalPnl.toFixed(2)} | Portfolio Theta: +$${totalTheta.toFixed(1)}/day | Alerts: ${dangerCount}

OPEN POSITIONS IN DESK:
${positionsSummary}

TOP OPPORTUNITIES SCANNED IN REAL-TIME:
${topOppsSummary || "ไม่มีคู่สัญญาที่ผ่านเกณฑ์ความคุ้มค่า ณ วินาทีนี้"}

INSTRUCTIONS FOR RESPONSES:
- Provide actionable, direct, math-backed advice.
- When evaluating opportunities, explicitly assess IV/VRP, trend support/resistance, delta, theta decay, and downside buffer.
- Use clear markdown formatting, bullet points, and bold text for strikes, numbers, and recommendations.
- Keep tone professional, institutional, and concise (avoid unnecessary fluff). Always respond in Thai.`;
  }, [btcPrice, marketIv, marketContext, accountInfo, positions, opportunities, maxPain, deltaHedge]);

  const handleSend = async (textToSend = null) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    setInput("");
    setError(null);
    SoundFX.playClick();

    const userMessage = { role: "user", content: query, timestamp: new Date() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      const systemPrompt = buildSystemContext();
      const token = localStorage.getItem("app_token") || "";

      // Send recent messages (up to 8 turns to keep context fast and focused)
      const recentChat = updatedMessages.slice(-8).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: recentChat,
          systemPrompt,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
      }

      const assistantReply = data.text || "ขออภัยครับ ไม่ได้รับคำตอบจากโมเดล";
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: assistantReply, timestamp: new Date() },
      ]);
      SoundFX.playSuccessChime();
    } catch (err) {
      setError(err.message || "เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI Analyst");
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ **ข้อผิดพลาด:** ${err.message || "ไม่สามารถเชื่อมต่อกับ AI ได้ กรุณาตรวจสอบ GROQ_API_KEY"}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    if (window.confirm("คุณต้องการล้างประวัติการสนทนาทั้งหมดใช่หรือไม่?")) {
      setMessages([{ role: "assistant", content: DEFAULT_GREETING, timestamp: new Date() }]);
      setError(null);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    alert("คัดลอกคำตอบไปยังคลิปบอร์ดแล้ว");
  };

  if (!isOpen) return null;

  const quickPrompts = [
    { label: "🎯 หาจังหวะที่ดีที่สุดตอนนี้", text: "ช่วยสแกนหาจังหวะเปิด Position ที่คุ้มค่าที่สุดในตลาดตอนนี้ พร้อมบอกเหตุผลเชิงกลยุทธ์และจุด Take Profit / Stop Loss" },
    { label: "⚖️ วิเคราะห์ความเสี่ยงพอร์ต", text: "ช่วยวิเคราะห์สุขภาพพอร์ตปัจจุบันของผมอย่างละเอียด มีสัญญาตัวไหนน่าเป็นห่วงหรือต้องตั้งรับเป็นพิเศษมั้ย?" },
    { label: "🛡️ เช็ก Net Delta & Rebalance", text: "ตรวจสอบสถานะ Net Delta ของพอร์ตตอนนี้ว่าสมดุลหรือไม่ จำเป็นต้องเปิด Futures เพื่อ Rebalance หรือไม่?" },
    { label: "📉 ทดสอบฉุกเฉินถ้า BTC ร่วง 10%", text: "ถ้า BTC เกิด Flash Crash ร่วงลงไป 10% ภายใน 24 ชม. พอร์ตผมจะได้รับผลกระทบอย่างไร และมีแผนแก้เกมอย่างไร?" },
    { label: "💡 เปรียบเทียบ Strangle vs Condor", text: "ในสภาวะ Volatility และ VRP ปัจจุบัน ควรเลือกเล่น Short Strangle หรือ Iron Condor เพราะอะไร?" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", justifyContent: "flex-end" }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(3, 5, 8, 0.75)",
          backdropFilter: "blur(6px)",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Slide-out Drawer */}
      <div
        style={{
          position: "relative",
          zIndex: 1201,
          width: "100%",
          maxWidth: 520,
          height: "100vh",
          background: `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
          borderLeft: `1px solid ${T.borderActive}`,
          boxShadow: `-10px 0 35px rgba(0,0,0,0.65)`,
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${T.border}`,
            background: T.bg2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: `linear-gradient(135deg, ${T.greenDim}, ${T.bg3})`,
              border: `1px solid ${T.greenMid}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18,
            }}>
              🧠
            </div>
            <div>
              <div style={{ color: T.textPrimary, fontFamily: T.fontSans, fontWeight: 800, fontSize: 14, letterSpacing: 1 }}>
                AI DESK ANALYST
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%", background: T.green,
                  boxShadow: `0 0 8px ${T.green}`, display: "inline-block",
                }} />
                <span style={{ color: T.green, fontFamily: T.font, fontSize: 10, fontWeight: 700 }}>
                  GROQ LLAMA 3.3 (ONLINE)
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={handleClearChat}
              title="ล้างประวัติการสนทนา"
              style={{
                background: T.bg3, border: `1px solid ${T.border}`, color: T.textSecondary,
                borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontSize: 11, fontFamily: T.fontSans,
              }}
            >
              🗑️ ล้างแชท
            </button>
            <button
              onClick={onClose}
              title="ปิดหน้าต่างแชท (ESC)"
              style={{
                background: T.bg3, border: `1px solid ${T.border}`, color: T.textPrimary,
                borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 13, fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Live Telemetry Chips Bar ──────────────────────────────────────── */}
        <div
          style={{
            padding: "8px 16px",
            background: T.bg3,
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
            overflowX: "auto",
            whiteSpace: "nowrap",
            fontFamily: T.font,
            fontSize: 10.5,
          }}
        >
          <span style={{ color: T.textMuted }}>LIVE CONTEXT:</span>
          <span style={{ background: T.bg1, padding: "2px 6px", borderRadius: 4, border: `1px solid ${T.border}`, color: T.blue }}>
            BTC {btcPrice ? fmtUSD(btcPrice, 0) : "N/A"}
          </span>
          {marketContext.dvol != null && (
            <span style={{ background: T.bg1, padding: "2px 6px", borderRadius: 4, border: `1px solid ${T.border}`, color: T.purple }}>
              DVOL {marketContext.dvol}%
            </span>
          )}
          {marketContext.vrp != null && (
            <span style={{ background: T.bg1, padding: "2px 6px", borderRadius: 4, border: `1px solid ${T.border}`, color: marketContext.vrp >= 0 ? T.green : T.red }}>
              VRP {marketContext.vrp > 0 ? "+" : ""}{marketContext.vrp}%
            </span>
          )}
          <span style={{ background: T.bg1, padding: "2px 6px", borderRadius: 4, border: `1px solid ${T.border}`, color: T.amber }}>
            POSITIONS: {positions.length}
          </span>
          {deltaHedge?.available && (
            <span style={{ background: T.bg1, padding: "2px 6px", borderRadius: 4, border: `1px solid ${T.border}`, color: deltaHedge.urgency === "HEDGE_REQUIRED" ? T.red : T.green }}>
              Δ {deltaHedge.netDelta > 0 ? "+" : ""}{deltaHedge.netDelta}
            </span>
          )}
        </div>

        {/* ── Chat Messages Body ────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {messages.map((m, idx) => {
            const isUser = m.role === "user";
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isUser ? "flex-end" : "flex-start",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: T.textMuted, fontFamily: T.fontSans }}>
                  <span>{isUser ? "👤 คุณ (Trader)" : "🧠 AI Desk Analyst"}</span>
                  <span>•</span>
                  <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>

                <div
                  style={{
                    maxWidth: "88%",
                    padding: isUser ? "10px 14px" : "14px 16px",
                    borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: isUser
                      ? `linear-gradient(135deg, ${T.greenDim}, ${T.bg2})`
                      : `linear-gradient(135deg, ${T.bg2}, ${T.bg1})`,
                    border: `1px solid ${isUser ? T.greenMid : T.border}`,
                    color: T.textPrimary,
                    fontSize: 13,
                    lineHeight: 1.65,
                    fontFamily: isUser ? T.fontSans : "'Inter', -apple-system, sans-serif",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                    position: "relative",
                  }}
                >
                  {isUser ? (
                    <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                  ) : (
                    <>
                      <div
                        dangerouslySetInnerHTML={{ __html: renderAnalysisHtml(m.content) }}
                        style={{ whiteSpace: "pre-wrap" }}
                      />
                      <button
                        onClick={() => copyToClipboard(m.content)}
                        title="คัดลอกข้อความ"
                        style={{
                          marginTop: 8,
                          background: "transparent",
                          border: `1px solid ${T.border}`,
                          color: T.textMuted,
                          borderRadius: 4,
                          padding: "2px 6px",
                          fontSize: 10,
                          cursor: "pointer",
                          fontFamily: T.fontSans,
                        }}
                      >
                        📋 คัดลอก
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.fontSans }}>🧠 AI Desk Analyst กำลังคิด...</div>
              <div style={{
                padding: "12px 16px", borderRadius: "12px 12px 12px 2px",
                background: T.bg2, border: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <div style={{ display: "flex", gap: 5 }}>
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: T.green,
                        boxShadow: `0 0 6px ${T.green}`,
                        animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </div>
                <span style={{ color: T.textSecondary, fontFamily: T.font, fontSize: 11 }}>
                  กำลังวิเคราะห์ Greeks และ Order Book...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Quick Suggested Prompts ───────────────────────────────────────── */}
        <div
          style={{
            padding: "8px 16px",
            borderTop: `1px solid ${T.border}`,
            background: T.bg1,
            display: "flex",
            gap: 6,
            overflowX: "auto",
            whiteSpace: "nowrap",
          }}
        >
          {quickPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(p.text)}
              disabled={loading}
              style={{
                background: T.bg2,
                border: `1px solid ${T.border}`,
                color: T.textSecondary,
                borderRadius: 20,
                padding: "4px 10px",
                fontSize: 11,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: T.fontSans,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = T.greenMid;
                e.currentTarget.style.color = T.green;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.color = T.textSecondary;
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* ── Input Box ────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: "14px 18px",
            borderTop: `1px solid ${T.border}`,
            background: T.bg2,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {error && (
            <div style={{ color: T.red, fontSize: 11, fontFamily: T.fontSans }}>
              ⚠ {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="พิมพ์คำถามถึง AI นักวิเคราะห์... (Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
              disabled={loading}
              rows={2}
              style={{
                flex: 1,
                background: T.bg0,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                padding: "10px 12px",
                color: T.textPrimary,
                fontFamily: T.fontSans,
                fontSize: 13,
                resize: "none",
                outline: "none",
                lineHeight: 1.4,
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              style={{
                background: input.trim() && !loading ? T.green : T.bg3,
                color: input.trim() && !loading ? "#05080c" : T.textMuted,
                border: "none",
                borderRadius: 8,
                width: 44,
                height: 44,
                cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: 16,
                transition: "all 0.2s ease",
                boxShadow: input.trim() && !loading ? T.greenGlow : "none",
              }}
            >
              ➤
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: T.textMuted, fontSize: 10, fontFamily: T.fontSans }}>
            <span>กด Hotkey <strong>C</strong> เพื่อเปิด/ปิดแชท AI ได้ทุกที่</span>
            <span>Groq Llama 3.3 70B • Institutional Context</span>
          </div>
        </div>
      </div>
    </div>
  );
}
