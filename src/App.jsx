import { useState, useCallback, useEffect, useRef } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts";
import * as XLSX from "xlsx";
import * as math from "mathjs";

const API_KEY    = ""; // clave en variable de entorno Vercel FMP_API_KEY
const BASE       = "/api/fmp"; // proxy serverless Vercel
const CACHE_KEY  = "sp500_screener_fund_v2";
const CACHE_DAYS = 15;

const SECTOR_COLORS = {
  "Technology":"#38bdf8","Healthcare":"#34d399","Financials":"#fbbf24",
  "Consumer Discretionary":"#f97316","Communication Services":"#a78bfa",
  "Industrials":"#60a5fa","Consumer Staples":"#86efac","Energy":"#fb923c",
  "Utilities":"#c4b5fd","Real Estate":"#fdba74","Materials":"#4ade80",
};
const SECTOR_ICONS = {
  "Technology":"💻","Healthcare":"⚕️","Financials":"🏦",
  "Consumer Discretionary":"🛍️","Communication Services":"📡",
  "Industrials":"⚙️","Consumer Staples":"🛒","Energy":"⚡",
  "Utilities":"💡","Real Estate":"🏢","Materials":"⛏️",
};
const PORT_STYLES = {
  minVar:{ color:"#60a5fa", label:"Mínima Varianza" },
  maxShp:{ color:"#fbbf24", label:"Máximo Sharpe"   },
  rp:    { color:"#a78bfa", label:"Risk Parity"      },
  ew:    { color:"#94a3b8", label:"Equal Weight"     },
  spy:   { color:"#f87171", label:"SPY Benchmark"    },
};

// Tickers del S&P 500 que tienen CEDEAR habilitado en BYMA (fuente: BYMA 30/09/2025)
const CEDEAR_TICKERS = new Set([
  // Tecnología
  "AAPL","MSFT","NVDA","AMD","AVGO","INTC","QCOM","AMAT","LRCX","MU",
  "ADBE","CRM","ORCL","IBM","CSCO","TXN","ADI","MRVL","EA","PANW","NOW","SNOW",
  // Salud
  "JNJ","PFE","MRK","ABBV","AMGN","GILD","LLY","MDT","ABT","DHR",
  "ISRG","BMY","CVS","BIIB",
  // Financials
  "JPM","C","AXP","SCHW","MA","SPGI","AIG","BRKB","MMC","EFX","ADP","COF",
  // Consumer Discretionary
  "AMZN","TSLA","MCD","SBUX","NKE","TGT","ETSY","BKNG","ABNB","GM","F",
  // Consumer Staples
  "PG","MO","PM","CL","KMB","COST","MDLZ","PEP","SYY","KO",
  // Energía
  "XOM","CVX","OXY","HAL","SLB","BKR","PSX",
  // Industriales
  "CAT","DE","HON","LMT","RTX","MMM","GE","FDX","DAL","AAL","HOG",
  "DOW","DD","IP","NUE","MSI","HWM","PCAR",
  // Comunicaciones
  "META","GOOGL","NFLX","SNAP","PINS",
  // Materiales
  "FCX","NEM","NUE","DOW","DD","IP","IFF",
  // Otros S&P con CEDEAR
  "PYPL","EBAY","COIN","PLTR","DOCU","ROKU","CDE","RIOT",
  "V","BAC","WFC","GS","MS","BLK","SPGI",
  "UNH","ELV","HUM","CI","CNC",
  "AMT","PLD","CCI","EQIX",
  "NEE","DUK","SO","D",
  "ACN","ORCL","INFY","SAP",
]);

const delay  = (ms) => new Promise(r => setTimeout(r, ms));
const chunk  = (arr, n) => { const o=[]; for(let i=0;i<arr.length;i+=n) o.push(arr.slice(i,i+n)); return o; };
const fmtP   = v => v==null ? "—" : `$${Number(v).toFixed(2)}`;
const fmtCap = v => { if(!v||v<=0) return"—"; if(v>=1e12) return`$${(v/1e12).toFixed(2)}T`; if(v>=1e9) return`$${(v/1e9).toFixed(1)}B`; return`$${(v/1e6).toFixed(0)}M`; };
const fmtPct = (v,d=1) => v==null||!isFinite(v) ? "—" : `${Number(v).toFixed(d)}%`;

const FUND_METRICS = [
  { key:"pe",        label:"P/E",       hb:false, w:0.20, tip:"Price/Earnings"   },
  { key:"pb",        label:"P/B",       hb:false, w:0.15, tip:"Price/Book"       },
  { key:"roe",       label:"ROE %",     hb:true,  w:0.22, tip:"Return on Equity" },
  { key:"de",        label:"D/E",       hb:false, w:0.13, tip:"Debt/Equity"      },
  { key:"evEbitda",  label:"EV/EBITDA", hb:false, w:0.15, tip:"EV/EBITDA"        },
  { key:"netMargin", label:"Margen %",  hb:true,  w:0.15, tip:"Margen Neto"      },
];

// ── Cache helpers (localStorage — funciona en browser estándar y Vercel) ──────
const HIST_CACHE_KEY    = "sp500_hist_prices_v1";
const HIST_CACHE_DAYS   = 7;
const CLIENT_CACHE_DAYS = 7;

function lsGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function lsDel(key) {
  try { localStorage.removeItem(key); } catch {}
}

// Fundamentals cache (Fase 1 — SP500)
function cacheLoad() {
  const d = lsGet(CACHE_KEY);
  if (!d) return null;
  const ageDays = (Date.now() - d.timestamp) / 86400000;
  if (ageDays > CACHE_DAYS) return null;
  return { ...d, ageDays: ageDays.toFixed(1), daysLeft: (CACHE_DAYS - ageDays).toFixed(1) };
}
function cacheSave(fundData, spy) {
  lsSet(CACHE_KEY, { fundData, spy, timestamp: Date.now() });
}
function cacheClear() {
  lsDel(CACHE_KEY);
}

// Historical prices cache — compartido por Fases 2, 3 y 4 (7 días)
function histCacheLoad(fromRequired) {
  const d = lsGet(HIST_CACHE_KEY);
  if (!d) return null;
  const ageDays = (Date.now() - d.timestamp) / 86400000;
  if (ageDays > HIST_CACHE_DAYS) return null;
  // Válido si el from cacheado cubre el período pedido
  if (d.from > fromRequired) return null;
  return d;
}
function histCacheSave(hist, spyPrices, from) {
  lsSet(HIST_CACHE_KEY, { hist, spyPrices, from, timestamp: Date.now() });
}
function histCacheClear() {
  lsDel(HIST_CACHE_KEY);
}

// Client cache (Fase 5)
function clientCacheKey(name) {
  const safe = (name||"anon").replace(/[^a-zA-Z0-9]/g,"_").toLowerCase();
  return `sp500_client_${safe}_v1`;
}
function clientCacheLoad(name) {
  const d = lsGet(clientCacheKey(name));
  if (!d) return null;
  const ageDays = (Date.now() - d.timestamp) / 86400000;
  if (ageDays > CLIENT_CACHE_DAYS) return null;
  return { ...d, ageDays: ageDays.toFixed(1), daysLeft: (CLIENT_CACHE_DAYS - ageDays).toFixed(1) };
}
function clientCacheSave(name, fundData, spy) {
  lsSet(clientCacheKey(name), { fundData, spy, timestamp: Date.now() });
}

// ── Math: risk metrics ────────────────────────────────────────────────────────
function toDailyRet(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++)
    if (prices[i-1].close > 0)
      out.push({ date: prices[i].date, r: (prices[i].close - prices[i-1].close) / prices[i-1].close });
  return out;
}
function buildSpyMap(spyPrices) {
  const m = {}; toDailyRet(spyPrices).forEach(r => { m[r.date] = r.r; }); return m;
}
function alignedRet(prices, spyMap) {
  return toDailyRet(prices).filter(r => spyMap[r.date] != null).map(r => ({ s: r.r, m: spyMap[r.date] }));
}
function calcRisk(al, rf) {
  const n = al.length; if (n < 30) return null;
  const rfD = rf/252, s = al.map(a=>a.s), m = al.map(a=>a.m);
  const annRet = (Math.pow(s.reduce((a,r)=>a*(1+r),1), 252/n) - 1) * 100;
  const mAnn   = (Math.pow(m.reduce((a,r)=>a*(1+r),1), 252/n) - 1) * 100;
  const sm = s.reduce((a,b)=>a+b,0)/n;
  const sVol = Math.sqrt(s.reduce((a,r)=>a+Math.pow(r-sm,2),0)/(n-1)*252)*100;
  const sharpe = sVol > 0 ? (annRet/100-rf)/(sVol/100) : null;
  const mm = m.reduce((a,b)=>a+b,0)/n;
  const cov = s.reduce((a,r,i)=>a+(r-sm)*(m[i]-mm),0)/(n-1);
  const mv  = m.reduce((a,r)=>a+Math.pow(r-mm,2),0)/(n-1);
  const beta  = mv > 0 ? cov/mv : null;
  const alpha = beta != null ? annRet - (rf*100 + beta*(mAnn-rf*100)) : null;
  const dn = s.filter(r=>r<rfD);
  const dd = dn.length > 1 ? Math.sqrt(dn.reduce((a,r)=>a+Math.pow(r-rfD,2),0)/n*252)*100 : null;
  const sortino = dd && dd > 0 ? (annRet/100-rf)/(dd/100) : null;
  let pk=1, mxDD=0, cu=1;
  for (const r of s) { cu*=1+r; if(cu>pk) pk=cu; const d=(pk-cu)/pk; if(d>mxDD) mxDD=d; }
  return { annRet, sVol, sharpe, beta, alpha, sortino, maxDD: mxDD*100 };
}

// ── Math: correlation + portfolio optimization ────────────────────────────────
function buildCovAndCorr(retArrays) {
  const n = retArrays.length, T = retArrays[0].length;
  const means = retArrays.map(r => r.reduce((a,b)=>a+b,0)/T);
  const cov = Array.from({length:n}, ()=> new Array(n).fill(0));
  for (let i=0; i<n; i++) for (let j=i; j<n; j++) {
    let c = 0;
    for (let t=0; t<T; t++) c += (retArrays[i][t]-means[i])*(retArrays[j][t]-means[j]);
    cov[i][j] = cov[j][i] = c/(T-1);
  }
  const corr = Array.from({length:n}, ()=> new Array(n).fill(0));
  for (let i=0; i<n; i++) for (let j=0; j<n; j++) {
    const si = Math.sqrt(Math.max(cov[i][i], 1e-12));
    const sj = Math.sqrt(Math.max(cov[j][j], 1e-12));
    corr[i][j] = cov[i][j] / (si * sj);
  }
  return { cov, corr };
}
function portStats(w, annRets, cov, rf) {
  const ret = w.reduce((a,wi,i)=>a+wi*annRets[i], 0);
  let dv = 0;
  for (let i=0; i<w.length; i++) for (let j=0; j<w.length; j++) dv += w[i]*w[j]*cov[i][j];
  const vol = Math.sqrt(Math.max(dv,0)*252)*100;
  const retP = ret*100;
  return { ret: retP, vol, sharpe: vol>0 ? (retP/100-rf)/(vol/100) : 0 };
}
function constrainedWeights(n, minW=0.01, maxW=0.20) {
  // Generate random weights respecting min/max bounds
  let w = Array.from({length:n}, ()=> -Math.log(Math.random()+1e-10));
  let s = w.reduce((a,b)=>a+b,0);
  w = w.map(x=>x/s);
  // Iterative projection onto constraints
  for (let iter=0; iter<20; iter++) {
    w = w.map(x=>Math.min(Math.max(x, minW), maxW));
    s = w.reduce((a,b)=>a+b,0);
    w = w.map(x=>x/s);
  }
  return w;
}
function runMonteCarlo(annRets, cov, rf, nSims=4000, minW=0.01, maxW=0.20) {
  const n = annRets.length;
  return Array.from({length:nSims}, ()=> {
    const w = constrainedWeights(n, minW, maxW);
    return { ...portStats(w, annRets, cov, rf), weights: w };
  });
}
function riskParityW(cov) {
  const n = cov.length;
  const invV = cov.map((row,i)=>1/Math.sqrt(Math.max(row[i],1e-10)));
  const s = invV.reduce((a,b)=>a+b,0);
  return invV.map(v=>v/s);
}
// Correlation color: red (high) → dark (zero) → blue (negative)
function corrColor(r) {
  const clamped = Math.max(-1, Math.min(1, r));
  if (clamped >= 0) {
    const t = clamped;
    const R = Math.round(20  + t*220);
    const G = Math.round(15  + t*30 * (1-t));
    const B = Math.round(15  + t*20 * (1-t));
    return `rgb(${R},${G},${B})`;
  } else {
    const t = -clamped;
    const R = Math.round(20  + t*20 * (1-t));
    const G = Math.round(15  + t*30 * (1-t));
    const B = Math.round(20  + t*180);
    return `rgb(${R},${G},${B})`;
  }
}

// ── Small UI components ───────────────────────────────────────────────────────
function ScoreBar({score}) {
  const c = score>=70?"#34d399":score>=45?"#fbbf24":"#f87171";
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <div style={{flex:1,height:5,background:"#1e293b",borderRadius:3,overflow:"hidden"}}>
        <div style={{width:`${score}%`,height:"100%",background:c,borderRadius:3}}/>
      </div>
      <span style={{fontSize:11,fontWeight:700,color:c,minWidth:26,fontFamily:"monospace"}}>{score.toFixed(0)}</span>
    </div>
  );
}
function CN({v, pg=true, suf="", d=2}) {
  if (v==null||!isFinite(v)) return <span style={{color:"#1e293b"}}>—</span>;
  const good = pg ? v>=0 : v<=0;
  const color = Math.abs(v)<0.001?"#64748b":good?"#34d399":"#f87171";
  return <span style={{color,fontFamily:"monospace"}}>{pg&&v>0?"+":""}{v.toFixed(d)}{suf}</span>;
}
function Stack({cpV,lpV,cpL,lpL,render}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <span style={{fontSize:8,color:"#4a90c4",fontFamily:"monospace",background:"#0c1e30",borderRadius:3,padding:"1px 4px"}}>{cpL}</span>
        {render(cpV)}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <span style={{fontSize:8,color:"#2d5a8a",fontFamily:"monospace",background:"#060e1a",borderRadius:3,padding:"1px 4px"}}>{lpL}</span>
        {render(lpV)}
      </div>
    </div>
  );
}
function NInput({label,value,onChange,min,max,step=1,unit=""}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      <span style={{fontSize:9,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:1}}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <input type="number" value={value} onChange={e=>onChange(parseFloat(e.target.value)||value)}
          min={min} max={max} step={step}
          style={{width:52,background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"5px 8px",color:"#e2e8f0",fontSize:13,fontFamily:"monospace",textAlign:"right",outline:"none"}}/>
        {unit&&<span style={{fontSize:10,color:"#475569"}}>{unit}</span>}
      </div>
    </div>
  );
}
function CacheBadge({info, onRefresh}) {
  if (!info) return null;
  const urgent = parseFloat(info.daysLeft) < 3;
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,background:"#0c1a0c",border:`1px solid ${urgent?"#f97316":"#166534"}`,borderRadius:8,padding:"6px 12px"}}>
      <div>
        <div style={{fontSize:9,color:urgent?"#fb923c":"#4ade80",fontFamily:"monospace",fontWeight:700}}>
          {urgent?"⚠️ Actualización próxima":"✅ Datos en caché"}
        </div>
        <div style={{fontSize:9,color:"#64748b",fontFamily:"monospace"}}>
          Actualizado hace {info.ageDays} días · Expira en {info.daysLeft} días
        </div>
      </div>
      <button onClick={onRefresh} style={{background:"transparent",border:"1px solid #334155",borderRadius:6,padding:"3px 8px",color:"#64748b",fontSize:9,cursor:"pointer",fontFamily:"monospace"}}>
        ↺ Forzar
      </button>
    </div>
  );
}

// ── Screens ───────────────────────────────────────────────────────────────────
function StartScreen({onStart, onStartClient, cacheInfo, onLoadCache, clientTickers, setClientTickers, clientName, setClientName, cedearFilter, setCedearFilter}) {
  const [mode,    setMode]    = useState("sp500"); // "sp500" | "client"
  const [dragging,setDragging]= useState(false);
  const [parseErr,setParseErr]= useState(null);
  const fileInputRef = useRef(null);

  async function handleFile(file) {
    setParseErr(null);
    if (!file) return;
    try {
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf);
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1});
      const set  = new Set();
      for (const row of rows)
        for (const cell of row)
          if (typeof cell === "string") {
            const t = cell.trim().toUpperCase();
            if (/^[A-Z]{1,5}$/.test(t)) set.add(t);
          }
      const tickers = [...set].slice(0, 100);
      if (!tickers.length) { setParseErr("No se detectaron tickers. Asegurate de que el archivo tenga símbolos bursátiles (ej: AAPL, MSFT)."); return; }
      setClientTickers(tickers);
    } catch { setParseErr("Error al leer el archivo. Usá formato .xlsx o .csv"); }
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const canRunClient = clientTickers.length > 0;

  return (
    <div style={{minHeight:"100vh",background:"#020817",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40,gap:22,fontFamily:"Georgia,serif"}}>
      <div style={{textAlign:"center",maxWidth:560}}>
        <div style={{fontSize:10,letterSpacing:6,color:"#64748b",marginBottom:14,fontFamily:"monospace",textTransform:"uppercase"}}>Financial Intelligence System</div>
        <h1 style={{fontSize:40,fontWeight:400,color:"#f1f5f9",margin:"0 0 10px",lineHeight:1.1}}>
          Portfolio Analyzer
        </h1>
        <p style={{fontSize:13,color:"#94a3b8",lineHeight:1.7,margin:0}}>
          Screening fundamental · Riesgo/Retorno · Correlación · Optimización Markowitz
        </p>
      </div>

      {/* Mode selector */}
      <div style={{display:"flex",gap:10,maxWidth:500,width:"100%"}}>
        {[
          {id:"sp500",  icon:"🏛️", label:"S&P 500",       sub:"Analizar el índice completo"},
          {id:"client", icon:"📁", label:"Cartera Propia", sub:"Subir Excel con tickers"},
        ].map(m=>(
          <div key={m.id} onClick={()=>setMode(m.id)} style={{flex:1,background:mode===m.id?"#0c1a2e":"#0f172a",border:`2px solid ${mode===m.id?"#38bdf8":"#1e293b"}`,borderRadius:12,padding:"14px 16px",cursor:"pointer",transition:"all 0.15s"}}>
            <div style={{fontSize:22,marginBottom:6}}>{m.icon}</div>
            <div style={{fontSize:13,fontWeight:700,color:mode===m.id?"#38bdf8":"#e2e8f0",fontFamily:"monospace"}}>{m.label}</div>
            <div style={{fontSize:10,color:"#475569",marginTop:3}}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* S&P 500 mode */}
      {mode==="sp500" && (
        <div style={{maxWidth:500,width:"100%",display:"flex",flexDirection:"column",gap:12}}>

          {/* Universe filter toggle */}
          <div style={{background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,padding:"14px 16px"}}>
            <div style={{fontSize:10,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:2,marginBottom:10}}>
              Universo de análisis
            </div>
            <div style={{display:"flex",gap:8}}>
              {[
                {id:"all",    icon:"🌐", label:"S&P 500 completo",       sub:`~503 empresas`},
                {id:"cedear", icon:"🇦🇷", label:"Solo con CEDEAR en BYMA", sub:`~${CEDEAR_TICKERS.size} empresas`},
              ].map(opt=>(
                <div key={opt.id} onClick={()=>setCedearFilter(opt.id)} style={{flex:1,background:cedearFilter===opt.id?"#0c1a2e":"#06101e",border:`2px solid ${cedearFilter===opt.id?"#38bdf8":"#1e293b"}`,borderRadius:10,padding:"12px 14px",cursor:"pointer",transition:"all 0.15s"}}>
                  <div style={{fontSize:18,marginBottom:4}}>{opt.icon}</div>
                  <div style={{fontSize:11,fontWeight:700,color:cedearFilter===opt.id?"#38bdf8":"#94a3b8",fontFamily:"monospace"}}>{opt.label}</div>
                  <div style={{fontSize:10,color:"#334155",marginTop:3}}>{opt.sub}</div>
                </div>
              ))}
            </div>
            {cedearFilter==="cedear"&&(
              <div style={{marginTop:10,fontSize:10,color:"#64748b",fontFamily:"monospace",lineHeight:1.6,padding:"8px 10px",background:"#060e1a",borderRadius:8}}>
                🇦🇷 Filtra el S&P 500 para mostrar solo empresas operables como CEDEAR desde Argentina. Útil para construir carteras invertibles directamente desde BYMA sin necesidad de cuenta en el exterior.
              </div>
            )}
          </div>
          {cacheInfo ? (
            <div style={{background:"#0c1a0c",border:"1px solid #166534",borderRadius:12,padding:"14px 16px"}}>
              <div style={{fontSize:11,color:"#4ade80",fontFamily:"monospace",fontWeight:700,marginBottom:6}}>
                ✅ Datos S&P 500 en caché — {cacheInfo.ageDays} días de antigüedad
              </div>
              <div style={{fontSize:10,color:"#86efac",fontFamily:"monospace",marginBottom:12,lineHeight:1.6}}>
                Expiran en {cacheInfo.daysLeft} días · Fundamentales: {CACHE_DAYS}d · Histórico Fases 2-4: {HIST_CACHE_DAYS}d · Cliente: {CLIENT_CACHE_DAYS}d
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={onLoadCache} style={{flex:1,background:"linear-gradient(135deg,#166534,#15803d)",border:"none",borderRadius:8,padding:"10px",color:"white",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"monospace"}}>
                  ⚡ Cargar desde caché
                </button>
                <button onClick={onStart} style={{flex:1,background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px",color:"#94a3b8",fontSize:12,cursor:"pointer",fontFamily:"monospace"}}>
                  ↺ Actualizar
                </button>
              </div>
            </div>
          ) : (
            <button onClick={onStart} style={{background:"linear-gradient(135deg,#0ea5e9,#2563eb)",border:"none",borderRadius:10,padding:"16px",color:"white",fontSize:15,fontWeight:700,cursor:"pointer",letterSpacing:1,fontFamily:"monospace",textTransform:"uppercase",boxShadow:"0 0 30px rgba(56,189,248,0.3)"}}>
              Analizar S&P 500
            </button>
          )}
        </div>
      )}

      {/* Client portfolio mode */}
      {mode==="client" && (
        <div style={{maxWidth:500,width:"100%",display:"flex",flexDirection:"column",gap:10}}>

          {/* Client name input */}
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <span style={{fontSize:10,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:1}}>Nombre del cliente (opcional)</span>
            <input
              type="text"
              value={clientName}
              onChange={e=>setClientName(e.target.value)}
              placeholder="Ej: Juan García"
              style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 14px",color:"#e2e8f0",fontSize:13,fontFamily:"monospace",outline:"none"}}
            />
          </div>

          {/* Drop zone */}
          <div
            onDragEnter={e=>{e.preventDefault();setDragging(true);}}
            onDragOver={e=>{e.preventDefault();setDragging(true);}}
            onDragLeave={()=>setDragging(false)}
            onDrop={onDrop}
            onClick={()=>fileInputRef.current?.click()}
            style={{background:dragging?"#0c1a2e":"#0a1020",border:`2px dashed ${dragging?"#38bdf8":clientTickers.length?"#166534":"#1e293b"}`,borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",transition:"all 0.15s"}}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e=>handleFile(e.target.files?.[0])}/>
            {clientTickers.length === 0 ? (
              <>
                <div style={{fontSize:28,marginBottom:8}}>📂</div>
                <div style={{fontSize:12,color:"#64748b",fontFamily:"monospace"}}>Arrastrá tu Excel acá o hacé clic para buscar</div>
                <div style={{fontSize:10,color:"#334155",marginTop:6,fontFamily:"monospace"}}>Formatos: .xlsx · .xls · .csv · Máx 100 tickers</div>
              </>
            ) : (
              <>
                <div style={{fontSize:24,marginBottom:6}}>✅</div>
                <div style={{fontSize:13,color:"#4ade80",fontFamily:"monospace",fontWeight:700}}>{clientTickers.length} tickers detectados</div>
                <div style={{fontSize:10,color:"#64748b",marginTop:4,fontFamily:"monospace"}}>Hacé clic para cambiar el archivo</div>
              </>
            )}
          </div>

          {/* Error */}
          {parseErr && <div style={{fontSize:10,color:"#f87171",fontFamily:"monospace",padding:"8px 12px",background:"#1a0a0a",borderRadius:8}}>{parseErr}</div>}

          {/* Ticker preview */}
          {clientTickers.length > 0 && (
            <div style={{background:"#0a1020",border:"1px solid #1e293b",borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:10,color:"#475569",fontFamily:"monospace",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>
                Tickers detectados
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {clientTickers.map(t=>(
                  <span key={t} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:5,padding:"3px 8px",fontSize:11,color:"#38bdf8",fontFamily:"monospace"}}>{t}</span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={()=>canRunClient&&onStartClient()}
            style={{background:canRunClient?"linear-gradient(135deg,#059669,#0ea5e9)":"#0f172a",border:`1px solid ${canRunClient?"transparent":"#1e293b"}`,borderRadius:10,padding:"14px",color:canRunClient?"white":"#334155",fontSize:14,fontWeight:700,cursor:canRunClient?"pointer":"default",fontFamily:"monospace",textTransform:"uppercase",boxShadow:canRunClient?"0 0 24px rgba(5,150,105,0.35)":"none",transition:"all 0.2s"}}>
            {canRunClient?`Analizar ${clientTickers.length} activos →`:"Subí un archivo para continuar"}
          </button>
        </div>
      )}

      <div style={{fontSize:10,color:"#1e293b",fontFamily:"monospace"}}>
        FMP API · Caché fundamentales: {CACHE_DAYS}d · Caché histórico: {HIST_CACHE_DAYS}d · Máx 100 tickers
      </div>
    </div>
  );
}

function LoadingScreen({progress}) {
  const colors = ["linear-gradient(90deg,#0ea5e9,#2563eb)","linear-gradient(90deg,#7c3aed,#4f46e5)","linear-gradient(90deg,#0d9488,#0ea5e9)","linear-gradient(90deg,#059669,#0ea5e9)"];
  const labels = ["","Fase 1 — Fundamentales","Fase 2 — Riesgo & Retorno","Fase 3 — Correlación","Fase 4 — Optimización"];
  return (
    <div style={{minHeight:"100vh",background:"#020817",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"monospace",padding:40,gap:22}}>
      <div style={{fontSize:10,letterSpacing:6,color:"#38bdf8",textTransform:"uppercase"}}>{labels[progress.phase]||""}</div>
      <div style={{fontSize:56,fontWeight:700,color:"#f1f5f9"}}>{Math.round(progress.pct)}<span style={{fontSize:22,color:"#64748b"}}>%</span></div>
      <div style={{width:400,maxWidth:"90vw"}}>
        <div style={{height:4,background:"#1e293b",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:2,width:`${progress.pct}%`,transition:"width 0.4s ease",background:colors[progress.phase-1]||colors[0],boxShadow:"0 0 10px #38bdf8"}}/>
        </div>
      </div>
      <div style={{fontSize:12,color:"#64748b",textAlign:"center",maxWidth:380,lineHeight:1.7}}>{progress.step}</div>
      <style>{`@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`}</style>
      <div style={{display:"flex",gap:8}}>
        {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#38bdf8",animation:`bob ${0.8+i*0.2}s ease-in-out ${i*0.15}s infinite`}}/>)}
      </div>
    </div>
  );
}

// ── Correlation Heatmap ───────────────────────────────────────────────────────
function CorrelationHeatmap({stocks, corrMatrix}) {
  const [hovered, setHovered] = useState(null);
  const n = stocks.length;
  const CELL = Math.max(10, Math.min(16, Math.floor(420/n)));
  const LABEL_W = 46;

  const highPairs = [];
  for (let i=0; i<n; i++) for (let j=i+1; j<n; j++)
    if (corrMatrix[i][j] > 0.75) highPairs.push({ a:stocks[i].symbol, b:stocks[j].symbol, r:corrMatrix[i][j] });
  highPairs.sort((a,b)=>b.r-a.r);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>

      {/* Heatmap grid */}
      <div style={{background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,padding:"16px",overflowX:"auto"}}>
        <div style={{fontSize:11,color:"#475569",fontFamily:"monospace",marginBottom:12,textTransform:"uppercase",letterSpacing:2}}>
          Matriz de Correlación — {n} activos
        </div>

        {/* Legend */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <span style={{fontSize:9,color:"#475569",fontFamily:"monospace"}}>-1.0</span>
          <div style={{height:8,width:160,borderRadius:4,background:"linear-gradient(90deg,rgb(20,20,180),rgb(20,15,15),rgb(240,20,20))"}}/>
          <span style={{fontSize:9,color:"#475569",fontFamily:"monospace"}}>+1.0</span>
          <div style={{width:1,height:14,background:"#1e293b",margin:"0 6px"}}/>
          <div style={{display:"flex",gap:10,fontSize:9,color:"#64748b",fontFamily:"monospace"}}>
            <span style={{color:"#60a5fa"}}>● negativa = buena diversificación</span>
            <span style={{color:"#f87171"}}>● &gt;0.75 = alta correlación</span>
          </div>
        </div>

        <div style={{display:"inline-block"}}>
          {/* Column labels */}
          <div style={{display:"flex",marginLeft:LABEL_W,marginBottom:2}}>
            {stocks.map((s,j)=>(
              <div key={j} style={{width:CELL,flexShrink:0,overflow:"hidden"}}>
                <div style={{fontSize:CELL>12?7:6,color:hovered&&(hovered.i===j||hovered.j===j)?"#f1f5f9":"#334155",fontFamily:"monospace",writingMode:"vertical-rl",textOrientation:"mixed",height:LABEL_W,textAlign:"right",lineHeight:1}}>
                  {s.symbol}
                </div>
              </div>
            ))}
          </div>

          {/* Rows */}
          {stocks.map((si,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",marginBottom:1}}>
              <div style={{width:LABEL_W,fontSize:CELL>12?7:6,color:hovered&&(hovered.i===i||hovered.j===i)?"#f1f5f9":"#334155",fontFamily:"monospace",textAlign:"right",paddingRight:4,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {si.symbol}
              </div>
              {stocks.map((sj,j)=>{
                const r = corrMatrix[i][j];
                const isHigh = i!==j && r>0.75;
                const isHov  = hovered && hovered.i===i && hovered.j===j;
                return (
                  <div key={j}
                    onMouseEnter={()=>setHovered({i,j,r,a:si.symbol,b:sj.symbol})}
                    onMouseLeave={()=>setHovered(null)}
                    style={{width:CELL,height:CELL,flexShrink:0,background:corrColor(r),cursor:"default",
                      outline:isHov?"2px solid white":"none",
                      boxShadow:isHigh&&i!==j?"inset 0 0 0 1px rgba(255,100,100,0.6)":"none"}}/>
                );
              })}
            </div>
          ))}
        </div>

        {/* Hover tooltip */}
        {hovered && (
          <div style={{marginTop:10,background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 14px",display:"inline-block",fontFamily:"monospace"}}>
            <span style={{color:"#f1f5f9",fontWeight:700}}>{hovered.a}</span>
            <span style={{color:"#475569"}}> vs </span>
            <span style={{color:"#f1f5f9",fontWeight:700}}>{hovered.b}</span>
            <span style={{color:"#475569"}}> → </span>
            <span style={{color:hovered.r>0.75?"#f87171":hovered.r<0?"#60a5fa":"#fbbf24",fontWeight:700}}>{hovered.r.toFixed(3)}</span>
            <span style={{color:"#475569",marginLeft:8}}>
              {hovered.r>0.75?"⚠️ Alta correlación":hovered.r<0?"✅ Diversificadora":"Moderada"}
            </span>
          </div>
        )}
      </div>

      {/* High correlation pairs */}
      {highPairs.length > 0 && (
        <div style={{background:"#1a0a0a",border:"1px solid #7f1d1d",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:11,color:"#f87171",fontFamily:"monospace",fontWeight:700,marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>
            ⚠️ Pares de alta correlación ({">"}0.75) — riesgo de concentración
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:6}}>
            {highPairs.slice(0,12).map((p,i)=>(
              <div key={i} style={{background:"#200a0a",borderRadius:8,padding:"8px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,fontFamily:"monospace",color:"#fca5a5"}}>{p.a} / {p.b}</span>
                <span style={{fontSize:12,fontFamily:"monospace",color:p.r>0.9?"#ef4444":"#f97316",fontWeight:700}}>{p.r.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{fontSize:10,color:"#64748b",fontFamily:"monospace",marginTop:10,lineHeight:1.6}}>
            Activos muy correlacionados no agregan diversificación real. La optimización de Markowitz los pondera de forma eficiente, pero considerá esto al interpretar los pesos resultantes.
          </div>
        </div>
      )}

      {highPairs.length === 0 && (
        <div style={{background:"#0c1a0c",border:"1px solid #166534",borderRadius:10,padding:"12px 16px"}}>
          <div style={{fontSize:11,color:"#4ade80",fontFamily:"monospace",fontWeight:700}}>
            ✅ Sin pares de alta correlación — buena base de diversificación
          </div>
        </div>
      )}
    </div>
  );
}

// ── Efficient Frontier Chart ──────────────────────────────────────────────────
function FrontierChart({mcPorts, special}) {
  const sample = mcPorts.filter((_,i)=>i%3===0);
  const mkPt = pts => pts ? [pts] : [];
  const CDot = ({cx,cy,fill,label,r=8}) => (
    <g>
      <circle cx={cx} cy={cy} r={r+3} fill={fill} opacity={0.2}/>
      <circle cx={cx} cy={cy} r={r} fill={fill}/>
      {label && <text x={cx+11} y={cy+4} fill={fill} fontSize={10} fontFamily="monospace">{label}</text>}
    </g>
  );
  const tip = ({active,payload}) => {
    if (!active||!payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 14px",fontFamily:"monospace",fontSize:11}}>
        <div style={{color:"#94a3b8"}}>Volatilidad: <span style={{color:"#f1f5f9"}}>{fmtPct(d.vol)}</span></div>
        <div style={{color:"#94a3b8"}}>Retorno: <span style={{color:"#34d399"}}>{fmtPct(d.ret)}</span></div>
        {d.sharpe!=null&&<div style={{color:"#94a3b8"}}>Sharpe: <span style={{color:"#fbbf24"}}>{d.sharpe.toFixed(2)}</span></div>}
        {d.label&&<div style={{color:"#f1f5f9",fontWeight:700,marginTop:4}}>{d.label}</div>}
      </div>
    );
  };
  return (
    <div style={{background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,padding:"16px 8px 8px"}}>
      <div style={{fontSize:11,color:"#475569",fontFamily:"monospace",textAlign:"center",marginBottom:8,letterSpacing:2,textTransform:"uppercase"}}>
        Frontera Eficiente · {mcPorts.length.toLocaleString()} simulaciones · Pesos: mín 1% · máx 20%
      </div>
      <ResponsiveContainer width="100%" height={330}>
        <ScatterChart margin={{top:10,right:60,bottom:30,left:10}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0f172a"/>
          <XAxis type="number" dataKey="vol" name="Volatilidad" unit="%" domain={["auto","auto"]}
            tick={{fill:"#475569",fontSize:10,fontFamily:"monospace"}} stroke="#1e293b"
            label={{value:"Volatilidad (%)",position:"insideBottom",offset:-12,fill:"#334155",fontSize:10}}/>
          <YAxis type="number" dataKey="ret" name="Retorno" unit="%" domain={["auto","auto"]}
            tick={{fill:"#475569",fontSize:10,fontFamily:"monospace"}} stroke="#1e293b"
            label={{value:"Retorno (%)",angle:-90,position:"insideLeft",offset:15,fill:"#334155",fontSize:10}}/>
          <ZAxis range={[6,6]}/>
          <Tooltip content={tip}/>
          <Scatter name="Portafolios" data={sample} fill="#1e3a5f" opacity={0.8}/>
          <Scatter name="Min Varianza" data={mkPt(special.minVar).map(p=>({...p,label:"Min Var"}))} shape={<CDot fill="#60a5fa" label="Min Var"/>}/>
          <Scatter name="Max Sharpe"   data={mkPt(special.maxShp).map(p=>({...p,label:"Max Sharpe"}))} shape={<CDot fill="#fbbf24" label="Max Sharpe"/>}/>
          <Scatter name="Risk Parity"  data={mkPt(special.rp).map(p=>({...p,label:"Risk Parity"}))} shape={<CDot fill="#a78bfa" label="Risk Parity"/>}/>
          <Scatter name="Equal Weight" data={mkPt(special.ew).map(p=>({...p,label:"EW"}))} shape={<CDot fill="#94a3b8" label="EW"/>}/>
          <Scatter name="SPY"          data={mkPt(special.spy).map(p=>({...p,label:"SPY"}))} shape={<CDot fill="#f87171" label="SPY" r={6}/>}/>
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{display:"flex",gap:14,justifyContent:"center",marginTop:4,flexWrap:"wrap"}}>
        {Object.entries(PORT_STYLES).map(([k,v])=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#64748b",fontFamily:"monospace"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:v.color}}/>
            {v.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Audit signal logic ────────────────────────────────────────────────────────
function getSignal(rcp, corrData, symbol) {
  if (!rcp) return null;
  const hits = [
    (rcp.sharpe  ?? 1)  <  0.5,   // Sharpe insuficiente
    (rcp.alpha   ?? 0)  <  0,     // Destruye valor vs mercado
    (rcp.maxDD   ?? 0)  > 25,     // Caída histórica severa
    (rcp.beta    ?? 1)  >  1.5,   // Alta sensibilidad sin compensación
  ];
  const count = hits.filter(Boolean).length;
  // Check high correlation with any other position
  let highCorr = false;
  if (corrData && symbol) {
    const idx = corrData.stocks.findIndex(s=>s.symbol===symbol);
    if (idx>=0) highCorr = corrData.corrMatrix[idx].some((r,j)=>j!==idx&&r>0.75);
  }
  if (count>=2)           return {key:"reduce",label:"🔴 Reducir",  color:"#ef4444",bg:"#1f0505", reasons:hits};
  if (count===1||highCorr)return {key:"review", label:"🟡 Revisar",  color:"#fbbf24",bg:"#1f1505", reasons:hits};
  return                         {key:"hold",   label:"✅ Mantener", color:"#34d399",bg:"#051a0a", reasons:hits};
}

// ── Export utilities ─────────────────────────────────────────────────────────
function exportToExcel(fundData, riskData, optData, blData, corrData, clientName) {
  const wb   = XLSX.utils.book_new();
  const date = new Date().toISOString().slice(0,10);

  // Sheet 1: Fundamentals
  const fRows = [["Sector","Ticker","Nombre","P/E","P/B","ROE %","D/E","EV/EBITDA","Margen %","Score"]];
  for (const [sector, stocks] of Object.entries(fundData||{}))
    for (const s of stocks)
      fRows.push([sector,s.symbol,s.name,s.pe?.toFixed(1),s.pb?.toFixed(1),s.roe?.toFixed(1),s.de?.toFixed(2),s.evEbitda?.toFixed(1),s.netMargin?.toFixed(1),s.score?.toFixed(1)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fRows), "Fundamentales");

  // Sheet 2: Portfolio comparison
  if (optData) {
    const cRows = [["Portafolio","Retorno Anual %","Volatilidad %","Sharpe"]];
    [["Black-Litterman",blData],["Máximo Sharpe",optData.maxShp],["Mínima Varianza",optData.minVar],
     ["Risk Parity",optData.rp],["Equal Weight",optData.ew],["SPY",optData.spy]]
      .filter(([,d])=>d)
      .forEach(([n,d])=>cRows.push([n,d.ret?.toFixed(2),d.vol?.toFixed(2),d.sharpe?.toFixed(3)]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cRows), "Comparación Portafolios");

    // Sheet 3: Weights
    const wHeader = ["Ticker","Sector","Max Sharpe %","Min Varianza %","Risk Parity %","Equal Weight %"];
    if (blData) wHeader.push("Black-Litterman %");
    const wRows = [wHeader];
    optData.stocks.forEach((s,i)=>{
      const row = [s.symbol,s.sector,
        ((optData.maxShp.weights?.[i]||0)*100).toFixed(2),
        ((optData.minVar.weights?.[i]||0)*100).toFixed(2),
        ((optData.rp.weights?.[i]||0)*100).toFixed(2),
        ((optData.ew.weights?.[i]||0)*100).toFixed(2)];
      if (blData) row.push(((blData.weights?.[i]||0)*100).toFixed(2));
      wRows.push(row);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wRows), "Pesos Portafolios");
  }

  // Sheet 4: Correlation matrix
  if (corrData?.stocks?.length) {
    const syms = corrData.stocks.map(s=>s.symbol);
    const crRows = [["", ...syms]];
    corrData.corrMatrix.forEach((row,i)=>crRows.push([syms[i],...row.map(r=>r.toFixed(3))]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(crRows), "Correlación");
  }

  XLSX.writeFile(wb, `analisis_cartera_${(clientName||"sp500").replace(/\s+/g,"_")}_${date}.xlsx`);
}

function exportToHTML(fundData, riskData, optData, blData, corrData, clientName, spy, rfRate, cpY, lpY) {
  const date  = new Date().toLocaleDateString("es-AR",{year:"numeric",month:"long",day:"numeric"});
  const name  = clientName||"S&P 500";
  const fmtN  = (v,d=1,suf="") => v==null||!isNaN(v)===false?"—":`${Number(v).toFixed(d)}${suf}`;
  const fmtV  = (v,suf="%",d=1) => v==null||!isFinite(v)?"—":`${Number(v)>=0&&suf==="%"?"+":""}${Number(v).toFixed(d)}${suf}`;

  // Portfolio comparison rows
  const portRows = [["Black-Litterman",blData,"#6366f1"],["Máximo Sharpe",optData?.maxShp,"#ca8a04"],
    ["Mínima Varianza",optData?.minVar,"#2563eb"],["Risk Parity",optData?.rp,"#7c3aed"],
    ["Equal Weight",optData?.ew,"#64748b"],["SPY Benchmark",optData?.spy,"#dc2626"]]
    .filter(([,d])=>d)
    .map(([n,d,c])=>`<tr><td style="color:${c};font-weight:700">${n}</td><td class="${(d.ret||0)>=0?"pos":"neg"}">${fmtV(d.ret,"%")}</td><td>${fmtN(d.vol,1,"%")}</td><td class="${(d.sharpe||0)>=0?"pos":"neg"}">${fmtN(d.sharpe,2)}</td></tr>`).join("");

  // Top weights rows (top 10 by max sharpe)
  const weightRows = optData ? optData.stocks
    .map((s,i)=>({s,i,msW:(optData.maxShp.weights?.[i]||0)*100,blW:(blData?.weights?.[i]||0)*100}))
    .sort((a,b)=>b.msW-a.msW).slice(0,10)
    .map(({s,msW,blW,i})=>`<tr><td><b>${s.symbol}</b></td><td style="color:#64748b">${s.sector||""}</td><td>${msW.toFixed(1)}%</td><td>${((optData.minVar.weights?.[i]||0)*100).toFixed(1)}%</td><td>${((optData.rp.weights?.[i]||0)*100).toFixed(1)}%</td>${blData?`<td>${blW.toFixed(1)}%</td>`:""}</tr>`).join("") : "";

  // Fundamental top 3 per sector
  const fundRows = Object.entries(fundData||{}).map(([sector,stocks])=>
    stocks.slice(0,3).map(s=>`<tr><td style="color:#0ea5e9">${sector}</td><td><b>${s.symbol}</b></td><td>${s.name?.slice(0,30)||""}</td><td>${fmtN(s.pe,1,"x")}</td><td>${fmtN(s.roe,1,"%")}</td><td>${fmtN(s.netMargin,1,"%")}</td><td><b>${fmtN(s.score,0)}</b></td></tr>`).join("")
  ).join("");

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Análisis de Cartera — ${name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;background:#fff}
  .cover{background:linear-gradient(135deg,#0f172a,#1e3a5f);color:white;padding:40px;margin-bottom:0}
  .cover h1{font-size:28px;font-weight:400;margin-bottom:8px}
  .cover .sub{color:#94a3b8;font-size:14px}
  .cover .meta{color:#64748b;font-size:11px;margin-top:12px}
  .body{padding:30px 40px}
  h2{font-size:15px;color:#0f172a;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #0ea5e9}
  h3{font-size:12px;color:#475569;margin:16px 0 6px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
  th{background:#0f172a;color:white;padding:7px 10px;text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase}
  td{padding:6px 10px;border-bottom:1px solid #f1f5f9}
  tr:nth-child(even) td{background:#f8fafc}
  .pos{color:#16a34a;font-weight:700}.neg{color:#dc2626;font-weight:700}
  .summary{display:flex;gap:16px;margin:16px 0;flex-wrap:wrap}
  .card{flex:1;min-width:120px;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center}
  .card .val{font-size:20px;font-weight:700;color:#0f172a}
  .card .lbl{font-size:10px;color:#64748b;margin-top:4px}
  .note{font-size:10px;color:#94a3b8;margin-top:20px;padding-top:12px;border-top:1px solid #f1f5f9}
  @media print{.page-break{page-break-before:always}}
</style></head><body>
<div class="cover">
  <div class="sub">Reporte de Análisis de Cartera</div>
  <h1>${name}</h1>
  <div class="meta">Generado el ${date} · Tasa libre de riesgo: ${rfRate}% · Períodos: CP ${cpY}Y / LP ${lpY}Y · Datos: Financial Modeling Prep</div>
</div>
<div class="body">
  <div class="summary">
    <div class="card"><div class="val">${Object.keys(fundData||{}).length}</div><div class="lbl">Sectores analizados</div></div>
    <div class="card"><div class="val">${Object.values(fundData||{}).flat().length}</div><div class="lbl">Activos seleccionados</div></div>
    ${optData?`<div class="card"><div class="val">${optData.mcPorts?.length?.toLocaleString()||"—"}</div><div class="lbl">Simulaciones Monte Carlo</div></div>`:""}
    ${spy?`<div class="card"><div class="val">$${Number(spy.price).toFixed(0)}</div><div class="lbl">SPY Benchmark</div></div>`:""}
  </div>

  ${optData?`<h2>Comparación de Portafolios</h2>
  <table><thead><tr><th>Portafolio</th><th>Retorno Anual</th><th>Volatilidad</th><th>Sharpe Ratio</th></tr></thead>
  <tbody>${portRows}</tbody></table>`:""}

  ${optData&&weightRows?`<h2>Asignación de Pesos — Top 10 por Máximo Sharpe</h2>
  <table><thead><tr><th>Ticker</th><th>Sector</th><th>Max Sharpe</th><th>Min Varianza</th><th>Risk Parity</th>${blData?"<th>Black-Litterman</th>":""}</tr></thead>
  <tbody>${weightRows}</tbody></table>`:""}

  <h2 ${optData?"class='page-break'":""}>Screening Fundamental — Top 3 por Sector</h2>
  <table><thead><tr><th>Sector</th><th>Ticker</th><th>Empresa</th><th>P/E</th><th>ROE</th><th>Margen</th><th>Score</th></tr></thead>
  <tbody>${fundRows}</tbody></table>

  <p class="note">Este reporte es solo informativo y no constituye asesoramiento de inversión. Los datos provienen de Financial Modeling Prep y pueden tener un retraso de hasta 24hs. Las proyecciones de portafolios son el resultado de modelos matemáticos (Markowitz, Black-Litterman) basados en datos históricos y no garantizan rendimientos futuros.</p>
</div></body></html>`;

  const blob = new Blob([html],{type:"text/html;charset=utf-8"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `reporte_${(clientName||"sp500").replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [phase,        setPhase]        = useState("idle");
  const [lp,           setLp]           = useState({step:"",pct:0,phase:1});
  const [fundData,     setFundData]     = useState({});
  const [riskData,     setRiskData]     = useState({});
  const [corrData,     setCorrData]     = useState(null);
  const [optData,      setOptData]      = useState(null);
  const [spy,          setSpy]          = useState(null);
  const [spyRisk,      setSpyRisk]      = useState(null);
  const [cacheInfo,    setCacheInfo]    = useState(null);
  const [activeSec,    setActiveSec]    = useState(null);
  const [tab,          setTab]          = useState("fund");
  const [rfRate,       setRfRate]       = useState(4.3);
  const [cpY,          setCpY]          = useState(3);
  const [lpY,          setLpY]          = useState(5);
  const [optY,         setOptY]         = useState(3);
  const [minW,         setMinW]         = useState(1);
  const [maxW,         setMaxW]         = useState(20);
  const [error,        setError]        = useState(null);
  const [portMode,     setPortMode]     = useState("sp500");   // "sp500" | "client"
  const [cedearFilter, setCedearFilter] = useState("all");     // "all" | "cedear"
  const [clientTickers,setClientTickers]= useState([]);
  const [clientName,   setClientName]   = useState("");
  const [blViews,      setBlViews]      = useState([]);
  const [blData,       setBlData]       = useState(null);
  const [blTau,        setBlTau]        = useState(0.05);
  const [blDelta,      setBlDelta]      = useState(2.5);
  const fileRef = useRef(null);

  // ── Load cache on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    const cached = cacheLoad();
    if (cached) setCacheInfo(cached);
  }, []);

  const loadFromCache = useCallback(() => {
    const cached = cacheLoad();
    if (!cached) return;
    setFundData(cached.fundData);
    setSpy(cached.spy);
    setCacheInfo(cached);
    setActiveSec(Object.keys(cached.fundData)[0]);
    setPhase("done1");
    setTab("fund");
  }, []);

  const forceRefresh = useCallback(() => {
    cacheClear();
    histCacheClear();
    setCacheInfo(null);
    setPhase("idle");
  }, []);

  // ── Phase 1: Fundamental screening ──────────────────────────────────────────
  const runP1 = useCallback(async () => {
    setPhase("loading"); setError(null);
    try {
      setLp({step:"Verificando conexión con FMP API...",pct:2,phase:1});
      let res;
      try { res = await fetch(`${BASE}?path=sp500_constituent`); }
      catch(e) { throw new Error(`Error de red: ${e.message}`); }
      if (!res.ok) throw new Error(`HTTP ${res.status} — verificá tu API key`);

      const raw = await res.json();
      if (raw && !Array.isArray(raw)) {
        const msg = raw["Error Message"]||raw.message||raw.error||JSON.stringify(raw);
        throw new Error(`FMP API: ${msg}`);
      }
      const constituents = raw;
      if (!constituents.length)
        throw new Error("Sin datos. Posible límite diario alcanzado (250 req/día en plan gratuito).");

      setLp({step:"Componentes del S&P 500 recibidos...",pct:5,phase:1});
      await delay(200);

      const cmap={}, bySector={};
      for (const c of constituents) {
        cmap[c.symbol]=c;
        if (!c.sector) continue;
        if (!bySector[c.sector]) bySector[c.sector]=[];
        bySector[c.sector].push(c.symbol);
      }

      const allSyms = constituents.map(c=>c.symbol).filter(Boolean);
      const quotes  = {};
      const qc = chunk(allSyms, 100);
      for (let i=0; i<qc.length; i++) {
        setLp({step:`Cotizaciones lote ${i+1}/${qc.length}...`,pct:6+(i/qc.length)*20,phase:1});
        const r=await fetch(`${BASE}?path=quote&symbol=${qc[i].join(",")}`);
        const d=await r.json();
        if (Array.isArray(d)) d.forEach(q=>{quotes[q.symbol]=q;});
        await delay(200);
      }

      setLp({step:"Benchmark SPY...",pct:27,phase:1});
      const spyRes = await fetch(`${BASE}?path=quote&symbol=SPY`);
      const spyD   = await spyRes.json();
      const spyObj = Array.isArray(spyD)?spyD[0]:spyD;
      setSpy(spyObj);
      await delay(200);

      const symIndexMap = {};
      allSyms.forEach((s,i) => { symIndexMap[s] = i; });
      const cands={};
      for (const sector of Object.keys(bySector)) {
        cands[sector]=(bySector[sector]||[])
          .filter(sym => cedearFilter === "all" || CEDEAR_TICKERS.has(sym))
          .map(sym=>({sym,q:quotes[sym],c:cmap[sym],idx:symIndexMap[sym]||9999}))
          .filter(s=>s.q&&(s.q.marketCap>1e8||(!s.q.marketCap&&s.q.price>0)))
          .sort((a,b)=>(b.q.marketCap||0)-(a.q.marketCap||0)||(a.idx-b.idx))
          .slice(0,12);
      }

      const allC = Object.values(cands).flat();
      const ratios={};
      let done=0;
      for (const batch of chunk(allC, 5)) {
        await Promise.all(batch.map(async({sym})=>{
          try {
            const r=await fetch(`${BASE}?path=ratios-ttm&symbol=${sym}`);
            const d=await r.json();
            const ratioData = Array.isArray(d) ? d[0] : d; if (ratioData && typeof ratioData === "object") ratios[sym]=ratioData;
          } catch{}
          done++;
          setLp({step:`Ratios fundamentales: ${done}/${allC.length}...`,pct:29+(done/allC.length)*54,phase:1});
        }));
        await delay(120);
      }

      setLp({step:"Calculando scores...",pct:85,phase:1});
      const norm=(vals,val,hb)=>{
        const cl=vals.filter(v=>v!=null&&isFinite(v));
        if (cl.length<2||val==null||!isFinite(val)) return null;
        const rank=[...cl].sort((a,b)=>a-b).filter(v=>v<val).length;
        const p=rank/(cl.length-1);
        return hb?p:1-p;
      };

      const results={};
      for (const [sector,cs] of Object.entries(cands)) {
        const enriched=cs.map(({sym,q,c})=>{
          const r=ratios[sym]||{};
          return {
            symbol:sym, name:c?.name||q?.name||sym, sector,
            price:q?.price, changePercent:q?.changesPercentage, marketCap:q?.marketCap,
            pe:       (q?.pe>0&&q?.pe<600)?q.pe:(r.peRatioTTM>0&&r.peRatioTTM<600)?r.peRatioTTM:null,
            pb:       r.priceToBookRatioTTM>0&&r.priceToBookRatioTTM<150?r.priceToBookRatioTTM:null,
            roe:      r.returnOnEquityTTM!=null?r.returnOnEquityTTM*100:null,
            de:       r.debtEquityRatioTTM!=null?Math.abs(r.debtEquityRatioTTM):null,
            evEbitda: r.enterpriseValueMultipleTTM>0&&r.enterpriseValueMultipleTTM<250?r.enterpriseValueMultipleTTM:null,
            netMargin:r.netProfitMarginTTM!=null?r.netProfitMarginTTM*100:null,
          };
        });
        const scored=enriched.map(stk=>{
          let score=0,tw=0;
          for (const m of FUND_METRICS) {
            const n=norm(enriched.map(s=>s[m.key]),stk[m.key],m.hb);
            if (n!=null){score+=n*m.w;tw+=m.w;}
          }
          return {...stk, score:tw>0?(score/tw)*100:0};
        });
        results[sector]=scored.sort((a,b)=>b.score-a.score).slice(0,5);
      }

      setFundData(results);
      setActiveSec(Object.keys(results)[0]);
      cacheSave(results, spyObj);
      const newInfo = cacheLoad();
      setCacheInfo(newInfo);
      setLp({step:"Fase 1 completada y guardada en caché.",pct:100,phase:1});
      await delay(400);
      setPhase("done1");
    } catch(err) { setError(err.message); setPhase("error"); }
  }, []);

  // ── Phase 1 (client mode): analyze custom ticker list ────────────────────────
  const runClientP1 = useCallback(async () => {
    setPhase("loading"); setError(null);
    if (!clientTickers.length) { setError("No hay tickers cargados."); setPhase("error"); return; }
    const tickers = clientTickers;
    try {
      // ── Caché de cliente (7 días) ──
      if (clientName) {
        const cc = clientCacheLoad(clientName);
        if (cc) {
          setFundData(cc.fundData);
          setSpy(cc.spy);
          setPortMode("client");
          setActiveSec(Object.keys(cc.fundData)[0]);
          setLp({step:`⚡ ${clientName} cargado desde caché (${cc.ageDays}d)`,pct:100,phase:1});
          await delay(300);
          setPhase("done1");
          return;
        }
      }
      setLp({step:"Verificando conexión con FMP API...",pct:2,phase:1});

      // 1. Batch quotes
      const quotes = {};
      const qc = chunk(tickers, 100);
      for (let i=0; i<qc.length; i++) {
        setLp({step:`Cotizaciones: lote ${i+1}/${qc.length}...`,pct:4+(i/qc.length)*18,phase:1});
        try {
          const r = await fetch(`${BASE}?path=quote&symbol=${qc[i].join(",")}`);
          const d = await r.json();
          if (!Array.isArray(d)) {
            const msg = d["Error Message"]||d.message||JSON.stringify(d);
            throw new Error(`FMP API: ${msg}`);
          }
          d.forEach(q=>{ quotes[q.symbol]=q; });
        } catch(e) { if(e.message.startsWith("FMP API")) throw e; }
        await delay(200);
      }

      // 2. Profiles for sector info (batch of 20)
      setLp({step:"Obteniendo sectores y perfiles...",pct:24,phase:1});
      const profiles = {};
      for (const batch of chunk(tickers, 20)) {
        try {
          const r = await fetch(`${BASE}?path=profile&symbol=${batch.join(",")}`);
          const d = await r.json();
          if (Array.isArray(d)) d.forEach(p=>{ profiles[p.symbol]=p; });
        } catch {}
        await delay(200);
      }

      // 3. SPY benchmark
      setLp({step:"Benchmark SPY...",pct:34,phase:1});
      const spyRes = await fetch(`${BASE}?path=quote&symbol=SPY`);
      const spyD   = await spyRes.json();
      setSpy(Array.isArray(spyD)?spyD[0]:spyD);
      await delay(200);

      // 4. Ratios TTM
      const ratios = {};
      let done = 0;
      for (const batch of chunk(tickers, 5)) {
        await Promise.all(batch.map(async sym=>{
          try {
            const r = await fetch(`${BASE}?path=ratios-ttm&symbol=${sym}`);
            const d = await r.json();
            const ratioData = Array.isArray(d) ? d[0] : d; if (ratioData && typeof ratioData === "object") ratios[sym]=ratioData;
          } catch {}
          done++;
          setLp({step:`Ratios fundamentales: ${done}/${tickers.length}...`,pct:36+(done/tickers.length)*50,phase:1});
        }));
        await delay(120);
      }

      // 5. Group by sector + score
      setLp({step:"Calculando scores...",pct:88,phase:1});
      const bySector = {};
      for (const sym of tickers) {
        if (!quotes[sym]) continue;
        const sector = profiles[sym]?.sector || "Sin sector";
        if (!bySector[sector]) bySector[sector] = [];
        bySector[sector].push({ sym, q:quotes[sym], p:profiles[sym], r:ratios[sym]||{} });
      }

      const norm = (vals,val,hb) => {
        const cl=vals.filter(v=>v!=null&&isFinite(v));
        if (cl.length<2||val==null||!isFinite(val)) return null;
        const rank=[...cl].sort((a,b)=>a-b).filter(v=>v<val).length;
        const p=rank/(cl.length-1);
        return hb?p:1-p;
      };

      const results = {};
      for (const [sector, items] of Object.entries(bySector)) {
        const enriched = items.map(({sym,q,p,r})=>({
          symbol:sym, name:p?.companyName||q?.name||sym, sector,
          price:q?.price, changePercent:q?.changesPercentage, marketCap:q?.marketCap,
          pe:       q?.pe>0&&q?.pe<600?q.pe:null,
          pb:       r.priceToBookRatioTTM>0&&r.priceToBookRatioTTM<150?r.priceToBookRatioTTM:null,
          roe:      r.returnOnEquityTTM!=null?r.returnOnEquityTTM*100:null,
          de:       r.debtEquityRatioTTM!=null?Math.abs(r.debtEquityRatioTTM):null,
          evEbitda: r.enterpriseValueMultipleTTM>0&&r.enterpriseValueMultipleTTM<250?r.enterpriseValueMultipleTTM:null,
          netMargin:r.netProfitMarginTTM!=null?r.netProfitMarginTTM*100:null,
        }));
        const scored = enriched.map(stk=>{
          let score=0, tw=0;
          for (const m of FUND_METRICS) {
            const n=norm(enriched.map(s=>s[m.key]),stk[m.key],m.hb);
            if (n!=null){score+=n*m.w;tw+=m.w;}
          }
          return {...stk, score:tw>0?(score/tw)*100:0};
        });
        // Client mode: show ALL tickers sorted by score (no top-5 cap)
        results[sector] = scored.sort((a,b)=>b.score-a.score);
      }

      if (clientName) clientCacheSave(clientName, results, Array.isArray(spyD)?spyD[0]:spyD);
      setFundData(results);
      setPortMode("client");
      setActiveSec(Object.keys(results)[0]);
      setLp({step:`${tickers.length} activos analizados.`,pct:100,phase:1});
      await delay(400);
      setPhase("done1");
    } catch(err) { setError(err.message); setPhase("error"); }
  }, [clientTickers, clientName]);

  // ── Phase 2: Risk metrics ────────────────────────────────────────────────────
  const runP2 = useCallback(async()=>{
    setPhase("loading");
    const rf=rfRate/100;
    const cpD=Math.round(cpY*252), lpD=Math.round(lpY*252);
    const yBack=Math.max(lpY+1,6);
    const from=`${new Date().getFullYear()-yBack}-01-01`;
    try {
      const allSyms=[...new Set(Object.values(fundData).flat().map(s=>s.symbol))];
      let done=0; const total=allSyms.length+1;
      let hist={}, spyPrices;

      // ── Caché de histórico compartido (7 días) ──
      const cached = histCacheLoad(from);
      if (cached) {
        hist = cached.hist;
        spyPrices = cached.spyPrices;
        setLp({step:`⚡ Histórico desde caché (${HIST_CACHE_DAYS} días)...`,pct:84,phase:2});
        done = total;
      } else {
        setLp({step:`Histórico SPY (${yBack} años)...`,pct:2,phase:2});
        const spyH=await fetch(`${BASE}?path=historical-price-full/SPY&from=${from}`);
        const spyHD=await spyH.json();
        spyPrices=(spyHD.historical || (Array.isArray(spyHD) ? spyHD : [])).slice().reverse();
        done++;

        for (const batch of chunk(allSyms,4)) {
          await Promise.all(batch.map(async sym=>{
            try {
              const r=await fetch(`${BASE}?path=historical-price-full/${sym}&from=${from}`);
              const d=await r.json();
              hist[sym]=(d.historical || (Array.isArray(d) ? d : [])).slice().reverse();
            } catch{}
            done++;
            setLp({step:`Histórico: ${done}/${total} activos...`,pct:4+(done/total)*80,phase:2});
          }));
          await delay(150);
        }
        histCacheSave(hist, spyPrices, from);
      }

      setLp({step:`Calculando CP (${cpY}Y) / LP (${lpY}Y)...`,pct:86,phase:2});
      const spyMap=buildSpyMap(spyPrices);
      const spyAl=Object.keys(spyMap).sort().map(d=>({s:spyMap[d],m:spyMap[d]}));
      setSpyRisk({cp:calcRisk(spyAl.slice(-cpD),rf), lp:calcRisk(spyAl.slice(-lpD),rf)});

      const rr={};
      for (const [sector,stocks] of Object.entries(fundData)) {
        rr[sector]=stocks.map(stk=>{
          const p=hist[stk.symbol]||[];
          if (p.length<60) return {...stk,rcp:null,rlp:null};
          const al=alignedRet(p,spyMap);
          return {...stk, rcp:calcRisk(al.slice(-cpD),rf), rlp:calcRisk(al.slice(-lpD),rf)};
        });
      }
      setRiskData(rr);
      setTab("risk");
      setLp({step:"Fase 2 completada.",pct:100,phase:2});
      await delay(400);
      setPhase("done2");
    } catch(err) { setError(err.message); setPhase("error"); }
  },[fundData,rfRate,cpY,lpY]);

  // ── Phase 3: Correlation ─────────────────────────────────────────────────────
  const runCorr = useCallback(async()=>{
    setPhase("loading");
    const corrY=Math.max(cpY,2);
    const from=`${new Date().getFullYear()-corrY}-01-01`;
    const allStocks=Object.values(fundData).flat();
    const allSyms=allStocks.map(s=>s.symbol);
    try {
      let done=0; const total=allSyms.length+1;
      let hist={}, spyPrices;

      // ── Caché de histórico compartido (7 días) ──
      const cached = histCacheLoad(from);
      if (cached) {
        hist = cached.hist;
        spyPrices = cached.spyPrices;
        setLp({step:"⚡ Histórico desde caché — calculando correlaciones...",pct:76,phase:3});
        done = total;
      } else {
        setLp({step:"Histórico SPY para correlación...",pct:3,phase:3});
        const spyH=await fetch(`${BASE}?path=historical-price-full/SPY&from=${from}`);
        const spyHD=await spyH.json();
        spyPrices=(spyHD.historical || (Array.isArray(spyHD) ? spyHD : [])).slice().reverse();
        done++;

        for (const batch of chunk(allSyms,4)) {
          await Promise.all(batch.map(async sym=>{
            try {
              const r=await fetch(`${BASE}?path=historical-price-full/${sym}&from=${from}`);
              const d=await r.json();
              hist[sym]=(d.historical || (Array.isArray(d) ? d : [])).slice().reverse();
            } catch{}
            done++;
            setLp({step:`Histórico: ${done}/${total} activos...`,pct:5+(done/total)*70,phase:3});
          }));
          await delay(150);
        }
        histCacheSave(hist, spyPrices, from);
      }

      setLp({step:"Calculando matriz de correlación...",pct:78,phase:3});
      const spyMap=buildSpyMap(spyPrices);
      const allDates=Object.keys(spyMap).sort();

      const validStocks=[], retArrays=[];
      for (const stk of allStocks) {
        const p=hist[stk.symbol]||[];
        if (p.length<60) continue;
        const rm={}; toDailyRet(p).forEach(r=>{rm[r.date]=r.r;});
        const al=allDates.filter(d=>rm[d]!=null).map(d=>rm[d]);
        if (al.length<60) continue;
        validStocks.push(stk);
        retArrays.push(al);
      }

      const minLen=Math.min(...retArrays.map(r=>r.length));
      const trimmed=retArrays.map(r=>r.slice(r.length-minLen));
      const {corr}=buildCovAndCorr(trimmed);

      setCorrData({stocks:validStocks, corrMatrix:corr, period:corrY});
      setTab("corr");
      setLp({step:"Fase 3 completada.",pct:100,phase:3});
      await delay(400);
      setPhase("done3");
    } catch(err) { setError(err.message); setPhase("error"); }
  },[fundData,cpY]);

  // ── Phase 4: Optimization ────────────────────────────────────────────────────
  const runOpt = useCallback(async()=>{
    setPhase("loading");
    const rf=rfRate/100;
    const minWf=minW/100, maxWf=maxW/100;
    const from=`${new Date().getFullYear()-optY}-01-01`;
    const allStocks=Object.values(fundData).flat();
    const allSyms=allStocks.map(s=>s.symbol);
    try {
      let done=0; const total=allSyms.length+1;
      let hist={}, spyPrices;

      // ── Caché de histórico compartido (7 días) ──
      const cached = histCacheLoad(from);
      if (cached) {
        hist = cached.hist;
        spyPrices = cached.spyPrices;
        setLp({step:"⚡ Histórico desde caché — construyendo covarianza...",pct:55,phase:4});
        done = total;
      } else {
        setLp({step:"Histórico SPY para optimización...",pct:2,phase:4});
        const spyH=await fetch(`${BASE}?path=historical-price-full/SPY&from=${from}`);
        const spyHD=await spyH.json();
        spyPrices=(spyHD.historical || (Array.isArray(spyHD) ? spyHD : [])).slice().reverse();
        done++;

        for (const batch of chunk(allSyms,4)) {
          await Promise.all(batch.map(async sym=>{
            try {
              const r=await fetch(`${BASE}?path=historical-price-full/${sym}&from=${from}`);
              const d=await r.json();
              hist[sym]=(d.historical || (Array.isArray(d) ? d : [])).slice().reverse();
            } catch{}
            done++;
            setLp({step:`Histórico: ${done}/${total} activos...`,pct:4+(done/total)*50,phase:4});
          }));
          await delay(150);
        }
        histCacheSave(hist, spyPrices, from);
      }

      setLp({step:"Construyendo matriz de covarianza...",pct:57,phase:4});
      const spyMap=buildSpyMap(spyPrices);
      const allDates=Object.keys(spyMap).sort();

      const validStocks=[], retArrays=[];
      for (const stk of allStocks) {
        const p=hist[stk.symbol]||[];
        if (p.length<60) continue;
        const rm={}; toDailyRet(p).forEach(r=>{rm[r.date]=r.r;});
        const al=allDates.filter(d=>rm[d]!=null).map(d=>rm[d]);
        if (al.length<60) continue;
        validStocks.push(stk);
        retArrays.push(al);
      }

      const minLen=Math.min(...retArrays.map(r=>r.length));
      const trimmed=retArrays.map(r=>r.slice(r.length-minLen));
      const {cov}=buildCovAndCorr(trimmed);
      const annRets=trimmed.map(r=>(Math.pow(r.reduce((a,v)=>a*(1+v),1),252/r.length)-1));

      setLp({step:`Monte Carlo: 4,000 portafolios (peso mín ${minW}% · máx ${maxW}%)...`,pct:64,phase:4});
      const mcPorts=runMonteCarlo(annRets,cov,rf,4000,minWf,maxWf);

      setLp({step:"Identificando portafolios óptimos...",pct:86,phase:4});
      const minVar=mcPorts.reduce((b,p)=>p.vol<b.vol?p:b, mcPorts[0]);
      const maxShp=mcPorts.reduce((b,p)=>p.sharpe>b.sharpe?p:b, mcPorts[0]);
      const rpW=riskParityW(cov);
      const rpStats=portStats(rpW,annRets,cov,rf);
      const ewW=new Array(validStocks.length).fill(1/validStocks.length);
      const ewStats=portStats(ewW,annRets,cov,rf);
      const spyR=allDates.filter(d=>spyMap[d]!=null).map(d=>spyMap[d]).slice(-minLen);
      const spyAnn=(Math.pow(spyR.reduce((a,v)=>a*(1+v),1),252/spyR.length)-1)*100;
      const spyM=spyR.reduce((a,b)=>a+b,0)/spyR.length;
      const spyVol=Math.sqrt(spyR.reduce((a,r)=>a+Math.pow(r-spyM,2),0)/(spyR.length-1)*252)*100;

      setOptData({
        stocks:validStocks, mcPorts,
        cov, annRets,
        minVar:{...minVar,label:"Mínima Varianza"},
        maxShp:{...maxShp,label:"Máximo Sharpe"},
        rp:    {...rpStats,weights:rpW,label:"Risk Parity"},
        ew:    {...ewStats,weights:ewW,label:"Equal Weight"},
        spy:   {ret:spyAnn,vol:spyVol,sharpe:spyVol>0?(spyAnn/100-rf)/(spyVol/100):0,label:"SPY"},
        constraints:{minW,maxW},
      });
      setTab("opt");
      setLp({step:"Fase 4 completada.",pct:100,phase:4});
      await delay(400);
      setPhase("done4");
    } catch(err) { setError(err.message); setPhase("error"); }
  },[fundData,rfRate,optY,minW,maxW]);

  // ── Black-Litterman ───────────────────────────────────────────────────────────
  function computeBL(stocks, cov, annRets, views, tau, delta) {
    const n = stocks.length;
    // Market-cap weights as equilibrium prior
    const mcaps  = stocks.map(s => Math.max(s.marketCap||1e9, 1));
    const mcapSum= mcaps.reduce((a,b)=>a+b,0);
    const wMkt   = mcaps.map(m=>m/mcapSum);
    // Annualized covariance
    const covA   = cov.map(row=>row.map(x=>x*252));
    // Equilibrium returns: Π = δ * Σ_ann * w_mkt
    const Pi = covA.map(row=> delta * row.reduce((s,x,j)=>s+x*wMkt[j],0));

    if (!views.length) {
      const ws = wMkt.reduce((a,b)=>a+b,0);
      return { weights:wMkt.map(w=>w/ws), mu:Pi, equilibriumMu:Pi, success:true };
    }

    const k = views.length;
    // P matrix (k×n): each row is a view portfolio
    const P = views.map(v=>{ const r=new Array(n).fill(0); r[v.assetIdx]=1; return r; });
    // Q vector: expected returns per view (decimal)
    const Q = views.map(v=>(v.direction==="up"?1:-1)*v.returnPct/100);
    // Confidence → uncertainty multiplier
    const confMult = {high:0.25, medium:1.0, low:4.0};
    // τΣ_ann
    const tSigma = covA.map(row=>row.map(x=>tau*x));

    try {
      // Ω diagonal: conf_mult * (P τΣ P')_ii
      const Omega = views.map((v,i)=>{
        let val=0;
        for(let a=0;a<n;a++) for(let b=0;b<n;b++) val+=P[i][a]*tSigma[a][b]*P[i][b];
        return Math.max(val*confMult[v.confidence], 1e-8);
      });

      const tSigmaMat = math.matrix(tSigma);
      const tSigmaInv = math.inv(tSigmaMat);

      // P' Ω^-1 P  (n×n)
      const PtOinvP = Array.from({length:n},(_,i)=>
        Array.from({length:n},(_,j)=>
          views.reduce((s,_,v)=>s+P[v][i]*(1/Omega[v])*P[v][j],0)));

      // A = (τΣ)^-1 + P'Ω^-1P
      const A    = math.add(tSigmaInv, math.matrix(PtOinvP));
      const Ainv = math.inv(A);

      // b = (τΣ)^-1 Π + P'Ω^-1 Q
      const tSInvPi = math.multiply(tSigmaInv, Pi).valueOf();
      const PtOinvQ = new Array(n).fill(0);
      views.forEach((v,vi)=>{ P[vi].forEach((p,i)=>{ PtOinvP[i]&&(PtOinvQ[i]+=p*(1/Omega[vi])*Q[vi]); }); });
      const b = tSInvPi.map((x,i)=>x+PtOinvQ[i]);

      // μ_BL = A^-1 b
      const muBL = math.multiply(Ainv, b).valueOf();

      // Optimal weights: w* = (δΣ_ann)^-1 μ_BL, then clamp & normalize
      const dSigma    = covA.map(row=>row.map(x=>x*delta));
      const dSigmaInv = math.inv(math.matrix(dSigma)).valueOf();
      let w = dSigmaInv.map(row=>row.reduce((s,x,j)=>s+x*muBL[j],0));
      w = w.map(x=>Math.max(x,0));
      const ws = w.reduce((a,b)=>a+b,0);
      if (ws<=0) throw new Error("Suma de pesos cero — revisá los views");
      return { weights:w.map(x=>x/ws), mu:muBL, equilibriumMu:Pi, success:true };
    } catch(e) {
      return { success:false, error:e.message };
    }
  }

  const runBL = useCallback(()=>{
    if (!optData) return;
    const result = computeBL(optData.stocks, optData.cov, optData.annRets, blViews, blTau, blDelta);
    if (!result.success) { setError(result.error); return; }
    const rf = rfRate/100;
    const stats = portStats(result.weights, optData.annRets, optData.cov, rf);
    // Mu shift: how much each view moved expected return vs equilibrium
    const muShift = result.mu.map((m,i)=>m*100 - result.equilibriumMu[i]*100);
    setBlData({ ...result, ...stats, weights:result.weights, muShift, label:"Black-Litterman" });
    setTab("bl");
  }, [optData, blViews, blTau, blDelta, rfRate]);
  if (phase==="idle") return <StartScreen onStart={runP1} onStartClient={runClientP1} cacheInfo={cacheInfo} onLoadCache={loadFromCache} clientTickers={clientTickers} setClientTickers={setClientTickers} clientName={clientName} setClientName={setClientName} cedearFilter={cedearFilter} setCedearFilter={setCedearFilter}/>;
  if (phase==="loading") return <LoadingScreen progress={lp}/>;
  if (phase==="error") return (
    <div style={{minHeight:"100vh",background:"#020817",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,fontFamily:"monospace",padding:32}}>
      <div style={{fontSize:36}}>⚠️</div>
      <div style={{fontSize:15,color:"#f1f5f9",fontWeight:700}}>Error en el análisis</div>
      <div style={{background:"#0f172a",border:"1px solid #ef4444",borderRadius:10,padding:"14px 20px",maxWidth:480,width:"100%"}}>
        <div style={{fontSize:11,color:"#f87171",lineHeight:1.7,wordBreak:"break-word"}}>{error||"Error desconocido"}</div>
      </div>
      <div style={{background:"#0c1a0c",border:"1px solid #166534",borderRadius:10,padding:"12px 18px",maxWidth:480,width:"100%"}}>
        <div style={{fontSize:10,color:"#4ade80",marginBottom:5,fontWeight:700}}>Posibles causas</div>
        <div style={{fontSize:10,color:"#86efac",lineHeight:1.8}}>
          Límite diario FMP (250 req/día plan gratuito) · API key inválida · Sin conexión a internet
        </div>
      </div>
      <button onClick={()=>setPhase("idle")} style={{marginTop:4,background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 28px",color:"#e2e8f0",cursor:"pointer",fontSize:12}}>
        Reintentar
      </button>
    </div>
  );

  // ── Results layout ───────────────────────────────────────────────────────────
  const doneN  = phase==="done4"?4:phase==="done3"?3:phase==="done2"?2:1;
  const isRisk = tab==="risk"&&doneN>=2;
  const isCorr = tab==="corr"&&doneN>=3;
  const isOpt  = tab==="opt" &&doneN>=4;
  const isBL   = tab==="bl"  &&doneN>=4;
  const srcData= (isRisk)?riskData:fundData;
  const sectors= Object.keys(srcData);
  const stocks = srcData[activeSec]||[];
  const sCol   = SECTOR_COLORS[activeSec]||"#38bdf8";
  const cpL    = `${cpY}Y`, lpL=`${lpY}Y`;

  const TH={padding:"9px 10px",textAlign:"right",fontSize:10,fontWeight:600,color:"#475569",letterSpacing:0.5,textTransform:"uppercase",fontFamily:"monospace",whiteSpace:"nowrap",borderBottom:"1px solid #1e293b"};
  const TD={padding:"11px 10px",verticalAlign:"middle"};

  const availTabs=[
    {id:"fund",label:"📊 Fund",        show:true},
    {id:"risk",label:portMode==="client"?"🔍 Auditoría":"📈 Riesgo", show:doneN>=2},
    {id:"corr",label:"🔗 Correlación", show:doneN>=3},
    {id:"opt", label:"🎯 Optimización",show:doneN>=4},
    {id:"bl",  label:"🧠 Black-Litterman", show:doneN>=4},
  ].filter(t=>t.show);

  return (
    <div style={{minHeight:"100vh",background:"#020817",color:"#e2e8f0",fontFamily:"system-ui,sans-serif"}}>

      {/* ── Header ── */}
      <div style={{borderBottom:"1px solid #1e293b",padding:"11px 16px",background:"#040d1a",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:9,letterSpacing:5,color:"#334155",fontFamily:"monospace",textTransform:"uppercase"}}>
            {portMode==="client" ? `Cartera · ${clientName||"Sin nombre"}` : cedearFilter==="cedear" ? "S&P 500 · Solo CEDEARs BYMA 🇦🇷" : "S&P 500 Sector Screener"}
          </div>
          <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9"}}>
            {portMode==="client"
              ? `📁 ${clientTickers.length} activos · Fase ${doneN} de 4`
              : `Fase ${doneN} de 4 ${doneN===4?"✅":"·"} ${["","Fundamentales","+ Riesgo","+ Correlación","+ Optimización"][doneN]}`}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          {cacheInfo&&doneN>=1&&(
            <CacheBadge info={cacheInfo} onRefresh={forceRefresh}/>
          )}
          {spy&&(
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:"#334155",fontFamily:"monospace"}}>SPY</div>
              <div style={{fontSize:14,fontWeight:700,color:"#f1f5f9",fontFamily:"monospace"}}>{fmtP(spy.price)}</div>
              <div style={{fontSize:10,color:(spy.changesPercentage||0)>=0?"#34d399":"#f87171",fontFamily:"monospace"}}>
                {(spy.changesPercentage||0)>=0?"▲":"▼"}{Math.abs(spy.changesPercentage||0).toFixed(2)}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Controls bar ── */}
      <div style={{borderBottom:"1px solid #1e293b",background:"#040d1a",padding:"10px 16px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        {/* Tab switcher */}
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {availTabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?"#1e293b":"transparent",border:`1px solid ${tab===t.id?"#334155":"transparent"}`,borderRadius:8,padding:"6px 12px",color:tab===t.id?"#f1f5f9":"#475569",fontSize:11,fontWeight:tab===t.id?600:400,cursor:"pointer",fontFamily:"monospace"}}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{width:1,height:28,background:"#1e293b",margin:"0 4px"}}/>

        {/* Phase 1 done: P2 settings */}
        {doneN===1&&(
          <>
            <NInput label="RF" value={rfRate} onChange={setRfRate} min={0} max={15} step={0.1} unit="%"/>
            <NInput label="CP" value={cpY} onChange={v=>setCpY(Math.min(v,lpY-1))} min={1} max={4} unit="Y"/>
            <NInput label="LP" value={lpY} onChange={v=>setLpY(Math.max(v,cpY+1))} min={2} max={10} unit="Y"/>
            <button onClick={runP2} style={{background:"linear-gradient(135deg,#7c3aed,#4f46e5)",border:"none",borderRadius:8,padding:"8px 14px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace",boxShadow:"0 0 16px rgba(124,58,237,0.3)"}}>
              Calcular Riesgo →
            </button>
          </>
        )}

        {/* P2 done: recalc P2 + run corr */}
        {doneN===2&&(
          <>
            <NInput label="RF" value={rfRate} onChange={setRfRate} min={0} max={15} step={0.1} unit="%"/>
            <NInput label="CP" value={cpY} onChange={v=>setCpY(Math.min(v,lpY-1))} min={1} max={4} unit="Y"/>
            <NInput label="LP" value={lpY} onChange={v=>setLpY(Math.max(v,cpY+1))} min={2} max={10} unit="Y"/>
            <button onClick={runP2} style={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"7px 12px",color:"#a78bfa",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"monospace"}}>↺ Riesgo</button>
            <button onClick={runCorr} style={{background:"linear-gradient(135deg,#0d9488,#0ea5e9)",border:"none",borderRadius:8,padding:"8px 14px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace",boxShadow:"0 0 16px rgba(13,148,136,0.3)"}}>
              Analizar Correlación →
            </button>
          </>
        )}

        {/* P3 done: run opt */}
        {doneN===3&&(
          <>
            <NInput label="RF" value={rfRate} onChange={setRfRate} min={0} max={15} step={0.1} unit="%"/>
            <NInput label="Periodo" value={optY} onChange={v=>setOptY(Math.max(1,Math.min(v,10)))} min={1} max={10} unit="Y"/>
            <NInput label="Min W" value={minW} onChange={v=>setMinW(Math.min(v,maxW-1))} min={0.5} max={10} step={0.5} unit="%"/>
            <NInput label="Max W" value={maxW} onChange={v=>setMaxW(Math.max(v,minW+1))} min={5} max={50} unit="%"/>
            <button onClick={runCorr} style={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"7px 12px",color:"#34d399",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"monospace"}}>↺ Corr</button>
            <button onClick={runOpt} style={{background:"linear-gradient(135deg,#059669,#0ea5e9)",border:"none",borderRadius:8,padding:"8px 14px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace",boxShadow:"0 0 16px rgba(5,150,105,0.3)"}}>
              Optimizar Cartera →
            </button>
          </>
        )}

        {/* P4 done: recalc */}
        {doneN===4&&(
          <>
            <NInput label="RF" value={rfRate} onChange={setRfRate} min={0} max={15} step={0.1} unit="%"/>
            <NInput label="Periodo" value={optY} onChange={v=>setOptY(Math.max(1,Math.min(v,10)))} min={1} max={10} unit="Y"/>
            <NInput label="Min W" value={minW} onChange={v=>setMinW(Math.min(v,maxW-1))} min={0.5} max={10} step={0.5} unit="%"/>
            <NInput label="Max W" value={maxW} onChange={v=>setMaxW(Math.max(v,minW+1))} min={5} max={50} unit="%"/>
            <button onClick={runOpt} style={{background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"7px 12px",color:"#34d399",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"monospace"}}>↺ Optimizar</button>
          </>
        )}
      </div>

      {/* ── Correlation tab ── */}
      {isCorr&&corrData&&(
        <div style={{padding:"16px 14px 32px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <div style={{width:3,height:22,background:"#0d9488",borderRadius:2}}/>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9"}}>🔗 Análisis de Correlación</div>
              <div style={{fontSize:10,color:"#475569",fontFamily:"monospace"}}>
                {corrData.stocks.length} activos · Período: {corrData.period} años · Rojo = alta correlación · Azul = correlación negativa (diversifica)
              </div>
            </div>
          </div>
          <CorrelationHeatmap stocks={corrData.stocks} corrMatrix={corrData.corrMatrix}/>
        </div>
      )}

      {/* ── Optimization tab ── */}
      {isOpt&&optData&&(
        <div style={{padding:"16px 14px 32px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <div style={{width:3,height:22,background:"#34d399",borderRadius:2}}/>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9"}}>🎯 Optimización de Cartera</div>
              <div style={{fontSize:10,color:"#475569",fontFamily:"monospace"}}>
                {optData.stocks.length} activos · Período: {optY}Y · RF: {rfRate}% · Pesos: mín {minW}% · máx {maxW}%
              </div>
            </div>
          </div>

          <FrontierChart mcPorts={optData.mcPorts} special={optData}/>

          {/* Comparison table */}
          <div style={{marginTop:18,background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"11px 14px",borderBottom:"1px solid #1e293b",fontSize:11,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:2}}>
              Comparación de Portafolios
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>
                    {["Portafolio","Retorno Anual","Volatilidad","Sharpe Ratio"].map(h=>(
                      <th key={h} style={{...TH,textAlign:h==="Portafolio"?"left":"right"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[{k:"minVar",d:optData.minVar},{k:"maxShp",d:optData.maxShp},{k:"rp",d:optData.rp},{k:"ew",d:optData.ew},{k:"spy",d:optData.spy}].map(({k,d})=>{
                    const s=PORT_STYLES[k];
                    return (
                      <tr key={k} style={{borderBottom:"1px solid #0a1628"}}>
                        <td style={{...TD,textAlign:"left"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{width:10,height:10,borderRadius:"50%",background:s.color,flexShrink:0}}/>
                            <span style={{fontWeight:700,color:s.color,fontFamily:"monospace",fontSize:12}}>{s.label}</span>
                          </div>
                        </td>
                        <td style={{...TD,textAlign:"right"}}><CN v={d.ret} suf="%" d={1}/></td>
                        <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#64748b"}}>{d.vol!=null?fmtPct(d.vol):"—"}</td>
                        <td style={{...TD,textAlign:"right"}}><CN v={d.sharpe} d={2}/></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Weights table */}
          <div style={{marginTop:14,background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"11px 14px",borderBottom:"1px solid #1e293b",fontSize:11,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:2}}>
              Asignación de Pesos — Top 15 por Máximo Sharpe
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr>
                    <th style={{...TH,textAlign:"left"}}>Ticker</th>
                    <th style={{...TH,textAlign:"left"}}>Sector</th>
                    <th style={{...TH,color:PORT_STYLES.maxShp.color}}>Max Sharpe</th>
                    <th style={{...TH,color:PORT_STYLES.minVar.color}}>Min Var</th>
                    <th style={{...TH,color:PORT_STYLES.rp.color}}>Risk Parity</th>
                    <th style={{...TH,color:PORT_STYLES.ew.color}}>Equal W.</th>
                  </tr>
                </thead>
                <tbody>
                  {optData.stocks
                    .map((stk,i)=>({stk,msW:optData.maxShp.weights?.[i]||0,mvW:optData.minVar.weights?.[i]||0,rpW:optData.rp.weights?.[i]||0,ewW:optData.ew.weights?.[i]||0}))
                    .sort((a,b)=>b.msW-a.msW)
                    .slice(0,15)
                    .map(({stk,msW,mvW,rpW,ewW},idx)=>{
                      const sc=SECTOR_COLORS[stk.sector]||"#64748b";
                      return (
                        <tr key={stk.symbol} style={{borderBottom:"1px solid #0a1628",background:idx%2===0?"transparent":"#04080f"}}>
                          <td style={{...TD,textAlign:"left",fontWeight:700,color:"#f1f5f9",fontFamily:"monospace"}}>{stk.symbol}</td>
                          <td style={{...TD,textAlign:"left",fontSize:10,color:sc,fontFamily:"monospace"}}>{stk.sector?.slice(0,20)}</td>
                          <td style={{...TD,textAlign:"right"}}>
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              <div style={{flex:1,height:4,background:"#1e293b",borderRadius:2,overflow:"hidden"}}>
                                <div style={{width:`${msW*100}%`,height:"100%",background:PORT_STYLES.maxShp.color,borderRadius:2}}/>
                              </div>
                              <span style={{fontFamily:"monospace",color:PORT_STYLES.maxShp.color,minWidth:40,fontSize:11}}>{fmtPct(msW*100,1)}</span>
                            </div>
                          </td>
                          <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:PORT_STYLES.minVar.color,fontSize:11}}>{fmtPct(mvW*100,1)}</td>
                          <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:PORT_STYLES.rp.color,fontSize:11}}>{fmtPct(rpW*100,1)}</td>
                          <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#475569",fontSize:11}}>{fmtPct(ewW*100,1)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Black-Litterman tab ── */}
      {isBL&&optData&&(
        <div style={{padding:"16px 14px 32px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
            <div style={{width:3,height:22,background:"#818cf8",borderRadius:2}}/>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9"}}>🧠 Black-Litterman</div>
              <div style={{fontSize:10,color:"#475569",fontFamily:"monospace"}}>
                Incorporá tus views del mercado para ajustar los retornos esperados · {optData.stocks.length} activos disponibles
              </div>
            </div>
          </div>

          {/* Parameters */}
          <div style={{background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,padding:"14px 16px",marginBottom:14}}>
            <div style={{fontSize:10,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:2,marginBottom:12}}>Parámetros del modelo</div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-end"}}>
              <NInput label="τ (tau)" value={blTau} onChange={setBlTau} min={0.01} max={0.5} step={0.01}/>
              <NInput label="δ (delta — aversión al riesgo)" value={blDelta} onChange={setBlDelta} min={0.5} max={10} step={0.5}/>
              <div style={{fontSize:10,color:"#334155",fontFamily:"monospace",maxWidth:260,lineHeight:1.6}}>
                τ controla cuánto pesan los views vs el equilibrio del mercado. δ es el coeficiente de aversión al riesgo del mercado (típico: 2.5).
              </div>
            </div>
          </div>

          {/* Views builder */}
          <div style={{background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,padding:"14px 16px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:10,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:2}}>Views del mercado</div>
              <button
                onClick={()=>setBlViews(v=>[...v,{id:Date.now(),assetIdx:0,symbol:optData.stocks[0]?.symbol||"",direction:"up",returnPct:10,confidence:"medium"}])}
                style={{background:"linear-gradient(135deg,#4f46e5,#818cf8)",border:"none",borderRadius:7,padding:"6px 14px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace"}}>
                + Agregar view
              </button>
            </div>

            {blViews.length===0&&(
              <div style={{textAlign:"center",padding:"20px 0",color:"#334155",fontFamily:"monospace",fontSize:11}}>
                Sin views · el modelo usará solo los retornos de equilibrio del mercado.<br/>
                <span style={{fontSize:10,color:"#1e293b"}}>Agregá views para ver cómo tus opiniones afectan la cartera óptima.</span>
              </div>
            )}

            {blViews.map((v,vi)=>{
              const update = (field,val)=>setBlViews(views=>views.map((x,i)=>i===vi?{...x,[field]:val,symbol:field==="assetIdx"?optData.stocks[val]?.symbol||x.symbol:x.symbol}:x));
              return (
                <div key={v.id} style={{background:"#06101e",border:"1px solid #1e293b",borderRadius:10,padding:"12px 14px",marginBottom:8,display:"flex",flexWrap:"wrap",gap:10,alignItems:"center"}}>
                  {/* Ticker */}
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    <span style={{fontSize:9,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:1}}>Activo</span>
                    <select value={v.assetIdx} onChange={e=>update("assetIdx",parseInt(e.target.value))}
                      style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:6,padding:"5px 8px",color:"#e2e8f0",fontSize:12,fontFamily:"monospace",outline:"none",minWidth:100}}>
                      {optData.stocks.map((s,i)=><option key={i} value={i}>{s.symbol}</option>)}
                    </select>
                  </div>

                  {/* Direction */}
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    <span style={{fontSize:9,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:1}}>Dirección</span>
                    <div style={{display:"flex",gap:4}}>
                      {["up","down"].map(d=>(
                        <button key={d} onClick={()=>update("direction",d)}
                          style={{background:v.direction===d?(d==="up"?"#166534":"#7f1d1d"):"#1e293b",border:`1px solid ${v.direction===d?(d==="up"?"#22c55e":"#ef4444"):"#334155"}`,borderRadius:6,padding:"5px 10px",color:v.direction===d?(d==="up"?"#4ade80":"#f87171"):"#64748b",fontSize:13,cursor:"pointer"}}>
                          {d==="up"?"▲":"▼"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Expected return */}
                  <NInput label="Retorno esperado" value={v.returnPct} onChange={val=>update("returnPct",val)} min={0.1} max={100} step={0.5} unit="%"/>

                  {/* Confidence */}
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    <span style={{fontSize:9,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:1}}>Confianza</span>
                    <div style={{display:"flex",gap:4}}>
                      {[{id:"low",label:"Baja"},{id:"medium",label:"Media"},{id:"high",label:"Alta"}].map(c=>(
                        <button key={c.id} onClick={()=>update("confidence",c.id)}
                          style={{background:v.confidence===c.id?"#1e3a5f":"#1e293b",border:`1px solid ${v.confidence===c.id?"#38bdf8":"#334155"}`,borderRadius:6,padding:"5px 10px",color:v.confidence===c.id?"#38bdf8":"#64748b",fontSize:10,cursor:"pointer",fontFamily:"monospace"}}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Summary text */}
                  <div style={{flex:1,minWidth:160,fontSize:10,color:"#64748b",fontFamily:"monospace",lineHeight:1.5,padding:"4px 0"}}>
                    "{optData.stocks[v.assetIdx]?.symbol} va a {v.direction==="up"?"subir":"bajar"} un {v.returnPct}% — confianza {v.confidence==="high"?"alta":v.confidence==="medium"?"media":"baja"}"
                  </div>

                  <button onClick={()=>setBlViews(views=>views.filter((_,i)=>i!==vi))}
                    style={{background:"transparent",border:"1px solid #334155",borderRadius:6,padding:"5px 8px",color:"#475569",fontSize:12,cursor:"pointer"}}>✕</button>
                </div>
              );
            })}

            <button onClick={runBL}
              style={{marginTop:10,width:"100%",background:"linear-gradient(135deg,#4f46e5,#818cf8)",border:"none",borderRadius:8,padding:"12px",color:"white",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"monospace",boxShadow:"0 0 20px rgba(99,102,241,0.35)"}}>
              🧠 Calcular Black-Litterman
            </button>
          </div>

          {/* Results */}
          {blData&&(
            <>
              {/* Comparison table */}
              <div style={{background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden",marginBottom:14}}>
                <div style={{padding:"11px 14px",borderBottom:"1px solid #1e293b",fontSize:11,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:2}}>
                  Comparación — Black-Litterman vs otros portafolios
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr>
                        {["Portafolio","Retorno Anual","Volatilidad","Sharpe"].map(h=>(
                          <th key={h} style={{...TH,textAlign:h==="Portafolio"?"left":"right"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {key:"bl",    d:{...blData},           color:"#818cf8", label:"🧠 Black-Litterman"},
                        {key:"maxShp",d:optData.maxShp,         color:"#fbbf24", label:"🟡 Máximo Sharpe"},
                        {key:"minVar",d:optData.minVar,         color:"#60a5fa", label:"🔵 Mínima Varianza"},
                        {key:"rp",    d:optData.rp,             color:"#a78bfa", label:"🟣 Risk Parity"},
                        {key:"spy",   d:optData.spy,            color:"#f87171", label:"🔴 SPY Benchmark"},
                      ].map(({key,d,color,label})=>(
                        <tr key={key} style={{borderBottom:"1px solid #0a1628",background:key==="bl"?"#08102a":"transparent"}}>
                          <td style={{...TD,textAlign:"left"}}>
                            <span style={{fontWeight:700,color,fontFamily:"monospace",fontSize:12}}>{label}</span>
                          </td>
                          <td style={{...TD,textAlign:"right"}}><CN v={d.ret} suf="%" d={1}/></td>
                          <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#64748b"}}>{d.vol!=null?fmtPct(d.vol):"—"}</td>
                          <td style={{...TD,textAlign:"right"}}><CN v={d.sharpe} d={2}/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* BL weights vs Max Sharpe */}
              <div style={{background:"#040c1a",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"11px 14px",borderBottom:"1px solid #1e293b",fontSize:11,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:2}}>
                  Pesos BL vs Máximo Sharpe — Top 15
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr>
                        <th style={{...TH,textAlign:"left"}}>Ticker</th>
                        <th style={{...TH,textAlign:"left"}}>Sector</th>
                        <th style={{...TH,color:"#818cf8"}}>BL</th>
                        <th style={{...TH,color:"#fbbf24"}}>Max Sharpe</th>
                        <th style={{...TH}}>Δ Retorno esperado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optData.stocks
                        .map((stk,i)=>({stk,i,blW:blData.weights?.[i]||0,msW:optData.maxShp.weights?.[i]||0,muShift:blData.muShift?.[i]||0}))
                        .sort((a,b)=>b.blW-a.blW)
                        .slice(0,15)
                        .map(({stk,blW,msW,muShift},idx)=>{
                          const sc=SECTOR_COLORS[stk.sector]||"#64748b";
                          return(
                            <tr key={stk.symbol} style={{borderBottom:"1px solid #0a1628",background:idx%2===0?"transparent":"#04080f"}}>
                              <td style={{...TD,textAlign:"left",fontWeight:700,color:"#f1f5f9",fontFamily:"monospace"}}>{stk.symbol}</td>
                              <td style={{...TD,textAlign:"left",fontSize:10,color:sc,fontFamily:"monospace"}}>{stk.sector?.slice(0,20)}</td>
                              <td style={{...TD,textAlign:"right"}}>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <div style={{flex:1,height:4,background:"#1e293b",borderRadius:2,overflow:"hidden"}}>
                                    <div style={{width:`${blW*100}%`,height:"100%",background:"#818cf8",borderRadius:2}}/>
                                  </div>
                                  <span style={{fontFamily:"monospace",color:"#818cf8",minWidth:40,fontSize:11}}>{fmtPct(blW*100,1)}</span>
                                </div>
                              </td>
                              <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#fbbf24",fontSize:11}}>{fmtPct(msW*100,1)}</td>
                              <td style={{...TD,textAlign:"right"}}>
                                <span style={{fontFamily:"monospace",fontSize:11,color:muShift>0.001?"#34d399":muShift<-0.001?"#f87171":"#475569"}}>
                                  {muShift>=0?"+":""}{muShift.toFixed(2)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {!isCorr&&!isOpt&&!isBL&&(
        <>
          {/* Sector tabs */}
          <div style={{overflowX:"auto",borderBottom:"1px solid #1e293b",background:"#040d1a"}}>
            <div style={{display:"flex",padding:"0 12px",gap:1,minWidth:"max-content"}}>
              {sectors.map(sector=>{
                const isA=sector===activeSec;
                const col=SECTOR_COLORS[sector]||"#38bdf8";
                return (
                  <button key={sector} onClick={()=>setActiveSec(sector)} style={{background:isA?"#0c1a2e":"transparent",border:"none",borderBottom:`2px solid ${isA?col:"transparent"}`,padding:"9px 12px",cursor:"pointer",color:isA?col:"#475569",fontSize:11,fontWeight:isA?700:400,whiteSpace:"nowrap",fontFamily:"monospace"}}>
                    {SECTOR_ICONS[sector]||""} {sector}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sector title */}
          <div style={{padding:"12px 16px 6px",display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:3,height:22,background:sCol,borderRadius:2}}/>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"#f1f5f9"}}>{SECTOR_ICONS[activeSec]} {activeSec}</div>
              <div style={{fontSize:10,color:"#475569",fontFamily:"monospace"}}>
                {isRisk?`CP: ${cpL} · LP: ${lpL} · RF: ${rfRate}% · Benchmark: SPY`:"Top 5 · Score compuesto · Fundamentales"}
              </div>
            </div>
          </div>

          {isRisk&&(
            <div style={{padding:"0 16px 8px",display:"flex",gap:12}}>
              <span style={{fontSize:10,color:"#4a90c4",fontFamily:"monospace",background:"#0c1e30",borderRadius:3,padding:"2px 8px"}}>{cpL} Corto plazo</span>
              <span style={{fontSize:10,color:"#2d5a8a",fontFamily:"monospace",background:"#060e1a",borderRadius:3,padding:"2px 8px"}}>{lpL} Largo plazo</span>
            </div>
          )}

          {/* ── Audit summary panel (client mode only) ── */}
          {isRisk&&portMode==="client"&&(()=>{
            const allStocks = Object.values(riskData).flat();
            const signals   = allStocks.map(s=>getSignal(s.rcp, corrData, s.symbol)).filter(Boolean);
            const reduce    = signals.filter(s=>s.key==="reduce").length;
            const review    = signals.filter(s=>s.key==="review").length;
            const hold      = signals.filter(s=>s.key==="hold").length;
            const reduceList= Object.values(riskData).flat().filter(s=>{const sg=getSignal(s.rcp,corrData,s.symbol); return sg?.key==="reduce";});
            const reviewList= Object.values(riskData).flat().filter(s=>{const sg=getSignal(s.rcp,corrData,s.symbol); return sg?.key==="review";});
            return (
              <div style={{margin:"0 14px 14px",background:"#06101e",border:"1px solid #1e293b",borderRadius:12,padding:"14px 16px"}}>
                <div style={{fontSize:10,color:"#475569",fontFamily:"monospace",textTransform:"uppercase",letterSpacing:2,marginBottom:12}}>
                  Auditoría de riesgo — {allStocks.length} posiciones analizadas
                </div>
                {/* Signal summary cards */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
                  {[{count:reduce,label:"Reducir",color:"#ef4444",bg:"#1f0505",icon:"🔴"},
                    {count:review,label:"Revisar", color:"#fbbf24",bg:"#1f1505",icon:"🟡"},
                    {count:hold,  label:"Mantener",color:"#34d399",bg:"#051a0a",icon:"✅"}].map(c=>(
                    <div key={c.label} style={{background:c.bg,border:`1px solid ${c.color}22`,borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:700,color:c.color,fontFamily:"monospace"}}>{c.count}</div>
                      <div style={{fontSize:10,color:c.color,fontFamily:"monospace",marginTop:2}}>{c.icon} {c.label}</div>
                    </div>
                  ))}
                </div>
                {/* Action lists */}
                {reduce>0&&(
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:10,color:"#ef4444",fontFamily:"monospace",fontWeight:700,marginBottom:6}}>
                      🔴 Posiciones a reducir — 2+ criterios de riesgo
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {reduceList.map(s=>{
                        const sg=getSignal(s.rcp,corrData,s.symbol);
                        const reasons=["Sharpe<0.5","Alpha<0","DD>25%","Beta>1.5"].filter((_,i)=>sg.reasons[i]);
                        return(
                          <div key={s.symbol} style={{background:"#1a0505",border:"1px solid #ef444433",borderRadius:8,padding:"6px 10px"}}>
                            <span style={{fontWeight:700,color:"#f87171",fontFamily:"monospace",fontSize:12}}>{s.symbol}</span>
                            <span style={{fontSize:9,color:"#64748b",fontFamily:"monospace",marginLeft:6}}>{reasons.join(" · ")}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {review>0&&(
                  <div>
                    <div style={{fontSize:10,color:"#fbbf24",fontFamily:"monospace",fontWeight:700,marginBottom:6}}>
                      🟡 Posiciones a revisar — 1 criterio o alta correlación
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {reviewList.map(s=>{
                        const sg=getSignal(s.rcp,corrData,s.symbol);
                        const reasons=["Sharpe<0.5","Alpha<0","DD>25%","Beta>1.5"].filter((_,i)=>sg.reasons[i]);
                        const hcorr=corrData&&corrData.stocks.findIndex(x=>x.symbol===s.symbol)>=0&&corrData.corrMatrix[corrData.stocks.findIndex(x=>x.symbol===s.symbol)].some((r,j)=>j!==corrData.stocks.findIndex(x=>x.symbol===s.symbol)&&r>0.75);
                        return(
                          <div key={s.symbol} style={{background:"#1a1505",border:"1px solid #fbbf2433",borderRadius:8,padding:"6px 10px"}}>
                            <span style={{fontWeight:700,color:"#fbbf24",fontFamily:"monospace",fontSize:12}}>{s.symbol}</span>
                            <span style={{fontSize:9,color:"#64748b",fontFamily:"monospace",marginLeft:6}}>
                              {[...reasons,hcorr?"Alta correlación":""].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {!isRisk&&(
            <div style={{padding:"0 16px 10px",display:"flex",gap:12,flexWrap:"wrap"}}>
              {FUND_METRICS.map(m=><span key={m.key} style={{fontSize:9,color:"#334155",fontFamily:"monospace"}}>{m.label} {m.hb?"↑":"↓"} ({(m.w*100).toFixed(0)}%)</span>)}
            </div>
          )}

          {/* Main table */}
          <div style={{overflowX:"auto",padding:"0 12px 18px"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:isRisk?900:780}}>
              <thead>
                <tr>
                  <th style={{...TH,width:30}}>#</th>
                  <th style={{...TH,textAlign:"left",minWidth:158}}>Empresa</th>
                  <th style={{...TH}}>Precio</th>
                  {!isRisk&&FUND_METRICS.map(m=><th key={m.key} style={{...TH}} title={m.tip}>{m.label}</th>)}
                  {!isRisk&&<th style={{...TH,minWidth:100}}>Score</th>}
                  {isRisk&&<>
                    <th style={{...TH}}>Retorno</th>
                    <th style={{...TH}}>Volatilidad</th>
                    <th style={{...TH}}>Sharpe</th>
                    <th style={{...TH}}>Beta</th>
                    <th style={{...TH}}>Alpha</th>
                    <th style={{...TH}}>Sortino</th>
                    <th style={{...TH}}>Max DD</th>
                    {portMode==="client"&&<th style={{...TH,textAlign:"center"}}>Señal</th>}
                  </>}
                  <th style={{...TH}}>Mkt Cap</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stk,idx)=>(
                  <tr key={stk.symbol} style={{borderBottom:"1px solid #0a1628",background:idx%2===0?"transparent":"#040c1a"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="#0f172a";}}
                    onMouseLeave={e=>{e.currentTarget.style.background=idx%2===0?"transparent":"#040c1a";}}>
                    <td style={{...TD,textAlign:"center",color:sCol,fontWeight:700,fontSize:13}}>
                      {idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":idx+1}
                    </td>
                    <td style={TD}>
                      <div style={{fontWeight:700,color:"#f1f5f9",fontFamily:"monospace",fontSize:12}}>{stk.symbol}</div>
                      <div style={{fontSize:10,color:"#475569",marginTop:1,maxWidth:145,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{stk.name}</div>
                    </td>
                    <td style={{...TD,textAlign:"right"}}>
                      <div style={{color:"#f1f5f9",fontFamily:"monospace"}}>{fmtP(stk.price)}</div>
                      <div style={{fontSize:10,color:(stk.changePercent||0)>=0?"#34d399":"#f87171",fontFamily:"monospace"}}>
                        {(stk.changePercent||0)>=0?"▲":"▼"}{Math.abs(stk.changePercent||0).toFixed(2)}%
                      </div>
                    </td>
                    {!isRisk&&FUND_METRICS.map(m=>(
                      <td key={m.key} style={{...TD,textAlign:"right",fontFamily:"monospace"}}>
                        {stk[m.key]==null||!isFinite(stk[m.key])
                          ?<span style={{color:"#1e293b"}}>—</span>
                          :(m.key==="roe"||m.key==="netMargin")
                            ?<span style={{color:stk[m.key]>=0?"#e2e8f0":"#f87171"}}>{stk[m.key].toFixed(1)}%</span>
                            :<span style={{color:"#e2e8f0"}}>{stk[m.key].toFixed(1)}x</span>}
                      </td>
                    ))}
                    {!isRisk&&<td style={TD}><ScoreBar score={stk.score}/></td>}
                    {isRisk&&<>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={stk.rcp?.annRet} lpV={stk.rlp?.annRet} cpL={cpL} lpL={lpL} render={v=><CN v={v} suf="%" d={1}/>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={stk.rcp?.sVol} lpV={stk.rlp?.sVol} cpL={cpL} lpL={lpL} render={v=><span style={{fontFamily:"monospace",color:"#64748b"}}>{v!=null?`${v.toFixed(1)}%`:"—"}</span>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={stk.rcp?.sharpe} lpV={stk.rlp?.sharpe} cpL={cpL} lpL={lpL} render={v=><CN v={v}/>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={stk.rcp?.beta} lpV={stk.rlp?.beta} cpL={cpL} lpL={lpL} render={v=>v!=null?<span style={{fontFamily:"monospace",color:Math.abs(v-1)<0.15?"#94a3b8":v>1?"#fbbf24":"#60a5fa"}}>{v.toFixed(2)}</span>:<span style={{color:"#1e293b"}}>—</span>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={stk.rcp?.alpha} lpV={stk.rlp?.alpha} cpL={cpL} lpL={lpL} render={v=><CN v={v} suf="%" d={1}/>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={stk.rcp?.sortino} lpV={stk.rlp?.sortino} cpL={cpL} lpL={lpL} render={v=><CN v={v}/>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={stk.rcp?.maxDD} lpV={stk.rlp?.maxDD} cpL={cpL} lpL={lpL} render={v=><span style={{fontFamily:"monospace",color:v>20?"#f87171":v>10?"#fbbf24":"#34d399"}}>{v!=null?`-${v.toFixed(1)}%`:"—"}</span>}/></td>
                      {portMode==="client"&&(()=>{
                        const sg=getSignal(stk.rcp,corrData,stk.symbol);
                        if(!sg) return <td style={TD}/>;
                        return(
                          <td style={{...TD,textAlign:"center"}}>
                            <div style={{background:sg.bg,border:`1px solid ${sg.color}44`,borderRadius:7,padding:"4px 8px",display:"inline-block"}}>
                              <span style={{fontSize:11,color:sg.color,fontFamily:"monospace",fontWeight:700,whiteSpace:"nowrap"}}>{sg.label}</span>
                            </div>
                          </td>
                        );
                      })()}
                    </>}
                    <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#475569",fontSize:11}}>{fmtCap(stk.marketCap)}</td>
                  </tr>
                ))}

                {/* SPY pivot row */}
                {spy&&(
                  <tr style={{borderTop:"1px solid #1e293b",background:"#03080f"}}>
                    <td style={{...TD,textAlign:"center"}}>📍</td>
                    <td style={TD}>
                      <div style={{fontWeight:700,color:"#475569",fontFamily:"monospace",fontSize:12}}>SPY</div>
                      <div style={{fontSize:10,color:"#1e293b"}}>S&P 500 Benchmark</div>
                    </td>
                    <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#475569"}}>{fmtP(spy.price)}</td>
                    {!isRisk&&<>
                      <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#334155"}}>{spy.pe?`${spy.pe.toFixed(1)}x`:"—"}</td>
                      {FUND_METRICS.slice(1).map(m=><td key={m.key} style={{...TD,textAlign:"right",color:"#1e293b"}}>—</td>)}
                      <td style={{...TD,textAlign:"center"}}><span style={{fontSize:10,color:"#1e293b",fontFamily:"monospace"}}>pivot</span></td>
                    </>}
                    {isRisk&&spyRisk&&<>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={spyRisk.cp?.annRet} lpV={spyRisk.lp?.annRet} cpL={cpL} lpL={lpL} render={v=><CN v={v} suf="%" d={1}/>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={spyRisk.cp?.sVol} lpV={spyRisk.lp?.sVol} cpL={cpL} lpL={lpL} render={v=><span style={{fontFamily:"monospace",color:"#475569"}}>{v!=null?`${v.toFixed(1)}%`:"—"}</span>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={spyRisk.cp?.sharpe} lpV={spyRisk.lp?.sharpe} cpL={cpL} lpL={lpL} render={v=><CN v={v}/>}/></td>
                      <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#64748b"}}>1.00</td>
                      <td style={{...TD,textAlign:"right",color:"#1e293b"}}>—</td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={spyRisk.cp?.sortino} lpV={spyRisk.lp?.sortino} cpL={cpL} lpL={lpL} render={v=><CN v={v}/>}/></td>
                      <td style={{...TD,textAlign:"right"}}><Stack cpV={spyRisk.cp?.maxDD} lpV={spyRisk.lp?.maxDD} cpL={cpL} lpL={lpL} render={v=><span style={{fontFamily:"monospace",color:"#fbbf24"}}>{v!=null?`-${v.toFixed(1)}%`:"—"}</span>}/></td>
                    </>}
                    <td style={{...TD,textAlign:"right",fontFamily:"monospace",color:"#1e293b",fontSize:11}}>{fmtCap(spy.marketCap)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Sector grid */}
          <div style={{padding:"0 12px 26px"}}>
            <div style={{borderTop:"1px solid #0f172a",paddingTop:14,marginBottom:10}}>
              <div style={{fontSize:9,letterSpacing:3,color:"#1e293b",fontFamily:"monospace",textTransform:"uppercase"}}>Líderes por sector</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(148px,1fr))",gap:8}}>
              {Object.keys(fundData).map(sector=>{
                const leader=(isRisk?riskData[sector]:fundData[sector])?.[0];
                if (!leader) return null;
                const col=SECTOR_COLORS[sector]||"#38bdf8";
                const isA=sector===activeSec;
                return (
                  <div key={sector} onClick={()=>setActiveSec(sector)} style={{background:isA?"#0c1a2e":"#050d1c",border:`1px solid ${isA?col:"#0f172a"}`,borderRadius:10,padding:"10px 11px",cursor:"pointer"}}>
                    <div style={{fontSize:9,color:"#334155",marginBottom:3,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{SECTOR_ICONS[sector]} {sector}</div>
                    <div style={{fontWeight:700,color:col,fontFamily:"monospace",fontSize:14}}>{leader.symbol}</div>
                    {isRisk&&leader.rcp&&(
                      <div style={{marginTop:4,display:"flex",gap:6}}>
                        <span style={{fontSize:9,fontFamily:"monospace",color:"#475569"}}>{cpL}: <span style={{color:(leader.rcp.sharpe||0)>=0?"#34d399":"#f87171",fontWeight:700}}>{leader.rcp.sharpe?.toFixed(2)||"—"}</span></span>
                      </div>
                    )}
                    {!isRisk&&<div style={{fontSize:10,color:"#475569",marginTop:4,fontFamily:"monospace"}}>Score: <span style={{color:col,fontWeight:700}}>{leader.score?.toFixed(0)}</span></div>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div style={{textAlign:"center",padding:"4px 0 18px",fontSize:9,color:"#0c1524",fontFamily:"monospace"}}>
        Solo informativo · No constituye asesoramiento de inversión · FMP API
      </div>

      {/* ── Export bar ── */}
      {doneN>=1&&(
        <div style={{borderTop:"1px solid #1e293b",padding:"12px 16px",background:"#040d1a",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div style={{fontSize:10,color:"#334155",fontFamily:"monospace"}}>
            {portMode==="client"?`Cartera: ${clientName||"Sin nombre"} · ${Object.values(fundData).flat().length} activos`:`S&P 500 · ${Object.values(fundData).flat().length} activos seleccionados`}
            {optData&&` · ${optData.mcPorts?.length?.toLocaleString()} simulaciones`}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button
              onClick={()=>exportToExcel(fundData,riskData,optData,blData,corrData,clientName)}
              style={{background:"#0c2a0c",border:"1px solid #166534",borderRadius:8,padding:"7px 16px",color:"#4ade80",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace",display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:14}}>📊</span> Exportar Excel
            </button>
            <button
              onClick={()=>exportToHTML(fundData,riskData,optData,blData,corrData,clientName,spy,rfRate,cpY,lpY)}
              style={{background:"#0c1a2e",border:"1px solid #1e3a5f",borderRadius:8,padding:"7px 16px",color:"#60a5fa",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace",display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:14}}>📄</span> Exportar PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
