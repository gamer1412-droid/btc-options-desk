import { useState } from "react";
import { T } from "../tokens.js";
import { SoundFX } from "../services/soundFx.js";
import {
  getAlertPreferences,
  saveAlertPreferences,
  clearPersistedAlerts,
  sendTelegram,
  buildDailyBriefingData,
} from "../services/alerts.js";

export function AlertSettingsModal({
  isOpen,
  onClose,
  positions = [],
  marketContext = {},
  accountInfo = null,
  onPreferencesChange,
}) {
  const [prefs, setPrefs] = useState(() => getAlertPreferences());
  const [testStatus, setTestStatus] = useState(null); // "loading" | "ok" | "error" | null
  const [briefingStatus, setBriefingStatus] = useState(null); // "loading" | "ok" | "error" | null
  const [actionError, setActionError] = useState(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  if (!isOpen) return null;

  const handleToggle = (key) => {
    SoundFX.playClick();
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    saveAlertPreferences(updated);
    if (onPreferencesChange) onPreferencesChange(updated);
  };

  const handleTestAlert = async () => {
    SoundFX.playClick();
    setTestStatus("loading");
    setActionError(null);
    const res = await sendTelegram("test");
    if (res && res.ok) {
      SoundFX.playSuccessChime();
      setTestStatus("ok");
      setActionError(null);
    } else {
      SoundFX.playWarningAlert();
      setTestStatus("error");
      setActionError(res?.error || "ไม่สามารถส่งข้อความได้ กรุณาตรวจสอบการเชื่อมต่อ");
    }
    setTimeout(() => setTestStatus(null), 4000);
  };

  const handleSendBriefing = async () => {
    SoundFX.playClick();
    setBriefingStatus("loading");
    setActionError(null);
    const briefingData = buildDailyBriefingData(positions, marketContext, accountInfo);
    const res = await sendTelegram("daily_briefing", briefingData);
    if (res && res.ok) {
      SoundFX.playSuccessChime();
      setBriefingStatus("ok");
      setActionError(null);
    } else {
      SoundFX.playWarningAlert();
      setBriefingStatus("error");
      setActionError(res?.error || "ไม่สามารถส่ง Daily Briefing ได้");
    }
    setTimeout(() => setBriefingStatus(null), 4000);
  };

  const handleResetCooldowns = () => {
    SoundFX.playClick();
    clearPersistedAlerts();
    setResetSuccess(true);
    setTimeout(() => setResetSuccess(false), 3000);
  };

  const toggleRow = (key, title, desc, icon, badgeColor = T.green) => (
    <div
      onClick={() => handleToggle(key)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        background: prefs[key] && prefs.enabled ? `${badgeColor}0c` : T.bg2,
        border: `1px solid ${prefs[key] && prefs.enabled ? `${badgeColor}44` : T.border}`,
        borderRadius: 8,
        cursor: "pointer",
        transition: "all 0.2s ease",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, paddingRight: 12 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <div style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700, fontFamily: T.fontSans }}>
            {title}
          </div>
          <div style={{ color: T.textSecondary, fontSize: 11, marginTop: 2, fontFamily: T.fontSans }}>
            {desc}
          </div>
        </div>
      </div>

      {/* Switch Toggle */}
      <div
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          background: prefs[key] && prefs.enabled ? badgeColor : "#334155",
          padding: 2,
          transition: "all 0.25s ease",
          display: "flex",
          alignItems: "center",
          boxShadow: prefs[key] && prefs.enabled ? `0 0 10px ${badgeColor}66` : "none",
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#ffffff",
            transform: prefs[key] && prefs.enabled ? "translateX(20px)" : "translateX(0px)",
            transition: "all 0.25s ease",
          }}
        />
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(5, 7, 10, 0.82)",
        backdropFilter: "blur(8px)",
        zIndex: 9999,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: `linear-gradient(180deg, ${T.bg1}, ${T.bg0})`,
          border: `1px solid ${T.borderActive}`,
          borderRadius: 16,
          width: "100%",
          maxWidth: 580,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 25px 60px rgba(0,0,0,0.8), 0 0 30px rgba(0,240,168,0.12)",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: T.greenDim, border: `1px solid ${T.greenMid}`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
            }}>
              🔔
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: T.textPrimary, fontFamily: T.fontSans, letterSpacing: 0.5 }}>
                ALERT & NOTIFICATION ENGINE
              </div>
              <div style={{ fontSize: 11, color: T.green, fontFamily: T.font, fontWeight: 700 }}>
                LIVE BROWSER ALERTS + SERVER CRON v3.0
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              color: T.textSecondary,
              borderRadius: 8,
              width: 32,
              height: 32,
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
            }}
          >
            ✕
          </button>
        </div>

        {/* Master Switch */}
        <div
          onClick={() => handleToggle("enabled")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            background: prefs.enabled ? `linear-gradient(135deg, ${T.greenDim}, ${T.bg2})` : T.bg2,
            border: `1px solid ${prefs.enabled ? T.green : T.border}`,
            borderRadius: 12,
            cursor: "pointer",
            marginBottom: 20,
            boxShadow: prefs.enabled ? `0 0 20px ${T.greenDim}` : "none",
          }}
        >
          <div>
            <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 800 }}>
              {prefs.enabled ? "🟢 SYSTEM ALERTS: ACTIVE (เปิดใช้งาน)" : "🔴 SYSTEM ALERTS: MUTED (ปิดทั้งหมด)"}
            </div>
            <div style={{ color: T.textSecondary, fontSize: 11, marginTop: 2 }}>
              สวิตช์นี้ควบคุม Alerts ขณะเปิดแอปเท่านั้น ส่วน Cron ใช้ CRON_ALERTS_ENABLED ฝั่ง Server แยกกัน
            </div>
          </div>

          <div
            style={{
              width: 48,
              height: 26,
              borderRadius: 13,
              background: prefs.enabled ? T.green : "#334155",
              padding: 2,
              transition: "all 0.25s ease",
              display: "flex",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#ffffff",
                transform: prefs.enabled ? "translateX(22px)" : "translateX(0px)",
                transition: "all 0.25s ease",
              }}
            />
          </div>
        </div>

        <div style={{ color: T.textMuted, fontSize: 10, lineHeight: 1.5, marginTop: -12, marginBottom: 18 }}>
          Cron cooldown แบบข้ามหลาย server instance ต้องตั้งค่า KV_REST_API_URL / KV_REST_API_TOKEN; หากไม่มี ระบบจะลดข้อความซ้ำได้เฉพาะ instance ที่ยังทำงานอยู่
        </div>

        {/* Categories */}
        <div style={{ opacity: prefs.enabled ? 1 : 0.45, transition: "opacity 0.2s ease" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 8, fontFamily: T.font }}>
            NOTIFICATION CHANNELS & FILTERS
          </div>

          {toggleRow(
            "criticalDefense",
            "🚨 Critical Defense (ฉุกเฉินระดับสูง)",
            "Stop Loss แตะ 2× Premium, Delta >= 0.65 (Action Level), หรือ DTE <= 2 วัน",
            "🚨",
            T.red
          )}

          {toggleRow(
            "warningDefense",
            "⚠️ Early Defense (เฝ้าระวังและเตรียมตัว)",
            "Delta >= 0.35 (เฝ้าระวัง) และ Delta >= 0.50 (Defensive Mode เตรียม Roll)",
            "⚠️",
            T.amber
          )}

          {toggleRow(
            "takeProfit",
            "🎯 Take Profit 50% Target",
            "กำไรถึงเป้าหมาย 50% ของ Premium รับ — แนะนำปิดล็อกกำไรตามวินัย",
            "🎯",
            T.green
          )}

          {toggleRow(
            "entrySignals",
            "💎 Scanner Entry Signals (สัญญาณเข้าเทรด)",
            "สัญญาณ Short Put & Strangle คุณภาพเกรด A+ ที่ผ่านเกณฑ์ Rules Engine",
            "💎",
            T.cyan
          )}

          {toggleRow(
            "dailyBriefing",
            "📊 Daily Portfolio Briefing (สรุปพอร์ตประจำวัน)",
            "รายงานสรุปสถานะพอร์ต, P&L รวม, Theta/วัน และความเสี่ยงทุกวันอัตโนมัติ",
            "📊",
            T.purple
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ marginTop: 22, borderTop: `1px solid ${T.border}`, paddingTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, letterSpacing: 1, marginBottom: 10, fontFamily: T.font }}>
            TEST & QUICK ACTIONS
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <button
              onClick={handleTestAlert}
              disabled={testStatus === "loading"}
              style={{
                padding: "10px 14px",
                background: testStatus === "ok" ? T.greenDim : testStatus === "error" ? T.redDim : T.bg2,
                border: `1px solid ${testStatus === "ok" ? T.green : testStatus === "error" ? T.red : T.border}`,
                color: testStatus === "ok" ? T.green : testStatus === "error" ? T.red : T.textPrimary,
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: T.fontSans,
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "all 0.2s ease",
              }}
            >
              <span>📨</span>
              <span>{testStatus === "loading" ? "ส่งสัญญาณ..." : testStatus === "ok" ? "✓ สำเร็จ!" : testStatus === "error" ? "✗ ล้มเหลว" : "ทดสอบ Telegram Bot"}</span>
            </button>

            <button
              onClick={handleSendBriefing}
              disabled={briefingStatus === "loading"}
              style={{
                padding: "10px 14px",
                background: briefingStatus === "ok" ? T.purpleDim : briefingStatus === "error" ? T.redDim : T.bg2,
                border: `1px solid ${briefingStatus === "ok" ? T.purple : briefingStatus === "error" ? T.red : T.border}`,
                color: briefingStatus === "ok" ? T.purple : briefingStatus === "error" ? T.red : T.textPrimary,
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: T.fontSans,
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "all 0.2s ease",
              }}
            >
              <span>📊</span>
              <span>{briefingStatus === "loading" ? "กำลังสรุป..." : briefingStatus === "ok" ? "✓ ส่งสรุปแล้ว!" : briefingStatus === "error" ? "✗ ล้มเหลว" : "ส่ง Daily Briefing เดี๋ยวนี้"}</span>
            </button>
          </div>

          {actionError && (
            <div style={{
              background: T.redDim,
              border: `1px solid ${T.red}66`,
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 12,
              color: T.red,
              fontSize: 12,
              fontFamily: T.fontSans,
              lineHeight: 1.4,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>⚠️ แจ้งเตือนล้มเหลว:</div>
              <div>{actionError}</div>
              {actionError.includes("Missing TELEGRAM_BOT_TOKEN") && (
                <div style={{ color: T.textSecondary, marginTop: 4, fontSize: 11 }}>
                  💡 <strong>วิธีแก้ไข:</strong> เข้าไปที่ Vercel Dashboard → Project Settings → Environment Variables แล้วเพิ่ม <code>TELEGRAM_BOT_TOKEN</code> และ <code>TELEGRAM_CHAT_ID</code> จากนั้นกด Redeploy ครับ
                </div>
              )}
              {actionError.includes("chat not found") && (
                <div style={{ color: T.textSecondary, marginTop: 4, fontSize: 11 }}>
                  💡 <strong>วิธีแก้ไข:</strong> กรุณาเปิด Telegram แล้วค้นหาชื่อบอทของคุณ จากนั้นกดปุ่ม <code>/start</code> หรือพิมพ์ทักบอท 1 ครั้ง แล้วตรวจสอบว่า <code>TELEGRAM_CHAT_ID</code> ถูกต้อง
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleResetCooldowns}
            style={{
              width: "100%",
              padding: "9px 14px",
              background: resetSuccess ? T.greenDim : "transparent",
              border: `1px dashed ${resetSuccess ? T.green : T.borderHover}`,
              color: resetSuccess ? T.green : T.textSecondary,
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: T.fontSans,
              fontSize: 11,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "all 0.2s ease",
            }}
          >
            <span>🔄</span>
            <span>{resetSuccess ? "✓ ล้างประวัติ Cooldown แล้ว (สามารถยิง Alert ซ้ำได้ทันที)" : "ล้าง Cooldown History (สำหรับทดสอบการแจ้งเตือนซ้ำ)"}</span>
          </button>
        </div>

        {/* 24/7 Cloud Background Monitoring Section */}
        <div style={{
          marginTop: 18,
          background: `linear-gradient(135deg, ${T.bg2}, ${T.bg3})`,
          borderRadius: 10,
          padding: "14px 16px",
          border: `1px solid ${T.blue}44`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>☁️</span>
              <span style={{ color: T.blue, fontWeight: 800, fontSize: 12, letterSpacing: 0.5, fontFamily: T.fontSans }}>
                24/7 CLOUD BACKGROUND WORKER
              </span>
            </div>
            <span style={{
              background: T.greenDim, color: T.green, border: `1px solid ${T.greenMid}`,
              padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 700, fontFamily: T.fontSans,
            }}>
              ● SERVERLESS READY
            </span>
          </div>

          <div style={{ color: T.textSecondary, fontSize: 11, fontFamily: T.fontSans, lineHeight: 1.5, marginBottom: 10 }}>
            ระบบมี Worker ทำงานบน Cloud อัตโนมัติ คอยเฝ้าพอร์ต สแกนสัญญาระดับ A+ และยิงแจ้งเตือนเข้า Telegram แม้ปิดหน้าเว็บ
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: 8, background: T.bg0,
            padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, marginBottom: 10,
          }}>
            <code style={{ fontSize: 11, color: T.green, flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}>
              {typeof window !== "undefined" ? `${window.location.origin}/api/cron` : "https://btc-options-desk.vercel.app/api/cron"}
            </code>
            <button
              onClick={() => {
                SoundFX.playClick();
                const url = typeof window !== "undefined" ? `${window.location.origin}/api/cron` : "https://btc-options-desk.vercel.app/api/cron";
                navigator.clipboard.writeText(url);
                setResetSuccess(true);
                setTimeout(() => setResetSuccess(false), 2000);
              }}
              style={{
                background: T.bg2, border: `1px solid ${T.border}`, color: T.textPrimary,
                borderRadius: 4, padding: "4px 8px", fontSize: 10, cursor: "pointer", fontWeight: 700,
              }}
            >
              📋 คัดลอก URL
            </button>
          </div>

          <div style={{
            fontSize: 10.5, color: T.textMuted, lineHeight: 1.5, fontFamily: T.fontSans,
          }}>
            💡 <strong>ตั้งตรวจทุก 5 นาทีฟรี:</strong> นำ URL ด้านบนไปใส่ใน <a href="https://cron-job.org" target="_blank" rel="noreferrer" style={{ color: T.cyan, textDecoration: "underline" }}>cron-job.org</a> หรือ UptimeRobot ให้ยิง GET ทุก 5 นาที ระบบจะตรวจพอร์ตและยิงเข้า Telegram ให้ตลอด 24 ชั่วโมง 100% ฟรีครับ!
          </div>
        </div>

        {/* Tip info */}
        <div style={{
          marginTop: 14,
          background: T.bg2,
          borderRadius: 8,
          padding: "10px 14px",
          border: `1px solid ${T.border}`,
          fontSize: 11,
          color: T.textSecondary,
          lineHeight: 1.5,
          fontFamily: T.fontSans,
        }}>
          💡 <strong>Tip:</strong> ระบบมี <strong>State-Aware Escalation</strong> ในตัว — สัญญาที่เตือน Delta 0.38 จะไม่บล็อกสัญญาณ Delta 0.65 หรือ Stop Loss 2× Premium
        </div>
      </div>
    </div>
  );
}
