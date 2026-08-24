# BTC Options Desk

Dashboard ติดตาม BTC Options positions บน Binance แบบ real-time พร้อม AI วิเคราะห์ (ขับเคลื่อนโดย Claude)

## โครงสร้างโปรเจกต์

```
btc-options-desk/
├── api/
│   ├── binance.js      ← Vercel function: proxy Binance API (แก้ CORS + เซ็น request)
│   └── analyze.js      ← Vercel function: proxy Claude API (ซ่อน API key)
├── src/
│   ├── App.jsx          ← หน้าหลักของแอป
│   └── main.jsx
├── index.html
├── package.json
├── vercel.json
└── .env.example
```

## ทำไมต้องมี backend (api/) ด้วย

1. **CORS**: Binance ไม่อนุญาตให้ browser เรียก API ตรงๆ ต้องมี server กลาง
2. **ความปลอดภัย**: API Key/Secret ของ Binance และ Anthropic ต้องไม่ถูกส่งไปที่ browser
   ต้องเก็บไว้ใน server-side environment variables เท่านั้น

Vercel Serverless Functions (โฟลเดอร์ `api/`) ทำหน้าที่นี้ — deploy ไปพร้อมกับ frontend ได้เลย ไม่ต้องมี server แยก

## ขั้นตอน Deploy

### 1. เตรียม Binance API Key (Read-Only)

1. ไปที่ [Binance API Management](https://www.binance.com/en/my/settings/api-management)
2. สร้าง API Key ใหม่
3. **สำคัญมาก**: เปิดใช้งานเฉพาะ "Enable Reading" เท่านั้น
   - ❌ ห้ามเปิด "Enable Spot & Margin Trading"
   - ❌ ห้ามเปิด "Enable Withdrawals"
4. ถ้าเทรด Options อยู่ ตรวจสอบว่า Key นี้เข้าถึง Options account ได้ (Enable Reading ครอบคลุมอยู่แล้ว)
5. จำกัด IP access ถ้าทำได้ (เพิ่มความปลอดภัย แต่ Vercel ใช้ dynamic IP จึงมักต้องเปิดกว้างหรือใช้ Vercel's static IP add-on)

### 2. เตรียม Groq API Key (ฟรี)

ไปที่ [console.groq.com/keys](https://console.groq.com/keys)
- Sign up ฟรี (ไม่ต้อง credit card)
- ได้ API key ทันที
- Free tier ใช้ได้ดี rate limit 30 req/นาที

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

5. กด **Deploy**

หลัง deploy เสร็จ จะได้ URL แบบ `https://btc-options-desk-xxxx.vercel.app` เข้าได้จากทุกที่ทุกอุปกรณ์

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

## ฟีเจอร์ในแอป

- **Live position tracking** — sync กับ Binance ทุก 15 วินาที
- **Auto health classification** — position จะถูกจัดเป็น healthy / warning / danger ตาม Delta และ DTE อัตโนมัติ
- **AI Analysis** — กดปุ่ม "AI ANALYZE" ที่ position ไหนก็ได้ Claude จะวิเคราะห์และแนะนำ action เป็นภาษาไทย
- **Rules reference** — แท็บ Rules เก็บกฎ Entry/Exit/Roll/Stop-Loss ที่ตั้งไว้

## ข้อจำกัดที่ควรรู้

- แอปนี้เป็น **read-only** — ไม่มีการส่งคำสั่งซื้อขายใดๆ ไปที่ Binance ทั้งสิ้น การ Close/Roll position ต้องทำเองในแอป Binance
- Poll ทุก 15 วินาที ไม่ใช่ WebSocket แบบ tick-by-tick — เพียงพอสำหรับติดตาม theta decay รายวัน แต่ไม่เหมาะกับ scalping
- AI Analysis เป็นเครื่องมือช่วยตัดสินใจ ไม่ใช่คำแนะนำทางการเงิน ควรใช้ประกอบกับดุลยพินิจของคุณเองเสมอ
- ยังไม่มีระบบแจ้งเตือนอัตโนมัติ (push notification/LINE/Telegram) — ต้องเปิดแอปเพื่อดูสถานะ
