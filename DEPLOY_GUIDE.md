# 🚀 AI Trading Platform — คู่มือ Deploy

## สิ่งที่จะได้หลัง Deploy
- ราคาหุ้น US จริงจาก Finnhub (อัพเดททุก 60 วิ)
- ข่าวหุ้นจริง 7 วันล่าสุด
- AI วิเคราะห์จากราคา+ข่าวจริง
- สแกนตลาดอัตโนมัติทุก 5 นาที 24/7

---

## ขั้นตอนที่ 1 — สมัคร GitHub (ถ้ายังไม่มี)
1. ไปที่ github.com → Sign up ฟรี

---

## ขั้นตอนที่ 2 — Upload โค้ดขึ้น GitHub
1. ไปที่ github.com/new สร้าง repo ชื่อ `ai-trading-backend`
2. Upload ไฟล์ทั้งหมดใน folder `backend/`
   - server.js
   - package.json
   - railway.json

---

## ขั้นตอนที่ 3 — Deploy บน Railway (ฟรี 24/7)
1. ไปที่ **railway.app**
2. Login ด้วย GitHub
3. กด **New Project** → **Deploy from GitHub repo**
4. เลือก repo `ai-trading-backend`
5. ตั้ง Environment Variables:
   ```
   ANTHROPIC_API_KEY = (ใส่ Claude API key ของคุณ)
   FINNHUB_KEY = d8lqbfhr01qnkjl867mgd8lqbfhr01qnkjl867n0
   ```
6. รอ 2-3 นาที → Railway จะให้ URL เช่น
   `https://ai-trading-backend.railway.app`

---

## ขั้นตอนที่ 4 — แก้ URL ใน Frontend
เปิดไฟล์ `frontend/src/App.jsx` บรรทัดที่ 4:
```javascript
// เปลี่ยนจาก
const API_BASE = "https://your-railway-url.railway.app";
// เป็น URL จาก Railway ของคุณ
const API_BASE = "https://ai-trading-backend.railway.app";
```

---

## ขั้นตอนที่ 5 — Deploy Frontend บน Vercel (ฟรี)
1. ไปที่ **vercel.com**
2. Login ด้วย GitHub
3. Import repo `ai-trading-frontend`
4. Deploy → ได้ URL เช่น `https://ai-trade.vercel.app`

---

## ผลลัพธ์
✅ ราคาจริงจาก Finnhub
✅ ข่าวจริง
✅ AI วิเคราะห์ 24/7 บน Railway
✅ เข้าใช้ได้จากมือถือผ่าน Vercel URL

---

## Claude API Key (ถ้ายังไม่มี)
ไปที่ console.anthropic.com → API Keys → Create Key
