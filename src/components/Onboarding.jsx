import { useState } from "react";
import { T } from "../tokens.js";

const ENV_EXAMPLE = `APP_ACCESS_TOKEN=your-secure-random-token
ALLOWED_ORIGIN=https://your-domain.vercel.app
BINANCE_API_KEY=your-binance-readonly-key
BINANCE_API_SECRET=your-binance-secret
GROQ_API_KEY=gsk_your_groq_key
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id`;

export function Onboarding({ isOpen, onClose }) {
  const [copied, setCopied] = useState(null);

  if (!isOpen) return null;

  const copy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    }
  };

  const handleDone = () => {
    try { localStorage.setItem("onboarding_done", "true"); } catch {}
    if (onClose) onClose();
  };

  const handleDismiss = () => {
    try { localStorage.setItem("onboarding_done", "true"); } catch {}
    if (onClose) onClose();
  };

  const stepCard = (num, title, desc, children, accent = T.green) => (
    <div style={{
      background: T.bg2,
      border: `1px solid ${T.border}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 10,
      padding: "14px 16px",
      marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: `${accent}18`, border: `1px solid ${accent}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: accent, fontWeight: 900, fontSize: 13, flexShrink: 0,
        }}>{num}</div>
        <div style={{ color: T.textPrimary, fontWeight: 800, fontSize: 13, fontFamily: T.fontSans }}>{title}</div>
      </div>
      <div style={{ color: T.textSecondary, fontSize: 11.5, lineHeight: 1.6, fontFamily: T.fontSans, marginBottom: children ? 10 : 0 }}>
        {desc}
      </div>
      {children}
    </div>
  );

  const copyBtn = (text, id, label = "Copy") => (
    <button
      onClick={() => copy(text, id)}
      style={{
        background: copied === id ? T.greenDim : T.bg3,
        border: `1px solid ${copied === id ? T.green : T.border}`,
        color: copied === id ? T.green : T.textSecondary,
        borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 700,
        cursor: "pointer", fontFamily: T.fontSans, display: "inline-flex", alignItems: "center", gap: 4,
        transition: "all 0.2s ease",
      }}
    >
      {copied === id ? "✓ Copied" : `📋 ${label}`}
    </button>
  );

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        backgroundColor: "rgba(5, 7, 10, 0.88)",
        backdropFilter: "blur(10px)",
        zIndex: 10000,
        display: "flex", justifyContent: "center", alignItems: "center",
        padding: 20,
      }}
      onClick={handleDismiss}
    >
      <div
        style={{
          background: `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
          border: `1px solid ${T.borderActive}`,
          borderRadius: 16,
          width: "100%", maxWidth: 640,
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 25px 60px rgba(0,0,0,0.85), 0 0 30px rgba(0,240,168,0.14)",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⚡</div>
          <div style={{ color: T.textPrimary, fontWeight: 900, fontSize: 18, letterSpacing: 1.5, fontFamily: T.fontSans }}>
            WELCOME TO BTC OPTIONS DESK
          </div>
          <div style={{ color: T.green, fontSize: 11, fontWeight: 800, letterSpacing: 1, fontFamily: T.font, marginTop: 4 }}>
            3 STEPS TO GO LIVE — 5 MIN SETUP
          </div>
          <div style={{ color: T.textMuted, fontSize: 11, fontFamily: T.fontSans, marginTop: 8, lineHeight: 1.5 }}>
            War Room ติดตามพอร์ต Options แบบ Real-time + Scanner + Alerts — ตั้งค่าครั้งเดียว ใช้งานได้ทันที
          </div>
        </div>

        {/* Step 1 */}
        {stepCard(
          "1",
          "Create Binance Read-Only API Key",
          "สร้าง API Key แบบอ่านอย่างเดียว (Read-Only) ไม่ต้องเปิด Spot/Futures trading หรือ Withdraw — ปลอดภัย 100%",
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ol style={{ color: T.textSecondary, fontSize: 11.5, lineHeight: 1.7, margin: 0, paddingLeft: 18, fontFamily: T.fontSans }}>
              <li>เข้า <a href="https://www.binance.com/en/my/settings/api-management" target="_blank" rel="noreferrer" style={{ color: T.cyan, textDecoration: "underline" }}>Binance API Management</a> → Create API</li>
              <li>ตั้งชื่อ <code style={{ background: T.bg3, padding: "1px 6px", borderRadius: 4, color: T.green, fontSize: 11 }}>btc-options-desk-readonly</code> เลือก <b style={{ color: T.textPrimary }}>Enable Reading</b> เท่านั้น</li>
              <li>ปิด Withdrawals / Futures / Spot Trading ให้หมด — คัดลอก <b>API Key</b> + <b>Secret</b> ไปใส่ ENV</li>
              <li> whitelist IP ถ้าต้องการ (แนะนำสำหรับ production)</li>
            </ol>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <a href="https://www.binance.com/en/my/settings/api-management" target="_blank" rel="noreferrer"
                style={{ background: T.cyan, color: "#05070a", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 800, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                🔗 Open Binance API Management
              </a>
              {copyBtn("BINANCE_API_KEY=your-binance-readonly-key\nBINANCE_API_SECRET=your-binance-secret", "binance-env", "Copy ENV")}
            </div>
          </div>,
          T.cyan
        )}

        {/* Step 2 */}
        {stepCard(
          "2",
          "Get Groq API Key (AI Analysis)",
          "ใช้สำหรับ AI วิเคราะห์พอร์ตและ Market commentary — ฟรี มี rate limit สูง เร็วสุดในตลาด",
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ol style={{ color: T.textSecondary, fontSize: 11.5, lineHeight: 1.7, margin: 0, paddingLeft: 18, fontFamily: T.fontSans }}>
              <li>เข้า <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: T.amber, textDecoration: "underline" }}>console.groq.com/keys</a> → Create API Key</li>
              <li>คัดลอก key ที่ขึ้นต้นด้วย <code style={{ background: T.bg3, padding: "1px 6px", borderRadius: 4, color: T.amber, fontSize: 11 }}>gsk_...</code></li>
              <li>นำไปใส่ ENV เป็น <code style={{ background: T.bg3, padding: "1px 6px", borderRadius: 4, color: T.textPrimary, fontSize: 11 }}>GROQ_API_KEY</code></li>
            </ol>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer"
                style={{ background: T.amber, color: "#05070a", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 800, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                🔗 Open Groq Console
              </a>
              {copyBtn("GROQ_API_KEY=gsk_your_groq_key", "groq-env", "Copy ENV")}
            </div>
          </div>,
          T.amber
        )}

        {/* Step 3 */}
        {stepCard(
          "3",
          "Set APP_ACCESS_TOKEN & ALLOWED_ORIGIN",
          "ล็อก Dashboard ด้วย Token และกัน CORS — ตั้งใน Vercel → Project Settings → Environment Variables",
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{
              background: T.bg0, border: `1px solid ${T.border}`, borderRadius: 8,
              padding: 10, position: "relative",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: T.textMuted, fontSize: 10, fontWeight: 800, letterSpacing: 1, fontFamily: T.font }}>ENV TEMPLATE — .env / Vercel ENV</span>
                {copyBtn(ENV_EXAMPLE, "env-all", "Copy All")}
              </div>
              <pre style={{
                margin: 0, fontSize: 11, lineHeight: 1.6, color: T.textSecondary,
                fontFamily: T.font, whiteSpace: "pre-wrap", wordBreak: "break-all",
                background: "transparent",
              }}>{ENV_EXAMPLE}</pre>
            </div>
            <ul style={{ color: T.textSecondary, fontSize: 11.5, lineHeight: 1.6, margin: 0, paddingLeft: 18, fontFamily: T.fontSans }}>
              <li><code style={{ background: T.bg3, padding: "1px 6px", borderRadius: 4, color: T.green }}>APP_ACCESS_TOKEN</code> — ตั้งรหัสผ่านเข้า Dashboard (เช่นสุ่ม 32 ตัวอักษร) &nbsp;{copyBtn("openssl rand -hex 16", "openssl", "Copy cmd")}</li>
              <li><code style={{ background: T.bg3, padding: "1px 6px", borderRadius: 4, color: T.green }}>ALLOWED_ORIGIN</code> — ใส่โดเมน Vercel ของคุณ เช่น <code style={{ color: T.cyan }}>https://btc-options-desk.vercel.app</code></li>
              <li>บน <b style={{ color: T.textPrimary }}>Vercel</b>: Settings → Environment Variables → Add ทั้ง 2 ตัว → Redeploy</li>
              <li>บน <b style={{ color: T.textPrimary }}>Local</b>: สร้างไฟล์ <code style={{ color: T.textPrimary }}>.env</code> ที่ root แล้ววาง template ด้านบน</li>
            </ul>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer"
                style={{ background: T.green, color: "#05070a", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 800, textDecoration: "none" }}>
                ▲ Open Vercel Dashboard
              </a>
              {copyBtn("APP_ACCESS_TOKEN=your-secure-random-token\nALLOWED_ORIGIN=https://your-domain.vercel.app", "app-env", "Copy APP ENV")}
            </div>
          </div>,
          T.green
        )}

        {/* Footer help */}
        <div style={{
          background: `${T.blue}0c`, border: `1px solid ${T.blue}33`,
          borderRadius: 8, padding: "10px 14px", marginTop: 4, marginBottom: 16,
        }}>
          <div style={{ color: T.blue, fontSize: 11, fontWeight: 800, fontFamily: T.fontSans, marginBottom: 4 }}>💡 Need help?</div>
          <div style={{ color: T.textSecondary, fontSize: 11, lineHeight: 1.6, fontFamily: T.fontSans }}>
            ENV ทั้งหมดใส่ฝั่ง <b style={{ color: T.textPrimary }}>Server</b> เท่านั้น (Vercel Functions) ไม่เคยส่งออกไปที่ browser.
            หลังตั้งค่าเสร็จกด Redeploy 1 ครั้ง แล้วรีเฟรชหน้านี้ — ถ้ายังติดปัญหาเช็ค <code style={{ background: T.bg3, padding: "1px 5px", borderRadius: 4 }}> /api/health</code>.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleDismiss}
            style={{
              flex: 1, padding: "11px 16px",
              background: "transparent", border: `1px solid ${T.border}`, color: T.textSecondary,
              borderRadius: 10, cursor: "pointer", fontFamily: T.fontSans, fontSize: 12, fontWeight: 700,
            }}
          >
            Dismiss
          </button>
          <button
            onClick={handleDone}
            style={{
              flex: 2, padding: "11px 16px",
              background: T.green, color: "#05070a", border: "none",
              borderRadius: 10, cursor: "pointer", fontFamily: T.fontSans, fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
              boxShadow: `0 0 18px ${T.greenDim}`,
            }}
          >
            ✓ GOT IT — START TRADING
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button
            onClick={handleDismiss}
            style={{ background: "none", border: "none", color: T.textMuted, fontSize: 11, cursor: "pointer", textDecoration: "underline", fontFamily: T.fontSans }}
          >
            Don't show again
          </button>
        </div>
      </div>
    </div>
  );
}

export default Onboarding;
