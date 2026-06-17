# 📊 Portfolio Analyzer — S&P 500 Screener con yfinance

> Pegá este archivo + App.jsx al inicio de cada conversación nueva.
> Decile a Claude: "Continuamos un proyecto, adjunto el contexto completo. Leélo antes de hacer cualquier cosa."

---

## 🔑 Datos del proyecto

- **URL:** `https://sp500-screener-yf.vercel.app`
- **Repo:** `github.com/marcoscabello10/sp500-screener-yf`
- **App.jsx:** 2189 líneas · **data.py:** 324 líneas
- **Stack:** React + Vite · Python serverless · Vercel (30s timeout configurado)

---

## ✅ App — 7 fases implementadas

| Fase | Estado |
|------|--------|
| F1 Screening fundamental | ✅ funciona |
| F2 Riesgo & Retorno | ⚠️ push pendiente con fix |
| F3 Correlación | ⚠️ push pendiente con fix |
| F4 Optimización Markowitz | ⚠️ sin probar |
| F5 Cartera propia Excel | ⚠️ sin probar |
| F6 Black-Litterman | ⚠️ sin probar |
| F7 Exportación Excel + PDF | ⚠️ sin probar |

---

## 🔧 Fix aplicado — push pendiente

### Diagnóstico final (debug endpoint)
```json
{"empty": true, "shape": "(0, 12)", 
 "columns": ["('Adj Close', 'AAPL')", "('Close', 'AAPL')", ...]}
```
**`empty: true`** — yfinance multi-ticker (`yf.download('AAPL MSFT')`) falla en Vercel. Yahoo bloquea requests con múltiples tickers desde IPs de Vercel.

**Columnas son tuplas** `('Close', 'AAPL')` — orden `(Price, Ticker)`, pero no importa porque el multi-ticker no funciona de todas formas.

### Fix aplicado en data.py
- `action=history` ahora hace fetches **individuales** por símbolo dentro del proxy
- Función `fetch_one(sym)` descarga un ticker a la vez con `yf.download(sym, ...)`
- Con múltiples símbolos: `{sym: fetch_one(sym) for sym in symbols}` → dict de resultados
- `vercel.json` ya tiene `maxDuration: 30` — suficiente para 5 fetches ~1s c/u

### Fix aplicado en App.jsx
- Lotes reducidos de 20 → **5 símbolos** por request
- Proxy recibe 5 símbolos, hace 5 fetches secuenciales ~5s → dentro del límite de 30s

### Archivos a pushear
Dos archivos descargables ya generados: `data.py` y `App.jsx`

```bash
# Reemplazar api/data.py y src/App.jsx, luego:
git add .
git commit -m "fix history fetches individuales, lotes de 5"
git push
```

### Verificación post-push
```
# 1. History individual funciona:
https://sp500-screener-yf.vercel.app/api/data?action=history&symbol=SPY&from=2024-01-01
# Esperado: array de objetos {date, close, ...} con fecha más reciente primero

# 2. History multi devuelve dict:
https://sp500-screener-yf.vercel.app/api/data?action=history&symbol=AAPL,MSFT&from=2024-01-01
# Esperado: {"AAPL": [...], "MSFT": [...]}

# 3. F2 Riesgo en la app: valores reales, no "—"
# 4. F3 Correlación: heatmap sin crash
```

---

## 🔲 Fases post-fix

### FASE D — Test completo F2→F7
Una vez F2/F3 funcionen, probar todas las fases con F12 → Console abierto.

### FASE E — Auditoría de riesgo modo cliente
- Tab "Riesgo" → "🔍 Auditoría de Riesgo" en modo cliente
- Alertas: Sharpe < 0.5 → 🟡, Alpha < 0 → 🟡, MaxDD > 25% → 🔴
- Métricas agregadas del portafolio

### FASE F — Nuevo sector "Unknown"
Agregar subsector al SECTOR_MAP en data.py si aparece uno nuevo.

---

## 💾 Caché en localStorage

| Key | TTL | Fase |
|-----|-----|------|
| `sp500_screener_fund_v2` | 15 días | F1 |
| `sp500_hist_prices_v1` | 7 días | F2/F3/F4 |
| `sp500_client_{nombre}_v1` | 7 días | F5 |

---

## 🐍 Proxy `api/data.py` — acciones

| Action | Parámetros | Estado |
|--------|-----------|--------|
| `sp500` | — | ✅ |
| `quote` | `symbols=AAPL,SPY` | ✅ |
| `ratios` | `symbol=AAPL` | ✅ |
| `profile` | `symbols=AAPL,MSFT` | ✅ |
| `history` | `symbol=AAPL` o `symbol=AAPL,MSFT` | ✅ fix aplicado |
| `debug` | `symbol=AAPL,MSFT` | ✅ (mantener para diagnóstico) |

---

## 🏗️ Estructura del proyecto

```
sp500-screener-yf/
├── api/
│   └── data.py       ← 324 líneas, fetch_one individual
├── src/
│   ├── App.jsx       ← 2189 líneas, lotes de 5
│   └── main.jsx
├── index.html
├── package.json
├── requirements.txt  ← yfinance==0.2.54
├── vite.config.js
└── vercel.json       ← maxDuration: 30s, python3.12
```

---

## 🎨 Sistema de diseño

**Fondos:** `#020817` base · `#040d1a` header · `#0f172a` cards · `#1e293b` borders
**Texto:** `#f1f5f9` · `#475569`
**Positivo:** `#34d399` · **Negativo:** `#f87171` · **Neutro:** `#fbbf24`
**Sectores:** Technology `#38bdf8` · Healthcare `#34d399` · Financials `#fbbf24` · Consumer Discretionary `#f97316` · Communication Services `#a78bfa` · Industrials `#60a5fa` · Consumer Staples `#86efac` · Energy `#fb923c` · Utilities `#c4b5fd` · Real Estate `#fdba74` · Materials `#4ade80`
**Portafolios:** minVar `#60a5fa` · maxShp `#fbbf24` · rp `#a78bfa` · ew `#94a3b8` · spy `#f87171` · bl `#818cf8`

---

## ⚠️ Notas técnicas

1. **yfinance multi-ticker falla en Vercel** — Yahoo bloquea. Solo funciona un ticker a la vez.
2. **maxDuration 30s** — configurado en vercel.json para dar tiempo a 5 fetches secuenciales.
3. **Lotes de 5** — App manda 5 símbolos por request, proxy los descarga uno a uno (~5s total).
4. **history order** — proxy devuelve descendente (nuevo→viejo), App hace .reverse() → ascendente.
5. **calcRisk** — requiere mínimo 60 puntos. Si hist vacío → "—".
6. **SECTOR_MAP** — 180 subsectores mapeados a 11 GICS.

---

## 📋 Instrucción para nueva conversación

```
Continuamos proyecto. Adjunto PROYECTO_CONTEXTO.md y src/App.jsx (2189 líneas).
Leé solo el .md antes de empezar.

Estado: fix de history pusheado. Verificar F2/F3 funcionan.
Reportar resultado de las URLs de verificación del contexto.
```

---

*Actualizado: Junio 2026 · F1 ✅ · Fix history individual ✅ push pendiente · App.jsx 2189 · data.py 324*
