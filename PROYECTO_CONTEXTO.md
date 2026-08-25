# 📊 Portfolio Analyzer — S&P 500 Screener con yfinance

> Pegá este archivo al inicio de cada conversación nueva.
> Decile a Claude: "Continuamos un proyecto, adjunto el contexto completo. Leélo antes de hacer cualquier cosa."
>
> El tema de "informe avanzado" (tesis de inversión, CAGR, sentimiento,
> guidance) vive en un archivo APARTE: `CONTEXTO_INFORME_AVANZADO.md`.
> No lo mezcles acá — es un proyecto/proceso distinto.

---

## 🔑 Datos del proyecto
- **URL:** `https://sp500-screener-yf.vercel.app`
- **Repo:** `github.com/marcoscabello10/sp500-screener-yf`
- **Stack:** React + Vite · Python serverless · Vercel (maxDuration: 30s)

---

## 🚨 Regla operativa: verificar pushes entre sesiones

Ya pasó 2 veces que una sesión de fixes no se pusheó y la siguiente se
construyó encima sin darse cuenta, perdiendo el trabajo. **Al iniciar
sesión, verificar con `grep` que los cambios de la sesión anterior estén
realmente en el repo clonado antes de asumirlo.**

---

## 🎉 ESTADO GENERAL

| Fase | Estado |
|------|--------|
| F1 Screening fundamental | ✅ filtro CEDEAR real (closure bug + caché por modo arreglados) |
| F2 Riesgo & Retorno | ✅ demora F3→F4 corregida |
| F3 Correlación | ✅ Top N diversificado, puede repetir sector si CEDEAR limita opciones |
| F4 Markowitz | ✅ mismas mejoras que F3 |
| F5 Cartera propia | ✅ **arreglada** — usa snapshot local en vez de fetch en vivo, + sugerencias de reemplazo |
| F6 Black-Litterman | ✅ revisado y documentado |
| F7 Exportación | ✅ incluye N° comitente |

**Pendiente de push:**
```bash
git add src/App.jsx
git commit -m "fix: F5 usa snapshot local + sugerencias de reemplazo por score bajo"
git push
```
Después: `localStorage.clear()` → recargar Excel en F5 y confirmar que
ahora sí trae precios/ratios reales.

---

## 🐛 BUG DE ESTA SESIÓN — F5 (Cartera propia) devolvía todo en $0.00

### Síntoma
Cartera de 7 activos (AMD, CAT, MSFT, LRCX, AAPL, RGTI, HIMS) — todos con
precio $0.00, sector "Unknown", score 0/6, todos los múltiplos en "—".

### Causa raíz
`runClientP1` (F5) hacía **100% de llamadas en vivo** a Yahoo vía Vercel
(`action=quote`, `action=profile`, `action=ratios`) para CADA ticker —
nunca usaba el snapshot del bot local para precios/ratios, solo lo
consultaba para el chequeo de CEDEAR. Cuando Yahoo bloquea/limita Vercel
en ese momento (el problema de siempre en este proyecto), TODO sale vacío.

### Fix aplicado
`runClientP1` ahora:
1. Carga el snapshot del bot local primero
2. Para cada ticker de la cartera que esté en el S&P 500 (la gran mayoría
   de una cartera con CEDEARs), usa los datos del snapshot directo —
   precio, market cap, y los 9 ratios (P/E, P/B, ROE, D/E, EV/EBITDA,
   margen, ROA, crecimiento de revenue, P/S) — sin ninguna llamada a Yahoo
3. Solo los tickers que **no** son del S&P 500 (posiblemente RGTI, HIMS)
   siguen yendo a fetch en vivo — mismo riesgo de bloqueo que antes, pero
   ahora acotado a un subconjunto chico, no a toda la cartera

**Limitación conocida que queda:** si un ticker de la cartera NO es del
S&P 500 Y Yahoo está bloqueando Vercel en ese momento, ese ticker
específico puede seguir saliendo en $0.00. El resto de la cartera (los
que sí están en el S&P 500) va a andar bien igual.

---

## 🆕 FEATURE NUEVA — Sugerencia de reemplazo por score bajo

Para cualquier activo de la cartera con score < 45/100, F5 ahora muestra
una fila debajo con 2 alternativas sugeridas:
- **Mismo sector:** la mejor opción disponible en el mismo sector que el
  cliente no tenga ya, con CEDEAR verificado
- **Otro sector:** la mejor opción disponible en cualquier otro sector,
  mismo criterio

**Cómo funciona:** reutiliza el mismo algoritmo de score que usa F1
(percentil por sector, mismos 6 `FUND_METRICS`), pero corrido sobre el
**S&P 500 completo** (no solo la cartera), usando el snapshot ya cargado
— sin pedir datos nuevos. Ejemplo real: si RGTI tiene score bajo, puede
sugerir GOOGL (mismo sector Tecnología) y MO (otro sector, Consumer
Staples) si tienen mejor score y CEDEAR disponible.

---

## 📐 CARTERA PROPIA (F5) — checklist de validación pendiente
- [ ] Confirmar que después del push, los 5 tickers del S&P 500 (AMD, CAT,
  MSFT, LRCX, AAPL) traen precio/ratios reales
- [ ] Confirmar qué pasa con RGTI y HIMS (¿son S&P 500? si no, van a
  seguir con fetch en vivo — puede fallar según el momento)
- [ ] Confirmar que las sugerencias de reemplazo aparecen para activos
  con score bajo y tienen sentido

---

## ⚙️ Arquitectura de datos

| Endpoint/fuente | Uso | Corre desde |
|---|---|---|
| `local_bot/fetch_fundamentals.py` | F1 + F5 (S&P 500) — quote+ratios+CEDEAR de 503+SPY | PC de Marcos |
| `public/data/sp500_fundamentals.json` | F1 lee esto + F5 lo usa como fuente primaria (no solo CEDEAR) | Vercel (estático) |
| `action=quote`/`ratios`/`profile` | F5 — SOLO fallback para tickers fuera del S&P 500 | Vercel (Yahoo en vivo) |
| `action=history` | F2/F3/F4 (ventana ancha compartida) | Vercel (Twelve Data, 8 créditos/min) |

## 📐 Reglas de oro (acumulado + nuevas)
1. Verificar que los cambios de una sesión anterior realmente se pushearon
2. `useCallback` con deps vacías (`[]`) que usa state interno = closure
   obsoleto
3. Cachear con clave que distinga TODOS los parámetros que cambian el
   resultado
4. Yahoo bloquea IPs de datacenter/cloud → bot local para volumen alto
5. Twelve Data free tier: 8 créditos/minuto
6. Cachear con la ventana más ANCHA posible, recortar después
7. Toda API dinámica necesita `Cache-Control: no-store` explícito
8. No cachear resultados incompletos
9. Capturar TODOS los caminos de error
10. Antes de entregar código, correr el build real
11. Preferir verificación en vivo sobre listas estáticas
12. Un log de Vercel con "warning"/"warn" no es necesariamente un error —
    revisar si dice "Build Completed" y "Deployment completed"
13. **Cuando una funcionalidad ya tiene una fuente de datos confiable
    disponible (ej. el snapshot del bot local), preferirla sobre hacer
    fetch en vivo — aunque el fetch en vivo "debería" funcionar, el
    snapshot es más rápido y no depende del estado de Yahoo en ese momento**
14. Para features de "comparar contra el mercado" (ej. sugerir
    reemplazos), reutilizar el mismo algoritmo de scoring ya construido
    en vez de inventar uno nuevo — consistencia + menos código

---

## 💾 Caché
- `public/data/sp500_fundamentals.json` — snapshot del bot local, sin TTL
- `sp500_screener_fund_v2_all` / `..._cedear` (separados) → 15 días (F1)
- `sp500_hist_prices_v1` → 7 días (F2/F3/F4)
- `sp500_client_{nombre}_v1` → 7 días (F5)

---

## 📋 Instrucción para nueva conversación
```
Continuamos proyecto. Adjunto PROYECTO_CONTEXTO.md.
Verificar con grep que los fixes de la última sesión (snapshotMap en
runClientP1, marketScore/suggestReplacement, Fragment importado)
realmente se pushearon antes de asumir que están activos.
Pendiente: push + validar F5 con Excel real (5 tickers S&P 500 deberían
andar ya; RGTI/HIMS si no son S&P 500 quedan con el riesgo de siempre).
El tema "informe avanzado" está en CONTEXTO_INFORME_AVANZADO.md aparte.
```

---
*Actualizado: Agosto 2026 · F5 arreglada (snapshot local en vez de fetch en vivo) · Sugerencias de reemplazo implementadas · Pendiente validar con Excel real*
