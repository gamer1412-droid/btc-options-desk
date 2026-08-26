# BTC Options Desk

Dashboard ติดตาม BTC Options positions บน Binance แบบ real-time พร้อม AI วิเคราะห์ (ขับเคลื่อนโดย **Groq + Llama 3.3**) และ Telegram alert อัตโนมัติ

## โครงสร้างโปรเจกต์

```
btc-options-desk/
├── api/
│   ├── binance.js          ← Vercel function: proxy Binance API (แก้ CORS + เซ็น request)
│   ├── analyze.js          ← Vercel function: proxy Groq API (ซ่อน API key)
│   └── telegram.js         ← Vercel function: ส่ง alert ไป Telegram Bot
├── src/
│   ├── App.jsx             ← หน้าหลักของแอป
│   ├── main.jsx
│   ├── tokens.js           ← Design tokens (สี, font)
│   ├── utils.js            ← Helper functions
│   ├── components/
│   │   ├── AnalysisPanel.jsx
│   │   ├── MetricCard.jsx
│   │   ├── Pill.jsx
│   │   └── PositionRow.jsx
│   └── services/
│       ├── alerts.js       ← Alert logic + Telegram sender
│       └── binance.js      ← Binance data mapper
├── index.html
├── package.json
├── vercel.json
├── .gitignore
└── .env.example
```

## ทำไมต้องมี backend (api/) ด้วย

1. **CORS**: Binance ไม่อนุญาตให้ browser เรียก API ตรงๆ ต้องมี server กลาง
2. **ความปลอดภัย**: API Key/Secret ของ Binance และ Groq ต้องไม่ถูกส่งไปที่ browser
   ต้องเก็บไว้ใน server-side environment variables เท่านั้น

Vercel Serverless Functions (โฟลเดอร์ `api/`) ทำหน้าที่นี้ — deploy ไปพร้อมกับ frontend ได้เลย ไม่ต้องมี server แยก

## ขั้นตอน Deploy

### 1. เตรียม Binance API Key (Read-Only)

1. ไปที่ [Binance API Management](https://www.binance.com/en/my/settings/api-management)
2. สร้างหรือแก้ไข API Key
3. **การตั้งค่าความปลอดภัย (Permissions):**
   - ✅ เปิดเฉพาะ **"Enable Reading"** เท่านั้น (สำหรับอ่านข้อมูลพอร์ตและสแกนสัญญา)
   - ❌ **ห้ามเปิด "Enable Spot & Margin Trading"**
   - ❌ **ห้ามเปิด "Enable Futures" หรือ "Enable European Options"**
   - ❌ **ห้ามเปิด "Enable Withdrawals"** (เงินในบัญชีปลอดภัย 100%)
4. เปิด IP restriction หากแผน hosting รองรับ Static Egress IP หากจำเป็นต้องใช้ Dynamic IP ให้คงสิทธิ์ API เป็น Read-Only เท่านั้นและหมุนเวียน key เป็นระยะ

### 2. เตรียม Groq API Key (ฟรี)

ไปที่ [console.groq.com/keys](https://console.groq.com/keys)
- Sign up ฟรี (ไม่ต้อง credit card)
- ได้ API key ทันที
- Free tier ใช้ได้ดี rate limit 30 req/นาที
- โมเดลที่ใช้: `llama-3.3-70b-versatile` (เร็ว ฟรี)

### 3. Push โค้ดขึ้น GitHub

```bash
cd btc-options-desk
git init
git add .
git commit -m "Initial commit: BTC Options Desk"
git branch -M main
git remote add origin https://github.com/<your-username>/btc-options-desk.git
git push -u origin main
```

### 4. Deploy บน Vercel

1. ไปที่ [vercel.com/new](https://vercel.com/new)
2. Import repo `btc-options-desk`
3. Framework Preset: **Vite** (Vercel จะ detect ให้อัตโนมัติ)
4. ก่อนกด Deploy ให้ตั้งค่า **Environment Variables**:

   | Key | Value |
   |---|---|
   | `BINANCE_API_KEY` | API key ที่สร้างไว้ (Read-Only) |
   | `BINANCE_API_SECRET` | API secret คู่กัน |
   | `GROQ_API_KEY` | Groq key (ฟรี) |
   | `TELEGRAM_BOT_TOKEN` | Bot token จาก @BotFather |
   | `TELEGRAM_CHAT_ID` | Chat ID ของคุณ |
   | `ALLOWED_ORIGIN` | URL ของ Vercel app เช่น `https://btc-options-desk-xxxx.vercel.app` |
   | `APP_ACCESS_TOKEN` | Token แบบสุ่มยาวสำหรับปลดล็อก private dashboard APIs |
   | `CRON_SECRET` | Secret คนละค่ากับ APP_ACCESS_TOKEN สำหรับ Vercel Cron |
   | `APP_URL` | URL production ที่ใช้ในปุ่ม Telegram |

   แนะนำเพิ่มเติมสำหรับ Cron ที่ไม่ส่งซ้ำข้าม server instance:

   | Key | Value |
   |---|---|
   | `KV_REST_API_URL` | Vercel KV หรือ Upstash Redis REST URL |
   | `KV_REST_API_TOKEN` | Token ของ KV/Redis |
   | `CRON_ALERTS_ENABLED` | `true` หรือ `false` |
   | `CRON_DAILY_BRIEFING_ENABLED` | `true` หรือ `false` |

5. กด **Deploy**

หลัง deploy เสร็จ เปิด URL แล้วกด **ปลดล็อก Dashboard** และกรอก `APP_ACCESS_TOKEN` ค่า token จะอยู่ใน session ของ browser และหายเมื่อปิด session

> ตาราง Cron ทุก 10 นาทีใน `vercel.json` ต้องใช้แผน Vercel ที่รองรับความถี่ดังกล่าว หากใช้ Hobby ให้เปลี่ยนเป็นอย่างน้อยวันละครั้งหรือใช้ scheduler ภายนอกที่ส่ง `Authorization: Bearer <CRON_SECRET>`

### 5. ทดสอบ

- เปิด URL → ควรเห็นสถานะ "LIVE — BINANCE" มุมซ้ายบน (สีเขียว)
- ถ้าขึ้น "CONNECTION ERROR" สีแดง → ตรวจสอบ Environment Variables อีกครั้ง ใน Vercel Dashboard → Settings → Environment Variables แล้ว **Redeploy**

## รันทดสอบ Local (ก่อน deploy)

ต้องใช้ Vercel CLI เพื่อรัน serverless functions ด้วย (ปกติ `vite dev` เพียวๆ จะรันแค่ frontend ไม่มี `/api`):

```bash
npm install -g vercel
npm install
cp .env.example .env.local   # แล้วกรอกค่าจริงใน .env.local
vercel dev
```

จะรันที่ `http://localhost:3000` พร้อมทั้ง frontend และ `/api/*`

## Endpoints ที่มีให้

| Endpoint | Method | คำอธิบาย |
|---|---|---|
| `/api/binance?action=btcPrice` | GET | ราคา BTC ปัจจุบัน (public, ไม่ต้อง auth) |
| `/api/binance?action=optionPositions` | GET | Open options positions ของคุณ |
| `/api/binance?action=optionAccount` | GET | ข้อมูล margin/balance ของ options account |
| `/api/binance?action=optionMarks` | GET | Mark price + Greeks ของทุก contract (public) |
| `/api/binance?action=optionOrders` | GET | ประวัติ order 50 รายการล่าสุด |
| `/api/analyze` | POST | ส่ง `{ prompt }` → ได้ AI analysis กลับมา |

Endpoints ที่อ่านบัญชี, เรียก AI และส่ง Telegram ต้องมี `Authorization: Bearer <APP_ACCESS_TOKEN>` ส่วน market data สาธารณะยังเรียกได้โดยไม่ต้องปลดล็อก

## ฟีเจอร์ในแอป

- **Live position tracking** — sync กับ Binance ทุก 15 วินาที
- **Auto health classification** — position จะถูกจัดเป็น healthy / warning / danger ตาม Delta และ DTE อัตโนมัติ
- **AI Analysis** — กดปุ่ม "AI ANALYZE" ที่ position ไหนก็ได้ Groq (Llama 3.3) จะวิเคราะห์และแนะนำ action เป็นภาษาไทย
- **Telegram Alerts** — แจ้งเตือนอัตโนมัติผ่าน Telegram เมื่อ Delta ≥ 0.40 / Profit ≥ 50% / Loss = 2× premium / DTE ≤ 2
- **Market IV card** — แสดง IV เฉลี่ยตลาด BTC options ปัจจุบัน
- **Rules reference** — แท็บ Rules เก็บกฎ Entry/Exit/Roll/Stop-Loss ที่ตั้งไว้

## ข้อจำกัดที่ควรรู้

- แอปนี้เป็น **read-only** — ไม่มีการส่งคำสั่งซื้อขายใดๆ ไปที่ Binance ทั้งสิ้น การ Close/Roll position ต้องทำเองในแอป Binance
- Poll ทุก 15 วินาที ไม่ใช่ WebSocket แบบ tick-by-tick — เพียงพอสำหรับติดตาม theta decay รายวัน แต่ไม่เหมาะกับ scalping
- AI Analysis เป็นเครื่องมือช่วยตัดสินใจ ไม่ใช่คำแนะนำทางการเงิน ควรใช้ประกอบกับดุลยพินิจของคุณเองเสมอ
- IV ที่แสดงใน dashboard คือ IV เฉลี่ยของตลาด ณ ขณะนั้น ไม่ใช่ IV Rank แบบ 52-สัปดาห์ (ต้องมี database ประวัติ)
- Annualized ROM ใน Scanner เป็นค่าประมาณจาก Mark Price และ Margin สมมติ ยังไม่รวม bid/ask spread, fees, slippage และ Tail Loss
- Paper Trading ใช้ mark price ล่าสุดของ option แต่ข้อมูลเก็บใน browser เท่านั้น จึงไม่ใช่ backtest หรือ execution simulator เต็มรูปแบบ

## ตรวจสอบก่อนส่งขึ้น Production

```bash
npm test
npm run build
```
