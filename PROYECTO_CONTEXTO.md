# 📊 Portfolio Analyzer — S&P 500 Screener con yfinance

> Pegá este archivo al inicio de cada conversación nueva.
> Decile a Claude: "Continuamos un proyecto, adjunto el contexto completo. Leélo antes de hacer cualquier cosa."

---

## 🔑 Datos del proyecto
- **URL:** `https://sp500-screener-yf.vercel.app`
- **Repo:** `github.com/marcoscabello10/sp500-screener-yf` (branch `main`)
- **Stack:** React + Vite · Python serverless · Vercel (maxDuration: 30s)

---

## ✅ Estado de fases

| Fase | Estado |
|------|--------|
| F1 Screening fundamental | 🟡 funciona pero solo ~101/503 stocks — fix listo, pendiente push |
| F2 Riesgo & Retorno | ✅ funciona (Twelve Data para histórico) |
| F3 Correlación | ✅ funciona — heatmap mejorado (celdas grandes, números, labels) |
| F4 Optimización Markowitz | ✅ funciona — exclusión de activos con reoptimización instantánea |
| F5 Cartera propia Excel | ⚠️ sin tocar |
| F6 Black-Litterman | ⚠️ sin tocar |
| F7 Exportación Excel + PDF | ⚠️ sin tocar |

---

## 🎯 FIX PENDIENTE DE PUSH — F1 solo toma ~101 stocks

### Causa raíz
`action=quote` usaba Twelve Data `/quote` con batches de 5 símbolos → 100 requests
secuenciales → lento → muchos fallan → ~101 stocks con datos.

### Fix aplicado (archivos generados, NO pusheados aún)

**`api/data.py`** — `action=quote` reemplazado con Yahoo Finance batch endpoint:
- `GET https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,MSFT,...`
- 1 sola request HTTP para todos los símbolos del batch (hasta 100)
- Mismo dominio que `.info` → confirmado funcional desde Vercel
- Sin Twelve Data → sin riesgo de costos futuros
- Incluye `marketCap` (que Twelve Data no daba en free tier)
- Fallback a yfinance individual si el batch falla

**`src/App.jsx`** — batch size de quotes en F1: `chunk(allSyms, 5)` → `chunk(allSyms, 50)`
- 503 stocks ÷ 50 = ~10 requests en lugar de 100
- Cada request hace 1 sola llamada Yahoo batch para 50 símbolos → ~1s por request
- Total estimado: ~10-15s para cargar los 503 stocks

### Cómo pushear
```bash
git add api/data.py src/App.jsx
git commit -m "fix: Yahoo Finance batch para quotes F1, chunk 5→50, sin Twelve Data"
git push
```

### Verificación post-push
1. Limpiar caché: F12 → Console → `localStorage.clear()`
2. Recargar — F1 debería cargar todos los ~503 stocks
3. Si el batch Yahoo funciona → precio, marketCap, PE para todos
4. Si batch falla (rate limit) → los stocks caen al fallback (price=0) pero no crashea

---

## 🏗️ Arquitectura de datos confirmada

| Endpoint | Fuente | Estado |
|----------|--------|--------|
| `action=sp500` | Wikipedia (urllib) | ✅ funciona |
| `action=quote` | Yahoo Finance batch `/v7/finance/quote` | 🟡 fix pendiente push |
| `action=ratios` | yfinance `.info` (1 símbolo) | ✅ funciona |
| `action=profile` | yfinance `.info` (loop) | ✅ funciona |
| `action=history` | Twelve Data `/time_series` | ✅ funciona |
| `action=debug` | Test múltiples endpoints | ✅ funciona |

---

## 🔧 Historial técnico relevante

- **Yahoo Finance `chart/v8`** (histórico) bloqueado en Vercel → reemplazado por Twelve Data
- **Yahoo Finance `quoteSummary`** (`.info`) funciona desde Vercel ✅
- **Yahoo Finance `/v7/finance/quote`** (batch) — mismo dominio que `.info`, debería funcionar
- **Stooq:** bot protection con JS challenge → no funciona desde Vercel
- **Twelve Data:** funciona para histórico, API key `TWELVEDATA_API_KEY` en Vercel env vars
- **brotli:** `requests` no lo soporta → `Accept-Encoding: gzip, deflate` (sin `br`)
- **vercel.json:** sin campo `runtime` — autodetecta Python por `requirements.txt`
- **Webhook GitHub→Vercel:** poco confiable → redeploy manual si push no dispara

---

## 💾 Caché localStorage

| Key | TTL | Fase |
|-----|-----|------|
| `sp500_screener_fund_v2` | 15 días | F1 |
| `sp500_hist_prices_v1` | 7 días | F2/F3/F4 |

**Siempre hacer `localStorage.clear()` después de cambios de código para forzar datos frescos.**

---

## 🎨 Features implementadas (en producción)
- F3: heatmap con celdas grandes (72px para 4 activos), números de correlación, labels legibles
- F4: botón × por activo → excluye de optimización → recalcula MC instantáneo
  - Regla: mínimo `max(3, ceil(n×0.75))` activos incluidos
  - Botón "Resetear" para volver al estado original
  - Activos excluidos aparecen tachados con 0% en todas las estrategias

---

## 📋 Instrucción para nueva conversación
```
Continuamos proyecto. Adjunto PROYECTO_CONTEXTO.md.
Leélo antes de hacer cualquier cosa.

Estado: F2/F3/F4 funcionan. F1 solo toma ~101/503 stocks.
Fix listo (Yahoo batch quote + chunk 50): adjunto App.jsx y data.py.
Pushear, limpiar caché, verificar que F1 carga todos los stocks.
Luego continuar con F5/F6/F7.
```

---
*Actualizado: Julio 2026 · F1 🟡 fix pendiente · F2 ✅ · F3 ✅ mejorado · F4 ✅ con exclusión · F5/F6/F7 ⚠️ sin tocar*
