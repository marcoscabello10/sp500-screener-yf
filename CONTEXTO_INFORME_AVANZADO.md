# 🧾 Informe avanzado — contexto del proyecto

> Proyecto **separado** del screener (`PROYECTO_CONTEXTO.md`). No mezclar:
> el screener filtra y arma carteras; esto genera un **informe por activo**.
> Comparten carpeta y repo, pero son dos proyectos con contextos distintos.
> Pegá este archivo al inicio de cada conversación nueva sobre el informe.

---

## 🎯 Qué es

Un informe de análisis por activo que va **más allá de los ratios** del
screener: crecimiento histórico, consenso de analistas, y una tesis de
inversión escrita con riesgos y pros.

**El input viene del screener** (Excel/HTML + snapshot de fundamentales).
Está permitido leer y analizar el contexto del screener por ese motivo — pero
el código, el deploy y las decisiones de este proyecto se mantienen separados.

---

## ✅ Dirección confirmada — Opción B + C

1. **Entrada: lo que ya produce el screener.** El informe lee el Excel/HTML
   que el screener ya genera. No duplica el pipeline de screening.
2. **Bot local para el histórico.** Mismo patrón que
   `local_bot/fetch_fundamentals.py`: corre en la PC de Marcos (Yahoo bloquea
   IPs de datacenter), genera un snapshot JSON.
3. **Consenso de analistas: evaluado con yfinance primero.** ✅ Resuelto —
   ver "Resultado de la sonda". No hace falta fuente externa.
4. **Tesis de inversión + riesgos/pros en texto.** ✅ Decidido: **híbrido** —
   reglas eligen los hechos, modelo de lenguaje los redacta.
5. **Guidance y sentimiento** eran *nice to have*. ✅ Ambos resultaron
   alcanzables con yfinance, con una salvedad de etiquetado (ver abajo).

---

## 🔬 Resultado de la sonda — 21/08/2026

Corrida de `local_bot/probe_analistas.py` sobre 10 tickers de sectores
distintos (AAPL, MSFT, CAT, AMD, LRCX, MO, XOM, JPM, UNH, NEE).
**10/10 OK, cero errores.** Detalle crudo en `local_bot/probe_analistas_out.json`.

### ✅ A) Consenso de analistas — yfinance ALCANZA, sin fuente externa

`.info` devuelve, con cobertura pareja en los 10:

| Campo | Rango observado |
|---|---|
| `recommendationKey` | `strong_buy` / `buy` / `hold` |
| `recommendationMean` | 1.36 – 2.64 |
| `numberOfAnalystOpinions` | 11 (MO) – 53 (MSFT) |
| `targetMeanPrice` / `Median` / `High` / `Low` | completos en los 10 |

**Insight clave:** `fetch_fundamentals.py` **ya hace esa misma llamada
`.info`** por ticker. Sumar consenso al snapshot cuesta **0 llamadas extra** —
es ampliar el bot que ya corre, no escribir uno nuevo.

`analyst_price_targets` devuelve lo mismo que `.info` (current/high/low/mean/
median): **no justifica la llamada extra**.

### ✅ Guidance → en realidad es consenso forward (ojo con el etiquetado)

`earnings_estimate` y `revenue_estimate` traen, por `0q` / `+1q` / `0y` / `+1y`:
`avg`, `low`, `high`, `numberOfAnalysts`, `growth`, `yearAgoEps/Revenue`.

⚠️ **Esto NO es guidance de la empresa** — es lo que esperan los analistas.
Sirve para lo mismo en la práctica, pero en el informe hay que rotularlo como
"consenso de analistas", nunca como "la empresa proyecta".

`growth_estimates` incluye una fila `LTG` (long term growth) pero
`stockTrend` vino **null** en los 10 tickers — no usable.

### ✅ Sentimiento — medible y sin scraping

- `upgrades_downgrades`: 162 (MO) a 970 (AAPL) revisiones históricas, con
  firma, grado anterior/nuevo, y precio objetivo anterior/nuevo.
- `eps_revisions`: subas y bajas de estimación a 7 y 30 días.
- `recommendations`: 4 meses de consenso (`0m`, `-1m`, `-2m`, `-3m`) →
  permite calcular si el consenso mejora o se deteriora.

### ⚠️ B) Histórico para CAGR — LA limitación real

`income_stmt` devuelve 5 columnas pero **la más vieja viene vacía**: quedan
**4 datos = CAGR de 3 años**. Filas confirmadas disponibles: `Total Revenue`,
`Diluted EPS`, `Basic EPS`, `Net Income`, `EBITDA`, `EBIT`, `Gross Profit`,
`Operating Income`, `Research And Development`, entre otras.

**A 3 años el año base distorsiona gravemente:**

| Ticker | CAGR revenue | CAGR EPS | Por qué |
|---|---|---|---|
| XOM | **-6,7%** | **-20,4%** | 2022 fue pico de energía |
| UNH | +11,4% | **-14,5%** | colapso de márgenes desde base alta |
| AMD | +13,6% | +46,7% | base 2022 deprimida |

No es que el dato esté roto: es que 3 años es una ventana demasiado corta
para un número que va en la portada del informe.

### 🐛 Versiones de yfinance — CORRECCIÓN IMPORTANTE

Una conclusión anterior de esta sesión **estaba mal y quedó corregida**:

❌ *"la 0.2.54 no tiene los endpoints de analistas, hay que subir el pin"* →
**FALSO.** Verificado por introspección: la **0.2.54 ya tiene**
`analyst_price_targets`, `earnings_estimate`, `eps_revisions` y
`upgrades_downgrades`.

✅ Lo correcto: **NO tocar `requirements.txt` de la raíz.** Ese archivo es el
que **instala Vercel** para `api/data.py`, que usa
`yf.Ticker(sym, session=...)` y toca internos privados
(`yfinance.data.YfData`, `._crumb`, `._session`). Está pineado a `0.2.54`
porque es lo que funciona en producción hoy. Subirlo es riesgo puro sin
beneficio: la 0.2.54 ya alcanza para todo.

La PC corre **1.4.1** y la sonda se validó ahí. Eso se documenta en un archivo
**aparte**, `local_bot/requirements.txt`, que Vercel no lee (solo mira la raíz
y el directorio de la función). **No unificar los dos archivos.**

Detalle de compatibilidad verificado (por si alguna vez hace falta):
`session=` sigue existiendo en 1.4.1 y acepta `requests.Session`, y `YfData()`
sigue teniendo `._crumb` / `._session`. O sea que subir **probablemente**
andaría — pero "probablemente" no es razón para tocar producción.

- Tiempo medido: **2,1 s/ticker** con todos los endpoints → ~17 min para 504.

---

## 🚦 Estado

| Paso | Estado |
|------|--------|
| Definir dirección (B+C) | ✅ confirmada |
| Sonda: ¿yfinance cubre consenso? | ✅ **sí**, con 0 llamadas extra |
| Sonda: ¿yfinance cubre histórico? | ⚠️ **solo 3 años** → se resuelve con SEC EDGAR |
| Tesis: reglas vs. LLM | ✅ **híbrido** (reglas eligen, LLM redacta) |
| Estética | ✅ **serif de research financiero**, documento claro |
| Alcance del histórico | ✅ **SEC EDGAR, on-demand por activo** |
| Dónde se genera | ✅ **en Vercel, en vivo** |
| Modelo de lenguaje | ✅ **Claude Haiku 4.5** por defecto, con adaptador |
| Alcance: screening (F1) + cartera propia (F5) | ✅ definido |
| Tickers fuera del S&P 500 (RGTI, HIMS) | ✅ resuelto con `fetch_informe.py` |
| Extender `fetch_fundamentals.py` con consenso | ✅ hecho, 4 inserciones, screener intacto |
| Bot del informe (`fetch_informe.py`) | ✅ hecho y probado offline |
| Pin de yfinance | ✅ resuelto — raíz NO se toca, bot tiene archivo propio |
| Correr los dos bots con datos reales | ✅ 504/504 y 7/7, sin fallos |
| Cachear `check_cedear` (28 min → ~8 min) | ✅ hecho y probado (6 escenarios) |
| Un repo / un Vercel / dos páginas Vite | ✅ decidido |
| Sonda de SEC EDGAR (`probe_edgar.py`) | ✅ corrida — mapeo validado, dif 0,00 vs yfinance |
| Fix de la cascada (bug del net income de CAT) | ✅ hecho y probado |
| Control de gasto del LLM (endpoint partido en 2) | ✅ diseñado |
| Ampliación a 59 campos (dividendos, FCF, forward, riesgo) | ✅ hecho y probado |
| Tratamiento por sector (percentil + reglas) | ✅ decidido, falta implementar |
| 4 señales derivadas | ✅ datos listos, faltan las reglas |
| Re-correr los dos bots (59 campos) | ✅ validado sobre 504 reales |
| **Re-correr `probe_edgar.py`** (crasheaba, ya corregido) | 🔄 **siguiente paso de Marcos** |
| Endpoint del informe en Vercel (EDGAR + reglas + LLM) | ⬜ pendiente |
| Reglas de tesis / riesgos / pros | ⬜ pendiente |
| Plantilla visual del informe | ⬜ pendiente |
| Subir `maxDuration` de 30 a 60 en vercel.json | ⬜ pendiente (al construir el endpoint) |

---

## 🌐 ¿App aparte? — UN repo, UN Vercel, dos páginas

**Decisión: un solo repo de GitHub y un solo proyecto de Vercel.** La
separación se hace con **archivos**, no con deploys.

### Por qué NO un Vercel aparte (el argumento que decide)
Los resultados del screening y la cartera de F5 viven en el **`localStorage`
del navegador**, que está atado al **origen** (el dominio). Un deploy separado
= otro dominio = **no puede leer nada de lo que el screener guardó**. Habría
que exportar e importar a mano en cada informe. Con un solo deploy comparten
origen y el informe lee los resultados directo.

Además el informe necesita `public/data/informe_consenso.json`, que ya se
sirve desde ese dominio — con dos proyectos habría que duplicar archivos o
pelear con CORS. Y en costo no se gana nada: dos proyectos en Hobby siguen
siendo US$0.

### Cómo se separan entonces: Vite multipágina
Vite permite varias páginas en un mismo proyecto. Quedan dos apps
independientes, con bundles separados y sin una línea compartida, que
casualmente se publican juntas:

| Ruta | Archivo | Proyecto |
|---|---|---|
| `/` | `index.html` → `src/main.jsx` → `src/App.jsx` | **screener** (no se toca) |
| `/informe` | `informe.html` → `src/informe/main.jsx` | **informe** (nuevo) |
| — | `api/data.py` | **screener** (no se toca) |
| — | `api/informe.py` | **informe** (nuevo) |
| — | `public/data/sp500_fundamentals.json` | **screener** |
| — | `public/data/informe_consenso.json` · `informe_detalle.json` | **informe** |

`src/App.jsx` **no se modifica ni una línea**. Requiere un cambio chico en
`vite.config.js` para declarar las dos entradas. Si algún día se quiere
separar de verdad, se mueve `src/informe/` a otro repo y listo.

---

## 🏗️ Arquitectura decidida

**Regla de reparto: el bot local recolecta, Vercel genera.**

| Pieza | Dónde corre | Por qué ahí |
|---|---|---|
| Consenso de analistas (yfinance `.info`) | **Bot local** | Yahoo bloquea IPs de datacenter |
| Histórico / CAGR (SEC EDGAR) | **Vercel, en vivo** | La SEC **no** bloquea cloud |
| Reglas de tesis | **Vercel** | Datos ya disponibles ahí |
| Redacción (LLM) | **Vercel** (función serverless) | Key en variable de entorno |
| Presentación | **Vercel**, sección propia | Input del screener ya está ahí |

### ⚠️ Restricción dura
**Nada en Vercel puede llamar a Yahoo.** Todo dato de Yahoo entra por el
snapshot que genera el bot local. Es la regla de oro #4 y no la arregla
ningún diseño.

### Detalles técnicos ya resueltos
- **SEC EDGAR:** gratis, sin API key, **10 req/s**, User-Agent obligatorio con
  nombre y mail. Usar el endpoint **`companyconcept`** (un concepto por
  pedido, liviano) y **no** `companyfacts` (varios MB, no entra cómodo en una
  función serverless). Requiere mapear ticker → CIK con el `company_tickers.json`
  de la SEC.
- **Mapeo XBRL en cascada:** las empresas usan conceptos distintos para lo
  mismo (`Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`,
  `SalesRevenueNet`). Hace falta fallback por concepto. Bancos y aseguradoras
  reportan con otra estructura. Ojo con reformulaciones de años viejos.
- **`maxDuration`:** hoy está en 30 s; Hobby permite 60. Subirlo, porque la
  cadena EDGAR + reglas + LLM puede pasarse (solo la redacción se come 10-30 s).
- **Caché del informe generado**, con TTL alineado a los TTL actuales del
  screener. Sin caché, cada recarga del navegador es una llamada paga al LLM.
- **Vercel Hobby alcanza de sobra** (1 M invocaciones y 100 GB/mes). El único
  gatillo de costo real es el **uso comercial**: los términos exigen Pro
  (US$20/mes por asiento) si el proyecto sirve a clientes que pagan.

### ✅ Los dos bots (implementado 21/08/2026)

| Archivo | Qué hace | Tickers | Costo |
|---|---|---|---|
| `local_bot/fetch_fundamentals.py` | **del screener** + captura consenso básico | los 504 | **0 llamadas extra** |
| `local_bot/fetch_informe.py` | **del informe**, standalone | solo la lista corta | ~2 s/ticker |

**Archivos de datos, uno por proyecto:**

- `public/data/sp500_fundamentals.json` → **del screener**, no se toca
- `public/data/informe_consenso.json` → consenso básico de los 504 (nuevo)
- `public/data/informe_detalle.json` → todo lo del informe (nuevo)

#### Edición a `fetch_fundamentals.py` — 4 inserciones, 0 líneas tocadas
El `diff` contra el original son **cuatro inserciones puras**: ninguna línea
del screener fue borrada ni modificada. Garantías:

1. La captura va envuelta en `try/except` que se traga **todo**.
2. `informe_consenso.json` se escribe **después** del snapshot del screener,
   también en `try/except` — si falla, avisa y el screener ya quedó a salvo.
3. `sp500_fundamentals.json` quedó **byte a byte idéntico** al que produce el
   original (verificado comparando ambas versiones sobre los mismos datos).

Probado con tres sabotajes deliberados — acumulador que explota en cada
ticker, escritura del archivo imposible, y Yahoo devolviendo `.info` sin
ningún campo de consenso. En los tres el screener guardó su snapshot intacto.

#### `fetch_informe.py` — resuelve los tickers fuera del S&P 500
Totalmente independiente: **no importa nada** de `fetch_fundamentals.py`, así
que ni con un bug puede afectar al screener. Lo único que hace con archivos
del screener es **leer** `sp500_fundamentals.json` (solo lectura) para saber
qué tickers ya están cubiertos.

- Un ticker fuera del S&P 500 (RGTI, HIMS) recibe **los fundamentales
  completos** acá, con la misma forma de campos que el snapshot del screener.
- El sector de Yahoo se normaliza a la taxonomía del screener
  (`Financial Services` → `Financials`, `Consumer Cyclical` → `Consumer
  Discretionary`, etc.) para poder comparar contra los percentiles de F1.
- Si el ticker **sí** está en el snapshot, hereda de ahí `sector` y
  `hasCedear` en vez de volver a preguntar — no mezcla dos taxonomías ni
  gasta llamadas.
- **Acumula** por defecto: agregar un papel no obliga a rebajar todos.
  `--reset` empieza de cero.
- Tickers desde CLI (`python fetch_informe.py AAPL RGTI`) o desde
  `local_bot/tickers_informe.txt`.

Uso normal:
```bash
cd local_bot
python fetch_fundamentals.py     # diario, como siempre (ahora deja 2 archivos)
python fetch_informe.py          # cuando cambia la lista de activos
```

---

## 🎨 Decisiones de formato

- **Estética: documento claro, serif de research financiero.** Títulos y
  cuerpo en serif (tipo Source Serif / Lora), fondo blanco roto, acento azul
  petróleo sobrio, **números en monospace** para que las columnas alineen.
  Pensado para leer largo, imprimir y compartir en PDF.
- **Rompe a propósito** con el dark slate + monospace del screener: un informe
  se lee distinto que un panel de control.
- Referencia de lo que **NO** se usa (estética del screener): fondo `#0f172a` /
  `#1e293b`, bordes `#334155`, texto `#94a3b8`, acentos `#38bdf8` (sky),
  `#34d399` (verde), `#fbbf24` (ámbar), `#f87171` (rojo), todo monospace.
- Valores hex exactos del informe: **a definir al construir la plantilla**.

---

## ✍️ Tesis de inversión — híbrido confirmado

Las **reglas** detectan los hechos desde los datos (P/E alto contra su sector,
CAGR fuerte o débil, consenso deteriorándose, upside del precio objetivo,
revisiones de EPS a la baja). El **modelo de lenguaje** solo los convierte en
prosa. El LLM no elige los hechos, así que no puede inventar datos.

**Modelo: Claude Haiku 4.5** ($1 entrada / $5 salida por millón de tokens),
escrito con **adaptador de proveedor** para poder enchufar OpenAI cambiando
una variable de entorno.

Costo estimado (~2.000 tokens de entrada, ~800 de salida por informe):
**~US$0,006 por informe**, ~US$3 por los 503 completos. El caché de prompt
baja la entrada al 10% si las instrucciones son estables.

⚠️ **Regla de redacción:** lo que sale de `earnings_estimate` /
`revenue_estimate` es **consenso de analistas**, no guidance de la empresa.
El texto nunca debe decir "la empresa proyecta".

---

## ✅ Primera corrida real de los dos bots — 21/08/2026

| Bot | Resultado | Tiempo |
|---|---|---|
| `fetch_fundamentals.py` | **504/504, 0 fallos**, 151 con CEDEAR | 1705 s (28,4 min) |
| `fetch_informe.py` | **7/7, 0 avisos** (AAPL, MSFT, CAT, LRCX, AMD, RGTI, HIMS) | 20 s |

**Screener intacto, verificado sobre el archivo real:** las 504 acciones tienen
**exactamente los 16 campos de siempre**, sin un solo campo filtrado del
informe. `count: 504`, `failed_count: 0`.

### Cobertura de `informe_consenso.json` (504 símbolos)

| Campo | Cobertura |
|---|---|
| `recommendationKey` | 503/504 (99,8%) |
| `numberOfAnalystOpinions` | 499/504 (99,0%) |
| `targetMeanPrice` / `targetMedianPrice` / `upsidePct` | 499/504 (99,0%) |
| `forwardEps` | 502/504 (99,6%) |
| `recommendationMean` | **471/504 (93,5%)** |

- Analistas por papel: **mín 2 · mediana 20 · máx 60**
- Upside: **mín -36,2% · mediana +12,5% · máx +73,8%**
- Distribución: 327 `buy` · 84 `hold` · 60 `strong_buy` · 32 `none` · 1 nulo
- Sin precio objetivo (5): **SPY** (es un ETF, no tiene analistas), ERIE, FOX,
  L, NWS

`fetch_informe.py`: RGTI y HIMS trajeron fundamentales completos con sector
normalizado, y ambos **tienen CEDEAR**.

---

## ✅ Sonda de SEC EDGAR — corrida 21/08/2026

**Los 7 tickers tienen CIK, incluidos RGTI y HIMS.** Cero avisos.

### Validación cruzada: EDGAR vs. yfinance (CAGR revenue 3a)
**Diferencia 0,00 en los cinco comparables** (AAPL, MSFT, CAT, LRCX, AMD). El
mapeo XBRL es correcto.

### Años de revenue disponibles (contra los 4 de yfinance)

| Ticker | Años | Desde | Concepto ganador |
|---|---|---|---|
| CAT | **19** | 2007 | `Revenues` (los 2 primeros dieron 404) |
| MSFT | 11 | 2016 | `RevenueFromContractWithCustomerExcludingAssessedTax` |
| LRCX / AMD | 10 | 2016-17 | idem |
| AAPL | 9 | 2017 | idem |
| HIMS | 7 | 2019 | idem |
| RGTI | 5 | 2021 | `RevenueFromContractWithCustomerIncludingAssessedTax` |

### El beneficio, medido
- **AAPL: 1,8% a 3 años vs. 8,7% a 5 años.** La ventana corta arrancaba en el
  pico de 2022 y escondía la tendencia.
- **LRCX EPS: +20,2% a 3 años vs. -26,5% a 5 años.**

La cascada de conceptos **era necesaria**: CAT devolvió 404 en los dos
primeros tags.

### 🐛 Bug encontrado en la sonda (a corregir antes de producción)
`net_income` de CAT trajo **solo 4 años, y son 2007-2010**. La cascada devolvía
el **primer** concepto con ≥2 años en vez del **mejor**, y CAT cambió de tag
después de 2010. En producción habría metido un net income de 2010 en un
informe de 2026 **sin avisar** — peor que no tener el dato.

**Fix:** probar todos los candidatos y quedarse con el que más años anuales
traiga (corte anticipado si alguno supera ~10 años, para no gastar requests).
Agregar `NetIncomeLossAvailableToCommonStockholdersBasic` a la cascada.

### 📌 Hallazgo para las reglas de la tesis
**RGTI tiene revenue cayendo 18,5% anual** (13,1 → 7,1 M USD desde 2022), pero
yfinance reporta **+185% de crecimiento** porque mide el último trimestre
contra el mismo del año anterior. **Las dos cifras son correctas y dicen cosas
opuestas.** Con +62,8% de upside de analistas y pérdidas, es el caso testigo
de por qué la tesis necesita mostrar las dos ventanas y no elegir una.

---

## 💸 Control de gasto del LLM — GARANTÍA DE DISEÑO

Marcos preguntó explícitamente que no se gaste "por gastar". La garantía no es
una promesa, **es la arquitectura**: el endpoint se parte en dos.

| Acción | Qué hace | Llama al LLM | Costo |
|---|---|---|---|
| `api/informe.py?action=datos` | EDGAR + reglas + CAGR + tablas + señales de riesgo | **NO** | **US$0 siempre** |
| `api/informe.py?action=tesis` | solo redacta prosa con hechos ya elegidos por las reglas | SÍ | ~US$0,006 |

**El informe se abre y se ve COMPLETO sin gastar un centavo.** Todos los
números, el consenso, los CAGR a 3/5/10 años y las señales de riesgo en
formato de lista salen de `action=datos`. Lo único que falta es la redacción
en prosa.

Reglas duras de implementación:

1. La tesis se genera **solo con clic explícito** en un botón. Nunca al cargar
   la página.
2. Una vez generada, **queda cacheada**. Reabrir el informe **no** vuelve a
   llamar al modelo. Solo un "regenerar" explícito lo hace.
3. **Nunca en bucle, nunca en lote, nunca para los 503.**
4. Si falta la API key, `action=datos` **sigue funcionando igual** — la tesis
   simplemente no se ofrece.

**Respaldo fuera del código:** la API de Anthropic va con **créditos
prepagos**. Cargar un monto chico (ej. US$5) y **dejar la recarga automática
desactivada** es un techo real: al agotarse, las llamadas fallan y no hay
factura sorpresa. A ~US$0,006 por informe, US$5 ≈ 800 informes.

---

## 📊 Revisión y ampliación de métricas — 21/08/2026

Antes de construir el endpoint se hizo una revisión de qué faltaba. Resultado:
**59 campos por acción** (antes eran 13), todos con **0 llamadas extra**
porque salen de la misma `.info` que el bot ya hacía.

### Bloques agregados
| Bloque | Campos |
|---|---|
| **Dividendos** | `dividendRate`, `payoutRatio`, `fiveYearAvgDividendYield`, `trailingAnnualDividend*`, `lastDividendValue` |
| **Caja, deuda y FCF** | `freeCashflow`, `operatingCashflow`, `totalCash`, `totalDebt`, `currentRatio`, `quickRatio`, `ebitda` |
| **Valuación forward y márgenes** | `forwardPE`, `trailingPegRatio`, `pegRatio`, `enterpriseValue`, `bookValue`, `grossMargins`, `operatingMargins`, `ebitdaMargins` |
| **Riesgo de mercado** | `beta`, `fiftyTwoWeek*`, `shortRatio`, `shortPercentOfFloat`, `sharesOutstanding`, `floatShares`, `averageVolume` |

### Derivados calculados
`upsidePct`, `targetDispersionPct`, `dividendYieldPct`, `fcfYieldPct`,
`netDebt`, `netDebtToEbitda`, `desdeMaximo52wPct`, `grossMarginPct`,
`operatingMarginPct`, `ebitdaMarginPct`, `payoutRatioPct`.

⚠️ **`dividendYieldPct` se calcula SIEMPRE desde `dividendRate / precio`**, no
se lee de `dividendYield`: yfinance cambió la escala de ese campo entre
versiones (fracción vs. porcentaje). El crudo se guarda solo como referencia.

### ✅ Validado sobre los 504 reales (21/08/2026)

| Campo | Cobertura |
|---|---|
| `forwardPE`, `grossMarginPct`, `operatingMarginPct`, `desdeMaximo52wPct` | 100% |
| `payoutRatioPct`, `totalDebt`, `shortPercentOfFloat`, `targetDispersionPct` | 99% |
| `beta` | 98% · `currentRatio` 96% · `freeCashflow` 93% · `netDebtToEbitda` 93% |
| `fcfYieldPct` 90% · `trailingPegRatio` 87% · `dividendYieldPct` **80%** (el resto no paga dividendo) |

- **Dividend yield: mediana 1,78%**, máximo 6,79% (VICI, un REIT). Ningún valor
  absurdo. El campo crudo de yfinance daba 6,77 contra el 6,79 calculado — o
  sea que en 1.4.1 ya viene en porcentaje y coinciden. **Igual se conserva el
  cálculo propio**, que es a prueba de cambios de versión.
- **El forward P/E confirmó su necesidad: AMD pasa de 120,1x trailing a 30,6x
  forward, con PEG 1,00.** Sin ese dato el informe la trataría como carísima
  cuando está en precio razonable para su crecimiento. LRCX: 54,7 → 27,2.

### Por qué hacían falta (evidencia de los datos reales)
- **AMD figura a P/E 119x trailing.** Sin `forwardPE` ni PEG, el informe
  diría "carísima" de una empresa cuyas ganancias están explotando.
- **No había NADA de dividendos**, siendo que la cartera apunta a CEDEARs y
  hay papeles de renta como MO.
- **No había flujo de caja.** D/E es contable; el FCF dice si la empresa
  genera plata de verdad.
- Solo había margen neto, no bruto ni operativo — el bruto es la mejor señal
  de poder de fijación de precios.

---

## 🧭 Tratamiento por sector — decidido: percentil + reglas

**Percentil contra la mediana de SU sector** (reusando el algoritmo de F1)
**Y ADEMÁS** reglas que definen qué múltiplos aplican en cada sector.

### La evidencia que lo obliga (medida sobre los 504)

| Sector | P/E mediano | P/B | EV/EBITDA | D/E |
|---|---|---|---|---|
| Financials | 15,3 | 2,2 | 11,9 **(solo 37 de 67)** | 0,5 |
| Utilities | 20,8 | 2,1 | 13,3 | **1,6** |
| Technology | 34,9 | 7,1 | 22,1 | **0,6** |
| Real Estate | **33,4** | 2,4 | 18,8 | 0,9 |
| Energy | 18,1 | 2,6 | 8,7 | 0,5 |

- **EV/EBITDA falta en 30 de 67 financieras** — un banco no tiene EBITDA con
  sentido, la deuda es su materia prima. No mostrar el campo, no mostrarlo vacío.
- **`netDebt` tampoco sirve en Financials** (medido 21/08/2026): GS aparece con
  **-259.000 millones** de "caja neta", BRK-B -236.900, C -214.100, JPM
  -183.100. No nadan en efectivo: para un banco los depósitos y los activos de
  trading entran como caja. **Ocultar `netDebt` y `netDebtToEbitda` en
  Financials**, igual que EV/EBITDA.
- **D/E mediano: Utilities 1,6 vs Technology 0,6.** Un umbral absoluto marcaría
  a todas las eléctricas como endeudadas cuando es su estructura normal.
- **Real Estate con P/E 33,4** está inflado porque la depreciación aplasta la
  ganancia contable de los REITs. El múltiplo correcto es FFO.
- **Energy y Financials con los P/E más bajos** — terreno clásico de trampa de
  valor: barato en el pico del ciclo.

### Muestra por sector (para calibrar los percentiles)
Industrials 84 · Technology 75 · Financials 67 · Healthcare 59 ·
Consumer Discretionary 47 · Consumer Staples 34 · Real Estate 30 ·
Communication Services 30 · Utilities 29 · Materials 25 · Energy 23.
⚠️ Con n<25 (Materials, Energy) el percentil es ruidoso — avisarlo.

### Huecos que las reglas deben tolerar (de 504)
`de` falta en 54 · `evEbitda` en 32 · `roe` en 35 · `pe` en 29 ·
`priceToSales` en 18 · `roa` en 7.

---

## 🚨 Señales derivadas — las cuatro activadas

1. **Dispersión del precio objetivo.** Mediana del S&P 500: **40%**. PYPL
   **186%**, MRNA 162%, QCOM 155%. Un upside de 20% con dispersión de 180% es
   incertidumbre, no convicción. **AES da 0,0%** — todos los analistas con el
   objetivo idéntico huele a dato viejo, no a unanimidad.
2. **Reconstruir la recomendación faltante.** `recommendationKey = "none"` NO
   significa "sin cobertura": de los 32, **29 tienen analistas y precio
   objetivo** (BALL con 14, STZ con 23). Lo que falta es solo el promedio
   agregado, y se calcula desde la distribución strong buy / buy / hold / sell
   que `informe_detalle.json` ya trae.
3. **Trampa de valor.** P/E bajo contra su sector + revenue cayendo +
   revisiones de EPS a la baja = barato por algo. Prioritario en Energy y
   Financials.
4. **Choque de ventanas de crecimiento.** Avisar cuando el CAGR anual y el
   crecimiento trimestral se contradicen. Caso testigo RGTI: **-18,5% anual
   contra +185% trimestral**, ambas correctas.

### ✅ Fix de la cascada de EDGAR (el bug de CAT)
Ahora se prueban **todos** los candidatos y gana el que **más años** traiga, con
corte anticipado a los 12 años para no gastar requests. Verificado: con
`NetIncomeLoss` de 4 años (2007-2010) y `ProfitLoss` de 19, elige `ProfitLoss`.

### 🐛 Bug de variable pisada (21/08/2026) — y cómo se evita de nuevo
`probe_edgar.py` crasheó **después** de bajar todos los datos, al guardar el
JSON: `base` era la carpeta del script y el bucle de márgenes la reasignaba a
un número (`base = rev.get(fecha)`). `base / 'probe_edgar_out.json'` explotó y
**se perdió todo el trabajo ya hecho**.

Tres correcciones, no una:
1. La variable del bucle pasó a llamarse `ventas`.
2. **El JSON se guarda ANTES de imprimir el resumen.** Los datos cuestan tiempo
   y requests; el resumen es cosmética y no puede tirar abajo la corrida.
3. Se agregó una prueba que corre **`main()` completo** con la SEC simulada —
   el bug se escapó porque solo se habían probado las funciones sueltas.

Además quedó un detector estático que busca el patrón exacto (variable
asignada antes de un bucle, pisada adentro, usada después) y que se
auto-verifica contra el código con el bug original. Los tres bots pasan limpio.

### 🐛 CAT no reporta `GrossProfit` en XBRL
Varias industriales no desglosan el margen bruto como concepto propio.
**Fallback implementado:** si `GrossProfit` viene vacío, se pide
`CostOfRevenue` y se deriva `revenue - costo`. Solo se pide cuando hace falta —
AAPL, que sí tiene `GrossProfit`, no gasta ese request.

### ✅ Nuevos conceptos de EDGAR
- `GrossProfit` y `OperatingIncomeLoss` → **márgenes históricos** (% sobre
  ventas, año por año).
- `WeightedAverageNumberOfDilutedSharesOutstanding` → **recompras vs.
  dilución**. Es la pregunta clave: ¿el EPS crece por el negocio o por achicar
  el denominador? AAPL creció revenue 8,7% anual a 5 años pero EPS **17,9%** —
  esa brecha son recompras. Y para RGTI, la dilución es *el* riesgo y hoy sería
  invisible.

---

## ⚠️ Trampas de datos — OBLIGATORIO para las reglas de la tesis

Detectadas en la corrida real. Las reglas tienen que manejarlas explícitamente:

1. **`recommendationKey` puede ser el STRING `"none"`, no `null`** — pasa en
   **32 papeles**. Un `if recommendationKey:` da verdadero y el informe
   mostraría *"Recomendación: none"*. Hay que chequear el valor, no la
   truthiness.
2. **`pe` viene `null` en empresas con pérdidas** (RGTI y HIMS, ambas con ROE
   negativo). Es correcto — no existe P/E sin ganancias — pero ninguna regla
   puede asumir que hay P/E para comparar contra el sector.
3. **`recommendationMean` falta en el 6,5%** aunque sí haya
   `numberOfAnalystOpinions`. Son ~28 papeles con analistas pero sin promedio.
4. **Los ETF no tienen consenso.** SPY vino sin nada. Si alguna vez entra al
   informe, hay que degradar con elegancia.
5. **Upside alto + fundamentales malos es la combinación peligrosa.** Caso
   real: RGTI con **+62,8% de upside**, **ROE -43,8%** y revenue creciendo
   **185%**. La tesis tiene que decir "el consenso es optimista pero la
   empresa pierde plata", no quedarse con el upside solo.

---

## ℹ️ Los mensajes `$XXX.BA: possibly delisted` NO son un error

Aparecen a montones al correr `fetch_fundamentals.py`. **Es comportamiento
esperado y correcto**, no hay nada que arreglar.

**Por qué:** `check_cedear()` (función original del screener, anterior a este
proyecto) pregunta si existe CEDEAR consultando `TICKER.BA` en Yahoo, que es
la convención para la Bolsa de Buenos Aires. Yahoo **no tiene** un endpoint de
"¿existe este símbolo?", así que la única forma de averiguarlo es pedirlo y
ver si contesta. Cuando no existe, yfinance imprime ese texto por su cuenta
antes de que el `try/except` lo atrape. **El mensaje ES la respuesta "no tiene
CEDEAR".**

**El análisis usa siempre el ticker original.** Precio, P/E, ROE, márgenes,
consenso: todo sale de `AAPL`. `AAPL.BA` se consulta **una sola vez y para una
sola cosa**: poner el booleano `hasCedear`. Ningún ratio ni precio sale nunca
del `.BA`. F1 filtra por esa bandera solo cuando se pide modo CEDEAR.

Señal de que funciona bien: los que fallan son nombres medianos (AMP, AME,
APH, AON, APA, APO, APTV, ACGL, ADM, ARES, AJG, AIZ), que efectivamente no
tienen CEDEAR — y los grandes **no** aparecen en la lista de errores.

### ⚠️ Efecto secundario real: la corrida se volvió lenta
**Confirmado en la corrida completa: 1705 s = 28,4 min** para los 504, contra
los 3-5 min que dice el README del bot.

**No viene de la captura de consenso** (son lecturas de diccionario sobre
datos ya en memoria, 0 llamadas de red). La causa es `check_cedear`: por cada
símbolo sin CEDEAR, yfinance intenta traer historial **dos veces**
(`period=1y` y `period=5d`, visible en los mensajes) y encima reintenta. Son
~300 símbolos haciendo eso todos los días. Puede que la ruta de reintentos de
yfinance 1.4.1 sea más agresiva que la de 0.2.54.

### ✅ Caché de CEDEAR — aplicado 21/08/2026
`check_cedear` ahora consulta primero un caché local con vencimiento de
**30 días**. La lista de CEDEARs de BYMA cambia unas pocas veces al año, así
que **no viola la regla de oro #11**: se sigue verificando en vivo contra
Yahoo, solo que no se repite a diario.

- Archivo: `local_bot/.cedear_cache.json` (en `.gitignore`, se regenera solo)
- El logger de yfinance se silencia **solo durante la llamada `.BA`** y se
  restaura enseguida — no se pierde ningún error real de otro lado.
- Diff: la función original se renombró a `_check_cedear_live` y `check_cedear`
  quedó como envoltorio con caché, así que **`fetch_one` no cambió**.

Probado con seis escenarios: primera corrida, segunda corrida (**0 llamadas a
Yahoo y snapshot idéntico**), entradas vencidas (se re-verifican solo esas),
caché corrupto (se ignora y verifica todo), caché imposible de escribir (el
snapshot igual se guarda) y verificación de que los 16 campos del screener
siguen intactos.

Esperado: **28,4 min → ~8 min** a partir de la segunda corrida.

---

## 🎯 Alcance del informe — definido

Se ofrece para **los que pasaron el screening (F1) + los de la cartera propia
(F5)**, no para los 503. Algunos de F5 pueden estar fuera del S&P 500 (RGTI,
HIMS) y los cubre `fetch_informe.py`.

Consecuencia práctica: el mapeo **ticker → CIK** para SEC EDGAR se resuelve al
vuelo contra el `company_tickers.json` de la SEC, no hace falta precalcularlo
entero.

⚠️ **Un papel fuera del S&P 500 puede no cotizar en EE.UU. o no reportar a la
SEC.** En ese caso no va a tener histórico de EDGAR y el informe tiene que
degradar con elegancia: mostrar el resto y decir que el histórico no está
disponible, nunca inventarlo ni romper.

---

## ❓ Decisiones abiertas

1. Paleta hex y familias tipográficas concretas del documento.
2. TTL exacto del caché del informe.
3. Qué hacer cuando un activo no tiene datos en SEC EDGAR (ver arriba).

---

## 🚀 Guía de push paso a paso

Marcos pidió que cada vez que tenga que hacer algo, se le guíe paso a paso.

### Antes de cualquier push — verificar que lo anterior está subido
Es la regla operativa #1 del proyecto: ya se perdió trabajo dos veces por
asumir que una sesión anterior se había pusheado.

```bash
cd C:\Users\otero\Desktop\sp500-screener-yf
git status          # ¿qué cambió y qué falta subir?
git log --oneline -5   # ¿los últimos commits son los que esperabas?
```

### Push normal (código o datos)
```bash
cd C:\Users\otero\Desktop\sp500-screener-yf
git status                     # 1. mirar qué va a subir
git add <archivos>             # 2. elegir (NO uses "git add ." a ciegas)
git commit -m "mensaje claro"  # 3. confirmar
git push                       # 4. subir
```

Vercel detecta el push solo, corre `npx vite build` y redeploya. Tarda 1-2
minutos. En el panel de Vercel hay que buscar **"Build Completed"** y
**"Deployment completed"** — un `warning` en el log **no** es un error
(regla de oro #12).

### Después de un cambio en el frontend
```
localStorage.clear()   → en la consola del navegador (F12)
```
y recargar. Si no, seguís viendo datos cacheados de antes.

---

## 📐 Reglas heredadas del screener que aplican acá

1. Yahoo bloquea IPs de datacenter → **todo lo que sea volumen alto va por
   bot local**, nunca desde Vercel.
2. Si ya hay una fuente confiable disponible (el snapshot local), preferirla
   sobre fetch en vivo.
3. Reutilizar algoritmos ya construidos (ej. el scoring de F1) en vez de
   inventar uno nuevo.
4. Verificar que los cambios de la sesión anterior se hayan pusheado antes de
   construir encima.
5. **Ni el contenedor de Claude ni la VM del puente al escritorio pueden
   llegar a Yahoo** (proxy devuelve 403). Todo script de yfinance se valida
   offline y se corre en el Windows de Marcos.

---

*Actualizado: 21 de agosto de 2026 · Sonda corrida y analizada · Tesis híbrida y estética clara confirmadas · Pendiente: alcance del histórico y deploy*
