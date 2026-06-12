import { useState, useEffect, useRef, useCallback } from "react";

// ---- CONFIG ----
// เปลี่ยนเป็น Railway URL หลัง deploy เช่น https://ai-trading.railway.app
const API_BASE = "https://your-railway-url.railway.app";
const FINNHUB_KEY = "d8lqbfhr01qnkjl867mgd8lqbfhr01qnkjl867n0";

// ---- STOCK UNIVERSE ----
const STOCKS = [
  // Space
  { symbol: "RKLB", name: "Rocket Lab", sector: "Space" },
  { symbol: "ASTS", name: "AST SpaceMobile", sector: "Space" },
  { symbol: "IRDM", name: "Iridium", sector: "Space" },
  { symbol: "PL", name: "Planet Labs", sector: "Space" },
  { symbol: "RDW", name: "Redwire", sector: "Space" },
  { symbol: "LMT", name: "Lockheed Martin", sector: "Space" },
  { symbol: "NOC", name: "Northrop Grumman", sector: "Defense" },
  { symbol: "BA", name: "Boeing", sector: "Aerospace" },
  // AI & Chip
  { symbol: "NVDA", name: "NVIDIA", sector: "AI/Chip" },
  { symbol: "AVGO", name: "Broadcom", sector: "AI/Chip" },
  { symbol: "AMD", name: "AMD", sector: "AI/Chip" },
  { symbol: "INTC", name: "Intel", sector: "Chip" },
  { symbol: "TSM", name: "TSMC", sector: "Chip" },
  { symbol: "PLTR", name: "Palantir", sector: "AI" },
  { symbol: "AI", name: "C3.ai", sector: "AI" },
  // Tech
  { symbol: "AAPL", name: "Apple", sector: "Tech" },
  { symbol: "MSFT", name: "Microsoft", sector: "Tech" },
  { symbol: "GOOGL", name: "Alphabet", sector: "Tech" },
  { symbol: "META", name: "Meta", sector: "Tech" },
  { symbol: "AMZN", name: "Amazon", sector: "Tech" },
  // Cloud
  { symbol: "SNOW", name: "Snowflake", sector: "Cloud" },
  { symbol: "CRM", name: "Salesforce", sector: "Cloud" },
  { symbol: "ORCL", name: "Oracle", sector: "Cloud" },
  // EV
  { symbol: "TSLA", name: "Tesla", sector: "EV" },
  { symbol: "RIVN", name: "Rivian", sector: "EV" },
  { symbol: "NIO", name: "NIO", sector: "EV" },
  // Finance & Crypto
  { symbol: "JPM", name: "JPMorgan", sector: "Finance" },
  { symbol: "BAC", name: "Bank of America", sector: "Finance" },
  { symbol: "GS", name: "Goldman Sachs", sector: "Finance" },
  { symbol: "COIN", name: "Coinbase", sector: "Crypto" },
  // ETFs
  { symbol: "SPY", name: "S&P 500 ETF", sector: "ETF" },
  { symbol: "QQQ", name: "Nasdaq ETF", sector: "ETF" },
  { symbol: "ARKK", name: "ARK Innovation", sector: "ETF" },
  { symbol: "JEPQ", name: "JPM Nasdaq Income", sector: "ETF" },
  { symbol: "SCHD", name: "Schwab Dividend", sector: "ETF" },
  { symbol: "QYLD", name: "Nasdaq Covered Call", sector: "ETF" },
];

const SECTORS = ["ทั้งหมด", "Space", "AI/Chip", "AI", "Tech", "Cloud", "EV", "Finance", "ETF", "Defense", "Crypto"];
const TABS = [
  { id: "market", label: "🌍 ตลาด" },
  { id: "chart", label: "📊 กราฟ" },
  { id: "ai", label: "🤖 AI" },
  { id: "news", label: "📰 ข่าว" },
  { id: "options", label: "🎯 Options" },
];

// ---- TRADINGVIEW ----
function TradingViewChart({ symbol }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true, symbol, interval: "D",
      timezone: "Asia/Bangkok", theme: "dark", style: "1",
      locale: "th_TH", toolbar_bg: "#0D1527",
      backgroundColor: "rgba(8,13,26,1)",
      gridColor: "rgba(255,255,255,0.05)",
      studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies", "BB@tv-basicstudies"],
      container_id: "tv_main",
    });
    const w = document.createElement("div");
    w.className = "tradingview-widget-container__widget";
    w.style.cssText = "height:100%;width:100%";
    ref.current.appendChild(w);
    ref.current.appendChild(script);
    return () => { if (ref.current) ref.current.innerHTML = ""; };
  }, [symbol]);
  return <div ref={ref} id="tv_main" style={{ height: "100%", width: "100%" }} />;
}

// ---- MAIN APP ----
export default function App() {
  const [tab, setTab] = useState("market");
  const [sector, setSector] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(STOCKS[0]);
  const [watchlist, setWatchlist] = useState(["RKLB", "AVGO", "ASTS", "NVDA", "JEPQ", "SCHD"]);
  const [prices, setPrices] = useState({});
  const [news, setNews] = useState([]);
  const [aiResult, setAiResult] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [autoScan, setAutoScan] = useState(false);
  const [notif, setNotif] = useState(null);
  const [backendOnline, setBackendOnline] = useState(false);
  // Options
  const [optType, setOptType] = useState("call");
  const [strike, setStrike] = useState(100);
  const [expiry, setExpiry] = useState("14");
  const [contracts, setContracts] = useState(1);
  const [simPrice, setSimPrice] = useState(100);
  const [optBal, setOptBal] = useState(1000);
  const [positions, setPositions] = useState([]);
  const autoRef = useRef(null);

  const showNotif = (msg, color = "#10B981") => {
    setNotif({ msg, color });
    setTimeout(() => setNotif(null), 2500);
  };

  // ---- CHECK BACKEND ----
  useEffect(() => {
    fetch(`${API_BASE}/`)
      .then(r => r.json())
      .then(() => setBackendOnline(true))
      .catch(() => setBackendOnline(false));
  }, []);

  // ---- FETCH PRICES FROM FINNHUB DIRECT ----
  const fetchPrices = useCallback(async (syms) => {
    const results = {};
    await Promise.all(syms.map(async (sym) => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`
        );
        const d = await res.json();
        if (d.c) results[sym] = {
          price: d.c, change: d.d, changePct: d.dp,
          high: d.h, low: d.l, open: d.o, prevClose: d.pc,
        };
      } catch {}
    }));
    return results;
  }, []);

  // ---- LOAD INITIAL PRICES ----
  useEffect(() => {
    const syms = STOCKS.map(s => s.symbol);
    fetchPrices(syms).then(data => {
      setPrices(data);
      const p = data[selected.symbol]?.price || 100;
      setSimPrice(p);
      setStrike(Math.round(p * 1.03));
    });
    // Refresh every 60s (Finnhub free tier limit)
    const interval = setInterval(() => {
      fetchPrices(syms).then(setPrices);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // ---- FETCH NEWS ----
  const fetchNews = async (symbol) => {
    setNewsLoading(true);
    setNews([]);
    try {
      const today = new Date().toISOString().split("T")[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${FINNHUB_KEY}`
      );
      const data = await res.json();
      setNews(Array.isArray(data) ? data.slice(0, 10) : []);
    } catch { setNews([]); }
    setNewsLoading(false);
  };

  // ---- AI ANALYZE via backend ----
  const handleAnalyze = async (stock = selected) => {
    setAiLoading(true);
    setTab("ai");
    setAiResult("");
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: stock.symbol, name: stock.name, sector: stock.sector }),
      });
      const d = await res.json();
      setAiResult(d.analysis || "ไม่สามารถวิเคราะห์ได้");
    } catch {
      setAiResult("⚠️ Backend ออฟไลน์ กรุณา deploy Railway ก่อน");
    }
    setAiLoading(false);
  };

  // ---- MARKET SCAN via backend ----
  const handleScan = async () => {
    setScanLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks: STOCKS.slice(0, 15) }),
      });
      const d = await res.json();
      setScanResult(d.scan || "ไม่สามารถสแกนได้");
      setLastScan(new Date().toLocaleTimeString("th-TH"));
    } catch {
      setScanResult("⚠️ Backend ออฟไลน์ กรุณา deploy Railway ก่อน");
    }
    setScanLoading(false);
  };

  // ---- AUTO SCAN 5 min ----
  useEffect(() => {
    if (autoScan) {
      handleScan();
      autoRef.current = setInterval(handleScan, 5 * 60 * 1000);
    } else clearInterval(autoRef.current);
    return () => clearInterval(autoRef.current);
  }, [autoScan]);

  // update options when stock changes
  useEffect(() => {
    const p = prices[selected.symbol]?.price || 100;
    setSimPrice(p);
    setStrike(Math.round(p * 1.03));
  }, [selected, prices]);

  const curPrice = prices[selected.symbol]?.price || 0;
  const curChange = prices[selected.symbol]?.changePct || 0;
  const premium = Math.max(1, Math.round(
    (optType === "call"
      ? Math.max(0, curPrice - strike) + curPrice * 0.03
      : Math.max(0, strike - curPrice) + curPrice * 0.03
    ) * 0.8 * 100) / 100);
  const totalCost = premium * contracts * 100;
  const pnl = (optType === "call"
    ? Math.max(0, simPrice - strike)
    : Math.max(0, strike - simPrice)) * contracts * 100 - totalCost;

  const filtered = STOCKS.filter(s =>
    (sector === "ทั้งหมด" || s.sector === sector) &&
    (s.symbol.toLowerCase().includes(search.toLowerCase()) ||
      s.name.toLowerCase().includes(search.toLowerCase()))
  );

  const toggleWL = (sym) => {
    if (watchlist.includes(sym)) {
      setWatchlist(watchlist.filter(s => s !== sym));
      showNotif(`ลบ ${sym} ออก Watchlist`, "#EF4444");
    } else {
      setWatchlist([...watchlist, sym]);
      showNotif(`เพิ่ม ${sym} เข้า Watchlist ⭐`, "#F59E0B");
    }
  };

  return (
    <div style={{
      minHeight: "100vh", maxWidth: 480, margin: "0 auto",
      background: "#080D1A", color: "#E2E8F0",
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {notif && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: notif.color, color: "#fff", padding: "10px 20px",
          borderRadius: 12, fontWeight: 700, zIndex: 9999, fontSize: 13,
          whiteSpace: "nowrap", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>{notif.msg}</div>
      )}

      {/* Header */}
      <div style={{
        padding: "14px 16px 10px",
        background: "#0D1527",
        borderBottom: "1px solid rgba(0,212,255,0.1)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>🚀</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>
                AI <span style={{ color: "#00D4FF" }}>Trade</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: backendOnline ? "#10B981" : "#EF4444",
                }} />
                <span style={{ fontSize: 9, color: "#475569" }}>
                  {backendOnline ? "Backend Online • Real Data" : "Backend Offline"}
                </span>
              </div>
            </div>
          </div>
          <div
            onClick={() => { setTab("chart"); }}
            style={{
              background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)",
              borderRadius: 10, padding: "6px 12px", cursor: "pointer",
            }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#00D4FF" }}>{selected.symbol}</div>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: curChange >= 0 ? "#10B981" : "#EF4444"
            }}>
              {curPrice > 0 ? `$${curPrice.toFixed(2)}` : "Loading..."}
              {curChange !== 0 && ` ${curChange >= 0 ? "▲" : "▼"}${Math.abs(curChange).toFixed(2)}%`}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", background: "#0D1527",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        position: "sticky", top: 66, zIndex: 40,
        overflowX: "auto",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, minWidth: 64, padding: "11px 4px",
            background: "transparent", border: "none",
            borderBottom: tab === t.id ? "2px solid #00D4FF" : "2px solid transparent",
            color: tab === t.id ? "#00D4FF" : "#475569",
            fontSize: 11, fontWeight: tab === t.id ? 700 : 400,
            cursor: "pointer", whiteSpace: "nowrap",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ====== MARKET ====== */}
      {tab === "market" && (
        <div style={{ padding: "12px 12px 80px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12, padding: "10px 14px",
          }}>
            <span style={{ color: "#475569" }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา เช่น NVDA, Tesla..."
              style={{ flex: 1, background: "transparent", border: "none", color: "#E2E8F0", fontSize: 14, outline: "none" }}
            />
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 4 }}>
            {SECTORS.map(s => (
              <button key={s} onClick={() => setSector(s)} style={{
                padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap",
                background: sector === s ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.04)",
                border: sector === s ? "1px solid #00D4FF" : "1px solid rgba(255,255,255,0.06)",
                color: sector === s ? "#00D4FF" : "#64748B",
                fontSize: 11, fontWeight: sector === s ? 700 : 400, cursor: "pointer",
              }}>{s}</button>
            ))}
          </div>

          {/* Watchlist */}
          {watchlist.length > 0 && sector === "ทั้งหมด" && !search && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "#475569", fontWeight: 600, letterSpacing: 0.5, marginBottom: 8 }}>⭐ WATCHLIST</div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                {watchlist.map(sym => {
                  const p = prices[sym];
                  return (
                    <div key={sym}
                      onClick={() => { const s = STOCKS.find(x => x.symbol === sym); if (s) { setSelected(s); setTab("chart"); } }}
                      style={{
                        minWidth: 85, background: "rgba(0,212,255,0.06)",
                        border: "1px solid rgba(0,212,255,0.15)",
                        borderRadius: 10, padding: "8px 10px", cursor: "pointer",
                      }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#00D4FF" }}>{sym}</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {p ? `$${p.price.toFixed(2)}` : "—"}
                      </div>
                      <div style={{
                        fontSize: 10, fontWeight: 600,
                        color: (p?.changePct || 0) >= 0 ? "#10B981" : "#EF4444"
                      }}>
                        {p ? `${p.changePct >= 0 ? "▲" : "▼"}${Math.abs(p.changePct).toFixed(2)}%` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ fontSize: 10, color: "#475569", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>
            {filtered.length} หุ้น • อัพเดทราคาทุก 60 วิ
          </div>

          {filtered.map(stock => {
            const p = prices[stock.symbol];
            const isSelected = selected.symbol === stock.symbol;
            return (
              <div key={stock.symbol}
                onClick={() => { setSelected(stock); setTab("chart"); }}
                style={{
                  display: "flex", alignItems: "center",
                  padding: "11px 12px", marginBottom: 5,
                  background: isSelected ? "rgba(0,212,255,0.06)" : "rgba(255,255,255,0.02)",
                  border: isSelected ? "1px solid rgba(0,212,255,0.2)" : "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 12, cursor: "pointer",
                }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: isSelected ? "#00D4FF" : "#E2E8F0" }}>
                      {stock.symbol}
                    </span>
                    <span style={{
                      fontSize: 9, padding: "1px 5px", borderRadius: 4,
                      background: "rgba(255,255,255,0.05)", color: "#64748B",
                    }}>{stock.sector}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>{stock.name}</div>
                </div>
                <div style={{ textAlign: "right", marginRight: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>
                    {p ? `$${p.price.toFixed(2)}` : <span style={{ color: "#475569", fontSize: 12 }}>loading</span>}
                  </div>
                  {p && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: p.changePct >= 0 ? "#10B981" : "#EF4444" }}>
                      {p.changePct >= 0 ? "▲" : "▼"}{Math.abs(p.changePct).toFixed(2)}%
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <button onClick={e => { e.stopPropagation(); toggleWL(stock.symbol); }} style={{
                    width: 28, height: 28, borderRadius: 7,
                    background: watchlist.includes(stock.symbol) ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.04)",
                    border: watchlist.includes(stock.symbol) ? "1px solid rgba(245,158,11,0.4)" : "1px solid rgba(255,255,255,0.06)",
                    color: watchlist.includes(stock.symbol) ? "#F59E0B" : "#475569",
                    fontSize: 12, cursor: "pointer",
                  }}>⭐</button>
                  <button onClick={e => { e.stopPropagation(); setSelected(stock); handleAnalyze(stock); }} style={{
                    width: 28, height: 28, borderRadius: 7,
                    background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)",
                    color: "#A855F7", fontSize: 11, cursor: "pointer",
                  }}>🤖</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ====== CHART ====== */}
      {tab === "chart" && (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)" }}>
          <div style={{
            padding: "10px 14px", background: "#0D1527",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 17, fontWeight: 800, color: "#00D4FF" }}>{selected.symbol}</span>
                <span style={{ fontSize: 11, color: "#475569", marginLeft: 6 }}>{selected.name}</span>
                <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 18, fontWeight: 800 }}>
                    {curPrice > 0 ? `$${curPrice.toFixed(2)}` : "—"}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, alignSelf: "center", color: curChange >= 0 ? "#10B981" : "#EF4444" }}>
                    {curChange >= 0 ? "▲" : "▼"}{Math.abs(curChange).toFixed(2)}%
                  </span>
                </div>
                {prices[selected.symbol] && (
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                    H: ${prices[selected.symbol].high?.toFixed(2)} •
                    L: ${prices[selected.symbol].low?.toFixed(2)} •
                    O: ${prices[selected.symbol].open?.toFixed(2)}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => toggleWL(selected.symbol)} style={{
                  padding: "7px 10px", borderRadius: 8,
                  background: watchlist.includes(selected.symbol) ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.04)",
                  border: watchlist.includes(selected.symbol) ? "1px solid rgba(245,158,11,0.4)" : "1px solid rgba(255,255,255,0.06)",
                  color: watchlist.includes(selected.symbol) ? "#F59E0B" : "#64748B",
                  fontSize: 12, cursor: "pointer",
                }}>⭐</button>
                <button onClick={() => handleAnalyze()} style={{
                  padding: "7px 10px", borderRadius: 8,
                  background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)",
                  color: "#A855F7", fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>🤖 AI</button>
                <button onClick={() => { fetchNews(selected.symbol); setTab("news"); }} style={{
                  padding: "7px 10px", borderRadius: 8,
                  background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)",
                  color: "#00D4FF", fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>📰 ข่าว</button>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <TradingViewChart symbol={selected.symbol} />
          </div>
          <div style={{
            padding: "8px 10px", background: "#0D1527",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            display: "flex", gap: 6, overflowX: "auto",
          }}>
            {["RKLB", "NVDA", "AAPL", "TSLA", "AVGO", "META", "PLTR", "COIN"].map(sym => {
              const s = STOCKS.find(x => x.symbol === sym);
              return (
                <button key={sym} onClick={() => s && setSelected(s)} style={{
                  padding: "6px 10px", borderRadius: 8, whiteSpace: "nowrap",
                  background: selected.symbol === sym ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.04)",
                  border: selected.symbol === sym ? "1px solid #00D4FF" : "1px solid rgba(255,255,255,0.06)",
                  color: selected.symbol === sym ? "#00D4FF" : "#64748B",
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>{sym}</button>
              );
            })}
          </div>
        </div>
      )}

      {/* ====== AI ====== */}
      {tab === "ai" && (
        <div style={{ padding: "12px 12px 80px" }}>
          {/* Status */}
          <div style={{
            background: autoScan ? "rgba(16,185,129,0.07)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${autoScan ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.07)"}`,
            borderRadius: 12, padding: "12px 14px", marginBottom: 12,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: autoScan ? "#10B981" : "#94A3B8" }}>
                {autoScan ? "🟢 AI Agent 24/7 ทำงานอยู่" : "⚫ AI Agent หยุดอยู่"}
              </div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                {lastScan ? `สแกนล่าสุด ${lastScan}` : "ยังไม่ได้สแกน"}
                {autoScan && " • สแกนทุก 5 นาที"}
                {" • "}{backendOnline ? "🟢 Backend Online" : "🔴 Backend Offline"}
              </div>
            </div>
            <button onClick={() => setAutoScan(!autoScan)} style={{
              padding: "8px 12px", borderRadius: 10,
              background: autoScan ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
              border: autoScan ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(16,185,129,0.3)",
              color: autoScan ? "#EF4444" : "#10B981",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>{autoScan ? "หยุด" : "เปิด Auto"}</button>
          </div>

          {/* Market Scan */}
          <button onClick={handleScan} disabled={scanLoading} style={{
            width: "100%", padding: 13, marginBottom: 10,
            background: scanLoading ? "rgba(100,116,139,0.15)" : "linear-gradient(135deg,#0f2744,#0a1a30)",
            border: "1px solid rgba(0,212,255,0.25)", borderRadius: 12,
            color: scanLoading ? "#64748B" : "#00D4FF",
            fontSize: 14, fontWeight: 700, cursor: scanLoading ? "not-allowed" : "pointer",
          }}>
            {scanLoading ? "⏳ กำลังสแกน 15 หุ้น..." : "🔍 สแกนตลาดทั้งหมด (Real Data)"}
          </button>

          {scanResult && (
            <div style={{
              background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.12)",
              borderRadius: 12, padding: 14, marginBottom: 12,
            }}>
              <div style={{ fontSize: 11, color: "#00D4FF", fontWeight: 700, marginBottom: 8 }}>
                📊 ผลสแกนตลาด {lastScan && `• ${lastScan}`}
              </div>
              <div style={{ fontSize: 13, color: "#CBD5E1", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
                {scanResult}
              </div>
            </div>
          )}

          {/* Single Stock */}
          <button onClick={() => handleAnalyze()} disabled={aiLoading} style={{
            width: "100%", padding: 13, marginBottom: 10,
            background: aiLoading ? "rgba(100,116,139,0.15)" : "linear-gradient(135deg,#1a0a3d,#0d0624)",
            border: "1px solid rgba(168,85,247,0.25)", borderRadius: 12,
            color: aiLoading ? "#64748B" : "#A855F7",
            fontSize: 14, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer",
          }}>
            {aiLoading ? `⏳ วิเคราะห์ ${selected.symbol}...` : `🔮 วิเคราะห์ ${selected.symbol} (ราคา+ข่าวจริง)`}
          </button>

          {aiResult && (
            <div style={{
              background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.12)",
              borderRadius: 12, padding: 14, marginBottom: 12,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "#A855F7", fontWeight: 700 }}>🤖 {selected.symbol}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{curPrice > 0 ? `$${curPrice.toFixed(2)}` : ""}</span>
              </div>
              <div style={{ fontSize: 13, color: "#CBD5E1", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
                {aiResult}
              </div>
            </div>
          )}

          <div style={{ fontSize: 10, color: "#475569", fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>⚡ วิเคราะห์ด่วน</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {["RKLB", "NVDA", "AAPL", "TSLA", "AVGO", "META", "PLTR"].map(sym => (
              <button key={sym} onClick={() => {
                const s = STOCKS.find(x => x.symbol === sym);
                if (s) { setSelected(s); handleAnalyze(s); }
              }} style={{
                padding: "8px 12px", borderRadius: 10,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                color: "#94A3B8", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>🤖 {sym}</button>
            ))}
          </div>
        </div>
      )}

      {/* ====== NEWS ====== */}
      {tab === "news" && (
        <div style={{ padding: "12px 12px 80px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>📰 ข่าว {selected.symbol}</div>
            <button onClick={() => fetchNews(selected.symbol)} style={{
              padding: "7px 12px", borderRadius: 8,
              background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)",
              color: "#00D4FF", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>🔄 โหลดใหม่</button>
          </div>

          {/* Quick stock news switcher */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 14, paddingBottom: 4 }}>
            {["RKLB", "NVDA", "AAPL", "TSLA", "AVGO", "META", "MSFT"].map(sym => (
              <button key={sym} onClick={() => {
                const s = STOCKS.find(x => x.symbol === sym);
                if (s) { setSelected(s); fetchNews(sym); }
              }} style={{
                padding: "6px 10px", borderRadius: 8, whiteSpace: "nowrap",
                background: selected.symbol === sym ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.04)",
                border: selected.symbol === sym ? "1px solid #00D4FF" : "1px solid rgba(255,255,255,0.06)",
                color: selected.symbol === sym ? "#00D4FF" : "#64748B",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>{sym}</button>
            ))}
          </div>

          {newsLoading && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#475569" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
              <div style={{ fontSize: 13 }}>กำลังโหลดข่าว...</div>
            </div>
          )}

          {!newsLoading && news.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#475569" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: 13 }}>กดโหลดข่าวก่อนเลย</div>
              <button onClick={() => fetchNews(selected.symbol)} style={{
                marginTop: 12, padding: "10px 20px", borderRadius: 10,
                background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.2)",
                color: "#00D4FF", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>โหลดข่าว {selected.symbol}</button>
            </div>
          )}

          {news.map((item, i) => (
            <div key={i} style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12, padding: 14, marginBottom: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0", lineHeight: 1.5, marginBottom: 6 }}>
                {item.headline}
              </div>
              {item.summary && (
                <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.6, marginBottom: 6 }}>
                  {item.summary.slice(0, 150)}{item.summary.length > 150 ? "..." : ""}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#475569" }}>
                  {item.source} • {new Date(item.datetime * 1000).toLocaleDateString("th-TH")}
                </span>
                <a href={item.url} target="_blank" rel="noreferrer" style={{
                  fontSize: 11, color: "#00D4FF", textDecoration: "none",
                  padding: "4px 8px", borderRadius: 6,
                  background: "rgba(0,212,255,0.08)",
                }}>อ่านเพิ่ม →</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ====== OPTIONS ====== */}
      {tab === "options" && (
        <div style={{ padding: "12px 12px 80px" }}>
          <div style={{
            background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.15)",
            borderRadius: 12, padding: "10px 14px", marginBottom: 12,
            display: "flex", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 10, color: "#475569" }}>เงินจำลอง</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#00D4FF" }}>
                ${optBal.toLocaleString("en", { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#475569" }}>Positions</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{positions.length}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {["call", "put"].map(t => (
              <button key={t} onClick={() => setOptType(t)} style={{
                padding: 12,
                background: optType === t ? (t === "call" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)") : "rgba(255,255,255,0.03)",
                border: `1.5px solid ${optType === t ? (t === "call" ? "#10B981" : "#EF4444") : "rgba(255,255,255,0.07)"}`,
                borderRadius: 12, cursor: "pointer",
                color: optType === t ? (t === "call" ? "#10B981" : "#EF4444") : "#64748B",
                fontSize: 14, fontWeight: 700,
              }}>
                {t === "call" ? "📈 CALL" : "📉 PUT"}
                <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2 }}>{t === "call" ? "เดาขึ้น" : "เดาลง"}</div>
              </button>
            ))}
          </div>

          {/* Stock picker */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#475569", marginBottom: 6, fontWeight: 600 }}>หุ้น</div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
              {["RKLB", "NVDA", "AAPL", "TSLA", "AVGO", "META"].map(sym => {
                const p = prices[sym]?.price;
                const s = STOCKS.find(x => x.symbol === sym);
                return (
                  <button key={sym} onClick={() => s && setSelected(s)} style={{
                    padding: "7px 10px", borderRadius: 9, whiteSpace: "nowrap",
                    background: selected.symbol === sym ? "rgba(0,212,255,0.1)" : "rgba(255,255,255,0.04)",
                    border: selected.symbol === sym ? "1px solid #00D4FF" : "1px solid rgba(255,255,255,0.06)",
                    color: selected.symbol === sym ? "#00D4FF" : "#64748B",
                    fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}>
                    {sym}<br />
                    <span style={{ fontSize: 10, fontWeight: 400 }}>{p ? `$${p.toFixed(0)}` : "—"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Strike */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>Strike Price</span>
              <span style={{ fontSize: 13, color: "#00D4FF", fontWeight: 700 }}>${strike}</span>
            </div>
            <input type="range" min={Math.round(curPrice * 0.85)} max={Math.round(curPrice * 1.2)}
              value={strike} onChange={e => setStrike(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#00D4FF" }} />
            <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>
              ราคาปัจจุบัน: ${curPrice.toFixed(2)}
            </div>
          </div>

          {/* Expiry + Contracts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 5, fontWeight: 600 }}>หมดอายุ</div>
              <div style={{ display: "flex", gap: 4 }}>
                {["7", "14", "30"].map(d => (
                  <button key={d} onClick={() => setExpiry(d)} style={{
                    flex: 1, padding: "8px 2px",
                    background: expiry === d ? "rgba(0,212,255,0.1)" : "rgba(255,255,255,0.04)",
                    border: expiry === d ? "1px solid #00D4FF" : "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 8, color: expiry === d ? "#00D4FF" : "#64748B",
                    fontSize: 11, cursor: "pointer",
                  }}>{d}D</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 5, fontWeight: 600 }}>Contracts</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setContracts(Math.max(1, contracts - 1))} style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
                  color: "#fff", fontSize: 16, cursor: "pointer",
                }}>-</button>
                <span style={{ flex: 1, textAlign: "center", fontSize: 18, fontWeight: 800, color: "#00D4FF" }}>{contracts}</span>
                <button onClick={() => setContracts(contracts + 1)} style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
                  color: "#fff", fontSize: 16, cursor: "pointer",
                }}>+</button>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12, padding: 12, marginBottom: 10,
          }}>
            {[["Premium/หุ้น", `$${premium}`, "#00D4FF"], ["ต้นทุนรวม", `$${totalCost.toFixed(2)}`, "#F59E0B"]].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: "#64748B" }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Simulator */}
          <div style={{
            background: "rgba(0,212,255,0.03)", border: "1px solid rgba(0,212,255,0.1)",
            borderRadius: 12, padding: 12, marginBottom: 12,
          }}>
            <div style={{ fontSize: 10, color: "#475569", fontWeight: 600, marginBottom: 6 }}>🎮 จำลองราคา</div>
            <input type="range" min={Math.round(curPrice * 0.7)} max={Math.round(curPrice * 1.5)}
              value={simPrice} onChange={e => setSimPrice(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#00D4FF", marginBottom: 8 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#64748B" }}>ราคา: ${simPrice}</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: pnl >= 0 ? "#10B981" : "#EF4444" }}>
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
              </span>
            </div>
          </div>

          <button onClick={() => {
            if (totalCost > optBal) { showNotif("❌ เงินไม่พอ!", "#EF4444"); return; }
            setPositions([...positions, {
              id: Date.now(), stock: selected.symbol, type: optType,
              strike, premium, contracts, totalCost,
            }]);
            setOptBal(b => Math.round((b - totalCost) * 100) / 100);
            showNotif(`✅ ซื้อ ${optType.toUpperCase()} ${selected.symbol}`);
          }} disabled={totalCost > optBal} style={{
            width: "100%", padding: 14, borderRadius: 12, border: "none",
            background: totalCost > optBal ? "rgba(100,116,139,0.2)"
              : optType === "call" ? "linear-gradient(135deg,#10B981,#059669)"
              : "linear-gradient(135deg,#EF4444,#DC2626)",
            color: "#fff", fontSize: 15, fontWeight: 800, marginBottom: 12,
            cursor: totalCost > optBal ? "not-allowed" : "pointer",
          }}>
            {totalCost > optBal ? "💸 เงินไม่พอ" : `ซื้อ ${optType.toUpperCase()} — $${totalCost.toFixed(2)}`}
          </button>

          {positions.map(pos => {
            const posPnL = (pos.type === "call"
              ? Math.max(0, simPrice - pos.strike)
              : Math.max(0, pos.strike - simPrice)) * pos.contracts * 100 - pos.totalCost;
            return (
              <div key={pos.id} style={{
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${posPnL >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                borderRadius: 12, padding: 12, marginBottom: 8,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#00D4FF" }}>{pos.stock}</span>
                  <span style={{
                    marginLeft: 6, fontSize: 10, padding: "2px 5px", borderRadius: 4,
                    background: pos.type === "call" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                    color: pos.type === "call" ? "#10B981" : "#EF4444",
                  }}>{pos.type.toUpperCase()}</span>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                    Strike ${pos.strike} • {pos.contracts}x
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: posPnL >= 0 ? "#10B981" : "#EF4444" }}>
                    {posPnL >= 0 ? "+" : ""}${posPnL.toFixed(2)}
                  </div>
                  <button onClick={() => {
                    setOptBal(b => Math.round((b + Math.max(0, pos.totalCost + posPnL)) * 100) / 100);
                    setPositions(positions.filter(p => p.id !== pos.id));
                    showNotif(posPnL >= 0 ? `🎉 กำไร +$${posPnL.toFixed(2)}` : `📉 -$${Math.abs(posPnL).toFixed(2)}`,
                      posPnL >= 0 ? "#10B981" : "#EF4444");
                  }} style={{
                    marginTop: 4, padding: "3px 8px",
                    background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
                    borderRadius: 6, color: "#EF4444", fontSize: 10, cursor: "pointer",
                  }}>ปิด</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`* { box-sizing: border-box; } ::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
