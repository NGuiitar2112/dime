const express = require("express");
const cors = require("cors");
const Anthropic = require("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");

const app = express();
app.use(cors());
app.use(express.json());

const FINNHUB_KEY = process.env.FINNHUB_KEY || "d8lqbfhr01qnkjl867mgd8lqbfhr01qnkjl867n0";
const anthropic = new Anthropic({ apiKey: process.env.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 });

// Cache
const priceCache = {};
const newsCache = {};
let scanCache = null;
let scanTime = null;

// ---- GET REAL PRICE ----
async function getPrice(symbol) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();
    if (data.c) {
      priceCache[symbol] = {
        price: data.c,
        change: data.d,
        changePct: data.dp,
        high: data.h,
        low: data.l,
        open: data.o,
        prevClose: data.pc,
        timestamp: Date.now(),
      };
      return priceCache[symbol];
    }
  } catch (e) {}
  return priceCache[symbol] || null;
}

// ---- GET NEWS ----
async function getNews(symbol) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();
    const news = Array.isArray(data) ? data.slice(0, 5).map(n => ({
      headline: n.headline,
      summary: n.summary,
      url: n.url,
      datetime: n.datetime,
      source: n.source,
    })) : [];
    newsCache[symbol] = { news, timestamp: Date.now() };
    return news;
  } catch (e) {
    return newsCache[symbol]?.news || [];
  }
}

// ---- AI ANALYZE ----
async function aiAnalyze(symbol, stockName, sector) {
  const [quoteData, news] = await Promise.all([
    getPrice(symbol),
    getNews(symbol),
  ]);

  if (!quoteData) return "ไม่สามารถดึงข้อมูลราคาได้";

  const newsText = news.length > 0
    ? news.map(n => `- ${n.headline}`).join("\n")
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

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}

// ---- AI MARKET SCAN ----
async function aiMarketScan(symbols) {
  const quotes = await Promise.all(
    symbols.slice(0, 15).map(async (s) => {
      const q = await getPrice(s.symbol);
      return q ? { ...s, ...q } : null;
    })
  );
  const valid = quotes.filter(Boolean);

  const prompt = `คุณคือ AI Trading Agent สแกนตลาดหุ้น US แบบ Real-time วิเคราะห์เป็นภาษาไทย

ข้อมูลตลาดตอนนี้:
${valid.map(s =>
  `${s.symbol} (${s.sector}): $${s.price} | ${s.changePct >= 0 ? "+" : ""}${s.changePct?.toFixed(2)}% | H:$${s.high} L:$${s.low}`
).join("\n")}

วิเคราะห์และให้:
1. **🔥 Top 3 น่าซื้อวันนี้** พร้อมเหตุผลและราคาเป้า
2. **⚠️ Top 2 น่าระวัง/ขาย** พร้อมเหตุผล
3. **📊 ภาพรวมตลาด** วันนี้เป็นอย่างไร (Bull/Bear/Sideways)
4. **🏆 Sector แข็งแกร่งสุด**
5. **🎯 Options Opportunity** ตัวไหนน่าเล่นที่สุด Strike + Expiry

ตอบกระชับ ไม่เกิน 250 คำ`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}

// ---- ROUTES ----

// Health check
app.get("/", (req, res) => res.json({ status: "🚀 AI Trading API Online", time: new Date() }));

// Get single stock price
app.get("/api/price/:symbol", async (req, res) => {
  const data = await getPrice(req.params.symbol.toUpperCase());
  if (!data) return res.status(404).json({ error: "ไม่พบข้อมูล" });
  res.json(data);
});

// Get multiple prices at once
app.post("/api/prices", async (req, res) => {
  const { symbols } = req.body;
  const results = await Promise.all(
    symbols.map(async (sym) => {
      const data = await getPrice(sym);
      return { symbol: sym, ...data };
    })
  );
  res.json(results);
});

// Get news
app.get("/api/news/:symbol", async (req, res) => {
  const news = await getNews(req.params.symbol.toUpperCase());
  res.json(news);
});

// AI analyze single stock
app.post("/api/analyze", async (req, res) => {
  const { symbol, name, sector } = req.body;
  try {
    const result = await aiAnalyze(symbol, name, sector);
    res.json({ analysis: result, timestamp: new Date() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI market scan
app.post("/api/scan", async (req, res) => {
  const { stocks } = req.body;
  try {
    // Cache scan for 5 min
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

// Auto scan endpoint (called by cron)
app.get("/api/auto-scan", async (req, res) => {
  const stocks = [
    { symbol: "SPCX", sector: "Space" }, { symbol: "NVDA", sector: "AI/Chip" },
    { symbol: "AAPL", sector: "Tech" }, { symbol: "TSLA", sector: "EV" },
    { symbol: "RKLB", sector: "Space" }, { symbol: "MSFT", sector: "Tech" },
    { symbol: "AVGO", sector: "AI/Chip" }, { symbol: "META", sector: "Tech" },
    { symbol: "ASTS", sector: "Space" }, { symbol: "PLTR", sector: "AI" },
  ];
  try {
    const result = await aiMarketScan(stocks);
    scanCache = result;
    scanTime = Date.now();
    res.json({ scan: result, timestamp: new Date() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
