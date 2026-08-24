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
| Re-correr `probe_edgar.py` (crash de la variable pisada) | ✅ corrió, 0 avisos, CAT resuelto |
| Corrección de splits accionarios | ✅ **validada sobre datos reales** |
| **🎉 CAPA DE DATOS COMPLETA** | ✅ nada más que recolectar |
| Endpoint `api/informe.py` (`action=datos`) | ✅ escrito y probado contra datos reales |
| Reglas por sector + 4 señales + veredicto | ✅ dentro del endpoint |
| Re-correr `probe_edgar.py` (regla de tag corregida) | ✅ AAPL 9 años hasta 2025, 0 avisos |
| Entrada: Excel/HTML + buscador + cartera F5 | ✅ decidido |
| Cobertura: `--cedears` (~151) automático | ✅ hecho y probado |
| **Correr `fetch_informe.py --cedears RGTI HIMS`** | 🔄 **siguiente paso de Marcos** |
| Página `/informe` + `informe.html` + `vite.config.js` | ✅ construida y con build real verificado |
| Gráficos (evolución + percentiles) e impresión a PDF | ✅ hechos |
| **Pushear y probar en Vercel** | 🔄 **siguiente paso de Marcos** |
| `action=tesis` + API key | ⬜ al final |
| Botón "Ver informe" en F1/F5 (toca `App.jsx`) | ⬜ después de validar el informe |

---

## 🖥️ La página `/informe` — construida 24/08/2026

**Estructura de archivos** (bundles separados, cero imports cruzados):
| Archivo | Qué es |
|---|---|
| `informe.html` | entrada de la página, monta en `#root-informe` |
| `src/informe/main.jsx` | punto de entrada de React |
| `src/informe/App.jsx` | orquesta: universo, caché, ruteo por `?ticker=` |
| `src/informe/Selector.jsx` | subida de Excel/HTML + buscador + cartera F5 + historial |
| `src/informe/Informe.jsx` | el informe con gráficos y tablas |
| `src/informe/estilos.js` | paleta, tipografías, formateo y CSS de impresión |

**Build real verificado** (regla de oro #10):
```
dist/informe.html   0.43 kB      dist/assets/informe-*.js   40.70 kB (14.4 gzip)
dist/index.html     0.50 kB      dist/assets/main-*.js     282.24 kB
```
- `informe.html` carga **solo su bundle**; el de `App.jsx` no aparece —
  verificado buscando símbolos del screener dentro del bundle del informe: **0**.
- **`xlsx` (429 kB) se carga de forma diferida**, solo si subís un archivo.
  `index.html` sí lo precarga, como siempre.
- El screener sigue con su propio bundle y su propio HTML sin cambios.

**Prueba de render con datos reales**: se renderizó el informe en servidor
para AAPL, RGTI, JPM, VICI y HIMS (completos y reducidos) **más un objeto
mínimo con todos los campos vacíos**. Los seis renderizan sin excepciones.

**Detalles de implementación**
- **Tipografías de sistema, sin Google Fonts**: `"Segoe UI"` es humanista y
  está en todo Windows. Sin pedido a terceros la página carga más rápido y se
  imprime sin esperar descargas.
- **Caché de informes** en `informe_cache_v1`, **1 día**, máximo 15 tickers.
  El histórico de la SEC cambia por trimestre, así que un día es holgado.
  Botón "Actualizar datos" para forzar.
- **`?ticker=AAPL` abre el informe directo** — así va a funcionar el botón que
  agreguemos en F1/F5 sin tocar nada más.
- **Impresión**: `@media print` saca la barra de acciones y el botón de volver,
  fuerza los colores de fondo, y evita cortes en medio de una sección.
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

## 🖥️ Selección de activo — resuelto (22/08/2026)

**El problema que planteó Marcos:** la lista de F1 cambia según Top N y sectores
omitidos, así que "los que pasaron el screening" no es una lista estable.

**Verificado en `src/App.jsx`, y es peor que eso: el resultado de F1 NO se
persiste.** Lo único guardado en `localStorage` es:
- `sp500_screener_fund_v2_all` / `_cedear` → el **caché de fundamentales** de los
  504 (no el resultado filtrado)
- `sp500_hist_prices_v1` → precios históricos
- `sp500_client_${safe}_v1` → **la cartera de F5**, que sí es estable

El Top N filtrado vive solo en estado de React y se recalcula con los parámetros
del momento.

**Solución: no intentar congelar la lista.**
1. **Buscador sobre los 504** del snapshot + los de afuera que estén en
   `informe_detalle.json`. No depende de ninguna corrida.
2. **Cartera de F5 fija arriba**, leída de `sp500_client_*_v1` (sí persiste).
3. **Historial propio del informe** en su propia clave — el conjunto de trabajo
   se arma solo con el uso.
4. **Botón en F1/F5 más adelante**: al hacer clic desde la corrida que estás
   mirando, no hay nada que congelar. Eso toca `App.jsx`, así que se hace
   **después** de que el informe esté probado.

### ✅ Decidido el 23/08/2026 — flujo completo

**Entrada a la página** (tres caminos, conviven):
1. **Subir el Excel o el HTML** que exporta F1/F5. El export ya trae una hoja
   **"Fundamentales"** con encabezados
   `Sector · Ticker · Nombre · P/E · P/B · ROE % · D/E · EV/EBITDA · Margen % · Score`.
   Y F5 **ya tiene un lector de xlsx** con detección flexible de columna
   (`ticker` / `simbolo` / `activo` / `accion`) — se reutiliza ese patrón
   (regla de oro #14). Captura la corrida exacta con su Top N y sus filtros,
   funciona en cualquier máquina y sobrevive a limpiar el navegador.
2. **Buscador** sobre los 504 + los de afuera que estén en el detalle.
3. **Cartera de F5** leída de `sp500_client_*_v1`.

**Cobertura de datos: `--cedears` automático.**
`fetch_informe.py --cedears` trae los **~151 del S&P 500 con CEDEAR** —
justo el universo operable desde Argentina. Son ~7 min sobre los ~8 que ya
tarda el bot de fundamentales. Con eso **casi cualquier informe que abras sale
completo sin ningún paso manual**, y `tickers_informe.txt` queda solo para las
excepciones de afuera del índice.

Flags nuevos, probados:
```bash
python fetch_informe.py --cedears              # los ~151, lo habitual
python fetch_informe.py --cedears RGTI HIMS    # + los de afuera del indice
python fetch_informe.py --cedears --dias 7     # saltea lo bajado hace <7 dias
```

**Rutina recomendada** (una vez por semana, ~15 min en total):
```bash
cd C:\Users\otero\Desktop\sp500-screener-yf\local_bot
python fetch_fundamentals.py                   # ~8 min (con cache de CEDEAR)
python fetch_informe.py --cedears RGTI HIMS    # ~7 min
cd ..
git add public/data/*.json
git commit -m "chore: actualizar datos"
git push
```

### ⚠️ El gate real es `informe_detalle.json`, no el screening
Hoy tiene **7 tickers**. Para los otros 497 hay fundamentales, consenso básico e
histórico de EDGAR, pero **no** consenso forward ni sentimiento.

El informe debe mostrarse en dos niveles y **decirlo explícitamente**:
- **Completo** — ticker presente en `informe_detalle.json`
- **Reducido** — el resto, con el aviso "agregá este ticker a
  `tickers_informe.txt` y corré `fetch_informe.py`"

---

## 🎨 Decisiones de formato

⚠️ **Marcos revisó esta decisión el 22/08/2026: pasó de serif a SANS SERIF
humanista.** Lo que sigue es lo vigente.

- **Tipografía: sans serif humanista** para títulos y cuerpo. **Números en
  monospace** para que las columnas alineen.
- **Color:**
  - acento principal **azul celeste / cyan tecnológico**
  - subtítulos **azul marino profundo**
  - cuerpo del texto **grafito**
  - fondo claro
- Sigue siendo un **documento claro**, no el dark slate del screener.
- Referencia de lo que **NO** se usa (estética del screener): fondo `#0f172a` /
  `#1e293b`, bordes `#334155`, texto `#94a3b8`, acentos `#38bdf8` (sky),
  `#34d399` (verde), `#fbbf24` (ámbar), `#f87171` (rojo), todo monospace.

### Veredicto: las tres cosas
Decidido: **datos + semáforos simples + veredicto global**. O sea cada bloque
con su señal verde/amarilla/roja, y además una etiqueta global arriba derivada
de las reglas.

⚠️ Con veredicto global hay que cuidar el caso RGTI: **+62,8% de upside con
revenue cayendo y pérdidas**. Una sola etiqueta no puede tapar eso — el
veredicto tiene que mostrar **por qué** da lo que da, no solo el rótulo.

### Audiencia: uso propio **y clientes**
Implica incluir desde el arranque:
- **Fecha y hora de los datos** (el snapshot puede tener días)
- **Origen de cada cifra** (Yahoo Finance vía bot local / SEC EDGAR)
- **Mini descargo** de que no es recomendación de inversión

⚠️ Recordatorio: los términos de Vercel exigen **plan Pro (US$20/mes)** si el
proyecto sirve a clientes que pagan.

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
  pico de 2022 y escondía la tendencia. (Revenue — sin problema de splits.)
- ⚠️ El ejemplo del EPS de LRCX que figuraba acá (**-26,5% a 5 años**) resultó
  ser un **artefacto de split**, no un hallazgo. Ver la sección de splits más
  abajo. El valor correcto es **+16,4%**.

La cascada de conceptos **era necesaria**: CAT devolvió 404 en los dos
primeros tags.

### Segunda corrida (22/08/2026) — con el fix de la cascada
| Ticker | rev | eps | ni | gp | oi | acc | net_income tag |
|---|---|---|---|---|---|---|---|
| CAT | 19 | 19 | **17** | 11 | 19 | 19 | `NetIncomeLossAvailableToCommonStockholdersBasic` |
| AAPL / MSFT | 11 | 19 | 19 | 19 | 19 | 19 | `NetIncomeLoss` |
| LRCX / AMD | 10 | 18 | 18/16 | 18 | 18 | 18 | `NetIncomeLoss` |
| HIMS | 7 | 7 | 7 | 7 | 7 | 7 | `NetIncomeLoss` |
| RGTI | 5 | 5 | 5 | 5 | 5 | 5 | `NetIncomeLoss` |

**Cero avisos.** El bug de CAT quedó resuelto: **17 años (2009-2025)** en vez
de 4 terminando en 2010. Y el margen bruto se derivó de `CostOfGoodsSold`
porque CAT no reporta `GrossProfit`.

### Márgenes históricos (primero → último año)
| | bruto | operativo | neto |
|---|---|---|---|
| MSFT | 64,0 → 67,9 | 28,6 → **46,8** | 22,5 → **40,3** |
| AAPL | 34,0 → 38,5 | 18,4 → 26,8 | 14,6 → 21,1 |
| AMD | 23,2 → **49,5** | -8,6 → 10,7 | -11,5 → 12,5 |
| CAT | 27,4 → 31,7 | 10,9 → 16,5 | 2,8 → 13,1 |
| LRCX | 45,0 → 50,5 | 23,7 → 35,3 | 21,2 → 31,3 |
| HIMS | 54,0 → **73,8** | -90,1 → **+4,5** | -87,3 → **+5,5** |
| RGTI | 80,2 → **29,1** | -416 → **-1194** | -467 → **-3050** |

HIMS cruzó a rentabilidad; **RGTI se deteriora en las tres líneas**.

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

### 🚨 SPLITS: el error más grave encontrado hasta ahora (22/08/2026)

**Dos números que se dieron por buenos eran artefactos de splits accionarios.**
Quedan corregidos y anulados:

| Dato reportado antes | Realidad |
|---|---|
| ❌ "LRCX: EPS **-26,5%** a 5 años" | ✅ **+16,4%**. Fue el split 10:1 |
| ❌ "LRCX: acciones **+54,1%** (dilución)" | ✅ **-2,8%** — son **recompras** |
| ❌ "AAPL: EPS **-2,1%** a 10 años" | ✅ **+12,5%**. Fue el split 4:1 |

**Por qué pasa:** EDGAR devuelve los valores **tal como se presentaron**. Un
10-K reformula los años previos por el split, pero los años que solo aparecen
en filings viejos quedan en la base vieja. Al pegar ambos tramos, la serie
tiene un escalón. **La fecha del escalón NO es la del split**, sino la del
límite entre filings — por eso no sirve aplicar el calendario real de splits.

**Cómo se distingue un split de una emisión real:** en un split el net income
**no cambia** (la misma torta en más porciones) y el factor es **redondo**
(2, 3, 4, 5, 7, 10, 15, 20). Hacen falta **las dos evidencias juntas** —
con una sola no alcanza:
- HIMS saltó **x5,28** (cerca de 5) pero fue el **SPAC** de 2021, no un split.
- RGTI saltó **x1,68** con pérdidas parecidas, y es **emisión real**.
- AAPL 2012 saltó **x7,07** (su split 7:1) pero ese año el net income creció
  61%, así que la prueba de "torta estable" falla → queda sin resolver.

**Política adoptada — no inventar números:**
- `split` (factor redondo **Y** net income estable) → **se corrige** la serie.
- `discontinuidad` (cualquier otro salto ≥1,5x o ≤0,67x) → **no se corrige**,
  y `cagr_seguro()` devuelve **`None`** para toda ventana que la cruce.

Vale más un "no se puede calcular" que un número inventado.

**Verificación por identidad contable.** Como `EPS = NI / acciones`, tiene que
cumplirse que *crecimiento del EPS ≈ crecimiento del NI − variación de
acciones*. Cierra en los cinco casos calculables:

| | eps 5a | NI 5a | acc 5a | NI−acc |
|---|---|---|---|---|
| AAPL | 17,9 | 14,3 | -3,1 | 17,4 ✅ |
| MSFT | 17,4 | 16,9 | -0,4 | 17,3 ✅ |
| CAT | 28,1 | 24,3 | -3,0 | 27,2 ✅ |
| LRCX | 16,4 | 13,2 | -2,8 | 16,0 ✅ |
| AMD | 5,2 | 11,7 | **+6,3** | 5,5 ✅ |

**AMD es el caso más instructivo:** gana **11,7%** de net income pero solo
**5,2%** de EPS. La diferencia se la come la dilución del 6,3% anual por pagar
Xilinx con acciones. Sin este análisis, el informe habría dicho "crece 5%" sin
explicar por qué crece la mitad de lo que gana.

⚠️ **`net_income_3a` y `net_income_5a` se agregaron como control**: el net
income es inmune a splits, así que sirve de referencia cuando el EPS es dudoso.

### ✅ Corrección de splits — validada sobre datos reales (22/08/2026)

Clasificación obtenida en la corrida definitiva:

| Ticker | Saltos detectados | Acción |
|---|---|---|
| AAPL | 2012-09 x7,07 **discontinuidad** · 2018-09 x3,81 **split (÷4)** | corrige 2018, bloquea ventanas que cruzan 2012 |
| LRCX | 2023-06 x9,66 **split (÷10)** | corrige |
| RGTI | 2022-12 x4,38 · 2025-12 x1,68, ambas **discontinuidad** | no calcula CAGR de EPS ni acciones |
| HIMS | 2021-12 x5,28 **discontinuidad** (SPAC) | idem |
| MSFT · CAT · AMD | sin saltos | series intactas |

**Auditoría crudo vs. corregido:** el único que cambió fue LRCX
(eps5a **-26,5 → +16,4**, acc5a **+54,1 → -2,8**). Los demás quedaron
idénticos, o sea que **la corrección no toca lo que no hay que tocar**.

**Identidad contable: cierra en los 5 calculables** (diferencia máxima 0,85 pp).
RGTI y HIMS devuelven `None`, que es el comportamiento correcto.

**Cero avisos en toda la corrida.**

### ✅ Regla de recencia validada (23/08/2026)
| Ticker | años | hasta | tag ganador | descartados por obsoletos |
|---|---|---|---|---|
| AAPL | **9** | 2025-09-27 | `RevenueFromContractWithCustomer…` | `Revenues`, `SalesRevenueNet` |
| CAT | 19 | 2025-12-31 | `Revenues` | `SalesRevenueNet` |
| MSFT | 11 | 2026-06-30 | `RevenueFromContractWithCustomer…` | 3 descartados |

AAPL volvió a dar **CAGR 3a = 1,81%**, idéntico a yfinance. Su `revenue_10a`
ahora es `None` (9 puntos, hacen falta 11) — correcto y honesto. **Cero avisos.**

### 🚨 Elección del tag: DOS criterios, y el orden importa (22/08/2026)

Al arreglar el bug de CAT ("gana el que más años trae") **se creó otro peor**:

**AAPL devolvía `SalesRevenueNet` con 11 años... que terminaban en 2017**,
porque Apple dejó de usar ese tag con el cambio de norma contable. Todo el
CAGR se calculaba sobre datos de hace ocho años. Quedó camuflado porque el
CAGR a 5 años daba **7,9% en las dos ventanas por pura coincidencia**.

**Regla definitiva:**
1. **Recencia primero** — solo compiten los tags cuya serie llega al último
   ejercicio disponible (tolerancia de ~1 año).
2. **Entre los vigentes, gana el más largo.**

Verificado en las dos direcciones: con CAT elige el largo (17 años) porque
ambos llegan a 2025; con AAPL elige el corto (9 años) porque el largo está
muerto desde 2017.

⚠️ Ya **no hay corte anticipado**: hay que consultar todos los candidatos para
saber cuál es el vigente. Cuesta algún request más y vale la pena.

### 🚨 Otros dos bugs corregidos en el endpoint
- **Un múltiplo negativo NO es "barato".** RGTI puntuaba **100/100 en
  valuación** porque su forward P/E negativo caía en el extremo "más barato"
  del percentil. Ahora los valores ≤ 0 se excluyen de las métricas donde
  "menor es mejor" y devuelven `None`.
- **Las banderas rojas ahora DESCUENTAN del puntaje** (-18 cada una), no solo
  cambian la etiqueta. Antes quedaba el absurdo de **"con reparos
  (81,8/100)"** para una empresa con ingresos cayendo y pérdidas.

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

## 🚨 Primer deploy — dos fallas (24/08/2026)

### 1. `/informe` daba 404, pero `/informe.html` cargaba bien
No era el build: Vite generaba el archivo y Vercel lo servía. **Vercel no mapea
la URL sin extensión** a menos que se lo pidas.

**Fix:** un `rewrite` en `vercel.json`:
```json
"rewrites": [{ "source": "/informe", "destination": "/informe.html" }]
```
Se eligió un rewrite puntual en lugar de `cleanUrls: true` porque `cleanUrls`
cambia el comportamiento de **todas** las rutas, incluidas las del screener.
Los rewrites se evalúan **después** del filesystem, así que `/api/...` y `/`
siguen intactas.

### 2. `/api/informe` devolvía 500
**Causa:** la función pedía los JSON de `public/data/` **a su propio deploy por
HTTP**. Si Vercel tiene Deployment Protection activa, ese pedido vuelve 401 y
todo el endpoint se cae. Además era lento: `informe_detalle.json` pesa 1,2 MB.

**Fix — leer del disco, no de la red:**
- `vercel.json` incluye los datos en el bundle de la función:
  `"includeFiles": "public/data/**"`.
- `estatico()` prueba varias rutas del disco **primero** y solo cae a HTTP como
  último recurso.
- Verificado sin red: los tres archivos se leen del disco y un informe completo
  se arma igual.

### 3. Diagnóstico para no volver a adivinar
**`GET /api/informe?action=diag`** devuelve **200 siempre** y dice qué pieza
falla: variables de entorno, qué rutas de disco existen y qué contienen, si
cada JSON se pudo leer y de cuándo es, y si la SEC responde. No consume LLM ni
cuesta nada.

Y los 500 ahora incluyen las últimas líneas del traceback más una pista
apuntando a `action=diag`.

---

## 📦 PENDIENTE DE PUSH — lista acumulada

Todo esto está escrito en la carpeta y **todavía no subido**. Verificar con
`git status` antes de asumir.

**Nuevos**
```
.gitignore
api/informe.py
informe.html
local_bot/fetch_informe.py
local_bot/probe_analistas.py
local_bot/probe_edgar.py
local_bot/requirements.txt
local_bot/tickers_informe.txt
src/informe/App.jsx
src/informe/Informe.jsx
src/informe/Selector.jsx
src/informe/estilos.js
src/informe/main.jsx
```

**Modificados**
```
CONTEXTO_INFORME_AVANZADO.md
local_bot/fetch_fundamentals.py     (consenso + caché de CEDEAR)
requirements.txt                    (SOLO comentarios; el pin NO cambia)
vercel.json                         (función informe + includeFiles + rewrite /informe)
api/informe.py                      (lee del disco + action=diag)
vite.config.js                      (multipágina: index.html + informe.html)
public/data/sp500_fundamentals.json
public/data/informe_consenso.json
public/data/informe_detalle.json
```

**NO se sube** (está en `.gitignore`): `local_bot/.cedear_cache.json`,
`local_bot/probe_analistas_out.json`, `local_bot/probe_edgar_out.json`.

⚠️ **`src/App.jsx` sigue sin tocarse ni una línea.**

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
