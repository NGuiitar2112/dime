const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ---- ENV ----
const FINNHUB_KEY = process.env.FINNHUB_KEY || "d8mbjc1r01qkiso7q2u0d8mbjc1r01qkiso7q2ug";
const GROQ_KEY = process.env.GROQ_KEY || "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";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8862142836:AAFwz8GFNqpx2MLBrwVY8S6Y9WgKNFv2MYI";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "5926136579";

// ---- ALL US STOCKS TO MONITOR ----
const WATCHLIST = [
  // Space
  { symbol: "RKLB", name: "Rocket Lab", sector: "Space" },
  { symbol: "ASTS", name: "AST SpaceMobile", sector: "Space" },
  { symbol: "IRDM", name: "Iridium", sector: "Space" },
  { symbol: "PL", name: "Planet Labs", sector: "Space" },
  { symbol: "LMT", name: "Lockheed Martin", sector: "Defense" },
  { symbol: "NOC", name: "Northrop Grumman", sector: "Defense" },
  { symbol: "BA", name: "Boeing", sector: "Aerospace" },
  // AI & Chip
  { symbol: "NVDA", name: "NVIDIA", sector: "AI/Chip" },
  { symbol: "AVGO", name: "Broadcom", sector: "AI/Chip" },
  { symbol: "AMD", name: "AMD", sector: "AI/Chip" },
  { symbol: "INTC", name: "Intel", sector: "Chip" },
  { symbol: "TSM", name: "TSMC", sector: "Chip" },
  { symbol: "PLTR", name: "Palantir", sector: "AI" },
  // Tech
  { symbol: "AAPL", name: "Apple", sector: "Tech" },
  { symbol: "MSFT", name: "Microsoft", sector: "Tech" },
  { symbol: "GOOGL", name: "Alphabet", sector: "Tech" },
  { symbol: "META", name: "Meta", sector: "Tech" },
  { symbol: "AMZN", name: "Amazon", sector: "Tech" },
  { symbol: "NFLX", name: "Netflix", sector: "Tech" },
  { symbol: "ORCL", name: "Oracle", sector: "Cloud" },
  { symbol: "CRM", name: "Salesforce", sector: "Cloud" },
  { symbol: "SNOW", name: "Snowflake", sector: "Cloud" },
  // EV
  { symbol: "TSLA", name: "Tesla", sector: "EV" },
  { symbol: "RIVN", name: "Rivian", sector: "EV" },
  { symbol: "NIO", name: "NIO", sector: "EV" },
  // Finance
  { symbol: "JPM", name: "JPMorgan", sector: "Finance" },
  { symbol: "BAC", name: "Bank of America", sector: "Finance" },
  { symbol: "GS", name: "Goldman Sachs", sector: "Finance" },
  { symbol: "COIN", name: "Coinbase", sector: "Crypto" },
  // ETF
  { symbol: "SPY", name: "S&P 500 ETF", sector: "ETF" },
  { symbol: "QQQ", name: "Nasdaq ETF", sector: "ETF" },
  { symbol: "ARKK", name: "ARK Innovation", sector: "ETF" },
  { symbol: "JEPQ", name: "JPM Nasdaq Income", sector: "ETF" },
  { symbol: "SCHD", name: "Schwab Dividend", sector: "ETF" },
  { symbol: "QYLD", name: "Covered Call ETF", sector: "ETF" },
];

// ---- CACHE ----
const priceCache = {};
const newsCache = {};
const signalCache = {};
let lastSignalTime = {};

// ---- GROQ AI ----
async function callGroq(prompt, maxTokens = 1000) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });
  const data = await res.json();
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  throw new Error(JSON.stringify(data));
}

// ---- TELEGRAM ----
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });
    const data = await res.json();
    return data.ok;
  } catch (e) {
    console.error("Telegram error:", e.message);
    return false;
  }
}

// ---- GET PRICE + CANDLES ----
async function getPrice(symbol) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const data = await res.json();
    if (data.c && data.c > 0) {
      priceCache[symbol] = {
        price: data.c, change: data.d, changePct: data.dp,
        high: data.h, low: data.l, open: data.o, prevClose: data.pc,
        timestamp: Date.now(),
      };
      return priceCache[symbol];
    }
  } catch (e) { console.error(`Price error ${symbol}:`, e.message); }
  return priceCache[symbol] || null;
}

// ---- GET CANDLES FOR TECHNICAL ANALYSIS ----
async function getCandles(symbol) {
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 60 * 24 * 60 * 60; // 60 days
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();
    if (data.s === "ok" && data.c?.length > 0) return data;
  } catch (e) {}
  return null;
}

// ---- CALCULATE TECHNICAL INDICATORS ----
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return Math.round(ema * 100) / 100;
}

function calcSupRes(highs, lows, closes) {
  const recent = closes.slice(-20);
  const recentH = highs.slice(-20);
  const recentL = lows.slice(-20);
  const support = Math.round(Math.min(...recentL) * 100) / 100;
  const resistance = Math.round(Math.max(...recentH) * 100) / 100;
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  return { support, resistance, avg: Math.round(avg * 100) / 100 };
}

// ---- AI SIGNAL ANALYSIS ----
async function analyzeSignal(stock) {
  const [quote, candles] = await Promise.all([getPrice(stock.symbol), getCandles(stock.symbol)]);
  if (!quote || !candles) return null;

  const closes = candles.c;
  const highs = candles.h;
  const lows = candles.l;

  const rsi = calcRSI(closes);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const { support, resistance } = calcSupRes(highs, lows, closes);
  const currentPrice = quote.price;
  const distToSupport = Math.round(((currentPrice - support) / currentPrice) * 100 * 10) / 10;
  const distToResistance = Math.round(((resistance - currentPrice) / currentPrice) * 100 * 10) / 10;

  const prompt = `วิเคราะห์หุ้น ${stock.symbol} (${stock.name}) และตัดสินใจว่ามีสัญญาณชัดเจนหรือไม่

ข้อมูล Technical:
- ราคาปัจจุบัน: $${currentPrice}
- เปลี่ยนแปลง: ${quote.changePct?.toFixed(2)}%
- RSI (14): ${rsi}
- EMA20: $${ema20} | EMA50: $${ema50}
- แนวรับ: $${support} (ห่าง ${distToSupport}%)
- แนวต้าน: $${resistance} (ห่าง ${distToResistance}%)
- High วันนี้: $${quote.high} | Low: $${quote.low}

กฎการให้สัญญาณ:
- BUY ชัด: RSI < 35 + ราคาใกล้แนวรับ (<3%) + EMA20 > EMA50
- SELL ชัด: RSI > 65 + ราคาใกล้แนวต้าน (<3%) + EMA20 < EMA50
- WAIT: สัญญาณไม่ชัดเจน

ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น:
{
  "signal": "BUY" หรือ "SELL" หรือ "WAIT",
  "strength": "STRONG" หรือ "MODERATE" หรือ "WEAK",
  "entry": ราคาเข้า (ตัวเลข),
  "target": ราคาเป้าหมาย (ตัวเลข),
  "stopLoss": ราคา stop loss (ตัวเลข),
  "reason": "เหตุผลสั้นๆ ภาษาไทย 1 ประโยค",
  "riskReward": อัตราส่วน risk/reward (ตัวเลข)
}`;

  try {
    const result = await callGroq(prompt, 300);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      ...parsed,
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      price: currentPrice,
      rsi, ema20, ema50, support, resistance,
      changePct: quote.changePct,
    };
  } catch (e) {
    console.error(`Signal parse error ${stock.symbol}:`, e.message);
    return null;
  }
}

// ---- GET HIGH IMPACT NEWS ----
async function getHighImpactNews() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Get news for major symbols
    const symbols = ["SPY", "AAPL", "NVDA", "TSLA", "MSFT"];
    const allNews = [];

    for (const sym of symbols) {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${yesterday}&to=${today}&token=${FINNHUB_KEY}`
      );
      const data = await res.json();
      if (Array.isArray(data)) allNews.push(...data.slice(0, 3));
    }

    if (allNews.length === 0) return [];

    // Let AI filter high impact news
    const prompt = `คุณคือ AI กรองข่าวหุ้น US คัดเฉพาะข่าว HIGH IMPACT ที่จะกระทบราคาหุ้นมากจริงๆ

ข่าวทั้งหมด:
${allNews.slice(0, 20).map((n, i) => `${i + 1}. [${n.related}] ${n.headline}`).join("\n")}

เลือกเฉพาะข่าวที่ HIGH IMPACT จริงๆ เช่น:
- ผลประกอบการ earnings ที่เซอร์ไพรส์มาก
- Fed ประกาศเปลี่ยนอัตราดอกเบี้ย
- M&A ใหญ่
- ผลิตภัณฑ์ใหม่ที่เปลี่ยนเกม
- คดีกฎหมายสำคัญ
- ข่าว IPO ใหญ่

ตอบ JSON เท่านั้น:
{
  "highImpact": [
    {"index": หมายเลข, "impact": "HIGH/VERY HIGH", "reason": "เหตุผลภาษาไทยสั้นๆ"}
  ]
}`;

    const result = await callGroq(prompt, 500);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const highImpactNews = [];

    for (const item of parsed.highImpact || []) {
      const news = allNews[item.index - 1];
      if (news) {
        highImpactNews.push({
          headline: news.headline,
          source: news.source,
          url: news.url,
          datetime: news.datetime,
          related: news.related,
          impact: item.impact,
          reason: item.reason,
        });
      }
    }
    return highImpactNews;
  } catch (e) {
    console.error("News error:", e.message);
    return [];
  }
}

// ---- HOURLY SIGNAL SCAN ----
async function runHourlyScan() {
  console.log("🔍 Hourly signal scan...", new Date().toISOString());
  const strongSignals = [];

  for (const stock of WATCHLIST) {
    try {
      const signal = await analyzeSignal(stock);
      if (!signal) continue;

      signalCache[stock.symbol] = signal;

      // Only alert STRONG signals
      if (signal.signal !== "WAIT" && signal.strength === "STRONG") {
        // Avoid duplicate alerts within 4 hours
        const lastAlert = lastSignalTime[stock.symbol] || 0;
        if (Date.now() - lastAlert > 4 * 60 * 60 * 1000) {
          strongSignals.push(signal);
          lastSignalTime[stock.symbol] = Date.now();
        }
      }
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`Scan error ${stock.symbol}:`, e.message);
    }
  }

  // Send Telegram alerts for strong signals
  for (const sig of strongSignals) {
    const emoji = sig.signal === "BUY" ? "🟢" : "🔴";
    const msg =
      `${emoji} <b>สัญญาณ${sig.signal === "BUY" ? "ซื้อ" : "ขาย"}ชัดเจน!</b>\n\n` +
      `หุ้น: <b>${sig.symbol}</b> (${sig.name})\n` +
      `ราคาปัจจุบัน: <b>$${sig.price}</b> (${sig.changePct?.toFixed(2)}%)\n\n` +
      `📍 จุดเข้า: <b>$${sig.entry}</b>\n` +
      `🎯 เป้าหมาย: <b>$${sig.target}</b>\n` +
      `🛑 Stop Loss: <b>$${sig.stopLoss}</b>\n` +
      `📊 Risk/Reward: <b>1:${sig.riskReward}</b>\n\n` +
      `📈 RSI: ${sig.rsi} | EMA20: $${sig.ema20}\n` +
      `🔵 แนวรับ: $${sig.support} | แนวต้าน: $${sig.resistance}\n\n` +
      `💡 ${sig.reason}`;
    await sendTelegram(msg);
  }

  // Check high impact news
  const news = await getHighImpactNews();
  for (const item of news.slice(0, 3)) {
    const msg =
      `📰 <b>ข่าว HIGH IMPACT!</b> [${item.impact}]\n\n` +
      `<b>${item.headline}</b>\n\n` +
      `📌 ${item.reason}\n` +
      `🔗 <a href="${item.url}">อ่านเพิ่มเติม</a>\n` +
      `📡 ${item.source}`;
    await sendTelegram(msg);
  }

  console.log(`✅ Scan done. Strong signals: ${strongSignals.length}, News: ${news.length}`);
  return { signals: strongSignals, news };
}

// Run every 1 hour
setInterval(runHourlyScan, 60 * 60 * 1000);

// ---- NEWS for single stock ----
async function getStockNews(symbol) {
  if (newsCache[symbol] && Date.now() - newsCache[symbol].timestamp < 30 * 60 * 1000) {
    return newsCache[symbol].data;
  }
  try {
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${FINNHUB_KEY}`
    );
    const data = await res.json();
    const news = Array.isArray(data) ? data.slice(0, 10) : [];
    newsCache[symbol] = { data: news, timestamp: Date.now() };
    return news;
  } catch (e) { return []; }
}

// ---- ROUTES ----
app.get("/", (req, res) => res.json({
  status: "🚀 AI Trading API Online",
  ai: "Groq Llama 3.3 70B",
  version: "3.0 - Smart Signals",
  time: new Date(),
  telegram: TELEGRAM_TOKEN ? "✅" : "❌",
  cachedSignals: Object.keys(signalCache).length,
}));

// Get all prices
app.post("/api/prices", async (req, res) => {
  const { symbols } = req.body;
  const results = await Promise.all(
    symbols.map(async (sym) => ({ symbol: sym, ...await getPrice(sym) }))
  );
  res.json(results);
});

// Get single price
app.get("/api/price/:symbol", async (req, res) => {
  const data = await getPrice(req.params.symbol.toUpperCase());
  if (!data) return res.status(404).json({ error: "ไม่พบข้อมูล" });
  res.json(data);
});

// Get signal for single stock
app.get("/api/signal/:symbol", async (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const stock = WATCHLIST.find(s => s.symbol === sym) || { symbol: sym, name: sym, sector: "Other" };
  try {
    const signal = await analyzeSignal(stock);
    if (signal) signalCache[sym] = signal;
    res.json(signal || { signal: "WAIT", reason: "ไม่สามารถวิเคราะห์ได้" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all cached signals
app.get("/api/signals", (req, res) => {
  res.json(Object.values(signalCache));
});

// Manual scan trigger
app.get("/api/scan", async (req, res) => {
  try {
    const result = await runHourlyScan();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get news for stock
app.get("/api/news/:symbol", async (req, res) => {
  const news = await getStockNews(req.params.symbol.toUpperCase());
  res.json(news);
});

// Get high impact news
app.get("/api/news/market/high-impact", async (req, res) => {
  try {
    const news = await getHighImpactNews();
    res.json(news);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI analyze
app.post("/api/analyze", async (req, res) => {
  const { symbol, name, sector } = req.body;
  const stock = { symbol, name, sector };
  try {
    const [signal, news] = await Promise.all([
      analyzeSignal(stock),
      getStockNews(symbol),
    ]);
    if (signal) signalCache[symbol] = signal;

    const newsText = news.slice(0, 3).map(n => `- ${n.headline}`).join("\n") || "ไม่มีข่าว";
    const prompt = `วิเคราะห์หุ้น ${symbol} (${name}) เพิ่มเติมจากข้อมูลต่อไปนี้ เป็นภาษาไทย กระชับ

สัญญาณ Technical: ${signal?.signal} (${signal?.strength})
จุดเข้า: $${signal?.entry} | เป้า: $${signal?.target} | Stop: $${signal?.stopLoss}
RSI: ${signal?.rsi} | แนวรับ: $${signal?.support} | แนวต้าน: $${signal?.resistance}

ข่าวล่าสุด:
${newsText}

วิเคราะห์เพิ่มเติมและให้คำแนะนำการเทรด ไม่เกิน 150 คำ`;

    const analysis = await callGroq(prompt, 400);
    res.json({ signal, analysis, timestamp: new Date() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test telegram
app.get("/api/test-telegram", async (req, res) => {
  const ok = await sendTelegram("🚀 <b>AI Trading Bot v3.0</b>\n\nระบบพร้อมแจ้งเตือนสัญญาณชัดเจนแล้ว ✅\nสแกนทุก 1 ชั่วโมง");
  res.json({ success: ok });
});




// ---- USER ALERTS ----
let userAlerts = [];
const alertsTriggered = new Set();

async function checkAlerts() {
  if (userAlerts.length === 0) return;
  for (const alert of userAlerts.filter(a => a.active)) {
    const data = await getPrice(alert.symbol);
    if (!data) continue;
    const key = `${alert.id}-${Math.floor(Date.now() / 60000)}`;
    if (alertsTriggered.has(key)) continue;
    const triggered = (alert.condition === "above" && data.price >= alert.price) ||
                      (alert.condition === "below" && data.price <= alert.price);
    if (triggered) {
      alertsTriggered.add(key);
      const emoji = alert.condition === "above" ? "🚀" : "📉";
      await sendTelegram(
        `${emoji} <b>แจ้งเตือนราคา!</b>\n\n` +
        `หุ้น: <b>${alert.symbol}</b>\n` +
        `ราคา: <b>$${data.price.toFixed(2)}</b>\n` +
        `เงื่อนไข: ${alert.condition === "above" ? "ขึ้นถึง" : "ลงถึง"} $${alert.price}\n` +
        `เปลี่ยนแปลง: ${data.changePct >= 0 ? "+" : ""}${data.changePct?.toFixed(2)}%`
      );
    }
  }
}

// ---- SIGNAL CHECK ทุก 1 ชั่วโมง ----
const signalCache = {};
async function runSignalCheck() {
  console.log("🔍 Signal check...", new Date().toISOString());
  const watchStocks = ALL_STOCKS.slice(0, 10);
  for (const stock of watchStocks) {
    try {
      const result = await aiAnalyzeWithSignal(stock.symbol, stock.name, stock.sector);
      if (!result) continue;
      const prev = signalCache[stock.symbol];
      const changed = prev !== result.signal;
      signalCache[stock.symbol] = result.signal;
      if (result.shouldAlert && changed) {
        const emoji = result.signal === "STRONG_BUY" ? "🚀" : "🔴";
        await sendTelegram(
          `${emoji} <b>สัญญาณชัด! ${stock.symbol}</b>\n\n` +
          `สัญญาณ: <b>${result.signal}</b> (${result.confidence}%)\n` +
          `ราคา: <b>$${result.price}</b>\n` +
          `🎯 เข้า: ${result.entry} | 🛑 Stop: ${result.stopLoss}\n` +
          `✅ เป้า 1: ${result.target1} | เป้า 2: ${result.target2}\n` +
          `💡 ${result.reason}`
        );
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch(e) { console.error(stock.symbol, e.message); }
  }
  await checkAlerts();
}

setInterval(runSignalCheck, 60 * 60 * 1000);
setInterval(checkAlerts, 60 * 1000);

// Alerts routes
app.get("/api/alerts", (req, res) => res.json(userAlerts));
app.post("/api/alerts", async (req, res) => {
  const { symbol, condition, price } = req.body;
  if (!symbol || !condition || !price) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const alert = { id: Date.now().toString(), symbol: symbol.toUpperCase(), condition, price: Number(price), active: true, createdAt: new Date() };
  userAlerts.push(alert);
  await sendTelegram(`🔔 <b>ตั้งแจ้งเตือน ${alert.symbol}</b>\n${condition === "above" ? "ขึ้นถึง" : "ลงถึง"} $${price}`);
  res.json({ success: true, alert });
});
app.delete("/api/alerts/:id", (req, res) => {
  userAlerts = userAlerts.filter(a => a.id !== req.params.id);
  res.json({ success: true });
});
app.get("/api/test-telegram", async (req, res) => {
  const ok = await sendTelegram(
    "🚀 <b>AI Trading Bot พร้อมแล้ว!</b>\n\n" +
    `✅ ติดตาม ${ALL_STOCKS.length} หุ้น\n` +
    "⏰ ตรวจสัญญาณทุก 1 ชั่วโมง\n" +
    "📰 แจ้งข่าว High Impact\n" +
    "📈 Paper Trading ทุก 2 ชั่วโมง"
  );
  res.json({ success: ok });
});
app.get("/api/signal-check", async (req, res) => {
  runSignalCheck();
  res.json({ message: "Signal check started", time: new Date() });
});

// ---- PAPER TRADING ENGINE ----
let paperPortfolio = {
  cash: 10000,
  holdings: {},
  trades: [],
  startValue: 10000,
  startDate: new Date().toISOString(),
};

async function paperTrade() {
  console.log("📈 Paper trading check...", new Date().toISOString());
  try {
    // วิเคราะห์ top 5 หุ้น
    const watchStocks = [
      { symbol: "NVDA", name: "NVIDIA", sector: "AI/Chip" },
      { symbol: "AAPL", name: "Apple", sector: "Tech" },
      { symbol: "TSLA", name: "Tesla", sector: "EV" },
      { symbol: "RKLB", name: "Rocket Lab", sector: "Space" },
      { symbol: "PLTR", name: "Palantir", sector: "AI" },
    ];

    for (const stock of watchStocks) {
      const analysis = await aiAnalyzeWithSignal(stock.symbol, stock.name, stock.sector);
      if (!analysis) continue;

      const price = analysis.price;
      const holding = paperPortfolio.holdings[stock.symbol];

      // BUY logic
      if ((analysis.signal === "STRONG_BUY" || analysis.signal === "BUY") && analysis.confidence >= 70) {
        if (!holding && paperPortfolio.cash >= price * 10) {
          const shares = Math.floor((paperPortfolio.cash * 0.2) / price);
          if (shares > 0) {
            const cost = shares * price;
            paperPortfolio.cash -= cost;
            paperPortfolio.holdings[stock.symbol] = { shares, buyPrice: price, buyDate: new Date().toISOString() };
            paperPortfolio.trades.push({
              type: "BUY", symbol: stock.symbol, shares, price,
              signal: analysis.signal, confidence: analysis.confidence,
              date: new Date().toISOString(),
            });
            await sendTelegram(
              `🤖 <b>Paper Trade: ซื้อ ${stock.symbol}</b>
` +
              `${shares} หุ้น @ $${price.toFixed(2)}
` +
              `สัญญาณ: ${analysis.signal} (${analysis.confidence}%)
` +
              `เหลือเงิน: $${paperPortfolio.cash.toFixed(2)}`
            );
          }
        }
      }

      // SELL logic
      if ((analysis.signal === "STRONG_SELL" || analysis.signal === "SELL") && holding) {
        const proceeds = holding.shares * price;
        const pnl = proceeds - (holding.shares * holding.buyPrice);
        paperPortfolio.cash += proceeds;
        paperPortfolio.trades.push({
          type: "SELL", symbol: stock.symbol, shares: holding.shares, price,
          signal: analysis.signal, confidence: analysis.confidence,
          pnl: pnl.toFixed(2), date: new Date().toISOString(),
        });
        delete paperPortfolio.holdings[stock.symbol];
        await sendTelegram(
          `🤖 <b>Paper Trade: ขาย ${stock.symbol}</b>
` +
          `${holding.shares} หุ้น @ $${price.toFixed(2)}
` +
          `กำไร/ขาดทุน: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}
` +
          `เหลือเงิน: $${paperPortfolio.cash.toFixed(2)}`
        );
      }

      // Stop loss check
      if (holding) {
        const stopLossPrice = holding.buyPrice * 0.95; // -5%
        if (price <= stopLossPrice) {
          const proceeds = holding.shares * price;
          const pnl = proceeds - (holding.shares * holding.buyPrice);
          paperPortfolio.cash += proceeds;
          paperPortfolio.trades.push({
            type: "STOP_LOSS", symbol: stock.symbol, shares: holding.shares, price,
            pnl: pnl.toFixed(2), date: new Date().toISOString(),
          });
          delete paperPortfolio.holdings[stock.symbol];
          await sendTelegram(
            `🛑 <b>Stop Loss: ${stock.symbol}</b>
` +
            `ราคาลงถึง $${price.toFixed(2)} (ซื้อที่ $${holding.buyPrice})
` +
            `ขาดทุน: $${pnl.toFixed(2)}`
          );
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (e) {
    console.error("Paper trade error:", e.message);
  }
}

// Paper trade ทุก 2 ชั่วโมง
setInterval(paperTrade, 2 * 60 * 60 * 1000);

// Paper trading routes
app.get("/api/paper/portfolio", async (req, res) => {
  // คำนวณ current value
  let holdingsValue = 0;
  const holdingsDetail = {};
  for (const [sym, holding] of Object.entries(paperPortfolio.holdings)) {
    const quote = await getPrice(sym);
    const curPrice2 = quote?.price || holding.buyPrice;
    const curVal = holding.shares * curPrice2;
    const pnl = curVal - (holding.shares * holding.buyPrice);
    holdingsValue += curVal;
    holdingsDetail[sym] = { ...holding, curPrice: curPrice2, curVal, pnl };
  }
  const totalValue2 = paperPortfolio.cash + holdingsValue;
  const totalReturn = ((totalValue2 - paperPortfolio.startValue) / paperPortfolio.startValue) * 100;
  res.json({
    cash: paperPortfolio.cash,
    holdingsValue,
    totalValue: totalValue2,
    totalReturn: totalReturn.toFixed(2),
    holdings: holdingsDetail,
    trades: paperPortfolio.trades.slice(-20),
    startDate: paperPortfolio.startDate,
    startValue: paperPortfolio.startValue,
  });
});

app.post("/api/paper/reset", (req, res) => {
  paperPortfolio = { cash: 10000, holdings: {}, trades: [], startValue: 10000, startDate: new Date().toISOString() };
  res.json({ success: true, message: "รีเซ็ต Paper Trading แล้ว" });
});

// Backtest endpoint
app.post("/api/backtest", async (req, res) => {
  const { symbol, name, sector } = req.body;
  try {
    const quote = await getPrice(symbol);
    if (!quote) return res.status(404).json({ error: "ไม่พบข้อมูล" });

    const prompt = `คุณคือ AI Backtesting Expert วิเคราะห์ผลย้อนหลัง ${symbol} (${name})

ราคาปัจจุบัน: $${quote.price}
High 52W โดยประมาณ: $${(quote.price * 1.35).toFixed(2)}
Low 52W โดยประมาณ: $${(quote.price * 0.65).toFixed(2)}

สมมติฐาน Backtest 6 เดือนที่ผ่านมา:
- ถ้าซื้อตอน RSI < 30 และขายตอน RSI > 70
- ถ้าซื้อตอนแนวรับและขายตอนแนวต้าน

ตอบเป็น JSON เท่านั้น:
{
  "winRate": XX,
  "totalTrades": XX,
  "avgReturn": XX.X,
  "maxDrawdown": XX.X,
  "bestTrade": "+XX.X%",
  "worstTrade": "-XX.X%",
  "sharpeRatio": X.X,
  "recommendation": "ข้อความสั้นๆ ว่าหุ้นนี้เหมาะกับ strategy ไหน",
  "riskLevel": "ต่ำ/กลาง/สูง"
}`;

    const result = await callGroq(prompt);
    const clean = result.replace(/\`\`\`json|\`\`\`/g, "").trim();
    const parsed = JSON.parse(clean);
    res.json({ ...parsed, symbol, name, price: quote.price });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Portfolio Advisor
app.post("/api/portfolio-advisor", async (req, res) => {
  const { holdings } = req.body;
  try {
    // ดึงราคาจริงทุกตัว
    const holdingsWithPrices = await Promise.all(
      holdings.map(async h => {
        const q = await getPrice(h.symbol);
        const curPrice3 = q?.price || h.buyPrice;
        const pnl = ((curPrice3 - h.buyPrice) / h.buyPrice * 100).toFixed(2);
        return { ...h, curPrice: curPrice3, pnl, changePct: q?.changePct };
      })
    );

    const prompt = `คุณคือ AI Portfolio Advisor ผู้เชี่ยวชาญ วิเคราะห์พอร์ตแล้วให้คำแนะนำเป็นภาษาไทย

พอร์ตปัจจุบัน:
${holdingsWithPrices.map(h => `- ${h.symbol}: ${h.shares} หุ้น ซื้อที่ $${h.buyPrice} ตอนนี้ $${h.curPrice?.toFixed(2)} (${h.pnl >= 0 ? "+" : ""}${h.pnl}%)`).join("
")}

วิเคราะห์และตอบเป็น JSON:
{
  "overallHealth": "ดีมาก/ดี/พอใช้/ควรปรับ",
  "diversification": "การกระจายความเสี่ยง ดีหรือไม่",
  "actions": [
    { "symbol": "XX", "action": "ถือต่อ/ขายบางส่วน/ขายทั้งหมด/เพิ่ม", "reason": "เหตุผล", "priority": "สูง/กลาง/ต่ำ" }
  ],
  "addRecommendations": ["หุ้นที่แนะนำให้เพิ่มในพอร์ต 2-3 ตัว"],
  "riskWarnings": ["ความเสี่ยงที่ต้องระวัง"],
  "summary": "สรุปภาพรวมพอร์ต 2-3 ประโยค"
}`;

    const result = await callGroq(prompt);
    const clean = result.replace(/\`\`\`json|\`\`\`/g, "").trim();
    const parsed = JSON.parse(clean);
    res.json({ ...parsed, holdings: holdingsWithPrices });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- AI CHAT ----
app.post("/api/chat", async (req, res) => {
  const { message, portfolioContext, priceContext, history } = req.body;
  try {
    const systemPrompt = `คุณคือ AI Trading Assistant ผู้เชี่ยวชาญหุ้น US ตอบภาษาไทย กระชับ ตรงประเด็น มีประโยชน์

พอร์ตผู้ใช้ตอนนี้: ${portfolioContext || "ไม่มีข้อมูล"}
ราคาหุ้นตอนนี้: ${priceContext || "ไม่มีข้อมูล"}

ตอบสั้นๆ ไม่เกิน 150 คำ ถ้าถามเรื่องหุ้นให้อ้างอิงราคาจริงที่ให้มา`;

    const messages = [
      ...(history || []).map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message }
    ];

    const res2 = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        max_tokens: 400,
        temperature: 0.7,
      }),
    });
    const data = await res2.json();
    const reply = data.choices?.[0]?.message?.content || "ขอโทษครับ ไม่สามารถตอบได้";
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ================================================================
// 🤖 AI AGENT SYSTEM — ทำงานอัตโนมัติตลอดเวลา
// ================================================================

const agentLogs = []; // เก็บ log ทุก action
const agentState = {
  isRunning: true,
  lastRun: null,
  totalActions: 0,
  stats: { signals: 0, newsAlerts: 0, paperTrades: 0, priceAlerts: 0 }
};

function logAgent(type, symbol, message, data = {}) {
  const log = {
    id: Date.now(),
    time: new Date().toISOString(),
    timeTH: new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" }),
    type, // SIGNAL | NEWS | TRADE | ALERT | INFO | ERROR
    symbol: symbol || "SYSTEM",
    message,
    ...data,
  };
  agentLogs.unshift(log); // เพิ่มหัวสุด
  if (agentLogs.length > 100) agentLogs.pop(); // เก็บแค่ 100 อัน
  agentState.totalActions++;
  agentState.lastRun = new Date().toISOString();
  console.log(`[${log.type}] ${log.symbol}: ${log.message}`);
  return log;
}

// ---- AGENT 1: Signal Hunter ---- ตรวจทุก 1 ชม.
async function agentSignalHunter() {
  if (!agentState.isRunning) return;
  logAgent("INFO", "SYSTEM", "🔍 Signal Hunter เริ่มสแกน...");
  
  const results = [];
  for (let i = 0; i < ALL_STOCKS.length; i += 3) {
    const batch = ALL_STOCKS.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map(s => aiAnalyzeWithSignal(s.symbol, s.name, s.sector).catch(() => null))
    );
    
    for (const result of batchResults) {
      if (!result) continue;
      results.push(result);
      
      const prev = signalCache[result.symbol];
      const changed = prev !== result.signal;
      signalCache[result.symbol] = result.signal;
      
      // Log ทุก signal
      logAgent("SIGNAL", result.symbol, 
        `${result.signal} (${result.confidence}%) | Entry: ${result.entry} | Stop: ${result.stopLoss}`,
        { signal: result.signal, confidence: result.confidence, entry: result.entry, 
          stopLoss: result.stopLoss, target1: result.target1, shouldAlert: result.shouldAlert }
      );
      
      // แจ้ง Telegram เฉพาะ strong signal ที่เปลี่ยน
      if (result.shouldAlert && changed) {
        agentState.stats.signals++;
        const emoji = result.signal === "STRONG_BUY" ? "🚀" : "🔴";
        await sendTelegram(
          `${emoji} <b>[AI Agent] สัญญาณชัด! ${result.symbol}</b>\n\n` +
          `📊 ${result.signal} (${result.confidence}% มั่นใจ)\n` +
          `💰 ราคา: $${result.price}\n` +
          `🎯 เข้า: ${result.entry} | 🛑 Stop: ${result.stopLoss}\n` +
          `✅ เป้า 1: ${result.target1} | เป้า 2: ${result.target2}\n` +
          `📰 ข่าว: ${result.newsImpact}\n` +
          `💡 ${result.reason}`
        );
        logAgent("ALERT", result.symbol, `ส่ง Telegram: ${result.signal}`, { sent: true });
      }
    }
    await new Promise(r => setTimeout(r, 2000)); // rate limit
  }
  
  logAgent("INFO", "SYSTEM", `✅ Signal Hunter เสร็จ: สแกน ${results.length} หุ้น`);
}

// ---- AGENT 2: News Watcher ---- ตรวจทุก 30 นาที
let seenNewsIds = new Set();
async function agentNewsWatcher() {
  if (!agentState.isRunning) return;
  logAgent("INFO", "SYSTEM", "📰 News Watcher ตรวจข่าว...");
  
  // ตรวจข่าว High Impact Economic
  try {
    const highImpact = await getHighImpactNews();
    for (const news of highImpact) {
      const newsId = `${news.event}-${news.time}`;
      if (!seenNewsIds.has(newsId)) {
        seenNewsIds.add(newsId);
        agentState.stats.newsAlerts++;
        logAgent("NEWS", "MACRO", `High Impact: ${news.event} (${news.country})`,
          { event: news.event, country: news.country, impact: "high", actual: news.actual }
        );
        await sendTelegram(
          `📰 <b>[AI Agent] ข่าว High Impact!</b>\n\n` +
          `🔴 <b>${news.event}</b>\n` +
          `🌍 ${news.country} | ⏰ ${news.time}\n` +
          `${news.actual ? `📊 Actual: ${news.actual} | Est: ${news.estimate}` : ""}`
        );
      }
    }
  } catch(e) { logAgent("ERROR", "NEWS", e.message); }
  
  // ตรวจข่าวหุ้นใน portfolio (เฉพาะที่ user ถือ)
  const portfolioSymbols = Object.keys(paperPortfolio.holdings);
  for (const symbol of portfolioSymbols.slice(0, 3)) {
    try {
      const news = await getNews(symbol);
      const latestNews = news[0];
      if (latestNews) {
        const newsId = `${symbol}-${latestNews.datetime}`;
        if (!seenNewsIds.has(newsId)) {
          seenNewsIds.add(newsId);
          logAgent("NEWS", symbol, latestNews.headline, { url: latestNews.url });
          
          // ให้ AI วิเคราะห์ผลกระทบของข่าว
          const impact = await callGroq(
            `ข่าว: "${latestNews.headline}" กระทบหุ้น ${symbol} อย่างไร? ตอบสั้นๆ 1 ประโยค เป็นภาษาไทย บอก Positive/Negative/Neutral`
          );
          logAgent("NEWS", symbol, `AI วิเคราะห์: ${impact.slice(0, 100)}`);
          
          if (impact.toLowerCase().includes("negative") || impact.includes("ลบ")) {
            await sendTelegram(
              `⚠️ <b>[AI Agent] ข่าวสำคัญ ${symbol}!</b>\n\n` +
              `📰 ${latestNews.headline}\n\n` +
              `🤖 AI: ${impact}`
            );
          }
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch(e) { logAgent("ERROR", symbol, e.message); }
  }
  
  logAgent("INFO", "SYSTEM", "✅ News Watcher เสร็จ");
}

// ---- AGENT 3: Smart Paper Trader ---- ตรวจทุก 2 ชม.
async function agentSmartTrader() {
  if (!agentState.isRunning) return;
  logAgent("INFO", "SYSTEM", "📈 Smart Trader เริ่ม...");
  
  const tradeTargets = ALL_STOCKS.filter(s => 
    ["NVDA","AAPL","TSLA","RKLB","PLTR","AVGO","META","MSFT"].includes(s.symbol)
  );
  
  for (const stock of tradeTargets) {
    try {
      const analysis = await aiAnalyzeWithSignal(stock.symbol, stock.name, stock.sector);
      if (!analysis) continue;
      
      const price = analysis.price;
      const holding = paperPortfolio.holdings[stock.symbol];
      
      // BUY: STRONG_BUY + confidence >= 75 + ยังไม่มีในมือ
      if (analysis.signal === "STRONG_BUY" && analysis.confidence >= 75 && !holding) {
        const maxBuy = paperPortfolio.cash * 0.15; // ใช้ไม่เกิน 15% ต่อตัว
        const shares = Math.floor(maxBuy / price);
        if (shares > 0 && paperPortfolio.cash >= shares * price) {
          const cost = shares * price;
          paperPortfolio.cash -= cost;
          paperPortfolio.holdings[stock.symbol] = {
            shares, buyPrice: price, buyDate: new Date().toISOString(),
            targetPrice: Number(analysis.target1?.replace("$","")),
            stopLoss: Number(analysis.stopLoss?.replace("$","")),
          };
          paperPortfolio.trades.push({
            type: "BUY", symbol: stock.symbol, shares, price,
            signal: analysis.signal, confidence: analysis.confidence,
            date: new Date().toISOString(),
          });
          agentState.stats.paperTrades++;
          logAgent("TRADE", stock.symbol, 
            `🟢 BUY ${shares} หุ้น @ $${price.toFixed(2)} (${analysis.confidence}%)`,
            { action: "BUY", shares, price, cost }
          );
          await sendTelegram(
            `📈 <b>[AI Agent] Paper Buy: ${stock.symbol}</b>\n` +
            `${shares} หุ้น @ $${price.toFixed(2)}\n` +
            `Signal: ${analysis.signal} (${analysis.confidence}%)\n` +
            `Stop: $${analysis.stopLoss} | เป้า: $${analysis.target1}\n` +
            `เงินเหลือ: $${paperPortfolio.cash.toFixed(2)}`
          );
        }
      }
      
      // SELL: ถึงเป้า หรือ STRONG_SELL หรือ stop loss
      if (holding) {
        const pnlPct = ((price - holding.buyPrice) / holding.buyPrice) * 100;
        const hitTarget = holding.targetPrice && price >= holding.targetPrice;
        const hitStop = holding.stopLoss && price <= holding.stopLoss;
        const strongSell = analysis.signal === "STRONG_SELL" && analysis.confidence >= 70;
        
        if (hitTarget || hitStop || strongSell) {
          const proceeds = holding.shares * price;
          const pnl = proceeds - (holding.shares * holding.buyPrice);
          paperPortfolio.cash += proceeds;
          const reason = hitTarget ? "✅ ถึงเป้า" : hitStop ? "🛑 Stop Loss" : "🔴 STRONG_SELL";
          
          paperPortfolio.trades.push({
            type: "SELL", symbol: stock.symbol, shares: holding.shares,
            price, pnl: pnl.toFixed(2), reason, date: new Date().toISOString(),
          });
          logAgent("TRADE", stock.symbol,
            `${reason}: SELL ${holding.shares} หุ้น @ $${price.toFixed(2)} | PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
            { action: "SELL", pnl: pnl.toFixed(2), reason }
          );
          delete paperPortfolio.holdings[stock.symbol];
          agentState.stats.paperTrades++;
          await sendTelegram(
            `${pnl >= 0 ? "💰" : "📉"} <b>[AI Agent] Paper Sell: ${stock.symbol}</b>\n` +
            `${reason}\n` +
            `${holding.shares} หุ้น @ $${price.toFixed(2)}\n` +
            `PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)\n` +
            `เงินเหลือ: $${paperPortfolio.cash.toFixed(2)}`
          );
        }
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch(e) { logAgent("ERROR", stock.symbol, e.message); }
  }
  logAgent("INFO", "SYSTEM", "✅ Smart Trader เสร็จ");
}

// ---- AGENT 4: Price Alert Watcher ---- ตรวจทุก 1 นาที
async function agentPriceWatcher() {
  if (!agentState.isRunning || userAlerts.length === 0) return;
  
  for (const alert of userAlerts.filter(a => a.active)) {
    try {
      const data = await getPrice(alert.symbol);
      if (!data) continue;
      const key = `${alert.id}-${Math.floor(Date.now() / 60000)}`;
      if (alertsTriggered.has(key)) continue;
      
      const triggered = (alert.condition === "above" && data.price >= alert.price) ||
                        (alert.condition === "below" && data.price <= alert.price);
      
      if (triggered) {
        alertsTriggered.add(key);
        agentState.stats.priceAlerts++;
        logAgent("ALERT", alert.symbol,
          `💰 ราคา ${alert.condition === "above" ? "ขึ้นถึง" : "ลงถึง"} $${alert.price} (ปัจจุบัน $${data.price.toFixed(2)})`,
          { condition: alert.condition, target: alert.price, current: data.price }
        );
        await sendTelegram(
          `${alert.condition === "above" ? "🚀" : "📉"} <b>[AI Agent] แจ้งเตือนราคา!</b>\n\n` +
          `หุ้น: <b>${alert.symbol}</b>\n` +
          `ราคา: <b>$${data.price.toFixed(2)}</b>\n` +
          `เงื่อนไข: ${alert.condition === "above" ? "ขึ้นถึง" : "ลงถึง"} $${alert.price}\n` +
          `เปลี่ยน: ${data.changePct >= 0 ? "+" : ""}${data.changePct?.toFixed(2)}%`
        );
      }
    } catch(e) {}
  }
}

// ---- MASTER SCHEDULER ----
let agentCycle = 0;
async function runAgentCycle() {
  if (!agentState.isRunning) return;
  agentCycle++;
  
  // ทุก cycle (1 นาที): Price Watcher
  await agentPriceWatcher();
  
  // ทุก 30 cycle (30 นาที): News Watcher
  if (agentCycle % 30 === 0) await agentNewsWatcher();
  
  // ทุก 60 cycle (1 ชั่วโมง): Signal Hunter
  if (agentCycle % 60 === 0) await agentSignalHunter();
  
  // ทุก 120 cycle (2 ชั่วโมง): Smart Trader
  if (agentCycle % 120 === 0) await agentSmartTrader();
  
  // Reset cycle ทุก 24 ชั่วโมง
  if (agentCycle >= 1440) agentCycle = 0;
}

// Start master scheduler ทุก 1 นาที
setInterval(runAgentCycle, 60 * 1000);

// Boot sequence
setTimeout(async () => {
  logAgent("INFO", "SYSTEM", "🚀 AI Agent System เริ่มทำงาน...");
  await sendTelegram(
    "🤖 <b>AI Agent System Online!</b>\n\n" +
    "✅ Signal Hunter: ทุก 1 ชั่วโมง\n" +
    "✅ News Watcher: ทุก 30 นาที\n" +
    "✅ Smart Trader: ทุก 2 ชั่วโมง\n" +
    "✅ Price Watcher: ทุก 1 นาที\n" +
    `📊 ติดตาม ${ALL_STOCKS.length} หุ้น | 24/7`
  );
  // รัน cycle แรกทันที
  await agentNewsWatcher();
  await agentSignalHunter();
}, 8000);

// ---- AGENT API ROUTES ----
app.get("/api/agent/status", (req, res) => {
  res.json({
    isRunning: agentState.isRunning,
    lastRun: agentState.lastRun,
    totalActions: agentState.totalActions,
    cycle: agentCycle,
    stats: agentState.stats,
    paperPortfolioValue: paperPortfolio.cash + Object.keys(paperPortfolio.holdings).length * 100,
    activeAlerts: userAlerts.filter(a => a.active).length,
    logs: agentLogs.slice(0, 20),
  });
});

app.get("/api/agent/logs", (req, res) => {
  const { type, limit = 50 } = req.query;
  let logs = agentLogs;
  if (type) logs = logs.filter(l => l.type === type);
  res.json(logs.slice(0, Number(limit)));
});

app.post("/api/agent/toggle", (req, res) => {
  agentState.isRunning = !agentState.isRunning;
  logAgent("INFO", "SYSTEM", `Agent ${agentState.isRunning ? "เปิด" : "ปิด"} โดย User`);
  res.json({ isRunning: agentState.isRunning });
});

app.post("/api/agent/run/:agent", async (req, res) => {
  const { agent } = req.params;
  res.json({ message: `กำลังรัน ${agent}...` }); // ตอบทันที
  if (agent === "signal") agentSignalHunter();
  else if (agent === "news") agentNewsWatcher();
  else if (agent === "trader") agentSmartTrader();
  else if (agent === "all") {
    await agentNewsWatcher();
    await agentSignalHunter();
    await agentSmartTrader();
  }
});



// ================================================================
// 🤝 SECRETARY ↔ DEV COLLABORATION SYSTEM
// ================================================================

const taskQueue = [];      // งานที่รอ Dev ทำ
const pendingApprovals = []; // งานที่รอ User อนุมัติ
const completedTasks = [];   // งานที่เสร็จแล้ว

function createTask(id, from, title, description, code, status, proposedBy) {
  return { id, from, title, description, code, status, proposedBy,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

// ---- เลขารับ request จาก User แล้วส่งให้ Dev ----
app.post("/api/collab/request", async (req, res) => {
  const { message, context } = req.body;
  try {
    // เลขาวิเคราะห์ request และแปลเป็น Task
    const secretaryPrompt = `คุณคือเลขา AI ที่ฉลาด รับคำสั่งจาก User แล้วแปลงเป็น Task ที่ชัดเจนสำหรับ Dev AI

User พูดว่า: "${message}"
Context: ${context || "ไม่มี"}

วิเคราะห์แล้วตอบ JSON:
{
  "understood": "สิ่งที่ User ต้องการ (ภาษาไทย)",
  "taskType": "ADD_FEATURE|FIX_BUG|MODIFY|QUERY|IDEA",
  "title": "ชื่อ Task สั้นๆ",
  "description": "รายละเอียดที่ชัดเจนสำหรับ Dev",
  "priority": "high|medium|low",
  "needsApproval": true/false,
  "replyToUser": "ข้อความตอบ User ว่าจะดำเนินการอะไร"
}`;

    const secResult = await callGroq(secretaryPrompt);
    const clean = secResult.replace(/\`\`\`json|\`\`\`/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    const task = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (!task) return res.json({ reply: secResult, task: null });

    const taskId = `task-${Date.now()}`;

    // ถ้าต้องรออนุมัติก่อน
    if (task.needsApproval) {
      pendingApprovals.push(createTask(
        taskId, "secretary", task.title, task.description, null, "PENDING_APPROVAL", "secretary"
      ));
      await sendTelegram(
        `📋 <b>เลขา → รอการอนุมัติ</b>\n\n` +
        `📌 ${task.title}\n` +
        `📝 ${task.description}\n\n` +
        `Priority: ${task.priority}\n` +
        `กด Approve ในแอพเพื่อให้ Dev ดำเนินการ`
      );
    } else {
      // ส่งให้ Dev ทำได้เลย
      taskQueue.push(createTask(
        taskId, "secretary", task.title, task.description, null, "QUEUED", "secretary"
      ));
      // ให้ Dev AI วิเคราะห์และทำงานอัตโนมัติ
      processDevTask(taskId, task.title, task.description);
    }

    res.json({
      reply: task.replyToUser,
      taskId,
      task: { title: task.title, priority: task.priority, needsApproval: task.needsApproval }
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Dev AI วิเคราะห์ Task และเขียนโค้ด / เสนอไอเดีย ----
async function processDevTask(taskId, title, description) {
  const task = taskQueue.find(t => t.id === taskId) ||
               pendingApprovals.find(t => t.id === taskId);
  if (!task) return;

  try {
    task.status = "IN_PROGRESS";
    task.updatedAt = new Date().toISOString();

    const devPrompt = `คุณคือ Dev AI ผู้เชี่ยวชาญด้านการพัฒนาระบบ Trading Platform

Task: ${title}
รายละเอียด: ${description}

ระบบปัจจุบัน:
- Backend: Node.js + Express + Groq AI
- Frontend: React + TradingView
- API: Finnhub (ราคาหุ้น), Groq (AI), Telegram (แจ้งเตือน)

วิเคราะห์และตอบ JSON:
{
  "canImplement": true/false,
  "approach": "วิธีการที่จะทำ",
  "code": "โค้ดที่เขียนได้เลย (ถ้าทำได้)",
  "endpoint": "API endpoint ที่จะเพิ่ม (ถ้ามี)",
  "uiChanges": "การเปลี่ยนแปลง UI ที่ต้องการ",
  "estimatedTime": "เวลาโดยประมาณ",
  "sideEffects": "ผลกระทบที่อาจเกิดขึ้น",
  "devProposal": "ข้อเสนอเพิ่มเติมจาก Dev (ถ้ามี)",
  "needsUserInput": true/false,
  "questionsForUser": "คำถามที่ต้องถาม User (ถ้าต้องการ)"
}`;

    const devResult = await callGroq(devPrompt);
    const clean = devResult.replace(/\`\`\`json|\`\`\`/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { approach: devResult };

    task.devAnalysis = analysis;
    task.status = analysis.canImplement ? "COMPLETED" : "NEEDS_REVIEW";
    task.code = analysis.code;
    task.updatedAt = new Date().toISOString();

    // ถ้า Dev มีข้อเสนอเพิ่มให้ User อนุมัติ
    if (analysis.devProposal || analysis.needsUserInput) {
      const proposalId = `proposal-${Date.now()}`;
      pendingApprovals.push(createTask(
        proposalId, "dev", `💡 Dev เสนอ: ${title}`,
        `${analysis.devProposal || ""}\n${analysis.questionsForUser || ""}`,
        analysis.code, "PENDING_APPROVAL", "dev"
      ));
      await sendTelegram(
        `💡 <b>Dev AI เสนอไอเดีย!</b>\n\n` +
        `📌 ${title}\n` +
        `🔧 ${analysis.approach}\n\n` +
        `💬 ${analysis.devProposal || ""}\n\n` +
        `${analysis.questionsForUser ? "❓ " + analysis.questionsForUser : ""}\n\n` +
        `เปิดแอพเพื่ออนุมัติหรือปฏิเสธ`
      );
    }

    // Move to completed
    if (task.status === "COMPLETED") {
      completedTasks.unshift({ ...task });
      const idx = taskQueue.findIndex(t => t.id === taskId);
      if (idx > -1) taskQueue.splice(idx, 1);

      await sendTelegram(
        `✅ <b>Dev เสร็จ: ${title}</b>\n\n` +
        `🔧 ${analysis.approach}\n` +
        `⏱️ ${analysis.estimatedTime || "เสร็จแล้ว"}\n` +
        `${analysis.uiChanges ? "🎨 UI: " + analysis.uiChanges : ""}`
      );
    }
  } catch(e) {
    if (task) { task.status = "ERROR"; task.error = e.message; }
    console.error("Dev task error:", e.message);
  }
}

// ---- User อนุมัติ Task ----
app.post("/api/collab/approve/:id", async (req, res) => {
  const { id } = req.params;
  const { approved, feedback } = req.body;
  const taskIdx = pendingApprovals.findIndex(t => t.id === id);
  if (taskIdx === -1) return res.status(404).json({ error: "ไม่พบ Task" });

  const task = pendingApprovals[taskIdx];
  pendingApprovals.splice(taskIdx, 1);

  if (approved) {
    task.status = "APPROVED";
    task.approvedAt = new Date().toISOString();
    completedTasks.unshift(task);
    // ให้ Dev ดำเนินการต่อ
    await processDevTask(task.id, task.title, task.description + (feedback ? `\nFeedback: ${feedback}` : ""));
    await sendTelegram(`✅ <b>อนุมัติแล้ว: ${task.title}</b>\n${feedback || "Dev จะดำเนินการต่อ"}`);
    res.json({ success: true, message: "อนุมัติแล้ว Dev กำลังดำเนินการ" });
  } else {
    task.status = "REJECTED";
    task.rejectedAt = new Date().toISOString();
    task.feedback = feedback;
    completedTasks.unshift(task);
    await sendTelegram(`❌ <b>ปฏิเสธ: ${task.title}</b>\n${feedback || "ไม่อนุมัติ"}`);
    res.json({ success: true, message: "ปฏิเสธแล้ว" });
  }
});

// ---- Dev เสนอไอเดียขึ้นมาเอง ----
app.post("/api/collab/dev-propose", async (req, res) => {
  const { topic } = req.body;
  try {
    const prompt = `คุณคือ Dev AI ที่ต้องการเสนอไอเดียการพัฒนาระบบ Trading Platform

หัวข้อที่ต้องการเสนอ: ${topic || "สิ่งที่น่าพัฒนาต่อ"}

เสนอไอเดีย 3 อย่างที่จะทำให้ระบบดีขึ้น ตอบ JSON:
{
  "proposals": [
    {
      "title": "ชื่อไอเดีย",
      "description": "รายละเอียด",
      "benefit": "ประโยชน์ที่จะได้",
      "effort": "ง่าย|กลาง|ยาก",
      "priority": "สูง|กลาง|ต่ำ"
    }
  ],
  "devMessage": "ข้อความจาก Dev ถึง User"
}`;

    const result = await callGroq(prompt);
    const clean = result.replace(/\`\`\`json|\`\`\`/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    const proposals = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (proposals) {
      // เพิ่มทุก proposal เข้า pending
      for (const p of proposals.proposals || []) {
        const proposalId = `dev-proposal-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
        pendingApprovals.push(createTask(
          proposalId, "dev", p.title, p.description, null, "PENDING_APPROVAL", "dev"
        ));
      }

      await sendTelegram(
        `💡 <b>Dev AI เสนอ ${proposals.proposals?.length || 0} ไอเดีย!</b>\n\n` +
        (proposals.proposals || []).map((p,i) =>
          `${i+1}. <b>${p.title}</b>\n   ${p.benefit}\n   ความยาก: ${p.effort} | Priority: ${p.priority}`
        ).join("\n\n") +
        `\n\n💬 ${proposals.devMessage}`
      );
    }

    res.json(proposals || { proposals: [], devMessage: result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- ดูสถานะทั้งหมด ----
app.get("/api/collab/status", (req, res) => {
  res.json({
    queue: taskQueue.slice(0, 10),
    pendingApprovals: pendingApprovals.slice(0, 10),
    completed: completedTasks.slice(0, 20),
    stats: {
      queued: taskQueue.length,
      pending: pendingApprovals.length,
      completed: completedTasks.length,
    }
  });
});

// ---- DEV MODE ROUTES ----
app.post("/api/dev/run", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "ไม่มีโค้ด" });
  try {
    // Safe eval — รัน JS async function
    const fn = new Function("fetch","STOCKS","ALL_STOCKS","priceCache","paperPortfolio","agentLogs","agentState","userAlerts",
      `return (async () => { ${code} })()`
    );
    const result = await fn(fetch, [], ALL_STOCKS, priceCache, paperPortfolio, agentLogs, agentState, userAlerts);
    res.json({ result: typeof result === "object" ? JSON.stringify(result, null, 2) : String(result) });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// ---- SECRETARY AI ROUTES ----
app.post("/api/secretary", async (req, res) => {
  const { message, context, history } = req.body;
  try {
    const systemPrompt = `คุณคือเลขา AI ผู้ช่วยส่วนตัวที่ฉลาดและมีประโยชน์มาก ตอบภาษาไทย กระชับ ตรงประเด็น

ข้อมูลของ User:
- พอร์ตหุ้น: ${context?.portfolio || "ไม่มีข้อมูล"}
- Todo ที่มี: ${context?.todos || "ไม่มี"}

ความสามารถของคุณ:
1. จด Todo และ Reminder (ถ้า user บอกให้จด ให้ใส่ action: "ADD_TODO" และ todo: "ข้อความ")
2. สรุปและวิเคราะห์ข้อมูลพอร์ต
3. ร่างแผนการลงทุนและวางแผนงาน
4. ตอบคำถามทั่วไปและให้คำแนะนำ
5. ค้นหาและสรุปข้อมูล

ถ้า user บอกให้จด Todo ให้ตอบ JSON:
{ "reply": "จดแล้วครับ: [ข้อความ]", "action": "ADD_TODO", "todo": "[ข้อความ]" }
ถ้าไม่ได้จด Todo ให้ตอบ JSON:
{ "reply": "ข้อความตอบ" }

ตอบเป็น JSON เสมอ ไม่มีข้อความอื่น`;

    const messages = [
      ...(history || []).slice(-6).map(h => ({ role: h.role, content: h.content })),
      { role: "user", content: message }
    ];

    const result = await callGroq(systemPrompt + "\n\nUser: " + message + "\n\nตอบเป็น JSON:");
    
    // Try to parse JSON response
    try {
      const clean = result.replace(/```json|```/g, "").trim();
      // Find JSON in response
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return res.json(parsed);
      }
    } catch {}
    
    // Fallback: plain text
    res.json({ reply: result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 AI: Groq Llama 3.3 70B`);
  console.log(`📱 Telegram: ${TELEGRAM_TOKEN ? "✅ Ready" : "❌ Not configured"}`);
  // Run first scan after 10 seconds
  setTimeout(runHourlyScan, 10000);
});
