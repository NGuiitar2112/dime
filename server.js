const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ---- ENV ----
const FINNHUB_KEY = process.env.FINNHUB_KEY || "d8lqbfhr01qnkjl867mgd8lqbfhr01qnkjl867n0";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "AQ.Ab8RN6LhG3RZw_mqbLEg4oWtC5Q1CZavsQqErePaxVdXuzBbtg";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`;

// ---- CACHE ----
const priceCache = {};
const newsCache = {};
const alertsTriggered = new Set();
let scanCache = null;
let scanTime = null;
let userAlerts = [];

// ---- GEMINI AI ----
async function callGemini(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1200, temperature: 0.7 },
    }),
  });
  const data = await res.json();
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  throw new Error(JSON.stringify(data));
}

// ---- TELEGRAM ----
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
        }),
      }
    );
    const data = await res.json();
    return data.ok;
  } catch (e) {
    console.error("Telegram error:", e.message);
    return false;
  }
}

// ---- PRICE ----
async function getPrice(symbol) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();
    if (data.c && data.c > 0) {
      priceCache[symbol] = {
        price: data.c, change: data.d, changePct: data.dp,
        high: data.h, low: data.l, open: data.o, prevClose: data.pc,
        timestamp: Date.now(),
      };
      return priceCache[symbol];
    }
  } catch (e) {
    console.error(`Price error ${symbol}:`, e.message);
  }
  return priceCache[symbol] || null;
}

// ---- NEWS ----
async function getNews(symbol) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();
    const news = Array.isArray(data)
      ? data.slice(0, 5).map((n) => ({
          headline: n.headline, summary: n.summary,
          url: n.url, datetime: n.datetime, source: n.source,
        }))
      : [];
    newsCache[symbol] = { news, timestamp: Date.now() };
    return news;
  } catch (e) {
    return newsCache[symbol]?.news || [];
  }
}

// ---- CHECK ALERTS ----
async function checkAlerts() {
  if (userAlerts.length === 0) return;
  for (const alert of userAlerts.filter((a) => a.active)) {
    const data = await getPrice(alert.symbol);
    if (!data) continue;
    const alertKey = `${alert.id}-${Math.floor(Date.now() / 60000)}`;
    if (alertsTriggered.has(alertKey)) continue;
    const triggered =
      (alert.condition === "above" && data.price >= alert.price) ||
      (alert.condition === "below" && data.price <= alert.price);
    if (triggered) {
      alertsTriggered.add(alertKey);
      const emoji = alert.condition === "above" ? "🚀" : "📉";
      await sendTelegram(
        `${emoji} <b>แจ้งเตือนราคา!</b>\n\n` +
        `หุ้น: <b>${alert.symbol}</b>\n` +
        `ราคาปัจจุบัน: <b>$${data.price.toFixed(2)}</b>\n` +
        `เงื่อนไข: ${alert.condition === "above" ? "ขึ้นถึง" : "ลงถึง"} $${alert.price}\n` +
        `เปลี่ยนแปลง: ${data.changePct >= 0 ? "+" : ""}${data.changePct?.toFixed(2)}%`
      );
    }
  }
}

// ---- AI ANALYZE ----
async function aiAnalyze(symbol, stockName, sector) {
  const [quoteData, news] = await Promise.all([getPrice(symbol), getNews(symbol)]);
  if (!quoteData) return "ไม่สามารถดึงข้อมูลราคาได้";

  const newsText = news.length > 0
    ? news.map((n) => `- ${n.headline}`).join("\n")
    : "ไม่มีข่าวล่าสุด";

  const prompt = `คุณคือ AI Trading Agent วิเคราะห์หุ้น US เป็นภาษาไทย กระชับ ตรงประเด็น

ข้อมูลหุ้น ${symbol} (${stockName}) Sector: ${sector}
- ราคาปัจจุบัน: $${quoteData.price}
- เปลี่ยนแปลง: ${quoteData.change >= 0 ? "+" : ""}${quoteData.change?.toFixed(2)} (${quoteData.changePct?.toFixed(2)}%)
- High: $${quoteData.high} | Low: $${quoteData.low}
- Open: $${quoteData.open} | Prev Close: $${quoteData.prevClose}

ข่าวล่าสุด 7 วัน:
${newsText}

วิเคราะห์และตอบ:
1. **สัญญาณ**: ซื้อ/ขาย/ถือ + เหตุผล
2. **แนวรับ**: $xxx | **แนวต้าน**: $xxx
3. **ความเสี่ยง**: ต่ำ/กลาง/สูง
4. **สรุปข่าว**: ผลกระทบต่อราคา
5. **Options Play**: Call หรือ Put? Strike? Expiry?
6. **คำแนะนำ**: 2-3 ประโยค
ตอบไม่เกิน 200 คำ`;

  return await callGemini(prompt);
}

// ---- AI MARKET SCAN ----
const SCAN_STOCKS = [
  { symbol: "NVDA", sector: "AI/Chip" }, { symbol: "AAPL", sector: "Tech" },
  { symbol: "TSLA", sector: "EV" }, { symbol: "RKLB", sector: "Space" },
  { symbol: "MSFT", sector: "Tech" }, { symbol: "AVGO", sector: "AI/Chip" },
  { symbol: "META", sector: "Tech" }, { symbol: "ASTS", sector: "Space" },
  { symbol: "PLTR", sector: "AI" }, { symbol: "COIN", sector: "Crypto" },
];

async function aiMarketScan(stocks) {
  const quotes = await Promise.all(
    (stocks || SCAN_STOCKS).slice(0, 15).map(async (s) => {
      const q = await getPrice(s.symbol);
      return q ? { ...s, ...q } : null;
    })
  );
  const valid = quotes.filter(Boolean);
  if (valid.length === 0) return "ไม่สามารถดึงข้อมูลตลาดได้";

  const prompt = `คุณคือ AI Trading Agent สแกนตลาดหุ้น US Real-time วิเคราะห์ภาษาไทย

ข้อมูลตลาด:
${valid.map((s) =>
  `${s.symbol} (${s.sector}): $${s.price} | ${s.changePct >= 0 ? "+" : ""}${s.changePct?.toFixed(2)}% | H:$${s.high} L:$${s.low}`
).join("\n")}

วิเคราะห์:
1. 🔥 Top 3 น่าซื้อวันนี้ พร้อมเหตุผลและราคาเป้า
2. ⚠️ Top 2 น่าระวัง/ขาย
3. 📊 ภาพรวมตลาด (Bull/Bear/Sideways)
4. 🏆 Sector แข็งแกร่งสุด
5. 🎯 Options Opportunity ที่ดีสุด Strike + Expiry

ตอบกระชับ ไม่เกิน 250 คำ`;

  return await callGemini(prompt);
}

// ---- AUTO SCAN ----
async function runAutoScan() {
  console.log("🔍 Auto scan...", new Date().toISOString());
  try {
    const result = await aiMarketScan(SCAN_STOCKS);
    scanCache = result;
    scanTime = Date.now();
    const time = new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });
    await sendTelegram(`🤖 <b>AI Market Scan</b> — ${time}\n\n${result}\n\n<i>สแกนอัตโนมัติทุก 5 นาที • Powered by Gemini</i>`);
    await checkAlerts();
  } catch (e) {
    console.error("Auto scan error:", e.message);
  }
}

setInterval(runAutoScan, 5 * 60 * 1000);
setInterval(checkAlerts, 60 * 1000);

// ---- ROUTES ----
app.get("/", (req, res) =>
  res.json({
    status: "🚀 AI Trading API Online",
    ai: "Google Gemini 1.5 Flash",
    time: new Date(),
    telegram: TELEGRAM_TOKEN ? "✅ Connected" : "❌ Not configured",
    alerts: userAlerts.length,
  })
);

app.get("/api/price/:symbol", async (req, res) => {
  const data = await getPrice(req.params.symbol.toUpperCase());
  if (!data) return res.status(404).json({ error: "ไม่พบข้อมูล" });
  res.json(data);
});

app.post("/api/prices", async (req, res) => {
  const { symbols } = req.body;
  const results = await Promise.all(
    symbols.map(async (sym) => ({ symbol: sym, ...await getPrice(sym) }))
  );
  res.json(results);
});

app.get("/api/news/:symbol", async (req, res) => {
  res.json(await getNews(req.params.symbol.toUpperCase()));
});

app.post("/api/analyze", async (req, res) => {
  const { symbol, name, sector } = req.body;
  try {
    const result = await aiAnalyze(symbol, name, sector);
    if (TELEGRAM_TOKEN) {
      await sendTelegram(`🔮 <b>AI วิเคราะห์ ${symbol}</b>\n\n${result}`);
    }
    res.json({ analysis: result, timestamp: new Date() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/scan", async (req, res) => {
  const { stocks } = req.body;
  try {
    if (scanCache && scanTime && Date.now() - scanTime < 5 * 60 * 1000) {
      return res.json({ scan: scanCache, cached: true, timestamp: new Date(scanTime) });
    }
    const result = await aiMarketScan(stocks);
    scanCache = result;
    scanTime = Date.now();
    res.json({ scan: result, cached: false, timestamp: new Date() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/alerts", (req, res) => res.json(userAlerts));

app.post("/api/alerts", async (req, res) => {
  const { symbol, condition, price } = req.body;
  if (!symbol || !condition || !price)
    return res.status(400).json({ error: "ต้องระบุ symbol, condition, price" });
  const alert = {
    id: Date.now().toString(), symbol: symbol.toUpperCase(),
    condition, price: Number(price), active: true, createdAt: new Date(),
  };
  userAlerts.push(alert);
  await sendTelegram(
    `🔔 <b>ตั้งแจ้งเตือนสำเร็จ</b>\n\nหุ้น: <b>${alert.symbol}</b>\nเงื่อนไข: ${condition === "above" ? "ขึ้นถึง" : "ลงถึง"} <b>$${price}</b>`
  );
  res.json({ success: true, alert });
});

app.delete("/api/alerts/:id", (req, res) => {
  const before = userAlerts.length;
  userAlerts = userAlerts.filter((a) => a.id !== req.params.id);
  res.json({ success: userAlerts.length < before });
});

app.get("/api/auto-scan", async (req, res) => {
  await runAutoScan();
  res.json({ scan: scanCache, timestamp: new Date() });
});

app.get("/api/test-telegram", async (req, res) => {
  const ok = await sendTelegram("🚀 <b>AI Trading Bot เชื่อมต่อสำเร็จ!</b>\n\nขับเคลื่อนด้วย Google Gemini ✅");
  res.json({ success: ok, message: ok ? "ส่ง Telegram สำเร็จ!" : "ยังไม่ได้ตั้งค่า TELEGRAM_TOKEN" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 AI: Google Gemini 1.5 Flash`);
  console.log(`📱 Telegram: ${TELEGRAM_TOKEN ? "✅ Ready" : "❌ Not configured"}`);
  setTimeout(runAutoScan, 5000);
});
