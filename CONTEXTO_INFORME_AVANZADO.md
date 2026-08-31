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

## ✅ Deploy funcionando + selector que escala (24/08/2026)

`action=diag` devolvió **`"ok": true`**: los tres archivos se leen, la SEC
responde (10.403 tickers en el mapa) y `informe_detalle.json` tiene **153
activos**. `/informe` carga bien.

### ⚠️ Observación del diagnóstico: `includeFiles` no llegó al bundle
`rutas_probadas` dio **`null` en las tres**, o sea que los datos se están
leyendo por el **fallback HTTP**, no del disco. Funciona porque ahora se
prioriza `VERCEL_PROJECT_PRODUCTION_URL` (`sp500-screener-yf.vercel.app`) en
vez de `VERCEL_URL` (el deployment `...-8awppy562-...` que **sí** está
protegido) — **ese fue el fix real del 500**.

Queda como optimización pendiente: cada arranque en frío baja 1,2 MB. No
bloquea nada.

### Selector rediseñado para muchos activos
Antes todo eran chips: un Excel de F1 con 40 activos daba una pared de 40
botones sin orden ni filtro.

Ahora el listado **cambia de forma según el tamaño** (`UMBRAL_TABLA = 12`):
- **≤12 activos** → chips, como antes. Sirve para la cartera de F5.
- **>12** → **tabla con scroll, filtro y encabezados ordenables** por ticker,
  nombre, sector y score. Encabezado fijo, fila entera clickeable, contador de
  "N de M" al filtrar.

Además: **punto celeste** en los activos con informe **completo**, con leyenda
al pie diciendo cuántos son y cómo completar el resto. El set sale de las
claves de `informe_detalle.json`, que la página ya descarga para el buscador.

---

## 📄 INFORME DE CARTERA — el entregable final (24/08/2026)

Es el documento que se le manda al cliente. Se genera desde la misma página:
se seleccionan varios activos con casilla y sale **Generar informe de cartera**.

### Decisiones
| Punto | Decisión |
|---|---|
| Profundidad | **Ficha corta + anexo opcional.** No eran excluyentes: el anexo *contiene* la ficha. Interruptor por documento. |
| Cantidades y precio de compra | **NO se usan.** Los activos se tratan por igual, así sirve igual para una cartera existente que para una propuesta. |
| Sugerencias de reemplazo | **Sí**, sección propia al final. |
| Portada | Cliente, comitente, fecha, preparado por y **logo** (opcional). |

### Estructura del documento
1. **Portada** — logo, título, cliente, comitente, fecha, preparado por
2. **Resumen** — una fila por activo: veredicto, puntaje, recorrido, riesgos
3. **Composición por sector** — barra + aviso si un sector supera el 50%
4. **Puntos de atención** — los riesgos de severidad alta de toda la cartera
5. **Ficha por activo** — media página: veredicto, 6 métricas, CAGR, 3 notas
6. **Oportunidades a considerar** — reemplazos para los de puntaje bajo
7. **Anexo opcional** — el informe completo de cada activo, con gráficos
8. **Pie** — fuentes, fechas de corte, alcance y descargo

### ⚠️ Se arma en el NAVEGADOR, no en el servidor
Hacerlo server-side serían ~50 pedidos a la SEC en una invocación, y con 20
activos se pasa del límite de 60 s. En el navegador: se piden de a uno con
barra de progreso, y **el caché hace instantáneos los ya vistos**.

### ⚠️ El scoring de reemplazos es una REIMPLEMENTACIÓN
`src/informe/sugerencias.js` reimplementa el criterio de F1 (percentil por
sector de las 6 métricas) porque los proyectos no comparten módulos. **Los
puntajes pueden diferir en algunos puntos de los que muestra F5.** Si algún día
divergen de verdad, ese archivo es el que hay que revisar.

Los reemplazos **no repiten papel** entre distintas recomendaciones ni sugieren
algo que ya está en la cartera. Verificado.

### Probado
- Render en servidor con **9 activos reales**, con anexo y sin anexo
  (39 KB y 229 KB de HTML).
- Casos límite: **un solo activo sin metadatos** y **todos los activos con
  error**. Ninguno rompe.
- Sugerencias sobre datos reales: CAT (36/100) → SNA (75) y MO (94);
  AMD (35/100) → FSLR (82) y NEM.
- Build real: bundle del informe **63 kB**.

### Pendiente
El **logo lo carga Marcos desde el formulario** (queda en `localStorage`, no se
sube a ningún lado). Si nunca carga uno, la portada simplemente no lo muestra.

---

## 🐛 BUG DEL SCREENER — límite de Twelve Data en F2/F3/F4 (24/08/2026)

**No tiene nada que ver con el informe.** Apareció al usar F5 con la cartera
propia: al pasar al paso de riesgo, "No se pudo descargar histórico… El proxy
de datos (Twelve Data) no está devolviendo datos".

### El mensaje mentía dos veces
1. Culpaba a Twelve Data. **Twelve Data respondía perfecto** —
   `action=debug&symbol=SPY` daba status 200 con datos del día.
2. Las "posibles causas" nombraban a **Yahoo Finance**, que ni siquiera es la
   fuente del histórico (Yahoo sí estaba con `YFRateLimitError`, pero eso es
   otra parte del flujo).

### La causa real
`TD error 429: 13 API credits were used, with the current limit being 8.`

**Cada símbolo del lote cuesta un crédito.** `src/App.jsx` usaba
`chunk(allWithSpy, 8)` en **tres** lugares (F2 línea ~1584, F3 ~1686,
F4 ~1797). Con 7 activos + SPY = **8 símbolos = 8 créditos, justo en el
límite**: cualquier crédito gastado antes en el mismo minuto lo desbordaba.

⚠️ El diagnóstico con **un solo símbolo siempre da OK** — por eso el mensaje
mandaba a un debug que nunca reproducía el problema.

### Arreglo aplicado (elección de Marcos: lotes + reintento)
- **`TD_LOTE = 6`** en lugar de 8, en los tres lugares. Deja margen para SPY
  y para un reintento.
- **`histFetch()`**: helper nuevo que ante un 429 **espera 62 segundos y
  reintenta una sola vez**, con cuenta regresiva en pantalla. Nunca entra en
  bucle: máximo dos intentos.
- **Los mensajes dejan de mentir**: si es límite de créditos lo dice y explica
  cuánto esperar; si no, muestra **la respuesta textual de la fuente**.

**Diff: 41 líneas agregadas, 13 reemplazadas.** Nada más de `App.jsx` se tocó.

**Probado** extrayendo la función real del archivo y ejecutándola con `fetch`
simulado: respuesta OK a la primera (1 llamada, sin esperas), 429 y después OK
(reintenta y devuelve los datos buenos), 429 dos veces (corta en 2 intentos,
sin bucle), error global del lote (también lo detecta), y error que **no** es
429 (devuelve enseguida, sin esperar al pedo). Build real limpio.

---

## 🔄 VEREDICTO DE 3 POSICIONES + FOCO EN ROTACIÓN (25/08/2026)

Pedido literal de Marcos: *"mejorar el informe centrarme más o hacerle más
enfoque a las opciones de rotación, que activos conviene sacar, modificar
también la tesis 'veredicto' entre neutral compra y venta, nada más que eso, ya
que con reparos no me termina de cerrar"*.

### La escala vieja y por qué se cayó

```
sin datos suficientes | con reparos | atractiva | neutral | poco atractiva
```

`con reparos` no era una posición: era un asterisco. Convivía en el mismo campo
que las otras cuatro pero no decía qué hacer, y encima **tapaba el puntaje** —
una empresa podía salir "con reparos (81,8/100)" y el lector no sabía si eso
era bueno o malo.

### La escala nueva — `api/informe.py`

```python
UMBRAL_COMPRA = 60.0        # >= 60  -> compra
UMBRAL_VENTA  = 40.0        # 40-60  -> neutral,  < 40 -> venta
PENALIZACION_GRAVE = 18.0   # cada bandera roja RESTA 18 puntos
```

Función única `veredicto_de(puntaje, graves)`, usada por el informe individual y
por el de cartera, para que no puedan divergir.

Lo que hacía `con reparos` lo hacen ahora **dos mecanismos separados y
visibles**:

1. la bandera roja **resta** 18 puntos, así que empuja sola hacia neutral/venta;
2. si aun así queda ≥60, **topea la etiqueta en `neutral`** y marca
   `limitado_por_bandera: true`. El informe entonces lo dice con todas las
   letras: *"El puntaje daba compra, pero hay una bandera roja abierta"*. Antes
   eso se insinuaba; ahora se afirma.

`sin datos suficientes` se mantiene, pero **no es una cuarta opinión**: es la
ausencia de opinión. Callar y decir "neutral" no es lo mismo.

### Distribución real sobre las 503 (medida, no estimada)

Corriendo `evaluar()` sobre el snapshot real (sin el bloque de crecimiento,
que ensancharía todavía más la cola):

| puntaje | empresas |
|---|---|
| 0–30 | 7 |
| 30–40 | 51 |
| 40–50 | 118 |
| 50–60 | 168 |
| 60–70 | 97 |
| 70–100 | 62 |

→ **compra 159 (32%) · neutral 286 (57%) · venta 58 (11,5%)**

Se midió antes de fijar los cortes justamente para que no pasara lo obvio: como
los puntajes son percentiles dentro del sector, se acumulan cerca de 50, y con
cortes mal puestos **todo el universo habría salido "neutral"** y el informe no
habría servido para rotar nada. Con 60/40, una cartera de 10 papeles tiene
típicamente 1 para sacar.

### El mismo veredicto, leído desde la cartera

```python
ACCION_CARTERA = {'compra': 'reforzar', 'neutral': 'mantener',
                  'venta': 'sacar', SIN_DATOS: 'revisar a mano'}
```

**No es una escala nueva**, es la misma decisión mirada desde el otro lado. Si
el informe individual dijera VENTA y el de cartera "mantener", el cliente
estaría leyendo dos documentos que se contradicen. Hay un test que lo verifica.

### `src/informe/estilos.js` — los cortes del semáforo se alinearon

Estaban en 65/45 y el veredicto pasó a 60/40. Sin este cambio el documento
mostraba la palabra "venta" con la pastilla en ámbar.

```js
export const CORTE_VERDE = 60   // = UMBRAL_COMPRA de api/informe.py
export const CORTE_AMBAR = 40   // = UMBRAL_VENTA
```

### `src/informe/sugerencias.js` — nuevo `planRotacion()`

Antes solo existía `sugerirReemplazos()`, que se disparaba con un umbral propio
(`score < 45`) **distinto del veredicto**. Dos criterios para lo mismo. Ahora la
acción sale del veredicto del backend y este módulo aporta solo lo que el
backend no puede saber: el **orden** y el **motivo en una línea**.

- **Orden de salida**: primero los que tienen banderas rojas; a igualdad de
  banderas, el de peor puntaje; desempate alfabético para que dos corridas con
  los mismos datos den el mismo documento.
- **`SECTOR_PESADO_PCT = 35`**: si un sector pasa el 35% de la cartera, el
  reemplazo "de otro sector" **no puede caer ahí**. Antes la rotación podía
  arreglar el papel y empeorar la concentración, que es el problema más caro de
  los dos. Si no hay nada bueno fuera de los sectores pesados, ofrece igual y el
  documento avisa aparte.
- **Respaldo de sector**: `sugerirReemplazos` buscaba el sector en `stocks`, y
  un papel de afuera del S&P 500 no está ahí — se quedaba sin alternativa de su
  propio rubro. Ahora acepta el sector del informe. Esto pasa a ser **crítico**
  con los 137 CEDEAR nuevos.

### `src/informe/Cartera.jsx` — el documento se reordenó

```
1. Portada
2. Qué hacer con esta cartera   ← NUEVO, va arriba
3. Resumen (ahora con columna Acción)
4. Composición por sector
5. Puntos de atención
6. Análisis por activo
7. Anexo opcional
```

La sección *"Oportunidades a considerar"* **desapareció**: estaba al final y
desconectada del veredicto. Su contenido se absorbió dentro de "Qué hacer con
esta cartera", junto al motivo de salida. El orden no es cosmético — antes el
documento describía y recién al final sugería; quien lo recibía tenía que
leerlo entero para saber qué se le estaba proponiendo.

La sección trae: contadores (sacar / mantener / reforzar), la lista **ordenada**
de lo que conviene sacar con motivo y reemplazos, el aviso de concentración, y
una tabla con el resto.

### Verificación

`prueba-cartera.jsx` (render real con react-dom/server sobre los datos reales de
Marcos + dos casos sintéticos en venta, porque **la cartera de prueba no tiene
ninguno** y la sección no se habría ejercitado nunca):

- el de bandera roja sale primero aunque tenga mejor puntaje que el otro;
- cada activo aparece **exactamente una vez** en todo el plan;
- ningún reemplazo repetido ni ya presente en la cartera;
- el reemplazo de otro sector no cae en un sector sobrecargado;
- **veredicto y acción nunca se contradicen**;
- casos límite: sin nada para sacar, 1 activo sin metadatos, todos con error, y
  **un veredicto viejo sin campo `accion`** (caché del navegador de una sesión
  anterior — sin este caso el documento explotaba al primer F5 de un usuario
  con caché).

Build real de Vite: `informe-*.js` **69,19 kB**, sin una línea del screener
(`Twelve Data`, `TD_LOTE`, `histFetch`, `mathjs` → 0 ocurrencias), y sin rastro
de las etiquetas viejas.

⚠️ `src/App.jsx` **no se tocó** en esta tanda.

---

## 🌎 +137 CEDEARs SOLO PARA EL INFORME (25/08/2026)

Marcos pasó una lista de ~200 tickers de su broker y pidió corroborarla.
Explícito: **"solo para el informe, no el screener (Dejar de lado en este
caso)"**.

**La lista tiene 174 tickers únicos, no ~200.** Corroborados uno por uno.

### Resultado: 137 entran, 37 no

| motivo | n | cuáles |
|---|---|---|
| **entran** | **137** | ver `local_bot/cedears_informe.py` |
| ya están en el S&P 500 | 16 | BKR BX CAH HON HOOD HSY IP JCI MMM MOS O QCOM SNDK T TSLA XYZ |
| código BYMA de algo que ya tenemos | 4 | DISN→DIS · BA.C→BA · BK→BNY (cambió de ticker en 2025) · BNG→BG |
| misma empresa en otra plaza | 2 | ABEV3 y VALE3 son las acciones de B3; usamos los ADR ABEV y VALE |
| **ETFs** (no tienen P/E ni ROE: el informe sale en blanco) | 3 | CIBR · ITA · SH |
| deslistadas / disueltas | 6 | AABA (Altaba, disuelta 2019) · AUY (Yamana→PAAS 2023) · PTR · SNP · LFC · AOCA/ACH (los cuatro chinos salieron del NYSE en 2022) |
| ADR rusos suspendidos desde 2022 | 3 | ATAD (Tatneft) · MBT · NLM (Novolipetsk) |
| OTC sin comparabilidad | 3 | FNMA · FMCC (en concurso desde 2008) · HNPIY |

### El problema central: el código de BYMA **no** es el ticker de Yahoo

Si le pedimos "TXR" a Yahoo no devuelve Ternium: devuelve otra cosa o nada.
**20 de los 174 eran códigos locales.** Verificados contra `rava.com/perfil/<código>`:

| BYMA | es en realidad | Yahoo |
|---|---|---|
| ADGO | Adecoagro | AGRO |
| CBRD | Companhia Brasileira de Distribuição | CBD |
| KOFM | Coca-Cola FEMSA | KOF |
| LAR | Lithium Americas **(Argentina)** | LAAC ← ojo: **no** es LAC, que también está en la lista |
| NOKA | Nokia | NOK |
| TXR | Ternium | TX |
| WBO | **Weibo** (no Wabtec) | WB |
| XROX | Xerox | XRX |
| BBV | BBVA | BBVA |
| B | **Barrick** (cambió de GOLD a B en 2025) | B |
| ADS · BAS · BAYN · BSN · DTEA · EOAN · MBG | adidas · BASF · Bayer · **Danone** · Deutsche Telekom · E.ON · Mercedes-Benz | ADR en USD, con la acción local como respaldo |
| HHPD · SMSN | Hon Hai (Foxconn) · Samsung | HNHPF/2317.TW · SMSN.IL |

### Cómo se resolvió sin depender de que yo acertara

`local_bot/cedears_informe.py` no guarda un símbolo por CEDEAR: guarda una
**cascada de candidatos**. Para las europeas va primero el ADR en USD y después
la acción local (`.DE`, `.PA`), porque el informe compara múltiplos entre
papeles y mezclar monedas los rompe. Si el primero no trae fundamentals, se cae
al segundo solo.

### `local_bot/validar_cedears.py` — hay que correrlo ANTES de bajar nada

Un ADR OTC puede existir y no traer P/E, ROE ni margen. Ese papel entra al
informe con todos los bloques en blanco y queda **peor que no estar**. El
validador lo dice antes: por cada CEDEAR prueba los candidatos y clasifica en
`OK / SIN_PRECIO / NO_ES_ACCION / SIN_SECTOR / POCOS_FUNDAMENTALS`, exigiendo al
menos 3 de las 6 métricas con las que el informe puntúa. Avisa aparte de los que
sirven pero **no tienen cobertura de analistas** (sin precio objetivo ni
consenso).

Escribe `local_bot/cedears_ok.txt`, que es lo que después lee el bot.
Probado offline con un yfinance falso que ejercita las ocho ramas, incluida la
caída de `BASFY` → `BAS.DE`.

### `local_bot/fetch_informe.py` — nueva bandera `--cedears-extra`

4 líneas de inserción + una función. `--cedears` (los 151 del S&P) sigue igual.
Si falta `cedears_ok.txt` usa los primeros candidatos y **avisa** que están sin
validar.

### Decisión de diseño: los 137 NO entran a la base de percentiles

Se reportan y se pueden proponer como reemplazo, pero **la base contra la que se
calculan los percentiles por sector sigue siendo las 503 del S&P**. Si un banco
brasileño entrara a la distribución de `Financials`, los percentiles del informe
dejarían de coincidir con los que muestra F1 y los dos productos empezarían a
decir números distintos sobre la misma empresa.

- base de comparación → 503 del S&P (sin cambios)
- universo reportable → 503 + 137
- candidatos a reemplazo → los que tengan CEDEAR de ambos conjuntos

### ⚠️ Peso del archivo — hay que mirarlo después de la corrida

`informe_detalle.json` está en ~1,2 MB con 151 activos (~8 kB cada uno). Con 137
más queda en **~2,3 MB**, y el endpoint hoy lo lee **por HTTP en cada arranque
en frío** (el `includeFiles` del `vercel.json` nunca llegó al bundle:
`rutas_probadas` da todo `null`). No bloquea, pero si el informe se siente lento
después de esta tanda, **este es el motivo y no otro**.

---

## 🔤 ACENTOS Y BUSCADOR (25/08/2026, después del push)

### El buscador no dejaba comparar

`Selector.jsx` renderizaba los resultados de la búsqueda con `<Chip>` **sin**
`seleccionado` ni `onAlternar`, así que no aparecía la casilla y el clic iba
directo al informe individual. Los grupos de cartera propia e historial sí las
pasaban: era el mismo componente usado de dos formas distintas. Dos props.

De paso: el pie flotante decía *"1 activos seleccionados"*.

### Todo el texto del endpoint estaba sin tildes

No era solo "anios". **`api/informe.py` entero estaba escrito en ASCII** — y
esas cadenas son el cuerpo del informe que recibe el cliente: "valuacion",
"dilucion", "multiplo", "capitalizacion", "recomendacion", "ciclico",
"depositos". El front (JSX) sí tenía acentos, así que el documento mezclaba
los dos y se notaba.

Se acentuaron **76 literales**, con `tokenize` para tocar solo los tokens de
tipo STRING. Verificado extrayendo todo el texto que ve el cliente sobre 16
tickers reales y revisando las 294 palabras distintas una por una.

Los acentos viajan sin problema: `json.dumps` los escapa a `\uXXXX` y el
navegador los reconstruye.

### 🐛 El bug que esto se llevó puesto — y por qué ahora hay un test de contrato

El reemplazo automático sobre literales también renombró **claves de
diccionario**: `'senales'` → `'señales'`, `'accion'` → `'acción'`,
`'historico'` → `'histórico'`, `'bloque': 'valuacion'` → `'valuación'`.

Lo peligroso es cómo se veía: **el archivo compilaba, el endpoint devolvía
200 y el JSON era válido.** Lo que se rompía estaba del otro lado — el front
leía `d.senales`, recibía `undefined`, y el informe salía en blanco sin un
solo error en consola. Lo agarró la corrida de pruebas, no la lectura del
diff.

Se revirtieron las 10 claves y se agregó **`test/test_contrato.py`**, que
congela: el set exacto de claves de la raíz, del veredicto y de cada señal;
que la etiqueta esté siempre dentro de `compra/neutral/venta/sin datos`; que
la acción esté dentro de `reforzar/mantener/sacar/revisar a mano`; que
**ninguna clave lleve tilde**; y que **ningún texto del cliente esté sin
tilde**. Las dos mitades de la misma regla, en el mismo test.

### `titulo` en cada señal

`porque` armaba el texto con `bloque.replace('_', ' ')`, así que imprimía
"valuacion: 30/100" — el identificador, sin acento, en un documento donde todo
lo demás sí lo tenía. Ahora cada señal viaja con `titulo` ya acentuado
(`BLOQUE_TEXTO` en el endpoint) y el front lo usa con respaldo al identificador
para informes cacheados de antes.

---

## 🧭 LAS 20 MEJORAS DE CARTERA — análisis y plan (25/08/2026)

Marcos pasó una lista de 20 mejoras en tiers (S/A/B/C) y pidió pensarla antes
de tocar nada: qué puede hacer la IA, qué hay que agregar al bot o al snapshot,
y qué parte conviene automatizar.

### El hallazgo que reordena todo

**`src/App.jsx` (F5) ya calcula, por posición: `cantidad`, `precioCompra`,
`pctExcel`, `valorActual`, `costoBase`, `gananciaUSD`, `gananciaPct` y
`pctActual`.** Está desde la línea 1458. El Excel del cliente ya se parsea con
esas columnas, y hay respaldo para cuando viene solo la lista de tickers.

**El informe de cartera no recibe nada de eso.** Trata todos los activos por
igual — decisión del 24/08, tomada cuando el informe todavía no apuntaba a
rotación.

Consecuencia: los puntos **2, 3, 4 y 5 del Tier S no necesitan IA, ni datos
nuevos, ni bot**. Necesitan que el informe reciba un dato que ya existe.

### Los 20 agrupados por lo que REQUIEREN (no por tier)

| grupo | puntos | qué hace falta |
|---|---|---|
| 🟢 Ya se puede | 1, 2, 3, 4, 5, 11 | pasar los pesos de F5 al informe |
| 🔵 Input del usuario | 6, peso objetivo del 2, clasificación del 3 | no hay IA que lo adivine |
| 🟡 Dato nuevo en el bot | 16, 12, 8, 15 | ver abajo |
| 🟣 Acá sí la IA | 14, 9, 18, 13, resumen ejecutivo | juicio, no aritmética |
| ⚪ Derivable de lo que hay | 17, 7, 10, 19 | solo código |
| ⚫ Input aparte | 20 | comisiones y régimen impositivo |

Detalle del grupo 🟡:

- **16 (P/E vs su propia historia)** — el EPS histórico ya lo trae EDGAR; falta
  la **serie de precios**. Es lo más caro de toda la lista.
- **12 (correlación)** — necesita retornos históricos. El screener los saca de
  Twelve Data en F3, pero el informe **no puede llamar a Twelve Data**
  (8 créditos/minuto, y ya nos costó el bug de F2/F3/F4). Habría que
  snapshotear una matriz desde el bot.
- **8 (quality of growth)** — márgenes y FCF ya están; falta **ROIC**, que pide
  tags nuevos de EDGAR (capital invertido).
- **15 (catalysts)** — `upgrades_downgrades` ya está; falta la fecha del
  próximo earnings.

### Regla: la IA no calcula, juzga

Los números los hace el código. El modelo recibe los números **ya calculados**
y escribe el juicio. Dos razones: la regla de gasto que puso Marcos, y que un
LLM haciendo aritmética sobre 280 activos sale caro y con peor precisión que
un `for`.

### Por qué el punto 1 va primero

Separar Fundamental Score de Portfolio Score no es una mejora más: es lo que
ordena las otras 19. El Fundamental Score ya existe — es el veredicto
compra/neutral/venta. El Portfolio Score es una capa arriba (peso,
concentración, correlación, objetivo). Separarlos ahora hace que 2 a 20 se
enchufen; dejarlo para después obliga a rehacer lo del medio.

### ✅ Decisiones de Marcos (25/08/2026)

1. **Peso objetivo: por perfil, con topes.** Se elige conservador / moderado /
   agresivo al generar el informe y de ahí salen el máximo por posición y el
   máximo por sector. Es una **regla, no una tabla**: sirve igual para una
   cartera existente que para una propuesta, y no hay que cargar nada por
   activo. (Se descartó equal weight porque marcaría sobreponderación en
   cualquier posición grande aunque sea deliberada.)
2. **Core / Growth / Speculative: derivado de datos** — capitalización, beta,
   si gana plata y antigüedad de la serie. Automático y consistente para los
   ~800 papeles, con posibilidad de corregir un caso puntual a mano.
3. **Orden: paso 1 primero** — separar los dos scores y hacer que el informe
   reciba cantidad, precio de compra y peso real.

### Plan en pasos

- **Paso 1** ✅ **HECHO** (25/08/2026) — ver abajo.
- **Paso 2** ✅ **HECHO** (26/08/2026) — objetivo + horizonte + afinidad (6, 13),
  el arreglo del dividendo (7) y el stress test (19).
- **Paso 3** ✅ **HECHO** (26/08/2026) — tesis por activo con dos proveedores
  separados. ⚠️ Falta que Marcos cargue las claves en Vercel para que aparezcan
  los botones. Sin claves, el informe funciona igual y no hay botón.
  Pendiente del paso 3: el **resumen ejecutivo de la CARTERA** (puntos 14, 18, 9
  a nivel cartera). Se dejó para después de ver la latencia de la tesis
  individual, porque rearmar 10 activos del lado del servidor tarda.
- **Paso 4** (sin bloqueos, lo que sigue):
  - **17 Expected return** — EPS esperado + cambio de multiplo + dividendo. Se
    deriva de lo que ya hay. ⚠️ Es el numero mas facil de leer como promesa:
    hay que mostrarlo con los supuestos a la vista o no ponerlo.
  - **15 Catalysts** — `upgrades_downgrades` ya esta en el snapshot y hoy no se
    usa para nada. Falta la fecha del proximo balance.
  - **10 Replacement quality** — hoy el reemplazo se elige por puntaje. Deberia
    exigir un margen minimo sobre el que sale y mostrar SU veredicto.
  - **Resumen ejecutivo de la CARTERA con IA** — 14 (thesis risk), 18 (bull /
    base / bear), 9 (que aporta que no tengo). Es lo que falta del paso 3.
- **Paso 5**: 16 (P/E vs su historia) y 12 (correlación) — piden datos nuevos y
  tocan el bot. Ver la nota sobre bajar el histórico de una vez.

### ⚠️ REORDENAMIENTO PROPUESTO (26/08/2026): el 5 antes que el 4

El *expected return* (punto 17, el plato fuerte del paso 4) se arma con tres
piezas: crecimiento de EPS esperado + **cambio de múltiplo** + dividendo. La
segunda necesita saber si el múltiplo de hoy está caro o barato **contra la
propia historia de la empresa** — que es exactamente el punto 16, del paso 5.

Sin eso, el "cambio de múltiplo" sale de suponer que converge a la mediana del
sector, que es un supuesto arbitrario metido dentro de un número que el cliente
va a leer como una proyección. Hacer el 5 primero convierte esa suposición en
un dato.

Además el snapshot de precios del paso 5 **arregla de raíz el límite de Twelve
Data en F2/F3/F4**, que hoy sigue siendo el bug más molesto del screener.
- **Pendiente aparte**: botón "Ver informe" en las filas de F1/F5 — es lo único
  que sí obliga a tocar `src/App.jsx`.

---

## ✅ PASO 1 — LA CAPA DE CARTERA (25/08/2026)

### No hizo falta tocar `src/App.jsx`

Era la parte que más preocupaba y resultó innecesaria. En `src/App.jsx`,
línea ~1521, F5 hace:

```js
const enriched = items.map(({sym,q,p,r})=>({
  symbol:sym, name:..., sector, price:..., pe:..., roe:..., score:...,
  ...(valuations[sym]||{}),     // ← cantidad, precioCompra, valorActual,
}))                             //    costoBase, gananciaUSD, gananciaPct, pctActual
```

y después `clientCacheSave(clientName, results, spy)` lo guarda entero en
`localStorage`. **Las posiciones ya estaban ahí desde siempre.**

Verificación de que el screener no se tocó: el bundle `main-*.js` sale con el
**mismo hash** que antes del cambio (`main-wr6GwcBs.js`). Byte por byte.

### 🐛 Y ahí apareció un bug silencioso

`leerCarterasF5()` en `Selector.jsx` buscaba `d.holdings || d.tickers || d.rows`.
El screener guarda `{fundData: {sector: [...]}, spy, timestamp}` — **ninguna de
esas tres claves existe**.

No fallaba: devolvía `[]`, el grupo no se agregaba, y el bloque **"Cartera
propia" simplemente nunca aparecía** en el informe. Sin error, sin consola, sin
nada. La única forma de notarlo era buscarlo.

Ahora lee la forma real (con respaldo a la plana por si hay carteras viejas),
saltea SPY, y trae de paso la antigüedad del snapshot para avisar si pasó de los
7 días que dura el caché de F5.

### `src/informe/cartera.js` (nuevo) — el segundo puntaje

**Los dos puntajes no se promedian nunca.** Promediarlos daría un número sin
significado: mezclaría "cuán buena es la empresa" con "cuánto tenés". Son
preguntas distintas y se cruzan en una matriz explícita:

|                | venta | neutral | compra |
|---|---|---|---|
| **sobrepeso**  | sacar | recortar | recortar (toma de ganancia) |
| **en banda**   | sacar | mantener | reforzar |
| **subpeso**    | sacar | consolidar o salir | reforzar |

**Perfiles y el detalle que no es obvio.** Los topes salen del perfil elegido
(conservador 8% / moderado 12% / agresivo 20% por posición). Pero un tope duro
del 8% en una cartera de 6 activos marcaría **las seis** en sobrepeso, porque
equiponderada ya da 16,7% cada una. Por eso:

```
topeGeneral = max(tope del perfil, factorEquiponderado × 100/N)
```

Así el informe señala concentración de verdad y no el hecho aritmético de tener
pocas posiciones. Lo mismo con los sectores.

**Clases** (derivadas de datos, decisión de Marcos): especulativo si no gana
plata, o capitaliza menos de US$2.000 M, o beta > 1,8; core si capitaliza más de
US$50.000 M y beta ≤ 1,2; growth el resto. **El orden importa**: primero se
descarta lo especulativo, porque una empresa que pierde plata no es "core" por
más grande que sea. Cada clase tiene su propio tope: Core 100% del general,
Growth 75%, Especulativo 40%.

**Take profit (punto 11)**: si un papel está sobre el tope, el veredicto NO es
venta y gana más del 15%, se marca como toma de ganancia. La distinción es todo
el punto: *recortar porque subió* y *salir porque la empresa está mal* son dos
motivos de venta completamente distintos y el cliente tiene que verlos separados.

**El monto**: cada recorte trae `excesoUSD`, cuánto vender para volver al tope.
Sin monto la recomendación no se puede operar.

### Qué cambió en el documento

- **Portada**: valor total de la cartera y perfil aplicado.
- **"Cuánto pesa cada cosa"** (nueva, solo si hay cantidades): composición por
  clase, tabla de peso vs tope con estado y resultado latente, y los tres avisos
  — sobre el tope, posiciones muy chicas, sectores excedidos.
- **"Qué hacer con esta cartera"**: los contadores ahora salen de la matriz.
  Nuevo bloque **"Conviene recortar — no por la empresa, por el tamaño"**, con
  peso, tope, monto a vender y el motivo.
- **Degradación**: sin cantidades, la sección de pesos **no se muestra** y todo
  funciona como antes. No se inventa una equiponderación que nadie pidió.

### Verificación — `prueba-pesos.jsx`

Reproduce la forma **exacta** de `clientCacheSave` en un `localStorage` falso y
cubre: lectura de las dos formas (actual y vieja), que SPY no entre como activo,
la caducidad de 7 días, los 5 casos de clasificación, que **la matriz nunca
devuelva "sacar" si el veredicto no es venta**, que los pesos sumen 100 en los
tres perfiles, que el tope nunca quede por debajo del perfil, cartera parcial
(algunos con cantidad y otros no), sin posiciones, perfil ausente, perfil
inexistente y posiciones con basura (`null`, strings, tickers que no están).

Y lo que más importa: que **ningún activo reciba dos recomendaciones distintas**
en el mismo documento — el bloque "recortar" y la tabla "el resto" no se pisan.

### Lo que el paso 1 NO resuelve

- **Peso objetivo real por activo**: hoy hay topes, no objetivos. Un papel dentro
  del tope no tiene "target" contra el cual estar corto o largo.
- **Punto 6 (objetivo y horizonte)**: el perfil es un proxy. Falta el horizonte
  temporal, que es lo que debería ponderar crecimiento contra dividendos.
- **Costo de rotar (punto 20)**: el informe dice cuánto vender, no cuánto cuesta.

---

## ✅ PASO 2 — PARA QUÉ ES ESTA CARTERA (26/08/2026)

### 🐛 Primero: el bloque de dividendos tenía un incentivo al revés

Buscando cómo implementar el punto 7 ("no penalizar Growth por yield bajo")
apareció que el problema no era de ponderación: era un **escalón**. El bloque
solo puntuaba `if dy:` — o sea, si el dividendo era distinto de cero. Medido
sobre datos reales:

| | paga | bloque dividendos | **global** |
|---|---|---|---|
| AMZN | 0% | `None` (no promedia) | **63,5** |
| GOOGL | 0,26% | 0/100 (sí promedia) | **47,1** |

**Empezar a pagar un dividendo simbólico te hundía 16 puntos. No pagar nada te
los dejaba intactos.** Dos empresas parecidas separadas por un dividendo que a
ningún accionista le cambia la vida.

Arreglo: `UMBRAL_DIVIDENDO_RELEVANTE = 1.0`. Debajo de 1% el dato se informa
pero no puntúa, igual que cuando no paga nada. GOOGL pasó a **62,8**, en línea
con AMZN.

**Efecto en las 503**: compra 201 (40%) · neutral 263 (52%) · venta 39 (7,8%).
Antes era 159/286/58. Hay más "compra" y menos "venta" porque desapareció el
lastre que arrastraba a las que pagan poco. La contracara es que **"venta" ahora
es más raro** (7,8% contra 11,5%): en una cartera de 10 se espera menos de uno.
Si con carteras reales resulta demasiado permisivo, el lugar para tocarlo es
`UMBRAL_VENTA`, no este umbral.

### Objetivo y horizonte — y por qué el ajuste va en el navegador

El formulario de cartera ahora pide tres cosas: **perfil** (topes de
concentración), **objetivo** (renta / equilibrado / crecimiento) y **horizonte**
(menos de 2 años / 2 a 5 / más de 5).

**El ajuste por objetivo se hace en el navegador, no en el endpoint.** La razón
es concreta: el informe cachea `action=datos` por ticker. Si el puntaje
dependiera del objetivo de la cartera, el caché estaría mal cada vez que se
abre la misma empresa con otro objetivo. Así que el endpoint sigue devolviendo
un veredicto objetivo-agnóstico y `cartera.js` **repesa los bloques que ya
vinieron**. Cero datos nuevos, cero llamadas extra.

```
afinidad = Σ(puntaje_bloque × peso_objetivo × ajuste_horizonte) / Σ(pesos)
```

El **puntaje fundamental no se toca**. Aparecen los dos al lado y lo que
interesa es la diferencia: cuando son muy distintos, la empresa es buena pero
para otra cosa. Medido en la cartera de prueba, AAPL da **41 con objetivo renta
y 61 con objetivo crecimiento** — la misma empresa, la misma data, otra balanza.

**El horizonte mueve poco a propósito.** Un modelo que cambiara mucho el puntaje
según si mirás a 2 o a 7 años estaría fingiendo una precisión que los datos no
dan. Lo que sí cambia de verdad es qué riesgos son relevantes: a corto plazo la
volatilidad y el ánimo del mercado; a largo, la dilución y el crecimiento real
(el precio objetivo de los analistas mira a 12 meses y a diez años no dice nada).

### Stress test (punto 19) — con una línea que no se cruza

Cuatro escenarios, y **el informe dice cuál tiene modelo y cuál es aritmética**:

| escenario | cómo se calcula |
|---|---|
| El mercado cae 20% | beta promedio ponderado. **Es un modelo.** |
| La posición más grande cae 30% | aritmética sobre el peso |
| El sector más pesado cae 25% | aritmética sobre el peso |
| Los especulativos caen 50% | aritmética sobre el peso |

**El escenario de tasas NO se calcula.** Haría falta la sensibilidad de cada
empresa a la tasa y no está en ninguna fuente que usemos. Un número inventado
ahí se leería igual de serio que los otros cuatro, y no lo sería. El documento
dice explícitamente que no se estima y por qué.

### Verificación

`prueba-pesos.jsx` sumó: que la afinidad **se mueva** entre objetivos (si no, el
campo no sirve para nada), que nunca se salga de 0–100 en las 9 combinaciones de
objetivo × horizonte, que objetivo u horizonte inexistentes caigan al valor por
defecto sin romper, que ninguna caída del stress test sea positiva ni supere el
100%, que el peor escenario quede primero, y que sin pesos no haya stress test.
Cuatro combinaciones nuevas de render, incluida `meta` completamente vacía.

Build: `informe-*.js` 88,97 kB. `main-*.js` sigue con el **mismo hash**
(`main-wr6GwcBs.js`): el screener no se tocó.

---

## ✅ PASO 3 — LA TESIS CON IA, CON DOS PROVEEDORES (26/08/2026)

### La decisión, y por qué el costo no la definió

Se midió el payload real sobre los datos de Marcos: **~1.250 tokens de entrada y
~450 de salida por activo**. A ese volumen:

| modelo | 1 activo | 50 tesis + 20 carteras al mes |
|---|---|---|
| gpt-5.6-luna | US$ 0,0008 | US$ 0,08 |
| Claude Haiku 4.5 | US$ 0,0035 | US$ 0,38 |
| **Claude Sonnet 5** | **US$ 0,0070** | **US$ 0,76** |
| Claude Opus 5 | US$ 0,0175 | US$ 1,90 |

Con Sonnet 5 hacen falta **489 informes de cartera para gastar US$ 10**. Elegir
el modelo más barato para ahorrar US$ 0,40 al mes es optimizar lo que no
importa. Se eligió **Sonnet 5** por calidad de redacción, no por precio.

**Elección de Marcos**: Anthropic + Sonnet 5 como principal, adaptador para
OpenAI + gpt-5.6-luna, y **dos botones separados**.

### La regla que define todo el diseño

> *"dos clicks diferentes, solo que gaste si selecciono uno, si elijo openai no
> use tokens de anthropic o viceversa"*

**NO HAY FALLBACK ENTRE PROVEEDORES.** Si elegís OpenAI y su clave no está, el
endpoint falla diciendo eso — no se cae a Anthropic para salvar la respuesta.
Un fallback silencioso sería exactamente gastar en un proveedor que no elegiste.

El parámetro `proveedor` es **obligatorio y sin valor por defecto**: sin él no
se llama a ningún modelo.

```
GET /api/informe?action=datos&ticker=AAPL                        CERO costo
GET /api/informe?action=proveedores                              CERO costo
GET /api/informe?action=tesis&ticker=AAPL&proveedor=anthropic    ← gasta
GET /api/informe?action=tesis&ticker=AAPL&proveedor=openai       ← gasta
```

### Los frenos, uno por uno

| freno | dónde |
|---|---|
| El informe se ve completo sin gastar | `action=datos` no llama a nadie |
| Un clic = una llamada | sin reintentos que puedan cobrar dos veces |
| Doble clic nervioso | los botones se bloquean mientras genera |
| Releer no vuelve a cobrar | caché por **ticker + proveedor**, 7 días |
| Respuesta desbocada | `MAX_TOKENS_TESIS = 900`, tope duro |
| Sin clave, no hay botón | `action=proveedores` decide qué se muestra |
| Ticker inexistente | se valida ANTES de llamar al modelo |
| El anexo de cartera | `conTesis={false}`: no son N botones que gastan |

**El prompt va podado a propósito**: solo el veredicto, los bloques con sus
notas, las banderas y los múltiplos. Nada de series históricas crudas ni
`upgrades_downgrades`. Medido: **1.486 caracteres (~424 tokens)** contra ~4.000
del informe entero. Cada token de más se paga y el modelo no los usaba.

Y la respuesta devuelve **tokens usados y costo estimado**, que el informe
muestra abajo del texto. No para asustar —son fracciones de centavo— sino
porque un gasto que no se ve es un gasto que no se controla.

### El prompt del sistema

Siete reglas, y las tres primeras son de honestidad: no inventar ni un número,
no redondear hacia un número más lindo, y no escribir el consenso de analistas
como si fuera proyección de la empresa. Las banderas rojas **tienen que**
aparecer en el texto. Tres párrafos, máximo 200 palabras.

### 🐛 Otro resto del pase de acentos

Un detector de nombres no definidos (AST) encontró que en la rama de "acción
desconocida" quedó `f'Accion desconocida: {acción}'` — con tilde. La variable se
llama `accion`. Habría reventado con `NameError`, pero **solo por esa rama**,
que ningún test ejercitaba porque todos pasan acciones válidas. Arreglado.

Lección para la próxima: un reemplazo masivo sobre literales necesita, además
del test de contrato, un barrido de nombres no definidos. El primero encontró
las claves de diccionario; este encontró la variable dentro del f-string.

### 🐛 `action=proveedores` devolvía 400 en producción

Apenas Marcos cargó las claves y pusheó, se consultó el endpoint real:

```
GET /api/informe?action=proveedores  ->  400
```

El guardia de arriba de `do_GET` decía `if not ticker and accion != 'diag'`.
`proveedores` no estaba exceptuado, así que **una acción que por diseño no
necesita ticker moría antes de ejecutarse**. Lo grave no era el 400: el front
preguntaba qué claves había, recibía un error, y **no mostraba ningún botón de
tesis aunque las claves estuvieran perfectamente cargadas**. Todo el paso 3
habría parecido no funcionar, sin un solo error visible.

**Los tests no lo agarraron y vale entender por qué**: todos llamaban a
`generar_tesis()` directo. Nadie entraba por `do_GET`, que es el único camino
que usa un navegador. Se corrigió la lista (`SIN_TICKER = ('diag',
'proveedores')`) y se agregó una **batería que entra por `do_GET`**, con un
handler falso que no llama al `__init__` real:

| pedido | esperado |
|---|---|
| `action=proveedores` sin ticker | 200, y cero llamadas a modelos |
| `action=datos&ticker=AAPL` | 200, y cero llamadas a modelos |
| `action=tesis` sin `proveedor` | 400 pidiendo el proveedor, sin llamar a nadie |
| `action=tesis&proveedor=anthropic` | 200, una sola llamada, a Anthropic |
| `action=tesis&proveedor=openai` sin su clave | 400, **sin caer a Anthropic** |
| `action=inventada` | 400 nombrando la acción (la rama del `{acción}`) |
| `action=datos` sin ticker | 400 pidiendo el ticker |

Lección: probar la función no es probar el endpoint. Todo lo que el navegador
toca tiene que tener al menos un caso que entre por la misma puerta.

### Verificación — `test/test_tesis.py`

**No gasta un solo token**: se reemplaza `_post_json` por un doble que devuelve
la forma exacta de cada API y **registra a qué URL se llamó**. Ese registro es
lo que permite verificar lo único que de verdad importa:

- con Anthropic elegido, **cero** llamadas a OpenAI, y al revés;
- con **solo una** clave cargada, pedir el otro proveedor falla **sin llamar a
  nadie** (no se cae al que sí tiene clave);
- proveedor vacío, inexistente o con espacios: rechazado sin llamar a nadie;
- ticker inexistente: no se llama al modelo;
- el tope de salida viaja en las dos APIs;
- el prompt no lleva series crudas y pesa menos de 4.000 caracteres;
- el respaldo de `max_tokens` para cuentas de OpenAI con modelos viejos —
  y el primer intento muere en un 400 **antes de generar**, así que el
  reintento no puede cobrar dos veces.

---

## ⚖️ EL DIVIDENDO PESABA DEMASIADO — medido y corregido (26/08/2026)

Marcos: *"el dividendo está pesando bastante en el score de las empresas
atractivas o con buenos fundamentals"*. Se midió sobre las 503 antes de tocar
nada, y tenía razón.

### El diagnóstico

Los cinco bloques promediaban parejo, así que para una empresa que paga
dividendo el bloque valía **~25% de su puntaje**. Resultado: **30 empresas
cambiaban de veredicto solo por el dividendo.**

**Once llegaban a COMPRA empujadas por él:**

| | con dividendo | sin el bloque | bloque |
|---|---|---|---|
| TROW | 67,5 | 57,1 | 98/100 |
| VZ | 67,9 | 59,2 | 94/100 |
| MDT | 67,2 | 58,8 | 92/100 |
| ITW | 61,2 | 51,7 | 90/100 |

**Diecinueve dejaban de serlo por pagar poco:**

| | con dividendo | sin el bloque | bloque |
|---|---|---|---|
| EQT | 57,9 | **74,3** | 9/100 |
| PCG | 53,3 | **68,8** | 7/100 |
| RL | 55,3 | 66,4 | 22/100 |
| KO | **37,5 = VENTA** | — | 19/100 |

**Coca-Cola marcada VENTA por repartir poco.** Ahí está el problema de fondo: el
percentil de dividendo se calcula *dentro del sector*, así que mide **"paga más
que sus pares"** — una política de reparto, no la calidad del negocio. KO paga
2,33% y eso es poco *para Consumer Staples*, donde todos pagan más.

### La corrección

```python
PESO_BLOQUE = {'valuacion': 1.0, 'crecimiento': 1.0, 'salud_financiera': 1.0,
               'consenso': 1.0, 'dividendos': 0.5}
```

El promedio pasó de simple a **ponderado**. El dividendo pesa la mitad que los
bloques que miden el negocio.

**Por qué 0,5 y no 0.** Un dividendo sostenido es evidencia real de generación de
caja y de disciplina; eso sí dice algo de la empresa. Lo que no puede es valer
lo mismo que la valuación.

**Y esto no le quita importancia al dividendo para quien lo busca**: el objetivo
de la cartera multiplica este peso por **2,5 en "renta"** (queda en 1,25, más
que cualquier otro bloque) y por **0,25 en "crecimiento"** (queda en 0,125, casi
nada). La preferencia del cliente se expresa ahí, que es su lugar, y no metida
dentro del puntaje de la empresa.

### Efecto medido

| peso | compra | neutral | venta | cambian de veredicto |
|---|---|---|---|---|
| 1,0 (antes) | 201 | 263 | 39 | — |
| 0,75 | 204 | 263 | 36 | 10 |
| **0,5 (elegido)** | **207** | **261** | **35** | **22** |
| 0,25 | 207 | 260 | 36 | 33 |
| 0,0 | 209 | 256 | 38 | 49 |

**22 de 503 (4,4%)**: una corrección quirúrgica, no una barajada. Los casos que
motivaron el cambio quedaron bien: EQT 57,9 → **64,9 compra**, PCG 53,3 →
**60,0 compra**, KO 37,5 venta → **40,2 neutral**. ITW cayó de compra a neutral,
que era lo correcto: se apoyaba en un dividendo de 90/100.

### El puntaje muestra sus pesos

Cada señal viaja con su `peso` y el informe lo dibuja (`pesa ×0.5`), con una
línea que explica por qué. **Un puntaje ponderado que no muestra sus pesos es
una caja negra**, y el `porque` del veredicto ahora lo dice también.

El test de contrato **recalcula el promedio ponderado y lo compara** con el
veredicto: si alguien vuelve a poner un promedio simple, falla ahí.

---

## 💡 CONSULTA DE MARCOS — bajar el histórico de precios de una vez

Preguntó si en vez de pedirle a Twelve Data en cada corrida no se puede bajar
todo el histórico una vez y guardarlo local. **Sí, y conviene** — no es
prioridad, pero queda anotado con el análisis hecho.

**La fuente debería ser yfinance, no Twelve Data.** El bot corre en la PC de
Marcos, donde Yahoo sí responde, y `yf.download()` acepta muchos símbolos por
llamada: ~640 papeles en tandas de 50 son 13 llamadas, minutos. Twelve Data en
gratuito da 8 créditos por minuto y 800 por día: los mismos 640 papeles son
~107 llamadas y **casi dos horas** de espera forzada.

Lo que resolvería:
- El bug de 429 en F2/F3/F4 desaparece: no habría llamadas en vivo.
- F2/F3/F4 pasarían a ser instantáneas.
- Habilita el punto **16** (P/E contra su propia historia) y el **12**
  (correlación), que hoy no se pueden hacer.

Lo que hay que mirar antes:
- **Peso**: 640 símbolos × 5 años diarios ≈ 4-8 MB. Para correlaciones alcanza
  con cierres **semanales**, que bajan eso a menos de 1 MB.
- **Los números van a moverse**: Twelve Data y Yahoo ajustan dividendos distinto,
  así que las volatilidades y correlaciones no van a dar idénticas. Hay que
  correr las dos en paralelo sobre los mismos 10 tickers y comparar **antes** de
  cambiar la fuente.
- **Alineación de fechas**: papeles con menos historia (IPO reciente) necesitan
  recorte a ventana común, si no la matriz de correlación sale sesgada.
- `auto_adjust=True` obligatorio, o los splits arruinan los retornos.

**Cómo probarlo sin riesgo**: el bot genera el snapshot, y F2/F3/F4 lo usan solo
si existe, con Twelve Data como respaldo. Se comparan las dos salidas y recién
cuando coinciden se saca el camino viejo.

---

---

## 🔒 REGLA OPERATIVA: no correr git desde el puente de Claude

Pasó dos veces (25 y 27/08/2026). Cuando Claude corre `git status` sobre la
carpeta montada, git crea `.git/index.lock` y **no puede borrarlo**: el puente
no tiene permiso de eliminar archivos. Queda un lock huérfano y **todos los
comandos git de Marcos fallan** con:

```
fatal: Unable to create '.../.git/index.lock': File exists.
```

La primera vez le costó tres comandos seguidos fallando sin entender por qué.

**Regla**: Claude no corre `git status`, `git diff` ni nada que toque el índice
sobre la carpeta de Marcos. Para verificar qué llegó, usa `grep`, `ls`, `sed` y
`python`, que no tocan `.git/`. Si igual hace falta mirar el historial,
`git log` es seguro (no escribe el índice).

**Si aparece el lock**: Marcos lo borra a mano antes de cualquier git.
```
del .git\index.lock
```

---

## ✋ `src/main.jsx`: el "modificado" era MÍO, no de Marcos

Corregido el 27/08/2026. Durante varias sesiones se le dijo a Marcos que
`src/main.jsx` figuraba modificado y que lo descartara o lo commiteara. **Su git
nunca lo vio modificado.** Al intentar commitearlo:

```
nothing to commit, working tree clean
```

### Por qué

Hay **dos gits mirando la misma carpeta**:

| | ve el archivo | `core.autocrlf` |
|---|---|---|
| Git de Windows (el de Marcos, el que commitea) | normalizado a LF | `true`, lo pone el instalador |
| Git del Linux del puente (el que usa Claude) | con CRLF crudo | sin definir |

El archivo en disco tiene CRLF (220 bytes) y en el commit está con LF (212).
El git de Windows normaliza al leer, así que para él **no hay ningún cambio**.
El git del Linux del puente no normaliza, así que ve el archivo distinto y lo
reporta modificado.

Y el `git config core.autocrlf` que se consultó para descartar esta hipótesis
**se corrió desde el Linux del puente**, no desde Windows. Leyó la config
equivocada y devolvió vacío, lo que pareció confirmar que no había
normalización. Es el mismo error de vantage point dos veces.

### Regla

**El git de Marcos es la autoridad sobre el estado del repo, no el del puente.**
Si el puente dice que algo está modificado y `git status` de Marcos dice que no,
gana Marcos. Nunca más mandarlo a "arreglar" un archivo por lo que se ve desde
acá.

Esto refuerza la regla de arriba: Claude no corre git sobre la carpeta montada.
No solo por el lock — también porque **la respuesta puede ser directamente
falsa**.

---

## 🚨 LOS PESOS ESTÁN MAL CUANDO LA CARTERA SUBIDA ES PARCIAL (27/08/2026)

Marcos lo vio antes de que pasara: *"si te subo 5 acciones, puede que sumen un
50%, porque el resto va a estar en acciones argentinas o en renta fija"*.

**Es un bug vivo hoy.** `analizarCartera()` calcula:

```js
peso = valorActual / (suma de los activos analizados) * 100
```

Si esos 5 CEDEARs son la mitad de la cartera real, **cada peso sale al doble** y
las alertas de sobrepeso se disparan de más. El informe dice "AAPL pesa 22%"
cuando en la cartera del cliente pesa 11%. No hay ningún aviso: los porcentajes
suman 100 y parecen correctos.

### La pieza que ya está y no se usa

F5 **ya parsea una columna `% Posición`** (`colPct`, busca "posicion",
"porcentaje", "tenencia" o "%") y la guarda como `pctExcel`. `leerCarterasF5()`
**ya la trae** hasta el informe. `analizarCartera()` la **ignora** y recalcula
sobre el subconjunto.

Arreglo mínimo: si viene `pctExcel`, ese es el peso real; si no, se recalcula
sobre lo analizado **y el informe lo dice con todas las letras** en vez de
presentar un 100% que no es el 100% de nada.

### Lo que falta para la rotación entre clases de activo

Saber que los CEDEARs son el 48% arregla los pesos, pero no contesta lo que
Marcos quiere: **cuánto rotar de cada cosa**. Para eso hace falta saber qué es
el otro 52% — renta fija, acciones locales, efectivo. Eso no está en ninguna
fuente y no se puede deducir: es input.

Propuesta: tres campos en el formulario del informe de cartera (valor de renta
fija, de acciones locales, de efectivo). Con eso el informe puede:

- calcular los pesos reales sobre el total;
- mostrar la composición completa, no solo la parte que sabe analizar;
- decir si la exposición a renta variable encaja con el perfil elegido, y
  cuánto habría que mover para que encaje.

### ⚠️ Límite honesto que hay que escribir en el documento

Acciones argentinas y renta fija local **no tienen datos** en las fuentes del
informe. Se pueden **dimensionar** (cuánto pesan) pero **no analizar**. El
documento tiene que decirlo, no hacer como si esa parte de la cartera no
existiera.

### Plantilla de carga

Se entregó `plantilla_cartera.xlsx`, verificada simulando el parser real de F5.
El detalle que la hace funcionar: **los encabezados van en la FILA 1**. F5 hace
`sheet_to_json(ws)` y toma la primera fila como encabezado; con un título
arriba, no encuentra la columna Ticker, cae al modo viejo y **pierde cantidad y
precio**. Las instrucciones van en una hoja aparte porque F5 solo lee la
primera.

Otro límite del parser: el ticker debe ser **1 a 5 letras, sin puntos ni
números**. `BRK.B` y `SMSN.IL` no entran por esta vía.

---

## ✅ RESUELTO: los pesos ahora salen sobre la cartera COMPLETA (27/08/2026)

Tres fuentes, en orden de precedencia. La primera que esté disponible manda:

| # | fuente | por qué en ese orden |
|---|---|---|
| 1 | columna **`% Posición`** del Excel | viene del reporte del broker, ya está sobre la cartera completa y **no envejece con el precio** |
| 2 | **montos** del resto (renta fija / acciones locales / efectivo) | exactos, pero si una posición se movió el total deja de cerrar |
| 3 | **porcentajes** del resto | menos precisos que los montos y más estables — es el motivo por el que Marcos pidió los dos |
| 4 | nada | reparte 100% entre lo analizado **y el documento lo dice** |

`analizarCartera()` recibe `otros = {modo: 'monto'|'pct', rentaFija, accionesLocales,
efectivo}` y devuelve `cobertura`, `origenPesos` y `valorTotalCartera`.

**Ojo con `pctActual`**: F5 lo calcula dividiendo por la suma de lo que se subió,
así que ya viene con el mismo error que estamos corrigiendo. El que sirve es
`pctExcel`, que es lo que se escribió en el Excel.

### El ancla equiponderada también se escala

`pesoEquiponderado = cobertura / n`. Si 5 posiciones son el 48% de la cartera,
equiponderado es 9,6% cada una, no 20%. Sin esta corrección los topes quedaban
al doble y no marcaban nada. Lo mismo con los sectores, que ahora se suman
sobre el total.

### Nueva sección: "Cómo está repartida la cartera"

Composición completa —acciones del exterior, renta fija, acciones locales,
efectivo— y la comparación contra el tope de renta variable del perfil
(conservador 50% · moderado 70% · agresivo 90%), con **el monto a mover**.
Eso es lo que contesta "cuánto rotar de cada cosa".

También cubre el caso inverso: un perfil agresivo con 30% en acciones no está
siendo prudente, está desalineado con lo que el cliente pidió.

**Límite declarado en el documento**: acciones argentinas y renta fija local se
pueden **dimensionar** pero no **analizar**. No hay datos de fundamentales para
ellas en las fuentes del informe. El documento lo dice en vez de hacer como si
esa parte de la cartera no existiera.

### 🐛 Shadowing, la misma clase de bug por segunda vez

Dentro del `.map` de `analizarCartera` ya existía `const base = i.veredicto?.puntaje`,
que **tapaba al `base` de afuera** (el que resuelve el denominador de los pesos)
durante todo el callback — incluida una línea *anterior* a su propia
declaración. Resultado: `Cannot access 'base' before initialization`.

Es exactamente lo que pasó en `probe_edgar.py`, donde `base` era la carpeta del
script y el bucle de márgenes la reasignaba a un float. **Una variable de nombre
corto reusada en dos alcances anidados, dos veces en el mismo proyecto.**

Por eso ahora hay **`detector-shadow.cjs`**, que recorre `src/informe/` buscando
declaraciones que reusen un nombre de un alcance exterior. Verificado
reintroduciendo el bug a propósito: lo agarra y sale con código 1.

---

## 🔍 AUDITORÍA DE LOS DATOS EN VIVO DEL SCREENER (27/08/2026)

Marcos pidió analizar todo lo que se le pide a Twelve Data y ver si se puede
bajar a la PC y cachear. La auditoría encontró tres cosas, y **la más grave no
tiene nada que ver con Twelve Data**.

### El mapa: qué usa qué

`api/data.py` tiene cinco acciones. **Solo UNA usa Twelve Data.**

| acción | fuente | quién la llama | problema |
|---|---|---|---|
| `sp500` | Wikipedia | F1 | ninguno |
| `quote` | **yfinance desde Vercel** | F1/F5, solo los que NO están en el snapshot | ⚠️ Yahoo bloquea IPs de datacenter |
| `profile` | **yfinance desde Vercel** | ídem | ⚠️ ídem |
| `ratios` | **yfinance desde Vercel** | ídem | ⚠️ ídem |
| `history` | **Twelve Data** | F2/F3/F4 | 8 créditos/minuto |

O sea: lo que "no da toda la información" son `quote`/`profile`/`ratios`, que
salen a Yahoo **desde Vercel** — exactamente el camino que la regla de oro #4
del proyecto dice que está bloqueado. Twelve Data es el que tarda, no el que
falta.

### 🐛 El caché de histórico NUNCA se guarda

`histCacheSave()` existe y tiene 7 días de vida. Pero `lsSet()` es esto:

```js
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
```

**El `catch {}` vacío se traga el error de cuota.** Y la cuota se supera casi
siempre, porque el caché guarda **siete campos por día** cuando el screener usa
exactamente dos:

```js
function toDailyRet(prices) { ... prices[i].close ... }   // solo .close y .date
```

`open`, `high`, `low`, `volume` y `adjClose` **no se usan en ningún cálculo**.
Verificado por grep sobre todo `App.jsx`.

| símbolos, 6 años | como se guarda hoy | solo cierres |
|---|---|---|
| 20 | 3,5 MB | 0,9 MB |
| 40 | **7,0 MB** | 1,8 MB |
| 80 | **14,0 MB** | 3,5 MB |
| 150 | **26,3 MB** | 6,6 MB |

localStorage da ~5 MB por origen — **y el informe comparte ese mismo origen**.
Con más de ~30 activos el caché falla en silencio y **cada corrida vuelve a
bajar todo de Twelve Data**. Ahí está la lentitud.

### Twelve Data no ajusta por dividendos

En `parse_td`, `adjClose` se escribe igual a `close`. O sea que los retornos que
hoy alimentan volatilidad, beta y correlación **ignoran los dividendos**. Pasar
a yfinance con `auto_adjust=True` va a **mover los números** — hacia mejor, pero
se van a mover. Hay que compararlos antes de cambiar la fuente, no después.

### Cuánto pesa y cuánto tarda cada camino

| | tiempo | tamaño |
|---|---|---|
| Twelve Data, 505 símbolos, 6 años | **88 minutos** (85 lotes × 62 s) | — |
| yfinance desde la PC, 634 símbolos | **minutos** (7-13 llamadas) | — |
| snapshot compacto, solo cierres diarios | | 7,7 MB |
| snapshot compacto, cierres **semanales** | | **1,6 MB** |

### El plan, en fases separadas

**Fase A — adelgazar el caché.** Guardar `{date, close}` en vez de siete campos.
Tres líneas en `App.jsx`, sin fuente nueva, sin bot. Hace que el caché de 7 días
**funcione por primera vez**. Es el mejor retorno por línea tocada de todo el
proyecto.

**Fase B — snapshot de precios desde la PC.** `local_bot/fetch_historico.py` con
yfinance, archivo **aparte** de `informe_detalle.json` para no engordarlo.
F2/F3/F4 lo leen; Twelve Data queda de respaldo para lo que falte.

**Fase C — matar `quote`/`profile`/`ratios` en vivo.** Los 129 CEDEARs nuevos ya
están en `informe_detalle.json` con `price`, `sector`, `pe`, `pb`, `roe`, `de`,
`evEbitda`, `netMargin`, `roa`, `revGrowth`, `priceToSales` — **los mismos
campos que esas tres acciones devuelven**. No hay que bajar un dato nuevo:
hay que leer del archivo que ya existe.

**Fase D — el paso 5 original.** P/E contra su propia historia y correlaciones
en el informe. Sale casi gratis una vez que existe el snapshot de la fase B.

### ⚠️ El paso 5 y esto son el MISMO trabajo

El paso 5 necesitaba un snapshot de precios históricos. La fase B **es ese
snapshot**. No hay que elegir entre uno y otro: hacer esto primero es hacer el
paso 5, y de paso arreglar el screener.

---

## ✅ FASE A — el caché de histórico ahora entra (27/08/2026)

`adelgazarHist()` deja de cada día **solo `date` y `close`**, que es lo único
que usa `toDailyRet()`. Medido con un localStorage simulado **con cuota** (con
uno infinito el bug es invisible):

| símbolos, 6 años | antes | ahora |
|---|---|---|
| 20 | 3,8 MB (entraba) | **1,2 MB** |
| 40 | 7,5 MB (**no entraba**) | **2,4 MB** |
| 80 | 14,8 MB (**no entraba**) | **4,7 MB** |
| 150 | 27,6 MB (**no entraba**) | 8,8 MB (sigue sin entrar) |

Y `histCacheSave` **ya no usa `lsSet`**: su `catch {}` vacío era exactamente lo
que escondía el problema. Ahora atrapa el error de cuota, avisa por consola con
el tamaño y la cantidad de símbolos, y devuelve `false`.

Verificado que **los retornos salen idénticos** a los del histórico completo —
byte por byte sobre la serie de `toDailyRet`. Adelgazar el caché no cambia un
solo número.

Los 150 símbolos siguen sin entrar, y está bien que así sea: para eso está la
fase B, donde el límite no es localStorage.

## ✅ FASE B1 — `local_bot/fetch_historico.py` (27/08/2026)

Baja el histórico con yfinance desde la PC y lo guarda en
`public/data/historico_precios.json`. **Todavía no lo lee nadie**: el screener
sigue con Twelve Data. Es a propósito.

**Formato con eje de fechas compartido.** Repetir la fecha en cada punto de cada
símbolo triplica el archivo:

```json
{"fechas": ["2020-01-02", ...],
 "series": {"AAPL": [72.88, null, ...]},
 "cobertura": {"AAPL": {"desde": 0, "puntos": 1512}}}
```

**`null` = ese día el papel no cotizaba.** Quien lo consuma tiene que
saltearlos, **no rellenarlos**: rellenar inventa un retorno de 0% que baja la
volatilidad artificialmente. Está escrito dentro del propio JSON
(`_nota_nulos`) para que no se pierda.

**El eje sale de SPY**, que cotiza todos los días hábiles y es el calendario
correcto. Si SPY no baja, el bot **aborta sin escribir**: sin benchmark el
snapshot no le sirve a F2/F3/F4. Verificado que no pisa el archivo bueno.

### ⚠️ Los números VAN a moverse

`auto_adjust=True` → precios ajustados por dividendos y splits. Twelve Data
devuelve el cierre crudo (`adjClose = close` en `api/data.py`). Las
volatilidades, betas y correlaciones **no van a coincidir** con las de hoy. Van
a estar mejor, pero distintas.

Por eso B1 no reemplaza nada. El camino es: generar el snapshot, correr las dos
fuentes sobre los mismos tickers, comparar, y **recién ahí** sacar el viejo.

### Verificación offline

yfinance falso que reproduce la forma real (`MultiIndex` con varios símbolos,
columnas planas con uno solo) y los casos feos: papel sin datos, IPO reciente
(nulls al principio), día faltante en el medio. Se comprueba que las series
quedan alineadas al eje, que los símbolos vacíos no se guardan, que el día
faltante queda en `null` y no rellenado, y que los retornos se pueden calcular
salteando nulls. Más `--solo`, `--sin-cedears` y `--anios`.

### ✅ Primera corrida real (27/08/2026)

```
python fetch_historico.py --solo AAPL MSFT KO XOM JPM
-> 6 simbolos x 1672 fechas, 0,1 MB, 3 segundos
```

**Tres segundos.** Twelve Data, para los mismos seis, serían dos lotes y ~2
minutos de espera forzada.

(1672 fechas y no 1512: `desde` es el 1 de enero de *año − 6*, así que desde
enero de 2020 hasta hoy son 6,65 años, no 6. Es correcto.)

#### Métricas calculadas con el snapshot nuevo

Replicando exactamente `calcRisk()` de `App.jsx`:

| | días | ret. anual | volatilidad | beta | maxDD |
|---|---|---|---|---|---|
| SPY | 1671 | 15,53% | 20,15% | **1,000** | 33,7% |
| AAPL | 1671 | 24,85% | 31,38% | 1,178 | 33,4% |
| MSFT | 1671 | 19,89% | 30,44% | 1,137 | 37,1% |
| KO | 1671 | 10,90% | 20,29% | 0,508 | 37,0% |
| XOM | 1671 | 17,97% | 32,43% | 0,730 | 55,0% |
| JPM | 1671 | 18,08% | 30,66% | 1,059 | 43,6% |

Los controles de sanidad dan bien: **el beta de SPY contra sí mismo es
exactamente 1,000**; el maxDD de SPY de 33,7% es el desplome de marzo 2020; el
55% de XOM es el derrumbe del petróleo del mismo año; y KO con beta 0,5 y baja
volatilidad es lo que se espera de una defensiva.

Correlaciones: AAPL–MSFT **0,64** (la más alta, las dos tecnológicas) y
MSFT–XOM **0,19** (la más baja, tecnología contra energía). Ordenadas como
deben estar.

#### Predicción falsable para comparar contra F2

Si la **única** diferencia entre las fuentes es el ajuste por dividendos, F2
tiene que mostrar hoy el retorno anual menos el dividend yield:

| | yfinance ajustado | F2 debería dar |
|---|---|---|
| SPY | 15,53% | **14,79%** |
| AAPL | 24,85% | **24,50%** |
| MSFT | 19,89% | **19,14%** |
| KO | 10,90% | **8,57%** |
| XOM | 17,97% | **15,47%** |
| JPM | 18,08% | **16,37%** |

**Y la volatilidad y el beta casi no deberían moverse**: los dividendos son
chicos y trimestrales, no cambian la forma de la serie. Si el retorno se mueve
como dice la tabla pero la volatilidad y el beta se mantienen, la fuente nueva
está bien y se puede avanzar con B2. Si la volatilidad o el beta se mueven
mucho, hay otra cosa y **no se cambia la fuente hasta entender qué**.

### ✅ COMPARACIÓN CONTRA F2 — la fuente nueva pasa (27/08/2026)

Sobre las **mismas ventanas** que muestra F2 (3Y = 756 días, 5Y = 1260),
replicando `calcRisk()`:

| | | F2 (Twelve Data) | snapshot yfinance | dif |
|---|---|---|---|---|
| **SPY 3Y** | retorno | 20,70% | 22,26% | **+1,56** |
| | volatilidad | 15,40% | 15,33% | −0,07 |
| | beta | 1,00 | 1,00 | 0,00 |
| | maxDD | −19,0% | −18,8% | +0,24 |
| **SPY 5Y** | retorno | 11,90% | 13,41% | **+1,51** |
| | volatilidad | 17,20% | 17,17% | −0,03 |
| | beta | 1,00 | 1,00 | 0,00 |
| **JPM 3Y** | retorno | 34,30% | 37,34% | **+3,04** |
| | volatilidad | 23,00% | 22,96% | −0,04 |
| | beta | 0,86 | 0,86 | 0,00 |
| **JPM 5Y** | retorno | 18,10% | 21,13% | **+3,03** |
| | volatilidad | 24,40% | 24,38% | −0,02 |
| | beta | 0,88 | 0,88 | −0,00 |
| | maxDD | −40,6% | −38,8% | +1,83 |

**La predicción se cumplió en lo que importaba:**

- **Volatilidad: coincide dentro de 0,07 puntos** en los cuatro casos.
- **Beta: idéntico a dos decimales** en los cuatro.
- **maxDD: dentro de 1,8 puntos**, y siempre menor en el ajustado — correcto,
  los dividendos amortiguan la caída acumulada.
- **El retorno es siempre más alto**, que es exactamente el ajuste.

#### El único punto que hubo que explicar

La brecha de retorno (**+1,5 SPY / +3,0 JPM**) supera al dividend yield de HOY
(0,74% / 1,71%). Dos motivos, los dos correctos:

1. **El yield del período fue mayor que el de hoy.** El precio ajustado de JPM
   se multiplicó por **2,60** en 5 años; el dividendo por acción creció mucho
   menos, así que hace 5 años rendía ~3% y no 1,7%.
2. **Los dividendos se reinvierten.** Los cobrados temprano rinden al mismo
   ritmo que la acción durante los años que quedan. Por eso la brecha tiene que
   **superar** al promedio simple de los yields, no igualarlo.

O sea: la predicción original era conservadora por usar el yield actual. La
dirección y el orden de magnitud dieron bien, y **lo que no debía moverse no se
movió**.

### 🟢 Veredicto: la fase B2 puede avanzar

Volatilidad, beta y maxDD —lo que alimenta el ranking de riesgo, la correlación
y Markowitz— **coinciden**. Lo único que cambia es el retorno, y cambia **hacia
el número correcto**: el retorno total de un accionista incluye los dividendos
que cobró.

Vale anotarlo al revés: **hasta hoy F2 venía subestimando el retorno** de todo
lo que paga dividendos. KO, XOM y los bancos aparecían peor de lo que fueron.

### ✅ FASE B2 HECHA (28/08/2026) — F2/F3/F4 leen el snapshot

**Qué cambió en `src/App.jsx`** (+184 líneas, −14; la mayor parte comentarios):

**1. El lector del snapshot** (`snapshotBajar` + `snapshotHistorico`, ~110
líneas nuevas, todas juntas y autocontenidas). Baja
`/data/historico_precios.json`, lo expande a la forma `[{date, close}]`
ascendente que ya esperaban `toDailyRet`/`alignedRet` —la MISMA que devolvía
Twelve Data después del `.reverse()`— y por eso **nada río abajo cambió**:
`calcRisk`, la matriz de correlación y Markowitz siguen igual.

**2. El orden de fuentes en las tres fases** (6 líneas por fase):

```
snapshot local  →  caché de localStorage (7 días)  →  Twelve Data
```

El snapshot va **antes** del caché a propósito. Si fuera al revés, un caché de
Twelve Data de hace 5 días taparía un snapshot recién generado y los números
seguirían siendo los crudos sin ninguna señal de por qué.

**3. Clave de caché `v1` → `v2`.** El `v1` podía tener series de Twelve Data
(cierre crudo) y ahora se guardan ajustadas: son números que no se pueden
mezclar. Se cambia la clave para que el caché viejo no siga contestando 7 días,
y hay un `useEffect` que **borra el `v1` una vez** — podía estar ocupando varios
MB de los ~5 MB que este origen **comparte con el informe**.

#### 🔒 Todo o nada, a propósito

Si el snapshot no cubre al menos el **85%** de los símbolos pedidos, no se
completa el resto con Twelve Data: se cae **entero** al camino viejo. Mezclar
series ajustadas con crudas en la misma matriz de correlación o covarianza
daría números sin significado — cada papel medido con una regla distinta.
Es preferible tardar y ser consistente.

#### El interruptor — 8 motivos de caída, los 8 probados

| Motivo | Qué hace |
|---|---|
| no está el archivo (404) | Twelve Data |
| el fetch explota (sin red) | Twelve Data |
| el JSON no tiene la forma esperada | Twelve Data |
| el snapshot tiene más de 45 días | Twelve Data |
| no tiene `generated_at` | Twelve Data |
| no trae SPY (el benchmark) | Twelve Data |
| se pide más historia de la que cubre | Twelve Data |
| cubre menos del 85% de los símbolos | Twelve Data |

Cada uno escribe en consola **por qué** y **qué hacer**, con el prefijo
`[hist] snapshot no usado:`. Antes un problema de fuente se perdía en silencio.

#### 🐛 Bug encontrado de paso: `${r.status}` en los tres lotes

En las tres fases había, dentro del `try` del lote:

```js
console.log(`[hist] lote ${batch.join(',')} → status ${r.status}`, d);
```

**`r` no existe en ese scope** — vive dentro de `histFetch`. La línea tiraba
`ReferenceError` en **todos** los lotes, siempre. Las fases andaban igual
porque los datos ya se habían asignado dos líneas arriba, pero el `catch`
marcaba cada símbolo con `histErrors[s] = "Error de red: r is not defined"`,
y **ese** era el mensaje que se mostraba cuando algo fallaba de verdad, tapando
la causa real (429, sin datos, símbolo inexistente).

Es el mismo patrón que el `{acción}` del f-string y el `base` de `cartera.js`:
**un nombre que no existe en una rama que casi nunca se mira**. Arreglado en
los tres lugares.

#### Verificación: `test/prueba-snapshot.cjs`, 41 comprobaciones ✅

La prueba **extrae las funciones reales de `App.jsx`** con regex y las corre en
un `vm` con `fetch` falso. No copia el código: copiarlo verificaría una copia y
no lo que se despliega. Se le da el **snapshot real** de la PC (6 símbolos,
1672 fechas). Comprueba:

1. Forma `{date, close}`, fechas ascendentes, ninguna fuera de orden, ningún
   `close` nulo.
2. **Los `null` se saltean, no se rellenan.** Con `[null, null, 50, 55]` la
   serie queda con 2 puntos y `toDailyRet` da **1** retorno (+10%), no 3.
   Rellenar habría inventado dos retornos de 0% que bajan la volatilidad.
3. El recorte por `from` corta de verdad y no deja nada anterior.
4. Los 8 motivos de caída, cada uno con su mensaje.
5. **Los números coinciden al centésimo** con los ya comparados contra F2:
   SPY 3Y 22,26% / 15,33 / β1,00 · JPM 5Y 21,13% / 24,38 / β0,88.

Correr con: `node test/prueba-snapshot.cjs` (necesita Node — Marcos no lo
tiene instalado, así que la corrí acá; queda en el repo para el futuro).

También pasó: `esbuild --bundle` (sintaxis) y `detector-shadow.cjs`
(8 shadowings vs 7 antes; el nuevo es un `let i` de un `for`, igual que los 6
que ya había).

#### 📸 El snapshot completo, corrido el 28/08/2026

```
633 símbolos x 1673 fechas · 9,3 MB · 79 segundos
```

**79 segundos contra los ~88 minutos de Twelve Data.** Cobertura del S&P:
**504/504 = 100%**, SPY incluido → el interruptor pasa sin problema.

13 papeles con menos de la mitad del historial, todos IPOs recientes y por eso
correcto:

| | puntos | años | |
|---|---|---|---|
| HONA | 53 | 0,2 | ⚠️ **por debajo de los 60 que pide el screener** → F2 lo muestra sin métricas y F3/F4 lo saltean. Es lo correcto, y es lo mismo que hacía Twelve Data. |
| FDXF | 66 | 0,3 | pasa apenas el umbral: F2 va a calcular un "3Y" con 66 días. **No es culpa de B2** (con Twelve Data pasaba igual), pero conviene poner un mínimo de puntos por ventana algún día. |
| Q, SNDK, NBIS | 211–465 | 0,8–1,8 | |
| GEV, SOLV, RDDT, ALAB | ~610 | 2,4 | |
| VLTO, LAC, ARM, KVUE | 728–833 | 2,9–3,3 | |

#### ⚖️ Cadencia: SEMANAL, no diaria — el archivo pesa

| | |
|---|---|
| crudo | 9,33 MB |
| gzip (así lo sirve Vercel) | **3,53 MB** |
| zlib, que es lo que guarda git | **~3,5 MB por versión** |

Servirlo no es problema: el browser baja 3,5 MB una vez y después lo cachea por
HTTP. **El problema es el historial de git**: cada versión commiteada suma
~3,5 MB *para siempre*. Diario serían **~1,3 GB al año** en un repo que hoy
pesa poco.

Y no hace falta. Este archivo alimenta retornos, volatilidad, beta y
correlaciones sobre ventanas de **3 a 6 años**: una semana de datos nuevos mueve
un retorno 3Y en centésimas. **Semanal alcanza de sobra**, y el interruptor de
45 días es la red de seguridad si se pasa un par de semanas.

> ❌ **No redondear para achicarlo.** Se probó: a 2 decimales baja a 7,7 MB,
> pero el precio ajustado más bajo del archivo es **KEEL a 0,22** (y BIOX 0,323,
> ONDS 0,336). Redondear a 2 decimales sobre 0,22 es un escalón del **2,3%**,
> que destroza los retornos diarios de esos CEDEARs. Los 4 decimales actuales
> son un escalón del 0,023%. **Se quedan los 4 decimales.**

#### 🪤 Trampa de git a tener presente

`git add public/data/historico_precios.json` **falla si se corre desde
`local_bot/`** — git resuelve la ruta desde el directorio actual, así que busca
`local_bot/public/data/`:

```
warning: could not open directory 'local_bot/public/data/'
fatal: pathspec '...' did not match any files
```

Como el bot se corre desde `local_bot/`, es el error natural. Se arregla con
`cd ..` primero. Y ojo: **`git add` no imprime nada cuando funciona** — el
silencio es el éxito, no un segundo fallo.

#### Lo que Marcos va a ver

- **F2/F3/F4 dejan de tardar ~88 minutos** y pasan a leer un archivo local.
- El mensaje de progreso dice `⚡ Histórico del snapshot local (N días,
  ajustado por dividendos)`, así que **se ve de dónde salieron los números**.
- Los **retornos suben** en todo lo que paga dividendos. Volatilidad, beta y
  maxDD quedan donde estaban.
- Si nunca corre `fetch_historico.py`, **todo sigue funcionando como antes**.

### ~~Lo que falta (fase B2)~~ — HECHO, ver arriba

Que F2/F3/F4 lean el snapshot. Toca `App.jsx` y mueve los números. Va después
de comparar.

---

## ✅ BUG DE F1 ARREGLADO — el patrimonio negativo puntúa como "barato" (28/08/2026)

Marcos reportó "faltan datos" en F1: MCD sin ROE ni D/E, los bancos sin
EV/EBITDA, MO y PM sin ROE ni D/E. **No es un problema de datos. Son tres cosas
distintas y solo una es un bug** — pero es grave.

### 1. ✅ Los huecos de ROE y D/E son CORRECTOS

MCD, BKNG, MAR, MO, PM, SBUX, ABBV y 26 más tienen **patrimonio neto
negativo**: décadas de recompras y dividendos financiados con deuda dejaron el
equity por debajo de cero. Con equity negativo **el ROE y el D/E no tienen
sentido** (denominador negativo), así que la fuente no los reporta. Está bien.

### 2. ✅ Los bancos sin EV/EBITDA también son CORRECTOS

Un banco **no tiene EBITDA con sentido**: la deuda es su materia prima, no su
financiamiento. Por eso JPM, BAC, WFC y SCHW no traen `evEbitda`, y el D/E de
un banco tampoco es comparable con el de una industrial.

**El informe ya lo sabe** — `SECTOR_OCULTAR['Financials']` en `api/informe.py`
oculta `evEbitda`, `netDebt`, `netDebtToEbitda`, `currentRatio`, `quickRatio` y
`grossMarginPct`. **El screener no**: muestra la columna vacía sin decir que no
aplica.

### 3. 🔴 EL BUG: un P/B de −187 saca el mejor puntaje del sector

`norm()` en `App.jsx` (línea ~1472) ordena de menor a mayor y para las métricas
de "menor es mejor" devuelve `1 - p`:

```js
const rank=[...cl].sort((a,b)=>a-b).filter(v=>v<val).length;
const p=rank/(cl.length-1);
return hb?p:1-p;
```

El P/B de MCD es **−187,38**. Es el número **más chico de todo el sector**, así
que `rank = 0`, `p = 0`, y devuelve **1,0 — el puntaje perfecto** en una
métrica que pesa 15%.

**Y pesa más que 15%.** Como el ROE (22%) y el D/E (13%) se caen por falta de
dato, `tw` baja de 1,00 a 0,65 y el P/B pasa a valer **0,15 / 0,65 = 23%** del
score. O sea: la empresa cobra el premio máximo en una métrica rota, y esa
métrica pesa un 50% más de lo previsto, **justo por culpa de la misma causa**.

Traducido: **tener el patrimonio en cero o negativo es lo que más te sube el
score.** Es exactamente al revés de lo que debería.

#### Alcance medido

| métrica | negativos sobre 504 | quiénes |
|---|---|---|
| `pb` | **33** | ABBV MO AZO BKNG CAH CCI DVA DELL DPZ FICO FDXF IT MCD MAR SBUX … |
| `evEbitda` | 3 | BRK-B, BA, MRNA |
| `pe` | 0 | (la fuente ya devuelve `None` cuando hay pérdidas) |
| `de` | 0 | |

**Consumer Discretionary con filtro CEDEAR** (lo que ve Marcos en pantalla):

| # | hoy | con el arreglo |
|---|---|---|
| 1 | **MCD 77,6 (4/6)** ▼2 | DECK 78,9 (6/6) |
| 2 | DECK 76,7 (6/6) ▲1 | BKNG 71,9 (3/6) |
| 3 | BKNG 74,3 (4/6) ▲1 | MCD 70,9 (3/6) |
| 4 | CCL 64,2 (6/6) = | CCL 67,2 (6/6) |
| 5 | EBAY 61,3 (6/6) = | EBAY 62,9 (6/6) |

**Sobre las 504 sin filtro**, cambian de dueño **5 puestos del Top 5**:

| sector | salen | entran |
|---|---|---|
| Consumer Discretionary | MCD, YUM | CCL, NVR |
| Healthcare | DVA | REGN |
| Industrials | OTIS | SNA |
| Technology | HPQ | MU |

Sin el filtro CEDEAR, MCD cae del puesto 3 al **15**, AZO baja 11 y BKNG baja 8.

### 🎯 Lo importante: este bug YA LO ARREGLAMOS, en el informe

`percentil()` en `api/informe.py` (línea 427) tiene exactamente el arreglo, con
el comentario que lo explica:

```python
    Para los múltiplos donde "menor es mejor" se descartan los valores <= 0:
    un P/E o un forward P/E negativo NO significa barato, significa que la
    empresa pierde plata. Sin este filtro RGTI puntuaba 100/100 en valuación.
    if menor_es_mejor:
        valores = [x for x in valores if x is not None and x > 0]
        if valor is not None and valor <= 0:
            return None
```

**Lo encontramos en el informe, lo arreglamos ahí, y nunca lo llevamos al
screener.** Los dos códigos hacen el mismo cálculo y solo uno está arreglado.

> 📌 **Regla para el futuro:** cuando se arregle un bug de *criterio* (no de
> plomería) en uno de los dos proyectos, revisar si el otro tiene el mismo
> cálculo. Están separados a propósito, pero `norm()` de App.jsx y `percentil()`
> de informe.py son **la misma fórmula escrita dos veces**, y por eso se
> desincronizan. Candidatos a revisar: `MENOR_ES_MEJOR` y `SECTOR_OCULTAR`.

### ✅ ARREGLADO (28/08/2026) — con reemplazos, no con huecos

Marcos eligió **no exigir un mínimo de métricas** (el badge `n/6` ya avisa) pero
pidió *"intentemos obtener todas las métricas nosotros con el snapshot"*. Eso
resultó ser lo correcto y además lo que resolvió el problema de fondo: en vez de
dejar huecos, **se reemplaza cada métrica rota por el múltiplo que los analistas
usan justamente cuando no hay patrimonio contra qué medir.**

| métrica | por qué se rompe | reemplazo | rescata |
|---|---|---|---|
| P/B | necesita patrimonio | **P/S** (Price/Sales) | 34 |
| ROE | necesita patrimonio | **ROA** (sobre activos) | 29 |
| D/E | necesita patrimonio | **Deuda neta / EBITDA** | 32 |
| EV/EBITDA en bancos | no existe el EBITDA | ninguno — dice `n/a` | — |

**Resultado sobre las 503:**

| | antes | con arreglo solo | **+ reemplazos** |
|---|---|---|---|
| 6/6 métricas | — | 398 | **397 + 46 con 5/5** |
| 3/6 métricas | — | **29** | **0** |

Los 29 que iban a quedar con la mitad del score sacado de tres números **son
cero**. 37 empresas usan al menos un reemplazo.

#### Los casos concretos, después

| | valuación | rentabilidad | deuda |
|---|---|---|---|
| MCD | 6,92 (P/S) | 13,25% (ROA) | 3,60x (DN/EBITDA) |
| BKNG | 5,58 (P/S) | 20,38% (ROA) | 0,36x (DN/EBITDA) |
| MO | 5,40 (P/S) | 29,55% (ROA) | 1,41x (DN/EBITDA) |
| PM | 6,90 (P/S) | 14,59% (ROA) | 2,39x (DN/EBITDA) |
| JPM | 2,64 (P/B) | 17,79% (ROE) | EV/EBITDA `n/a` |

#### Qué se tocó

**`local_bot/fetch_fundamentals.py`**

- **Anula `roe` y `de` cuando el patrimonio es negativo**, aunque la fuente
  mande un número. Esto era imprescindible: MAS informaba **ROE 5862%**, IT
  113%, DVA 88% y D/E 12,42. El ROE es "mayor es mejor" y pesa 22%, así que
  **MAS se llevaba el máximo del sector con un número que no existe.** Un hueco
  es honesto; un 5862% es una mentira que gana el ranking.
- **Saca el `abs()` de `'de': abs(de / 100)`.** El `abs()` convertía un D/E
  negativo en uno positivo de aspecto normal — DVA aparecía con 12,42, que se
  puntuaba como deuda altísima cuando en realidad es un número inexistente.
- **Agrega `ndEbitda`** calculado de `totalDebt − totalCash / ebitda`, y solo si
  la deuda neta es positiva (en bancos da negativa porque los depósitos cuentan
  como caja: JPM da −183.000 millones).
- **Deja el `pb` crudo, negativo incluido** — el screener ya descarta los `<= 0`
  al puntuar, y conservarlo permite detectar el patrimonio negativo aguas abajo.

**`src/App.jsx`**

- `norm()` descarta los `<= 0` en "menor es mejor". **Había DOS copias de
  `norm()`** (una en `runP1`, otra en `runClientP1`) escritas con distinto
  espaciado; la segunda casi se escapa del arreglo.
- `metricaEfectiva()` resuelve qué se usa realmente, y `puntuarGrupo()` unifica
  el cálculo del score que **estaba escrito tres veces** (F1, F5 modo cliente y
  el `marketScore` de las sugerencias de reemplazo). Las tres habrían necesitado
  el mismo arreglo por separado.
- **Los pools no se mezclan**: un ROA se compara contra ROAs, nunca contra ROEs.
  Son escalas distintas — el ROA siempre da más bajo porque no lleva
  apalancamiento. Mezclarlos castigaría a los reemplazados sin motivo.
- La tabla muestra **lo que se puntuó**, con la etiqueta del reemplazo en ámbar
  debajo (`P/S`, `ROA %`, `DN/EBITDA`) y el motivo en el tooltip.
- `SECTOR_NO_APLICA` — portado de `SECTOR_OCULTAR`. **Solo `evEbitda`**: el
  primer intento incluía también `de` y fue un error, porque el percentil es
  relativo al sector y el D/E de un banco se compara contra el de otros bancos,
  que es la comparación correcta. Lo detectó la prueba (COIN, IVZ y MSCI
  quedaban con una métrica menos sin motivo).

#### Cuánto se movió: 8 de 55 puestos del Top 5

**6 de los 11 sectores no cambian** (Communication Services, Consumer Staples,
Energy, Materials, Real Estate, Utilities). Los que sí:

| sector | salen | entran |
|---|---|---|
| Consumer Discretionary | MCD, YUM | NVR, BKNG |
| Healthcare | HCA, DVA | REGN, RMD |
| Industrials | OTIS | SNA |
| Technology | IT, WDC, HPQ | MU, SNDK, PTC |

Las caídas más grandes son exactamente los casos de patrimonio negativo:
**DVA #5 → #20**, **IT #2 → #8**, **FDXF #27 → #81**. Y MAS **sigue #1** en
Industrials aun sin su ROE de 5862% (80 en vez de 87) — o sea que el arreglo no
tira todo abajo a ciegas, corrige lo que estaba mal medido.

#### Verificación: `test/prueba-metricas.cjs`, 27 comprobaciones ✅

Extrae `FUND_METRICS`, `metricaEfectiva`, `puntuarGrupo`, `SECTOR_NO_APLICA` y
el `norm` **reales** de App.jsx y los corre sobre las 503 del snapshot,
simulando lo que va a producir el bot parcheado. Comprueba que un `<= 0` no
puntúe ni ensucie el pool, que el reemplazo entre solo cuando hace falta, que
los pools no se mezclen, que un negativo en "mayor es mejor" **sí** puntúe (un
margen de −5% es un dato real), y que los 75 scores de Technology coincidan con
el promedio ponderado recalculado a mano.

### 🏦 CET1 y NIM para bancos: analizado, NO se hace (por ahora) — 28/08/2026

Marcos preguntó si para Financials conviene medir con métricas propias del
sector: **ROE, ROA, CET1, NIM**. La idea es la correcta; el problema es otro.

#### Los datos no están

| métrica | ¿está? | qué costaría |
|---|---|---|
| ROE, ROA | ✅ ya están | — |
| **NIM** | ❌ | EDGAR: `InterestIncomeExpenseNet` / `Assets`. Es un *proxy* — el NIM real usa activos **rentables** promedio (sin goodwill ni inmuebles), ~10-15% menos que activos totales. Para un ranking **relativo** dentro del grupo ordena casi igual. Factible. |
| **CET1** | ❌ | EDGAR, pero el etiquetado XBRL es inconsistente entre bancos. Frágil. |

Los dos existen **solo para bancos de verdad**.

#### El problema de fondo: "Financials" no son bancos

| tipo | cuántas |
|---|---|
| Aseguradoras | 19 |
| **Bancos** | **18** |
| Sin clasificar (ARES, COIN, HOOD, IBKR, FDS, PFG…) | 11 |
| Pagos y datos (V, MA, SPGI, ICE, CME, MSCI, COF, SYF…) | 10 |
| Gestoras de activos (BLK, BX, KKR, APO, TROW…) | 9 |
| **total** | **67** |

**Solo 18 de 67 son bancos.** Agregar CET1 al *sector* dejaría a 49 en null:
peor que ahora.

Y el problema ya existe sin CET1: hoy el percentil compara el P/B de **MSCI**
—empresa de datos, patrimonio negativo, vende suscripciones— contra el de
**JPM** —banco a 2,6x libros—. Esa comparación no significa nada. El percentil
ya es relativo al sector; **lo que falla es que el sector es demasiado
heterogéneo**, y métricas bancarias nuevas no lo arreglan.

#### Lo que sí se hizo: capturar `industry` (gratis)

`local_bot/fetch_fundamentals.py` ahora guarda `info.get('industry')`. **Cuesta
cero**: ya viene en el mismo `info` que se pide. **Todavía no lo usa nadie** —
se captura para poder decidir con datos reales, no con una clasificación a mano.

#### Decisión pendiente, en este orden

1. **Correr el bot y mirar el reparto real por `industry`.** Recién ahí se sabe
   si los grupos dan para un percentil (informe.py exige n ≥ 5; con 18 bancos
   alcanza, con 3 exchanges no).
2. **Si dan: comparar por industria con caída a sector** cuando el grupo sea
   chico. ⚠️ Esto movería los rankings de **todos** los sectores, no solo
   Financials — es un cambio bastante más grande que el del patrimonio negativo,
   y hay que medirlo igual que se midió aquel.
3. **Recién después, y solo si hace falta, CET1/NIM.** Si agrupar por industria
   ya deja a los 18 bancos juntos, el ROE y el P/B —que son los múltiplos que
   mandan en bancos, como dice `SECTOR_AJUSTE` en informe.py— pueden alcanzar.

> 📌 **El orden importa:** primero agrupar bien, después agregar métricas. Al
> revés se agregan métricas para tapar un problema de agrupación.

#### Otros sectores con el mismo síntoma

- **Real Estate**: el múltiplo correcto para un REIT es **FFO**, no el P/E — la
  depreciación contable distorsiona la ganancia. `SECTOR_AJUSTE['Real Estate']`
  en informe.py ya lo dice por escrito, pero nadie lo calcula.
- **Energy**: `SECTOR_AJUSTE` ya avisa que un P/E bajo en el pico del ciclo es
  la trampa de valor clásica.

### 📊 El reparto REAL por `industry` (28/08/2026, corrida del bot)

Con el campo capturado, este es el reparto de Financials — ya no una
clasificación a mano:

| n | industry | quiénes |
|---|---|---|
| 13 | Asset Management | AMP APO ARES BEN BLK BX IVZ KKR NTRS PFG RJF STT TROW |
| 9 | Financial Data & Stock Exchanges | CBOE CME COIN FDS ICE MCO MSCI NDAQ SPGI |
| 9 | Banks - Regional | CFG FITB HBAN KEY MTB PNC RF TFC USB |
| 8 | Insurance - Property & Casualty | AIZ ALL CB CINF L PGR TRV WRB |
| 6 | Insurance Brokers | AJG AON BRO ERIE MRSH WTW |
| 5 | Banks - Diversified | BAC BNY C JPM WFC |
| 5 | Capital Markets | GS HOOD IBKR MS SCHW |
| 4 | Insurance - Life | AFL GL MET PRU |
| 4 | Insurance - Diversified | ACGL AIG BRK-B HIG |
| 3 | Credit Services | AXP COF SYF |
| 1 | Insurance - Reinsurance | EG |

**Agrupación propuesta** (ninguna industria sola alcanza; agrupadas sí):

| grupo | n | de qué industrias |
|---|---|---|
| **Bancos** | **17** | Banks-Diversified + Banks-Regional + Credit Services |
| Mercados y gestión | 27 | Asset Management + Capital Markets + Financial Data |
| Seguros | 23 | todas las Insurance-* + Insurance Brokers |

AXP, COF y SYF van con Bancos a propósito: **son bank holding companies** y
reportan CET1 igual que JPM.

### ⛔ Agrupar por industria en TODOS los sectores: NO

El mismo dato lo desaconseja fuera de Financials:

| sector | empresas | industrias | con n≥8 | cubren |
|---|---|---|---|---|
| **Consumer Discretionary** | 47 | 17 | **0** | 0/47 |
| **Real Estate** | 30 | 9 | **0** | 0/30 |
| **Consumer Staples** | 34 | 12 | **0** | 0/34 |
| Industrials | 84 | 26 | 2 | 26/84 |
| Financials | 67 | 11 | 4 | 39/67 |
| Technology | 75 | 16 | 4 | 47/75 |

Consumer Discretionary se parte en **17 industrias y ninguna llega a 8**. Un
percentil sobre 2 o 3 empresas no es un percentil. **Financials es el único
sector donde la separación se sostiene con los datos**, y por eso se hace solo
ahí.

### 🔬 SONDA `local_bot/probe_bancos.py` — pendiente de correr

CET1 y NIM **no están en yfinance**. Antes de escribir código de producción hay
que comprobar que los datos existen. La sonda prueba, para los 17 bancos:

- **NIM**: 3 rutas por yfinance (fila neta anual → ingreso menos egreso →
  TTM de 4 trimestres), sobre `Total Assets` del balance.
- **CET1**: 5 etiquetas XBRL candidatas contra la API de la SEC.

**No escribe nada en `public/data/`.** Solo mide y reporta cobertura.

> ⚠️ **El NIM va a ser un PROXY.** El NIM real usa activos **rentables**
> promedio (sin goodwill ni inmuebles); la sonda usa activos **totales**, que
> son ~10-15% más. El número va a salir más bajo que el que publica el banco.
> Para **ordenar** entre bancos sirve; para **citar el número** no. Si se
> muestra en pantalla hay que aclararlo.

> ⚠️ **Sospecha sobre CET1**: probablemente no tenga etiqueta us-gaap estándar
> y cada banco lo publique como extensión propia. Si la sonda lo confirma,
> automatizarlo requeriría parsear el texto del 10-Q banco por banco, que se
> rompe cada vez que uno cambia el formato. **Ese sería el motivo para NO
> hacerlo**, no la falta de ganas.

> 📌 **Por qué una sonda y no código directo:** la integración de la tesis con
> IA se escribió sin haber llamado nunca a la API de verdad y **sigue sin
> verificar**. Esta sonda existe para no repetirlo.

#### Medición de la separación, ya hecha

Con los 17 bancos puntuados entre sí en vez de contra los 67:

- **El orden entre bancos casi no cambia** — SYF #1 en los dos, y TFC, RF, MTB,
  USB quedan en el mismo vecindario. Los bancos ya se estaban comparando con las
  mismas métricas.
- **Lo que sí cambia es el Top 5 de Financials**: hoy SYF(82) CINF(80) ACGL(79)
  ALL(79) TROW(75); separado sería TROW(84) ALL(83) CINF(81) SYF(81) ACGL(80).
- **El valor real de separar no es reordenar bancos**: es dejar de comparar el
  P/B de **MSCI** —empresa de datos con patrimonio negativo— contra el de JPM.

### 🚩 FISV: el único caso que el arreglo NO cubre

Fiserv aparece con **2 de 6 métricas** (solo P/E 10,07 y P/B 1,04; el resto
todo `null`) y con eso **puntúa 99 y encabeza Technology**. Es la única empresa
de las 503 con 3 o más métricas nulas.

**Sospecha fuerte: es un ticker viejo.** Fiserv cambió de `FISV` a **`FI`** en
2023, y `FI` no está en el snapshot. Además el market cap que trae (28.000
millones) no se parece al de Fiserv. Si el ticker está muerto, yfinance devuelve
lo poco que le queda en caché y el resto `null`.

**Dos cosas a decidir, distintas:**

1. **Arreglar el ticker** — revisar de dónde sale `FISV` (la lista de Wikipedia
   en `fetch_sp500_list()`) y si hay más casos de renombre sin actualizar.
2. **Un piso mínimo de métricas.** Marcos eligió no ponerlo, y con los
   reemplazos esa decisión quedó bien: ya no hay ningún 3/6. Pero FISV muestra
   que **una empresa con 2 métricas puede encabezar un sector**, y eso no lo
   cubre el badge. Un piso de "la mitad de las aplicables" hoy dejaría afuera
   **solo a FISV**, sin tocar nada más. Queda como propuesta.

---

## 🏦 RESULTADO DE LA SONDA DE BANCOS (28/08/2026)

```
NIM  : 17/17 (100%)   [OK]
CET1 : 11/17  (65%)   [NO]
```

### ❌ CET1: NO se hace. Y es peor de lo que dice el 65%

Dos motivos, y el segundo no lo vi hasta leer la salida:

**1. La etiqueta que respondió NO es CET1.** Es
`TierOneRiskBasedCapitalToRiskWeightedAssets` — **Tier 1**, que es CET1 **más**
el capital adicional (acciones preferidas). Suele dar 1 a 2 puntos por encima
del CET1. O sea que ni siquiera en los 11 que "funcionaron" tenemos el número
que se pidió.

**2. Los que respondieron tampoco son confiables.** **MTB dio 6,00%**, y eso es
imposible para un Tier 1: el mínimo regulatorio con colchones ronda 8,5% y M&T
opera cerca de 11-13%. Lo más probable es que la sonda haya agarrado otra
dimensión del mismo dato (un ratio de apalancamiento, u otro contexto). Un dato
que a veces trae otra cosa **sin avisar** es peor que no tener el dato.

**Conclusión: CET1 queda afuera.** Sacarlo bien exigiría parsear el texto del
10-Q banco por banco, y eso se rompe cada vez que uno cambia el formato.

### ⚠️ NIM: sale al 100%, pero NO conviene puntuarlo

Los números salieron correctos y creíbles:

| | NIM aprox | |
|---|---|---|
| SYF | 15,51% | tarjetas |
| COF | 6,41% | tarjetas |
| AXP | 5,79% | tarjetas |
| MTB | 3,25% | regional |
| RF | 3,14% | regional |
| JPM / WFC / C | 2,16-2,25% | money-center |
| BAC | 1,76% | money-center |
| BNY | 1,05% | custodia |

Están donde tienen que estar: las tarjetas arriba, los regionales en 2,5-3,3%,
los grandes cerca de 2%, la custodia abajo. Como proxy, funciona.

**Pero mirá el rango: SYF 15,5% contra BNY 1,05%. Catorce puntos.** Esa
diferencia **no mide calidad, mide modelo de negocio**: un emisor de tarjetas
SIEMPRE va a tener más NIM que un banco de custodia, porque cobra 20% de
interés y el otro cobra comisiones.

> 🚨 **Puntuar el NIM crearía una versión nueva del bug que se acaba de
> arreglar**: una métrica que premia *ser de un tipo de negocio* en vez de
> *andar bien*. Es exactamente lo mismo que el P/B de −187 premiando el
> patrimonio negativo. Y encima el grupo "Bancos" mete a AXP, COF y SYF junto a
> JPM justamente porque son bank holding companies — o sea que el problema está
> garantizado por construcción.

**Propuesta: mostrar el NIM como dato, no como puntaje.** Aparece en la ficha
del banco (con la aclaración de que es aproximado sobre activos totales) pero
no entra al score. Si algún día se quiere puntuar, tendría que ser dentro de
Banks-Diversified + Banks-Regional únicamente, sacando Credit Services y BNY —
ahí el rango es 1,76% a 3,25%, que sí es comparable.

---

## 🔴 DOS BUGS DE `UnboundLocalError` EN `api/informe.py` (28/08/2026)

Al escribir el "qué revisar" del punto 4 aparecieron **dos variables que solo
existían dentro de un `if`**, y las dos reventaban justamente en Financials:

```python
    if mb and len(mb) >= 4:
        delta = mb[ks[-1]] - mb[ks[0]]     # <- solo existe si hay margen bruto
    ...
    else:
        nd, nde = cons.get('netDebt'), ...  # <- solo existe si NO es Financials
```

- **`delta`**: `mb` viene vacío siempre que no hay serie de margen bruto — y
  `grossMarginPct` está en `SECTOR_OCULTAR['Financials']`, así que en bancos
  **nunca** se define.
- **`nd` / `nde`**: la rama que las define es el `else` de "si es Financials no
  se muestra la deuda neta". En Financials se toma la otra rama.

Las dos ahora se inicializan en `None` antes del `if`. **Es el mismo patrón que
`{acción}` en el f-string y que `r.status` en App.jsx: un nombre que no existe
en la rama que casi nunca se mira.** Van tres.

> 📌 Lo importante: **este par lo encontró la prueba antes de subirlo**, no
> producción. Correr `evaluar()` con datos reales de MO y WFC costó dos minutos
> y evitó un 500 en todos los bancos con señal de trampa de valor.

---

## 🧪 LOS TESTS NUNCA PUDIERON CORRER EN LA PC DE MARCOS (28/08/2026)

`test_contrato.py` y `test_tesis.py` tenían clavada la ruta del contenedor
donde se escribieron:

```python
D = Path('/mnt/user-data/uploads/sp500-screener-yf')
spec = ... '/home/claude/informe/build/informe.py'
```

En la máquina de Marcos eso es `FileNotFoundError`. **La suite existía pero era
incorrible donde vive el código.** Ahora las rutas se resuelven relativas al
propio archivo (`Path(__file__).resolve().parent.parent`), así que anda desde
cualquier lado:

```
python test/test_contrato.py
python test/test_tesis.py
```

Las dos pasan con el código nuevo.

> 📌 **Regla:** un test con una ruta absoluta del entorno donde se escribió no
> es un test, es una nota. Rutas siempre relativas a `__file__`.

---

## ✅ TESIS EN EL ANEXO DE CARTERA — ACTIVADA (28/08/2026)

**Síntoma:** al cargar una cartera o seleccionar varios activos no aparecían
los botones de tesis. En un activo suelto sí.

**No era un bug del endpoint.** Se comprobó contra producción:

```json
{"anthropic": {"disponible": true,  "modelo": "claude-sonnet-5"},
 "openai":    {"disponible": false, "modelo": "gpt-5.6-luna"}}
```

**Era `conTesis={false}` en `Cartera.jsx`**, puesto a propósito con este
razonamiento: *"serían N botones que gastan, uno por activo"*. **El
razonamiento estaba mal**: cada botón gasta **solo cuando se lo clickea**, así
que N botones no son N llamadas. Marcos elige de cuál quiere la lectura en
prosa, uno por uno — que es exactamente la regla de costo del proyecto. Los
botones ya llevaban `no-imprimir`, así que no ensucian el PDF.

### Y de paso: el estado "sin claves" ya no es invisible

`tesis.jsx` hacía `if (!activos.length) return null` — el componente
desaparecía **sin decir nada**, y desde la pantalla no había forma de
distinguir "falta la clave" de "hay un bug". Es el mismo problema que el
`catch {}` vacío del caché de histórico. Ahora muestra un aviso que dice qué
variable falta.

> ⚠️ **OpenAI figura `disponible: false`**: falta cargar `OPENAI_API_KEY` en
> Vercel (Anthropic sí está). No es un error — es que nunca se cargó esa clave.

---

## 📋 "QUÉ REVISAR" EN LOS AVISOS DE TRAMPA DE VALOR (28/08/2026)

**Antes:** *"Barato por algo: revisar por qué antes de comprar el descuento."*
Y ahí terminaba. Mandaba a revisar sin decir **qué**, o sea que le trasladaba
el trabajo al lector.

**Ahora arma la lista de chequeos y, donde el dato ya está bajado, la
CONTESTA.** Los seis puntos:

1. **¿El mercado ya lo sabe?** Compara el P/E a futuro contra el actual. Si el
   de futuro es **mayor**, los analistas esperan **menos** ganancia — el indicio
   más directo de que el descuento no es oportunidad.
2. **¿Lo sostiene la recompra?** Si el EPS sube pero la ganancia total cae, lo
   está sosteniendo la recompra de acciones, no el negocio. Eso tiene límite.
3. **¿El dividendo aguanta?** Payout sobre 80% con ingresos cayendo = riesgo.
4. **¿Cuánto tiempo da la deuda?** Deuda neta / EBITDA sobre 3x.
5. **¿Se defiende el margen o cede precio?** Variación del margen bruto.
6. **¿Es la empresa o todo el sector?** Único que queda a mano — pero se
   pregunta explícitamente.

Salida real para **MO**, con sus datos:

> - A favor: el P/E a futuro (11,6x) es menor que el actual (14,4x), así que se
>   espera que la ganancia se recupere.
> - El EPS sube +4,0% anual pero la ganancia total cae −1,2% con 3,5% anual de
>   recompra: lo sostiene la recompra de acciones, no el negocio.
> - **El dividendo está en riesgo: paga 89% de la ganancia para rendir 6,2%.**
>   Con los ingresos cayendo, ese reparto no tiene margen.
> - A favor: sostiene el margen bruto (+2,5 puntos), así que vende menos pero
>   no más barato.

Y para **WFC**, que no tiene margen bruto ni deuda neta, **saltea esos dos
puntos en vez de romper** (que es justamente el bug que se arregló arriba).

Se agregó la clave `revisar` a los riesgos y el componente `QueRevisar`,
exportado desde `Informe.jsx` y reusado en los **tres** lugares donde se
renderiza un riesgo — para no tener tres copias que después se desincronizan,
que es como nacieron los dos `norm()` de App.jsx.

---

## ✅ PASO 1 DE LA TESIS DE CARTERA — `sugerencias.js` al día (28/08/2026)

Antes de conectar la tesis había que resolver que `sugerencias.js` —de donde
salen los candidatos de rotación— **reimplementaba** el criterio de F1 y estaba
desactualizado. Ya está.

### Lo que se corrigió

| | antes | ahora |
|---|---|---|
| promedio de percentiles | **simple** | **ponderado** (0,20/0,15/0,22/0,13/0,15/0,15) |
| reemplazos P/S · ROA · DN/EBITDA | no | **sí** |
| `evEbitda` en bancos | contaba | **no aplica**, denominador 5 |
| lo que devuelve | un número | `{score, nUsadas, nAplicables, reemplazos}` |

El cambio de forma de `scores` era el riesgo del paso (es el mismo tipo de
cambio de contrato que rompió el informe con los acentos), así que se buscaron
**todos** los consumidores: `scores` solo viaja App.jsx → Cartera.jsx →
`planRotacion` → `sugerirReemplazos`, todo dentro del módulo. Se agregó un
helper `pts()` para que no quede ningún `scores[a] - scores[b]` restando
objetos, que en JS da `NaN` sin avisar y ordena cualquier cosa.

### 🔴 Y apareció un bug de pool — en los DOS archivos

Al probar los reemplazos, **MO puntuaba 93,8 con 3 de 6 métricas y encabezaba
Consumer Staples.** Los reemplazos no se le aplicaban. El motivo:

> El pool de comparación de un reemplazo eran **solo los papeles que usan ese
> mismo reemplazo**. En Consumer Staples los únicos con patrimonio negativo son
> **MO y PM: un pool de dos.** `percentil` exige cinco → devolvía `null` → el
> reemplazo se caía **en silencio** → MO quedaba con 3 métricas y, justamente
> por eso, con el puntaje más alto del sector.

En Consumer Discretionary hay 11 con patrimonio negativo, así que el pool
alcanzaba y MCD y BKNG sí funcionaban. **El bug solo aparecía en los sectores
con pocos casos**, que es por qué no se vio antes.

**El arreglo:** el pool de un campo es **todo el sector que tenga ese campo**,
no solo los que lo usan como reemplazo. El P/S existe para todas las empresas,
no solo para las de patrimonio negativo. Es a la vez más correcto y hace que el
pool alcance. Lo que sigue prohibido es mezclar **escalas** (un ROA contra
ROEs) y eso se respeta: el pool se arma **por campo**.

**`src/App.jsx` tenía el mismo bug**, oculto porque su umbral es 2 en vez de 5:
no fallaba, devolvía un percentil sobre dos valores — que solo puede dar 0 o 1.
**Un puntaje máximo o mínimo por sorteo, sin ningún aviso.** Corregido también.

#### Cuánto movió

- **En `sugerencias.js`**: el reemplazo de otro sector para XOM pasó de
  **MO (93,8 con 3/6)** a **NEM (83 con 6/6)**. Un candidato falso por otro real.
- **En F1**: **1 solo puesto de 55** (Healthcare: sale RMD, entra HCA). Chico,
  pero el que estaba mal era el de antes.

### 🆕 `candidatosRotacion()` — el pool para la tesis

**Decisión de Marcos:** que los candidatos salgan de lo que da F1 —las mejores
por sector, solo CEDEAR— y no de las 150, para ahorrar. **Correcto, y el ahorro
está medido:**

```
todos los CEDEAR:     144 papeles  ~4.478 tokens
top 5 por sector:      49 papeles  ~1.522 tokens
ahorro por llamada:               ~2.956 tokens
```

Los candidatos **van dentro del prompt**, así que eso se paga en **cada**
llamada. El modelo no necesita el padrón completo: necesita los mejores de cada
rubro para poder elegir.

Dos detalles de diseño que la prueba verifica:

1. **Se excluye la cartera ANTES de cortar.** Si se cortara primero, un sector
   donde el cliente ya tiene 3 de los 5 mejores quedaría con 2 candidatos. Así
   siempre quedan 5 **reales**.
2. **Desempate alfabético.** Dos corridas con los mismos datos tienen que dar el
   mismo documento; sin eso el orden depende del `sort` del navegador.

Sectores chicos: Real Estate devuelve 1 y Utilities 3. No es un error, es todo
lo que hay.

### Verificación

- `test/prueba-sugerencias.cjs` — **31 comprobaciones**, NUEVO. Carga el módulo
  real (parseando los `export` a un sandbox, sin build) y lo corre sobre las 503.
- `test/prueba-metricas.cjs` — actualizado. **Tenía un caso que daba por bueno
  el comportamiento viejo**: afirmaba que estaba bien que un papel perdiera la
  métrica por ser el único con reemplazo en su sector. Ahora verifica lo
  contrario, y que las escalas sigan sin mezclarse.

> 📌 **Lección:** el bug del pool estaba en App.jsx desde que se escribió el
> arreglo del patrimonio negativo, y su propia prueba lo daba por correcto.
> Apareció recién al implementar lo mismo en otro archivo con otro umbral.
> **Escribir el mismo criterio dos veces es caro, pero compararlos encuentra
> cosas.**

---

## 🔴 PRIMERA LLAMADA REAL A ANTHROPIC — falló, y el error no servía (28/08/2026)

**MSFT, tesis individual. Resultado:** *"Anthropic respondio vacio. No se genero
la tesis (igual puede haberse cobrado la llamada)."* Y **cobró USD 0,01**.

O sea: la llamada salió, consumió tokens, el modelo respondió — y el parseo no
encontró texto.

### Lo primero que había que arreglar no era la causa, era el mensaje

`_llamar_anthropic()` devolvía solo `(texto, tokens_entrada, tokens_salida)` y
**tiraba todo lo demás**: el `stop_reason`, los tipos de bloque que vinieron, el
modelo que contestó. Justo lo único que explica qué pasó.

> ⚠️ **Y esto es peor que un error silencioso normal: la llamada YA se cobró.**
> Repetirla a ciegas cuesta plata otra vez y no aporta nada nuevo. El mensaje
> tiene que diagnosticar **a la primera**.

Es el mismo patrón que el `catch {}` vacío del caché de histórico: el dato
estaba ahí y se descartaba.

### La hipótesis: 900 tokens no alcanzaban

`MAX_TOKENS_TESIS` estaba en **900**. Con los modelos que razonan antes de
responder, ese presupuesto se puede consumir **entero en el bloque de
razonamiento**, y no queda nada para el texto. El `content` vuelve con un bloque
que no es de tipo `text`, el filtro no encuentra nada, y el resultado es
exactamente lo que se vio: cobro sin texto.

Encaja con el costo: USD 0,01 significa que **sí hubo tokens de salida**.

**Subido a 2000.** Y esto es importante: **subir el tope NO sube el costo por sí
solo** — se paga lo que el modelo escribe, no lo que se le permite escribir. Lo
único que hace es que no se corte antes de empezar.

### Lo que devuelve ahora si vuelve a fallar

```
Anthropic respondio sin texto. No se genero la tesis (la llamada igual se
cobro). Se corto por el tope de salida (2000 tokens): el modelo gasto el
presupuesto antes de escribir texto. Subir MAX_TOKENS_TESIS.
Detalle: {"stop_reason": "max_tokens", "tipos_de_bloque": ["thinking"],
          "n_bloques": 1, "modelo_que_respondio": "claude-sonnet-5",
          "tokens_salida": 900}
```

Los dos proveedores devuelven ahora un cuarto valor `diag`, con la misma forma,
para que el caller no tenga dos caminos.

### El caso no estaba en los tests — ahora sí

`test_tesis.py` probaba el camino feliz y la separación de proveedores, pero
**nunca** una respuesta sin texto. Se agregaron:

- respuesta con solo un bloque `thinking` y `stop_reason: max_tokens` → el error
  tiene que nombrar el tope, el tipo de bloque, y avisar que se cobró
- respuesta con `content: []` → tiene que traer el `stop_reason` igual
- `MAX_TOKENS_TESIS >= 1500`, para que nadie lo baje sin darse cuenta

> 📌 **Lección:** una integración con un servicio externo necesita una prueba de
> **la respuesta rara**, no solo de la buena. La respuesta buena la escribimos
> nosotros en el doble; la rara es la que manda el mundo real.

### ⚠️ Sigue sin verificarse de punta a punta

La hipótesis del tope es **la más probable, pero es una hipótesis**. Hasta que
una corrida devuelva texto de verdad, la integración con IA **sigue sin estar
verificada** — es la deuda más vieja del proyecto. Si el segundo intento vuelve
a fallar, el mensaje ahora dice exactamente por qué.

---

## ✅ LA TABLA ACTUAL vs OBJETIVO + 2 BUGS QUE TIRABAN EL MOTOR B (31/08/2026)

Cierra los dos puntos aprobados ("avancemos con lo propuesto") y, en el camino,
aparecieron **dos bugs que explican por qué el informe seguía siendo Motor A**
aunque el Motor B estuviera calculado y probado.

### 1. La tabla ACTUAL vs OBJETIVO — `planDePesos()`

`src/informe/cartera.js` → `export function planDePesos(cart, riesgo)`.
Cruza lo que ya existía y estaba en dos lugares distintos:

```
peso + tope + cantidad + valor   ← analizarCartera()   (Motor A)
objetivo + aporte + correlación  ← riesgo.js           (Motor B)
```

y produce el número que se OPERA: Δ en puntos porcentuales, monto en dólares y
**cantidad entera de acciones** (truncada, nunca redondeada para arriba: hacia
arriba se vendería más de lo que hay).

Se dibuja en `Cartera.jsx` como `<ActualVsObjetivo>`, entre "Cuánto pesa cada
cosa" y "Afinidad". **Sí sale impresa** — es la sección que convierte el
diagnóstico en algo ejecutable.

Sobre la cartera de la auditoría, con el histórico real:

```
  ticker   pesa  debería      Δ         monto   acc   riesgo  corr   qué hacer
  AAPL      30%    10.8%  -19.2pp  US$ -11520   -38   59.9%   0.24   vender
  KO        10%    22.7%   12.7pp    US$  7620   127    3.2%   0.06   comprar
  XOM      6.7%    14.9%    8.2pp    US$  4920    49    3.5%   0.10   comprar
  JPM       15%    13.4%   -1.6pp    US$  -960    -3   16.5%   0.21   vender
  MSFT    13.3%    13.2%   -0.1pp             —     —   16.9%   0.21   queda igual

  volatilidad 15.9% → 12.2%  (mejora 3.7 puntos)
```

Detalles de diseño que importan:

- **`UMBRAL_AJUSTE_PP = 1.0`.** Por debajo de un punto no se mueve nada. No es
  por el costo de operar —es una cuota fija mensual, así que el monto nunca
  justifica no operar— sino porque medio punto está **adentro del error del
  propio cálculo**: la covarianza es histórica y no tiene esa precisión.
- **El denominador es la cartera COMPLETA**, no lo analizado. Si se usara lo
  analizado, cada ajuste saldría chico en la proporción exacta en que la cartera
  está sin cubrir. Hay una comprobación dedicada a eso.
- **Si la mejora es menor a 0,3 puntos, la sección lo dice**: "los ajustes no
  cambian el riesgo de forma apreciable, no hay urgencia". Un informe que
  siempre encuentra algo para hacer no sirve.
- **Sin histórico, `planDePesos()` devuelve `null` y la sección no se dibuja.**
  Mismo interruptor que la fase B2: el Motor A no depende del B.

### 2. 🔴 EL BLOQUE `riesgo` NUNCA LLEGABA AL MODELO

`_resumen_cartera()` en `api/informe.py` arma el payload **clave por clave**.
Una clave que no se nombra ahí **no llega nunca, sin error y sin aviso**.

`riesgo` no estaba en la lista. O sea: la volatilidad de la cartera, la
volatilidad objetivo, `cobertura_del_calculo_pct` y `topes_insuficientes` se
calculaban en el navegador y **se tiraban a la basura justo antes de la
llamada**. El prompt tenía seis reglas escritas sobre datos que no llegaban.

### 3. 🔴 Y LOS CANDIDATOS PERDÍAN SUS TRES CAMPOS DE RIESGO

`_filtrar_candidatos()` reconstruía cada candidato a mano:

```python
out.append({'ticker': ..., 'sector': ..., 'puntaje': ..., 'metricas': ...})
```

Cuatro claves. `volatilidad_pct`, `correlacion_media_con_la_cartera` y
`delta_volatilidad_cartera` **no estaban**. El prompt decía, literal:

> *"Para elegir dónde poner plata mandan la correlación y el delta de
> volatilidad, NO el puntaje fundamental."*

…y esos dos números no llegaban. Al modelo le quedaba **solo el puntaje
fundamental** — exactamente el criterio que la auditoría del Motor B midió como
**la peor de cuatro opciones** (MSFT, −0,4 puntos, contra KO, −3,6).

Este es el motivo concreto del diagnóstico *"el informe hace mucho del motor A y
poco del B"*. No era redacción ni prompt: **los números se calculaban bien y se
perdían en el último paso.**

Además los candidatos ahora **vienen ordenados por lo que le aportan a ESTA
cartera** (delta de volatilidad, el que más baja primero), no por puntaje. Los
que no se pudieron medir van al final, no adelante: no se premia la falta de
dato.

**La compuerta contra que vuelva a pasar**: `test/test_tesis_cartera.py` tiene
ahora una comprobación que exige que **toda clave de primer nivel que produce el
navegador sobreviva a `_resumen_cartera`**. El próximo campo nuevo no se puede
perder en silencio.

### 4. La compresión de posiciones (punto 3 de lo aprobado)

Las posiciones que no requieren ninguna decisión viajan en formato corto.
El criterio es explícito y conservador — cualquier duda manda la ficha completa:

```js
const requiereDecision = (a, r) => {
  if (a.accion !== 'mantener') return true
  if (a.estado !== 'banda') return true        // critico | sobre | banda | sub
  if ((a.banderas || 0) > 0) return true
  if (a.tomaGanancia) return true
  if (r && r.aporte_al_riesgo_pct > a.peso * 1.5) return true
  return false
}
```

⚠️ **El primer intento usaba `estado === 'neutral'` y `'bajo'`, que no existen.**
La condición no se cumplía nunca y la compresión no comprimía nada. No fallaba:
mandaba todo completo, como antes, sin una sola señal. El vocabulario real es
`critico | sobre | banda | sub`.

Y el prompt tiene un bloque nuevo, **DOS NIVELES DE DETALLE**, para que la
ausencia de campos no se lea como dato faltante.

### 5. Invalidation points (era el punto 4 de la lista de valor)

Una línea de prompt: la sección 1 cierra con *"Esto estaría mal si…"* — una o
dos condiciones concretas y observables que harían que este plan sea la decisión
equivocada. Va **dentro** de la sección 1 y no como sexta sección, para no gastar
tokens de salida (que son el cuello de botella de los 60s, no los de entrada).

### 6. El costo, medido — cartera de 15 posiciones

Lo que realmente se manda después de `_resumen_cartera()`:

| bloque | tokens |
|---|---|
| posiciones (14 en orden + 1 con decisión) | 967 |
| candidatos (10, con sus deltas) | 714 |
| plan | 448 |
| sectores | 190 |
| resto | 184 |
| **payload** | **2.503** |
| prompt de reglas (**cacheado**, 0,1× en las lecturas) | 2.475 |

El bloque de posiciones sin comprimir serían ~1.950: **la compresión ahorra
~1.000 tokens por llamada** y paga de sobra el `plan` (448) y el `riesgo` (48)
que ahora sí viajan.

> El ahorro grande sigue siendo el mismo de siempre: **el caché por huella de
> cartera**. El costo es por CAMBIO, no por consulta. Abrir el informe diez veces
> sin tocar nada cuesta cero.

### 7. Dos pruebas que fallaban solas (arregladas)

- **`prueba-snapshot.cjs`** comparaba el retorno anualizado contra constantes
  sin decir de qué día eran. Cada vez que Marcos actualizaba el histórico, la
  ventana de 756 días se corría y la prueba "fallaba" sola. Ahora el ancla es la
  **cantidad de fechas** (`ANCLA_N`), y si el snapshot avanzó lo dice y compara
  con tolerancia amplia. Volatilidad y beta se siguen exigiendo finas — y siguen
  dando **idénticas** con 4 días más, que es la mejor confirmación de que el
  módulo está bien.
- El caso "cobertura insuficiente" agregaba **10 símbolos inventados sobre 632**:
  daba 98% de cobertura, o sea que no probaba nada. Ahora los inventados se
  calculan como el 40% de la lista.

### Estado de las pruebas

```
prueba-snapshot       41 ✅      test_contrato.py        ✅
prueba-metricas       28 ✅      test_tesis.py           ✅
prueba-sugerencias    31 ✅      test_tesis_cartera.py   ✅ (+8 casos nuevos)
prueba-datos-tesis    40 ✅
prueba-riesgo         25 ✅
prueba-plan           62 ✅  NUEVO
```

### Lo que sigue pendiente, en orden de valor

1. **Benchmark contra SPY** (capa 3). SPY ya está en el snapshot con 1.673
   puntos y no se lo compara con nada.
2. **Compuerta `DATA_INSUFFICIENT`** (capa 1): un solo lugar que diga "con esto
   no alcanza", en vez de cinco campos de cobertura desparramados.
3. **`industry`**: se captura hace tres días y no se usa. Concentración por
   industria es más fina que por sector.
4. **Fase C**: matar las llamadas en vivo de `quote`/`profile`/`ratios` y leer
   de `informe_detalle.json`.
5. **NIM como dato** (no como puntaje) en la ficha de bancos.
6. **FISV parece un ticker muerto** — Fiserv pasó a `FI` en 2023. Tiene 2/6
   métricas y puntúa 99.

---

## 🔢 EL ESTIMADOR DE COSTO MENTÍA PARA ABAJO (31/08/2026)

Chequeo previo antes de apretar el botón. **El número que el botón muestra
antes de gastar estaba mal, y mal para el lado peligroso.**

### Dos causas

1. **La fórmula de entrada quedó vieja.** Era `120 + 85·n + 35·candidatos`,
   calibrada antes de que existieran el bloque `plan`, el bloque `riesgo` y los
   tres campos de riesgo por candidato. Medido contra `_resumen_cartera()` con
   carteras reales:

   | posiciones | payload real | fórmula vieja | error |
   |---|---|---|---|
   | 3 | 955 | 585 | **−39%** |
   | 5 | 1.520 | 895 | **−41%** |
   | 10 | 2.374 | 1.670 | −30% |
   | 15 | 2.913 | 2.235 | −23% |
   | 20 | 3.602 | 2.660 | −26% |
   | 25 | 4.275 | 3.085 | −28% |

2. **El tamaño del prompt estaba clavado en `1249`** dentro del cálculo de
   `costo_primera_vez_usd`, mientras el prompt crecía a 2.475 tokens. El "cuánto
   sale la primera vez" que se mostraba era **la mitad del real**.

### El arreglo

La recta nueva es `800 + 160·n`, calibrada para quedar **por encima de las seis
mediciones**. Un estimador que subestima es peor que no tenerlo: el botón existe
para decidir si se gasta, y para eso el número tiene que ser el techo, no una
ilusión. Y el tamaño de las reglas ahora **se mide del prompt real**
(`len(SISTEMA_CARTERA) // 4`), no se escribe a mano — un número hardcodeado
sobre algo que se edita seguido se desactualiza sin que nadie se entere.

`test_tesis_cartera.py` tiene ahora las seis mediciones adentro: si se agrega un
bloque nuevo al payload, la prueba falla y obliga a recalibrar. Es la compuerta,
no el arreglo.

### Los números reales, cartera de 15 posiciones

| | rápido (Haiku) | profundo (Sonnet) |
|---|---|---|
| por llamada | USD 0,0131 | USD 0,0261 |
| la primera vez (paga las reglas) | USD 0,0156 | USD 0,0311 |
| tiempo | 23s | **58s ⚠️** |

⚠️ **El modo profundo no entra en los 60s de Vercel arriba de ~11 posiciones.**
El estimador ya lo marca (`entra_en_el_limite: false`) y el botón ya muestra el
aviso, así que no hay nada que arreglar — pero conviene saberlo: **para carteras
grandes, el modo rápido no es una economía, es el único que termina.**

### Verificación de build

Se bundleó el informe entero (`main.jsx` → todo el grafo de imports) con esbuild
antes de dar el visto bueno. Un error de importación —un `export` que no existe,
un nombre repetido— **rompe la página completa, no solo la sección nueva**, y no
lo caza ninguna de las suites. Compila limpio: 213 KB.

⚠️ `const plan` ya existía en `Cartera.jsx` (`planRotacion`). La tabla nueva usa
`planPesos`. Se detectó al escribirlo, no al romperlo.

---

## 🔴 LAS 6 PRUEBAS .cjs NUNCA PUDIERON CORRER EN LA PC DE MARCOS (31/08/2026)

**Es el mismo error que se arregló en las pruebas de Python el 28/08, repetido
en las de JavaScript.** Marcos lo encontró apenas instaló Node:

```
Error: ENOENT: no such file or directory, open
'C:\mnt\user-data\uploads\sp500-screener-yf\public\data\historico_precios.json'
```

Dos rutas mal, no una:

1. **Los datos** estaban clavados en `/mnt/user-data/uploads/...`, que es el
   contenedor de Claude. En Windows eso se resuelve a `C:\mnt\...` y no existe.
2. **Los módulos** se cargaban con `path.join(__dirname, 'cartera.js')`, o sea
   desde `test/` — donde no vive ninguno. Viven en `src/informe/`.

O sea que las seis pruebas solo podían correr en la máquina de quien las
escribió. **Una prueba que no corre donde está el código no es una prueba, es
una demostración** — y encima da una falsa sensación de cobertura, que es peor
que no tenerla.

### El arreglo

Cada archivo resuelve todo desde `__dirname`:

```js
const RAIZ = path.resolve(__dirname, '..');
const DATA = path.join(RAIZ, 'public', 'data') + path.sep;

function ruta(nombre) {           // busca src/informe/, src/, api/, test/
  ...
  throw new Error(`No encuentro "${nombre}". Esta prueba se corre desde la
                   raiz del repo: node test/${path.basename(__filename)}`);
}
```

⚠️ **`prueba-snapshot` y `prueba-metricas` NO usan `ruta()`.** Hay dos `App.jsx`
en el repo y son de proyectos distintos:

```
src/App.jsx           -> el SCREENER   (es el que prueban esas dos)
src/informe/App.jsx   -> el INFORME
```

`ruta()` buscaría primero en `src/informe/` y devolvería el equivocado **sin
decir nada**. Usan una constante explícita, `APP_SCREENER`. La separación entre
los dos proyectos es la regla #1 y también vale para las pruebas.

### Verificado como corresponde

Se armó una copia con la estructura REAL del repo (`src/informe/`, `src/`,
`api/`, `test/`, `public/data/`) y se corrieron las nueve suites desde ahí — y
además **desde otro directorio**, que es lo que las rompía. Las nueve pasan.

---

## 🔒 REGLA REFORZADA: NI SIQUIERA `git status` DESDE EL PUENTE

Ya existía la regla de no correr git desde el puente al escritorio. **La violé el
31/08 corriendo `git status`**, creyendo que era de solo lectura. No lo es:
`git status` refresca el índice y para eso escribe `.git/index.lock`. El puente
crea el archivo con su propio usuario y **no puede borrarlo**, así que quedó un
lock de 0 bytes bloqueando todos los `git add` y `git commit` de Marcos:

```
fatal: Unable to create '.../.git/index.lock': File exists.
```

Se destraba borrándolo a mano desde PowerShell:

```powershell
Remove-Item "C:\Users\otero\Desktop\sp500-screener-yf\.git\index.lock"
```

**Desde el puente: `git log` sí, leer `.git/config` sí, `git status` NO, y
cualquier cosa que escriba, tampoco.** Para saber qué cambió sin tocar el índice
se puede usar `git --no-optional-locks status`, pero lo más seguro es
preguntárselo a Marcos.

---

## 🌎 EL UNIVERSO OPERABLE — la mitad del abanico no existía (31/08/2026)

Marcos preguntó si los CEDEARs se habían actualizado porque "en las pruebas solo
daba los pocos que probamos". **Tenía razón, y la causa no era un archivo
desactualizado.**

### El diagnóstico, archivo por archivo

| archivo | símbolos | CEDEARs |
|---|---|---|
| `historico_precios.json` | 633 | 129/129 ✅ |
| `informe_detalle.json` | 281 | 130 fuera del índice ✅ |
| `sp500_fundamentals.json` | 504 | 0 — y está BIEN, ese es su universo |

`candidatosRotacion()` **ya filtraba por `hasCedear`**, y `sp500_fundamentals`
ya trae ese campo: los candidatos salían de las **151** del S&P que se compran
acá. Eso estaba bien.

Lo que faltaba son los **130 CEDEARs que NO están en el S&P 500** — los ADR de
Brasil, Europa, China, las mineras canadienses. Tienen fundamentales completos
en `informe_detalle.json`, tienen precios en el histórico, aparecen en el
buscador… y **nunca podían ser candidatos**, porque el pool que se puntúa era
solo `stocks` (las 504).

`src/informe/App.jsx` bajaba `informe_detalle.json` y **se quedaba únicamente
con las claves** (para marcar cuáles tenían informe completo). Los fundamentales
de esos 130 se tiraban a la basura después de bajarlos.

### Lo que cambió — `src/informe/universo.js` (NUEVO)

```js
export function armarUniverso(stocks, activos)
  -> { todos, operables, porSymbol, resumen }
```

- **`todos` (634)** es el pool contra el que se calculan los percentiles. NO se
  filtra por CEDEAR: que un papel no cotice en Buenos Aires no lo hace menos
  comparable como empresa.
- **`operables` (268)** es de donde salen los candidatos. Ahí sí se filtra,
  porque recomendar algo que no se puede comprar no es una recomendación.

**Quién gana si un símbolo está en las dos fuentes: el screener.** Es la fuente
canónica de su propio universo y es la que Marcos ve en F1. Si el informe usara
otros números para las mismas 504, habría dos verdades para el mismo papel. Del
detalle solo se toma `hasCedear`. Verificado: **0 campos pisados** en los 151
símbolos que están en las dos.

### El efecto, medido

```
CANDIDATOS: 49 antes -> 51 ahora   (28 son NUEVOS)

  Energy         PBR(86.2) GPRK(74.1) VIST(71.3) SHEL(64.5)
  Materials      HMY(87.5) B(82.2) KGC(81.9) PAAS(73.7)
  Utilities      SBS(86.7) KEP(71.5)
  Healthcare     NVO(82.5) GSK(66.2) AZN(61.5)
  Financials     BBD(74.4) ING(69.1) BBVA(66.4) XP(66.1) BCS(65)
  Staples        ABEV(79.7) KOF(66)
  ...
```

**Más de la mitad del abanico de rotación no existía.** Y son justamente los
CEDEAR que un inversor argentino compra.

### Lo que hay que saber: los puntajes se mueven

Ampliar el pool de 504 a 634 cambia los percentiles. Medido sobre las 504:

```
mediana 0,8 pts · p90 2,8 pts · maximo 11,1 pts · solo 22 de 502 se mueven > 5
```

Los que más se mueven son **todos de Materials** (PPG −11,1 · LIN −10,3 ·
CRH −10,2 · NEM −9,6 · FCX −9,1), porque el sector ganó 26 mineras y
commodities que son comparables de verdad. El percentil no empeoró: se volvió
más honesto. Pero **el puntaje del informe ya no es idéntico al de F1** para
esos papeles, y eso hay que saberlo antes de que sorprenda.

### Real Estate: 1 solo papel operable

El resumen ahora nombra los sectores donde **no hay de dónde elegir**
(`MIN_PARA_ROTAR = 3`). Antes el informe podía ofrecer "el mejor de Real Estate"
sin decir que era el ÚNICO de Real Estate. Una elección de uno no es una
elección. Utilities queda al límite con 6.

---

## 📊 BENCHMARK CONTRA SPY Y PARES CORRELACIONADOS (31/08/2026)

Las dos capas que faltaban del marco de Marcos. **Las dos son cuentas sobre la
matriz de covarianza que ya se calculaba: cero llamadas nuevas, cero tokens.**

### Contra el índice (capa 3)

SPY estaba en el snapshot desde el primer día —1.674 puntos— y no se comparaba
con nada. Sin benchmark, *"rinde 24% con 16% de volatilidad"* no se puede
juzgar.

```
                        esta cartera      S&P 500
  rendimiento anual         24,6%          21,9%
  volatilidad               15,9%          15,3%
  rendimiento / riesgo       1,55           1,43
  beta 0,80  ·  correlacion 0,77
```

`retorno_sobre_volatilidad` es lo que hay que mirar, **no el retorno solo**:
rendir más tomando el doble de riesgo no es rendir más. No es un Sharpe —no se
descuenta tasa libre de riesgo, porque cuál es la tasa libre de riesgo para un
argentino es una discusión que este informe no tiene por qué zanjar.

⚠️ Es retorno **histórico** de la ventana, no una proyección, y tanto el informe
como el prompt lo dicen cada vez.

### Pares que son una sola apuesta

La "concentración temática" del prompt original, que nunca se había
implementado. **Es la única lectura del informe que no se puede deducir de la
tabla de sectores.**

**El umbral está MEDIDO, no elegido a ojo.** Sobre 496 pares de 32 papeles
grandes con retornos diarios de 3 años:

```
min -0,23 · p25 0,07 · mediana 0,15 · p75 0,28 · p90 0,44 · p95 0,71 · max 0,89
```

Las correlaciones **diarias** son mucho más bajas de lo que la intuición dice:
AAPL–MSFT da **0,35**, no 0,8 — el ruido de un día tapa el movimiento común. Por
eso 0,70 es el percentil ~94 y marca solo el 5% de los pares. Los que marca:

```
RIO-BHP 0,89 · XOM-CVX 0,82 · KGC-PAAS 0,81 · BAC-WFC 0,81 · GFI-HMY 0,81
```

El caso que lo justifica, y está en la prueba: **XOM 12% + CVX 10% con tope de
12%.** Ninguno excede el tope solo; juntos son una posición del 22%.

Y esto se volvió mucho más útil justamente al sumar los CEDEAR: el universo
nuevo trae **siete mineras** (VALE, RIO, BHP, GFI, HMY, KGC, PAAS). Tener tres
se siente diversificado y es una sola posición.

---

## 🔁 LA GUARDA DEL ESTIMADOR SE QUEDÓ VIEJA EN UN DÍA (31/08/2026)

Vale anotarlo porque es una lección sobre las pruebas, no sobre el estimador.

A la mañana se recalibró `estimar_cartera` y se le puso una guarda con seis
mediciones reales adentro. A la tarde, `benchmark` (82 tokens) y
`pares_que_son_una_apuesta` (24) subieron el payload ~110 tokens, y el
estimador volvió a subestimar en 5 y 10 posiciones.

**La guarda no lo cazó**, porque tenía adentro las mediciones *viejas* — que
eran más bajas que la realidad nueva, así que todo pasaba en verde.

> Una guarda cuyos números no se actualizan junto con lo que vigila deja de
> vigilar, y encima da tranquilidad. Al tocar el payload hay que **volver a
> medir**; que la prueba siga pasando no alcanza como señal.

Recta nueva: `850 + 165·n`, por encima de las seis mediciones nuevas
(1.050 · 1.616 · 2.469 · 3.031 · 3.720 · 4.422).

---

## 🧩 UNA TERCERA COLISIÓN DE NOMBRE (31/08/2026)

`const universo` ya existía en `src/informe/App.jsx`: es la lista del buscador
que recibe `<Selector>`. Declarar otro `universo` para el mercado no solo es un
SyntaxError — le habría pasado al buscador un objeto `{todos, operables, ...}`
en vez de una lista. Se llama `mercado`.

Van tres en dos días: `plan` en `Cartera.jsx`, `DATA` en las pruebas,
`universo` acá. **Conviene mirar qué nombres ya existen en el archivo ANTES de
elegir uno**, no después de que compile.

---

## 🏦 CONCENTRACIÓN POR INDUSTRIA — la pregunta de Marcos (31/08/2026)

> *"Si tengo WFC que está en el S&P y otro banco, por ejemplo Itaú que está
> como CEDEAR pero no en el S&P, ¿no nos marcaría que ambos suman para la misma
> concentración de sector?"*

La respuesta tiene dos mitades, y **la primera es tranquilizadora**.

### Por SECTOR ya los sumaba, y siempre lo hizo

El peso por sector sale del campo `sector` de cada **posición de la cartera**,
no del universo del screener. Da igual de qué archivo salió el papel.
Verificado con una cartera de prueba:

```
  WFC   36%  Financials      <- del S&P 500
  BBD   24%  Financials      <- CEDEAR, fuera del indice
  BBVA  20%  Financials      <- CEDEAR, fuera del indice
  KO    20%  Consumer Staples

  Financials  80%  (tope 65%)  ⚠️ EXCEDE   [3 papeles]
```

### Lo que NO existía: el nivel fino

`Financials 80%` puede ser dos cosas completamente distintas:

```
  cuatro bancos                  -> UNA apuesta con cuatro nombres
  tres bancos y una aseguradora  -> concentrado, pero repartido
```

y la tabla de sectores **las dibuja idénticas**. Eso es lo que faltaba, y es lo
que ahora resuelve `concentracionPorIndustria()` en `cartera.js`.

La prueba tiene el caso exacto: dos carteras con **Financials 80% las dos**, y
solo la de cuatro bancos marca concentración por industria.

### Se complementa con los pares correlacionados, no los reemplaza

Son dos preguntas distintas y ninguna implica la otra:

| | qué mira | ejemplo |
|---|---|---|
| **industria** | la ETIQUETA | dos bancos son dos bancos, aunque uno sea brasileño y correlacionen poco |
| **correlación** | el COMPORTAMIENTO | dos papeles de industrias distintas que se mueven como uno |

Hacen falta las dos lecturas.

### El dato: capturado en el screener, faltaba en el informe

`industry` lo captura `fetch_fundamentals.py` desde hace días (`WFC` →
*Banks - Diversified*). `fetch_informe.py` **no lo capturaba**, así que los 130
CEDEAR de afuera del índice llegaban sin él.

Se agregó: es **un solo campo de `.info`, ya descargado** — no suma ni una
llamada ni un segundo al bot. Yahoo lo devuelve en inglés y sin normalizar
("Banks - Diversified", "Banks - Regional"); **no se traduce a propósito**,
porque el screener guarda el mismo string crudo y dos taxonomías para el mismo
campo serían peor que tenerlo en inglés.

⚠️ **Hasta que se vuelva a correr `fetch_informe.py`**, los CEDEAR de afuera
llegan sin industria. El informe **lo dice** en vez de callarse: con menos de la
mitad de las posiciones cubiertas, `confiable` es falso y la sección explica que
falta el dato y en qué papeles. Callarse se leería como "no hay concentración".

---

## 🔴 16 CEDEARs COMUNES QUE NO ESTÁN EN EL UNIVERSO (31/08/2026)

Apareció mirando bancos: **ITUB (Itaú) no está en ningún archivo** — ni en
`TRADUCCION`, ni en `DIRECTOS`, ni en `EXCLUIDOS`. Es el banco más grande de
Brasil y uno de los CEDEAR más operados acá.

`cedears_informe.py` dice *"ninguno se descarta en silencio"*, y estos 16 sí:

```
ITUB  Itau Unibanco        NU    Nu Holdings (Nubank)     TS    Tenaris
GGAL  Grupo Galicia        BMA   Banco Macro              YPF   YPF
PAM   Pampa Energia        TEO   Telecom Argentina        CRESY Cresud
SUPV  Supervielle          LOMA  Loma Negra               IRS   IRSA
EDN   Edenor               CEPU  Central Puerto           DESP  Despegar
```

**Son dos grupos distintos y la decisión no es la misma:**

1. **ITUB y NU** son CEDEAR de empresas extranjeras, igual que BBD o VALE.
   Parecen un olvido y deberían entrar.
2. **Los 11 argentinos** (GGAL, BMA, YPF, PAM, TEO, CRESY, SUPV, LOMA, IRS,
   EDN, CEPU) son ADR de empresas locales: acá se compra la acción directamente,
   no un CEDEAR. Excluirlos de un universo de CEDEARs es defendible — pero es
   una decisión de Marcos, no algo para que el archivo resuelva solo.

`TX` (Ternium) sí está, vía `TRADUCCION['TXR']`. `TS` (Tenaris) no.

**No se tocó nada**: agregar tickers al universo depende de saber cuáles tienen
CEDEAR de verdad, y eso lo sabe Marcos. Queda anotado para que lo decida.

---

## 🔁 Y EL ESTIMADOR SE QUEDÓ CORTO POR TERCERA VEZ

El bloque `industrias` (48 tokens) volvió a pasar la recta en 10 posiciones.
Van tres veces en un día: `benchmark` (82), `pares` (24), `industrias` (48).

El patrón es claro: **cada bloque nuevo son 30-80 tokens, y la recta iba con
1-3% de margen**, o sea que cualquier agregado la volvía mentirosa. Ahora va con
~5% de holgura en el punto más ajustado (`880 + 175·n`) en vez de pegada a la
medición.

```
  n     real   estimador   margen
  3    1.082     1.405       30%
  5    1.651     1.755        6%
 10    2.512     2.630        5%
 15    3.083     3.505       14%
 25    4.492     5.255       17%
```

> Un estimador que se pasa un poco es útil. Uno que se queda corto no sirve
> para decidir si gastar.

**Y la prueba de contrato hizo su trabajo**: `test_contrato.py` cazó la clave
`industry` al instante, porque congela el set exacto de claves raíz. Una clave
nueva tiene que ser una decisión, no un accidente — se declaró a mano con el
motivo escrito al lado.

---

## 🔴 EL OBJETIVO SE CONTRADECÍA CON SU PROPIO TOPE DE SECTOR (31/08/2026)

> *"Si tengo 50 Financials, 25 en bancos y 25 en financieras/brokers, ¿no me va
> a recomendar rotar? Yo quiero que sí, solamente que me diga cuánto reducir de
> cada uno y de cuál me conviene sacar."*

Antes de contestar se midió el caso exacto. **Y había una contradicción real.**

### Lo que hacía

Con cuatro bancos al 12,5% (Financials 50%, tope 35%):

```
  la tabla de sectores decia:   "Financials 50%, tope 35%  ⚠️ EXCEDE"
  el peso objetivo proponia:     41,3%   <- que TAMBIEN excede el 35%
```

Los dos números salían del mismo sistema y se desmentían entre ellos. El motivo:
**`aplicarTopes()` solo conocía el tope POR POSICIÓN.** Un sector es una
restricción de grupo y el optimizador no sabía que existía.

Sí reducía algo (50% → 41,3%) y sí repartía el recorte por riesgo, pero se
quedaba a mitad de camino y encima quedaba por encima de su propio límite.

### Lo que hace ahora

El peso objetivo respeta **tres** topes: posición, sector e industria.

```
  ticker   pesa    deberia     Δ      aporta al riesgo
  BBD     12.5%      7.6%   -4.9pp        20.8%
  BSBR    12.5%      7.9%   -4.6pp        19.6%
  WFC     12.5%      9.1%   -3.4pp        15.7%
  JPM     12.5%     10.3%   -2.2pp        13.6%

  Financials: 50% -> 34.9%   (tope 35%)  ✅
  lo recortado va a KO (+9pp), XOM (+4,1) y MSFT (+1,9)
```

Que es exactamente lo pedido: **cuánto sacar de cada uno, y de cuál más.**

### Cómo se reparte el recorte dentro del grupo, y por qué

**Proporcional al peso que la paridad de riesgo ya había asignado.** No es una
comodidad: la paridad ya le dio menos peso al que aporta más riesgo, así que
recortar proporcional CONSERVA ese orden y el que más arriesga termina cortado
más en términos absolutos. BBD aporta 20,8% del riesgo y se lleva el recorte más
grande; JPM aporta 13,6% y el más chico. Repartir el recorte en partes iguales
lo habría roto.

### El tope de industria

`FACTOR_TOPE_INDUSTRIA = 0.7` sobre el tope de sector. **Es un juicio, no una
ley**, y por eso es una constante con nombre y no un número escondido en una
cuenta: una industria es un corte más fino, así que su techo tiene que ser más
bajo. 0,7 deja lugar a dos o tres industrias por sector sin volverlo inoperable.

Medido con los tres casos que importan:

| cartera | qué aprieta | resultado |
|---|---|---|
| 4 bancos, 2 industrias | solo el sector | 50% → 34,9% |
| 4 bancos, 1 industria | la industria (más fina) | 50% → 24,4% |
| repartida | nada | sin falsos positivos |

⚠️ **Si falta `industry` en alguna posición, NO se agrupa por industria.**
Agrupar a medias sería peor que no agrupar: limitaría a los que sí tienen el
dato y dejaría libres a los que no. El tope de sector se sigue aplicando igual.

### Dos motivos de recorte que no hay que confundir

El informe ahora los distingue, y el prompt lo exige:

- **`limitado_por_tope`** — el papel pesa de más por sí mismo.
- **`limitado_por_grupo`** — el papel está bien; el sector o la industria no.

El segundo es contraintuitivo y hay que explicarlo: el cliente ve que le
recortan un banco que estaba perfecto. El informe lo dice arriba de la tabla:
*"no porque estén mal, sino porque juntos pesan de más"*.

### Y el faltante ahora aconseja distinto

Si los topes no dejan lugar al 100%, `topes_insuficientes` ya existía. Pero
desde que hay topes de grupo el consejo cambia: **con los sectores llenos,
sumar otro papel del mismo sector no resuelve nada** — hace falta uno de OTRO
sector. El aviso lo dice, y hay una prueba que lo exige.

### El estimador, por primera vez, aguantó solo

El bloque nuevo sumó 6 tokens y **la holgura del 5% lo absorbió sin recalibrar**.
Es la primera vez en el día que agregar algo no rompe el estimador — la lección
de la mañana (dejar margen en vez de pegarse a la medición) funcionó.

*(Cuarta colisión de nombre del día: `sumaObj` ya existía en `prueba-riesgo.cjs`.
Van `plan`, `DATA`, `universo` y esta. Mirar los nombres que ya existen ANTES
de elegir uno sigue siendo más barato que descubrirlo al ejecutar.)*

---

## 🐛 CUATRO COSAS DE LA PRIMERA PRUEBA REAL DEL BOTÓN (31/08/2026)

### 1. 🔴 El Excel: las cantidades se tiraban a la basura

Marcos subió **su propia plantilla**, la que le manda al cliente, con Cantidad,
Precio de compra y % Posición cargados. El informe salió sin pesos.

`filasAActivos()` en `Selector.jsx` leía **ticker, sector, nombre y score. Y
nada más.** Las tres columnas que la plantilla pide —y que su hoja
"Instrucciones" explica una por una— no se leían nunca. Las posiciones salían
ÚNICAMENTE de las carteras que F5 deja en `localStorage`.

No daba error: el informe se degradaba solo a "cartera propuesta" y ninguna
alerta de sobrepeso podía dispararse, porque no había pesos que comparar.

Ahora se leen las tres, y de ahí sale `valorActual` cruzando la cantidad con el
precio de HOY (que ya está en el universo). **El archivo gana sobre F5**: es lo
que Marcos acaba de subir.

⚠️ **La escala del porcentaje era una trampa.** Excel guarda `0,216` cuando la
celda está formateada como "21,6%", pero `21,6` si se escribió como número
suelto. Las dos son válidas. Leer 0,216 como "0,216%" habría hecho que el
informe crea que esa posición es el 0,2% de la cartera: **los pesos saldrían
~100 veces más chicos y no se dispararía ninguna alerta.** Silencioso y total.
La regla: si ningún valor pasa de 1 y la suma no llega a 1,5, son fracciones.

También se agregó `aNumero()`, porque una celda formateada como texto llega
`"1.234,56"` y `parseFloat` da **1,234** — mil veces menos, sin ningún error.

Su archivo real quedó como fixture en `test/fixtures/cartera_ejemplo.xlsx` y la
prueba corre el parser REAL contra él. Sus 7 activos son el **67,1%** de la
cartera del cliente, así que el informe ahora lo dice en vez de repartir 100%.

### 2. 🔴 El modo profundo: el pensamiento se comió TODO el tope

```
stop_reason: max_tokens · tipos_de_bloque: ["thinking"]
tokens_salida: 3440 · tope_pedido: 3440
```

Los 3.440 tokens se fueron enteros en el bloque de pensamiento y no quedó ni una
línea de texto. **La llamada se cobró igual.**

Es la SEGUNDA vez: el 28/08 la primera llamada real falló igual con 900 tokens.
Entonces se subió el tope. Ahora queda claro que **subir el tope no alcanza,
porque el pensamiento crece con el espacio que le des.**

Y aunque alcanzara, no entra en el tiempo: el modo profundo ya estaba en 58s
para 15 posiciones contra un límite de 60, y los tokens de pensamiento se
generan a la misma velocidad. Pensar 3.000 tokens antes de escribir garantiza
el 504.

**Se apaga explícitamente** (`thinking: {type: 'disabled'}`), con un reintento
sin el parámetro si algún modelo no lo acepta — un 400 no genera tokens, así que
ese reintento es el único que no rompe la regla de costo.

Qué se pierde: poco, y es medible. Este prompt no le pide al modelo que razone
sobre números —llegan calculados— sino que ORDENE y REDACTE. El modo profundo
sigue valiendo por el modelo, no por el pensamiento.

**7 posiciones en profundo: 51s, entra.** Antes: sin texto y cobrado.

### 3. 🔴 La afinidad ignoraba el perfil de riesgo

> *"Recomienda más afinidad RGTI para una cartera conservadora, cuando es una
> opción extremadamente arriesgada, alto beta."*

`afinidad()` repesaba los cinco bloques por OBJETIVO y HORIZONTE… y **nunca
miraba el PERFIL**, que es la única variable que dice cuánto riesgo tolera el
cliente. Medía *"¿es buena para este objetivo?"* y no *"¿es apropiada para esta
tolerancia?"*, que son dos preguntas y solo una estaba contestada.

```
                    base    conservador   moderado   agresivo
  RGTI               74          11          31         61
  KO                48,3        48,3        48,3       48,3

  antes: RGTI daba 74 para los TRES perfiles por igual
```

Para un conservador, **ahora KO (48,3) le gana a RGTI (11)**, y RGTI queda
marcado `incompatible`. Para un agresivo sigue siendo la mejor opción — un
perfil agresivo *tolera* el riesgo, no lo premia, así que el castigo baja mucho
pero no llega a cero.

El descuento se muestra **motivo por motivo** en el informe:

```
  −30  beta 2,6 contra 0,95 que tolera este perfil
  −25  es un papel especulativo
  − 8  1 riesgo de severidad alta
```

Un número que baja de 74 a 11 sin decir por qué es indistinguible de un error, y
lo primero que hace quien lo lee es desconfiar de todo el informe.

⚠️ El castigo por beta lleva **techo** (`CASTIGO_BETA_MAXIMO = 30`). Sin él, beta
2,6 daba 57,8 puntos, aplastaba a los otros dos motivos y clavaba el score en 0
— y un 0 no distingue "inapropiado" de "catastrófico".

⚠️ **Sin beta NO se asume que es tranquilo.** Es el caso de los CEDEAR nuevos,
que suelen ser justo los más volátiles. Se marca en vez de premiar la falta de
dato.

Los números de `TOLERANCIA` son un **juicio declarado**, no una ley de mercado.
Están arriba del archivo y con nombre para poder discutirlos.

### 4. La tesis salió del informe del cliente

Estaba arriba de todo, que era correcto mientras el informe era para Marcos.
Pero **el documento se le entrega AL CLIENTE**, y la lectura interna —qué rotar,
qué está sobrevaluado, el razonamiento del analista— no es para esos ojos.

Ahora hay un botón discreto al pie (*"Análisis interno de la cartera →"*) que
abre un **panel lateral**, y todo lo que sale de ahí lleva `no-imprimir`: no
existe para el PDF por más que uno imprima todo.

> Confiar en "elijo las páginas al imprimir" es confiar en no equivocarse una
> sola vez. Esto lo hace imposible, no improbable.

Es un panel y no un `window.open` a propósito: una ventana nueva perdería todo
el estado ya calculado —tendría que rehacer el análisis— y encima la bloquean
la mitad de los navegadores. Cierra con Escape, con el botón o clickeando fuera.

---

## 🔴 EL FILTRO DE CANDIDATOS IMPEDÍA DIVERSIFICAR, POR CONSTRUCCIÓN (31/08/2026)

> *"Me está diciendo que siga sumando posición de tecnología y no que
> diversifique, ¿por qué? Porque no me da opciones más defensivas, del estilo
> MCD, BMY, MO, GOOGL. Y ¿por qué para RGTI no analiza darme GOOGL?"*

Las dos preguntas tienen **la misma causa**, y es un bug del filtro de Python.

### El bug

`_filtrar_candidatos()` armaba su lista de sectores permitidos así:

```python
saliendo   = sectores de posiciones que se recortan
con_lugar  = sectores que no exceden su tope
utiles     = saliendo | con_lugar
```

Los dos conjuntos salen de `sectores`, que son **los sectores QUE YA ESTÁN EN
LA CARTERA**. Un sector donde el cliente no tiene nada no estaba en ninguno de
los dos, así que se filtraba **entero**.

Medido sobre la cartera real de Marcos (AMD, CAT, MSFT, LRCX, AAPL, RGTI, HIMS):

```
  el navegador producía   51 candidatos de 11 sectores
  llegaban al modelo      10 candidatos de  3 sectores

  SECTORES QUE DESAPARECÍAN ENTEROS:
    Consumer Staples        MO ABEV KOF PG TGT
    Communication Services  TIMB T GOOG GOOGL META
    Consumer Discretionary  DECK ANF CCL URBN ARCO
    Energy · Financials · Materials · Real Estate · Utilities
```

> **El filtro estaba construido para elegir DENTRO de lo que ya tenés, y por
> construcción impedía diversificar.** Es lo contrario de lo que el informe dice
> que hace, y explica las dos preguntas de una sola vez: MO, PG y GOOGL **sí
> estaban** en la lista del navegador; el filtro de Python los borraba.

Un sector donde NO hay nada es el **mejor** destino posible para diversificar,
no el peor.

### Además: los candidatos no tenían ninguna señal de riesgo

Se ordenaban por **puntaje fundamental puro**. Una cartera con 33% de
volatilidad que hay que bajar recibía exactamente las mismas sugerencias que una
tranquila, porque el puntaje no sabe nada de riesgo.

Ahora cada candidato viaja con:

- **`beta`** — sale de `informe_detalle.json`, que cubre a los 268 operables.
- **`defensivo`** — beta < 0,9. No es una opinión: es una medición contra el índice.
- **`sector_nuevo`** — el cliente no tiene nada de ese sector.

Y el orden ya no es por puntaje: primero los que más bajan la volatilidad
medida, y entre los no medidos, **los de menor beta primero**.

### El resultado, sobre su cartera

```
  23 candidatos de 11 sectores · 16 defensivos

  NUEVO Communication Services   TIMB(0,11)·def  T(0,42)·def
  NUEVO Consumer Staples         ABEV(0,26)·def  MO(0,50)·def
  NUEVO Energy                   PBR(−0,22)·def  GPRK(0,37)·def
  NUEVO Utilities                SBS(0,09)·def   KEP(0,82)·def
  NUEVO Real Estate              O(0,72)·def
        Healthcare               BMY(0,23)·def   GSK(0,30)·def   NVO(0,35)·def
        Technology               ZM(1,04)  FSLR(1,75)      <- al tope: cupo 2
```

**MO y BMY, los dos que Marcos nombró, ahora llegan.** MCD no: está 14º de 36 en
Consumer Discretionary por puntaje fundamental (52,6). Eso no es un bug — es el
screener diciendo que hay 13 mejores en su sector.

### El cupo se ajustó por PARA QUÉ sirve cada sector

Dejar entrar todo llevó el payload de 10 a 39 candidatos: **+980 tokens por
llamada.** La variedad de SECTORES es lo que permite diversificar; cuatro
opciones dentro de cada uno no agregan ninguna decisión, solo peso.

```
CANDIDATOS_POR_SECTOR_ENVIADOS = 3   # sectores de donde sale plata
CANDIDATOS_SECTOR_AL_TOPE      = 2   # solo reemplazo de sí mismos
CANDIDATOS_SECTOR_NUEVO        = 2   # alcanzan dos para elegir
```

23 candidatos, 791 tokens. El costo neto sube ~425 tokens por llamada y compra
la capacidad de diversificar, que es la mitad del producto.

### Reglas nuevas en el prompt

- Si hay que bajar volatilidad, **el candidato correcto es el defensivo aunque
  otro tenga mejor puntaje**. Un papel con puntaje 82 y beta 2,1 no baja el
  riesgo de nadie.
- `sector_nuevo` diversifica por definición: priorizarlo cuando el problema es
  la concentración.
- Si Technology excede, la respuesta **no puede ser otra tecnológica**.
- Al elegir un defensivo sobre uno de mejor puntaje, decirlo con esas palabras.

### Sobre GOOGL para RGTI, la respuesta honesta

Con el arreglo GOOGL llega (Communication Services, sector nuevo). Pero **el
sistema no tiene ningún concepto de "mismo negocio"** más allá de sector e
industria, y Yahoo clasifica a GOOGL como *Internet Content & Information*, no
como computación cuántica. Que Google tenga Quantum AI es una relación temática
que ninguna taxonomía sectorial captura.

Lo más parecido que sí medimos es la **correlación**: si dos papeles se mueven
juntos, son la misma apuesta aunque estén en sectores distintos. Eso ya está
implementado y es el sustituto honesto — pero no es lo mismo, y conviene no
fingir que sí.

### El estimador: cuarta recalibración, y esta vez cambió la FORMA

No solo la altura. Al entrar los sectores ausentes, una cartera **chica** tiene
**más** sectores ausentes y por lo tanto más candidatos: el bloque quedó casi
constante (~1.000-1.140 tokens) en vez de crecer con las posiciones.

```
  la ordenada subió de 880 a 1.620 y la pendiente bajó de 175 a 143
  medido: 1.759 · 2.167 · 2.884 · 3.455 · 4.020 · 4.730
  margen: 16% · 8% · 6% · 9% · 11% · 10%
```

---

## 📦 PENDIENTE DE PUSH — lista acumulada

Todo esto está escrito en la carpeta y **todavía no subido**. Verificar con
`git status` antes de asumir.

### Tanda de ahora (31/08) — octava parte: el filtro que impedia diversificar

```
api/informe.py               🔴 _filtrar_candidatos deja pasar los sectores
                             AUSENTES (borraba 8 sectores enteros)
                             + cupo por tipo de sector + orden por beta
                             + reglas de eleccion defensiva en el prompt
                             + estimador 1620 + 143n (cambio la FORMA)
src/informe/universo.js      beta en las dos fuentes
src/informe/sugerencias.js   el candidato lleva beta, defensivo y sector_nuevo
src/informe/cartera.js       esos tres campos al payload
src/informe/Cartera.jsx      le pasa los sectores de la cartera a candidatosRotacion
test/test_tesis_cartera.py   +7: los sectores ausentes llegan, cupos, banderas
CONTEXTO_INFORME_AVANZADO.md
```

### Tanda de ahora (31/08) — septima parte: los 4 hallazgos de la prueba real

```
src/informe/Selector.jsx     🔴 lee Cantidad, Precio y % Posicion del Excel
                             + aNumero() para celdas de texto
                             + normalizarPorcentajes() (0,216 vs 21,6)
src/informe/App.jsx          le pasa los precios de hoy al Selector
src/informe/cartera.js       TOLERANCIA por perfil + afinidadDetalle()
                             + CASTIGO_BETA_MAXIMO
src/informe/Cartera.jsx      <TesisAparte> (panel no-imprimir) + columna
                             "descuento por riesgo" en Afinidad
api/informe.py               🔴 thinking apagado + reintento sin el parametro
                             + tope por posicion 120 -> 140
test/prueba-excel.cjs        NUEVO — 22 comprobaciones sobre el archivo REAL
test/fixtures/cartera_ejemplo.xlsx   NUEVO — la plantilla de Marcos
test/prueba-datos-tesis.cjs  +12: la afinidad por perfil
CONTEXTO_INFORME_AVANZADO.md
```

Doce suites: 346 comprobaciones en JS + las tres de Python. Build: 251,2 KB.

### Tanda de ahora (31/08) — sexta parte: topes de grupo en el optimizador

```
src/informe/riesgo.js        aplicarTopes() ahora acepta topes de GRUPO
                             (sector e industria) + FACTOR_TOPE_INDUSTRIA
                             + grupos_limitantes + limitado_por_grupo
                             + el aviso de faltante distingue grupo de perfil
src/informe/cartera.js       los grupos limitantes al payload y a la tabla
src/informe/Cartera.jsx      aviso "esto se recorta por el grupo, no por el papel"
api/informe.py               regla en el prompt: no confundir los dos motivos
test/prueba-riesgo.cjs       +14: los tres casos (sector aprieta, industria
                             aprieta, cartera sana) y el faltante por grupo
test/test_tesis_cartera.py   mediciones del estimador al dia
CONTEXTO_INFORME_AVANZADO.md
```

Once suites: 312 comprobaciones en JS + las tres de Python. Build: 239,4 KB.

### Tanda de ahora (31/08) — quinta parte: concentracion por industria

```
local_bot/fetch_informe.py   captura `industry` (un campo de .info, 0 llamadas nuevas)
                             ⚠️ HAY QUE VOLVER A CORRERLO para llenarlo
api/informe.py               `industry` viaja en el informe por activo + al payload
                             + reglas en el prompt + estimador 880 + 175n
src/informe/cartera.js       concentracionPorIndustria() + bloque `industrias`
src/informe/Cartera.jsx      tabla "Dentro de cada sector" en Composicion
test/prueba-industria.cjs    NUEVO — 19 comprobaciones
test/test_contrato.py        declara `industry` (la prueba lo cazo sola)
test/test_tesis_cartera.py   mediciones del estimador otra vez
CONTEXTO_INFORME_AVANZADO.md
```

Once suites: 298 comprobaciones en JS + las tres de Python. Build: 233,7 KB.

### Tanda de ahora (31/08) — cuarta parte: universo operable + capas 3 y 6

```
src/informe/universo.js      NUEVO — une sp500_fundamentals + informe_detalle
src/informe/App.jsx          ⚠️ INFORME (no screener) — guarda el detalle crudo,
                             arma `mercado` y le pasa los operables a Cartera
src/informe/riesgo.js        benchmark vs SPY + pares correlacionados
src/informe/cartera.js       los dos bloques al payload y a la tabla
src/informe/Cartera.jsx      <ContraElIndice> + <UnaSolaApuesta> + nota de
                             cuantos papeles operables hay por sector
api/informe.py               reglas del benchmark y de los pares en el prompt
                             + estimador recalibrado (850 + 165n)
test/prueba-universo.cjs     NUEVO — 37 comprobaciones
test/prueba-riesgo.cjs       +15: benchmark y pares
test/test_tesis_cartera.py   mediciones del estimador actualizadas
CONTEXTO_INFORME_AVANZADO.md
```

Las diez suites pasan: 279 comprobaciones en JS + las tres de Python.
Build del informe verificado con esbuild (227,9 KB).

### Tanda de ahora (31/08) — tercera parte: las pruebas ahora corren en Windows

```
test/prueba-snapshot.cjs     rutas desde __dirname + APP_SCREENER explicito
test/prueba-metricas.cjs     idem
test/prueba-sugerencias.cjs  rutas desde __dirname
test/prueba-datos-tesis.cjs  idem
test/prueba-riesgo.cjs       idem
test/prueba-plan.cjs         idem
CONTEXTO_INFORME_AVANZADO.md
```

⚠️ Antes de cualquier `git add`: borrar `.git/index.lock` (lo dejo un
`git status` corrido desde el puente, ver la regla reforzada mas arriba).

### Tanda de ahora (31/08) — segunda parte: el estimador

```
api/informe.py               estimar_cartera recalibrado (subestimaba 23-41%)
                             + el tamano del prompt se MIDE, no se hardcodea
test/test_tesis_cartera.py   +11 casos: el estimador nunca por debajo del real
CONTEXTO_INFORME_AVANZADO.md
```

Build del informe verificado con esbuild: compila limpio.

### Tanda de ahora (31/08) — tabla ACTUAL vs OBJETIVO + 2 bugs del Motor B

```
src/informe/cartera.js       planDePesos() + compresion de posiciones + bloque `plan`
src/informe/Cartera.jsx      <ActualVsObjetivo> — la tabla, entre "Pesos" y "Afinidad"
api/informe.py               🔴 `riesgo` y `plan` al payload (faltaban) + candidatos con
                             sus deltas (faltaban) + DOS NIVELES DE DETALLE + invalidation
test/prueba-plan.cjs         NUEVO — 62 comprobaciones
test/prueba-datos-tesis.cjs  al dia con el formato de dos niveles
test/prueba-snapshot.cjs     ancla por cantidad de fechas + el caso de cobertura ahora prueba
test/test_tesis_cartera.py   +8 casos: nada del Motor B se cae en el camino
CONTEXTO_INFORME_AVANZADO.md
```

Las nueve suites pasan. `src/main.jsx` sigue apareciendo modificado por finales
de linea (CRLF) — es ruido, se descarta con `git checkout src/main.jsx`.

> Todo lo anterior (informe de cartera incluido) y el arreglo de Twelve Data en
> `src/App.jsx` **ya fueron pusheados** por Marcos. Lo que sigue es la tanda del
> **25/08/2026**: veredicto de 3 posiciones, foco en rotación y los CEDEARs.

### Tanda de ahora (28/08) — cuarta parte

```
api/informe.py        MAX_TOKENS_TESIS 900->2000 + diagnostico en la respuesta vacia
test/test_tesis.py    +5 casos: respuesta sin texto, sin bloques, y el tope minimo
src/informe/App.jsx   la casilla del anexo avisa que habilita la tesis
```

### Tanda de ahora (28/08) — tercera parte

```
src/informe/sugerencias.js   ponderado + reemplazos + candidatosRotacion + arreglo de pool
src/App.jsx                  ⚠️ SCREENER — mismo arreglo de pool (mueve 1 puesto de 55)
test/prueba-sugerencias.cjs  NUEVO — 31 comprobaciones
test/prueba-metricas.cjs     actualizado (tenia un caso que validaba el bug)
TESIS_CARTERA.md             diseño cerrado
CONTEXTO_INFORME_AVANZADO.md
```

### Tanda de ahora (28/08) — segunda parte

```
api/informe.py               ⚠️ arregla 2 UnboundLocalError + "que revisar" en trampa de valor
src/informe/Informe.jsx      componente QueRevisar (exportado) + comentario de conTesis
src/informe/Cartera.jsx      tesis ACTIVADA en el anexo + usa QueRevisar
src/informe/tesis.jsx        el estado "sin claves" ya no es invisible
test/test_contrato.py        rutas relativas a __file__ (antes no corrian aca)
test/test_tesis.py           idem
local_bot/probe_bancos.py    NUEVO — la sonda (ya pusheada, queda de registro)
CONTEXTO_INFORME_AVANZADO.md
```

Las dos suites pasan: `python test/test_contrato.py` y `python test/test_tesis.py`.

### Tanda anterior (28/08)

✅ B2 ya pusheada en `689463f`. Pendiente:

```
public/data/historico_precios.json   9,3 MB — snapshot de precios (ya en el index)
src/App.jsx                          ⚠️ SCREENER — arreglo del patrimonio negativo
local_bot/fetch_fundamentals.py      anula roe/de con patrimonio<0, saca el abs(), agrega ndEbitda + industry
test/prueba-metricas.cjs             NUEVO — 27 comprobaciones
CONTEXTO_INFORME_AVANZADO.md
```

⚠️ **Después de pushear hay que correr `fetch_fundamentals.py`**: el arreglo del
screener necesita el campo `ndEbitda`, que solo aparece con el bot parcheado.
Sin eso, los reemplazos de D/E no entran (los de P/S y ROA sí, esos ya están).

Todo lo de abajo ya está pusheado.

### Tanda de las fases A y B1 (27/08) — ✅ YA PUSHEADO

```
src/App.jsx                  ⚠️ SCREENER — adelgazarHist + histCacheSave sin lsSet
local_bot/fetch_historico.py NUEVO — snapshot de precios con yfinance
```

⚠️ **Esta tanda SÍ toca `src/App.jsx`**, por primera vez desde el arreglo de
Twelve Data. Son 43 líneas agregadas, todas dentro del caché de histórico: no
se tocó ningún cálculo, ninguna pantalla ni la exportación.

### Tanda del resto de la cartera (27/08)

```
src/informe/cartera.js       (resolverBase, exposicion, CLASES_RESTO, TOPE_RENTA_VARIABLE)
src/informe/App.jsx          (formulario RestoDeCartera: montos y %)
src/informe/Cartera.jsx      (seccion "Como esta repartida la cartera" + aviso de parcial)
detector-shadow.cjs          NUEVO — detector de shadowing en src/informe/
plantilla_cartera.xlsx       NUEVO — plantilla de carga verificada contra el parser de F5
```

### Tanda del peso del dividendo (26/08)

```
api/informe.py               (PESO_BLOQUE: promedio ponderado, dividendos 0,5)
src/informe/Informe.jsx      (muestra "pesa x0.5" y explica por que)
test/test_contrato.py        (recalcula el ponderado y lo compara)
```

### Tanda del paso 3 (tesis con IA)

```
api/informe.py               (action=tesis y action=proveedores; arregla {acción})
src/informe/tesis.jsx        NUEVO — los dos botones, con cache por proveedor
src/informe/Informe.jsx      (monta la tesis; conTesis=false en el anexo)
src/informe/Cartera.jsx      (apaga la tesis en el anexo)
test/test_tesis.py           NUEVO — verifica que un proveedor no toque al otro
CONTEXTO_INFORME_AVANZADO.md
```

**Segunda tanda del paso 3 (26/08, despues del push):** arreglo de
`action=proveedores` que devolvia 400, y la bateria de tests por `do_GET`.

```
api/informe.py               (SIN_TICKER: proveedores no necesita ticker)
test/test_tesis.py           (+7 casos que entran por do_GET)
```

✅ Claves ya cargadas en Vercel por Marcos (26/08/2026).

### Tanda del paso 2 (objetivo, horizonte, stress test)

```
api/informe.py               (UMBRAL_DIVIDENDO_RELEVANTE: arregla el incentivo al reves)
src/informe/cartera.js       (OBJETIVOS, HORIZONTES, afinidad(), stressTest())
src/informe/App.jsx          (componente Opciones + objetivo y horizonte en el form)
src/informe/Cartera.jsx      (secciones "Que tan bien encaja" y "Que pasa si sale mal")
CONTEXTO_INFORME_AVANZADO.md
```

### Tanda del paso 1 (capa de cartera)

**Nuevos**
```
src/informe/cartera.js       (perfiles, clases, pesos, matriz de los dos puntajes)
```

**Modificados**
```
src/informe/Selector.jsx     (lee bien la cartera de F5 + pasa las posiciones)
src/informe/App.jsx          (estado de posiciones + selector de perfil)
src/informe/Cartera.jsx      (seccion "Cuanto pesa cada cosa" + bloque de recorte)
CONTEXTO_INFORME_AVANZADO.md
```

⚠️ **`src/App.jsx` NO se tocó.** Verificable: el bundle `main-*.js` sale con el
mismo hash que antes (`main-wr6GwcBs.js`).

**Nuevos — tanda 25/08/2026**
```
local_bot/cedears_informe.py        (universo: 137 entran, 37 excluidos con motivo)
local_bot/validar_cedears.py        (validador; correrlo ANTES del bot)
```

**Modificados — tanda 25/08/2026**
```
CONTEXTO_INFORME_AVANZADO.md
api/informe.py                      (veredicto compra/neutral/venta + accion + tope por bandera)
src/informe/estilos.js              (cortes del semaforo 60/40, alineados al veredicto)
src/informe/sugerencias.js          (planRotacion + sector pesado + respaldo de sector)
src/informe/Cartera.jsx             (seccion "Que hacer con esta cartera"; se fue "Oportunidades")
src/informe/Informe.jsx             (el veredicto muestra la accion y el tope por bandera)
local_bot/fetch_informe.py          (bandera --cedears-extra)
```

**Se genera al correr el bot, y ese sí se sube después:**
```
public/data/informe_detalle.json    (crece de ~1,2 MB a ~2,3 MB con los 137)
```

**NO se sube** (agregar a `.gitignore` si no están):
`local_bot/.cedear_cache.json`, `local_bot/probe_analistas_out.json`,
`local_bot/probe_edgar_out.json`, `local_bot/cedears_validacion.json`,
`local_bot/cedears_ok.txt`.

⚠️ **`src/App.jsx` no se tocó en esta tanda.** El único cambio que tiene es el
de Twelve Data de la tanda anterior, ya pusheado.

### ✅ Corrida real del 25/08/2026 — y el estrangulamiento de Yahoo

| paso | resultado |
|---|---|
| `validar_cedears.py` | **129 de 137** resueltos |
| `fetch_informe.py --cedears-extra` | `informe_detalle.json`: 151 → **281 activos**, 1,2 MB → **2,2 MB** |
| de los 130 nuevos bajados | **115 completos**, 15 con precio y capitalización en blanco |

**La cascada de candidatos funcionó y no hizo falta ni un respaldo `.DE`:** las
siete europeas resolvieron al ADR en dólares (ADS→ADDYY, BAS→BASFY,
BAYN→BAYRY, BSN→DANOY, DTEA→DTEGY, EOAN→EONGY, MBG→MBGYY). **Los 129 quedaron
en USD**, así que no hay mezcla de monedas.

Los 16 códigos de BYMA se tradujeron solos y bien: ADGO→AGRO, BBV→BBVA,
HHPD→HNHPF, KOFM→KOF, NOKA→NOK, SMSN→SMSN.IL, TXR→TX, WBO→WB, XROX→XRX.

#### ❌ Diagnóstico equivocado que hay que no repetir

Cuando 23 papeles quedaron a medias dije que era **rate limit de Yahoo** y que
se arreglaba reintentando. **Era falso.** Marcos reintentó los 23 y volvieron
exactamente igual. Recién ahí se miró el contenido de los registros, que es lo
que había que hacer desde el principio, y aparecieron **dos problemas
distintos** que yo había metido en la misma bolsa:

```
NOK   price 9.96   sector Technology   pe 71.1   pb 2.28   roe 3.45
      netMargin 3.47   targetMean 15.02   9 analistas   marketCap → 0
```

Nokia tiene **todo** menos un campo. El rate limit no devuelve un `.info`
completo al que le falta exactamente el mismo campo, dos veces seguidas.

**Regla: antes de culpar a la red, imprimir el registro.** Un "falta el dato"
y un "falta ese dato" son diagnósticos opuestos y se ven en diez segundos.

#### Problema 1 — `marketCap` no está en `.info` para muchos ADR (15 papeles)

**AAP, AI, ASR, CX, GFI, HMY, IBN, JD, KOF, LND, NIO, NOK, SE, SMSN.IL, TX.**
Todos con 4–6 de las 6 métricas presentes. Yahoo simplemente no publica
`marketCap` en `.info` para esos símbolos: está en `fast_info`, que es otro
endpoint.

Impacto real: **casi nulo**. `marketCap` no es una de las seis métricas con las
que se puntúa. Lo único que se pierde es `fcfYieldPct`, que se calcula como
`freeCashflow / marketCap`.

Arreglado en `fetch_informe.py` con un respaldo a `fast_info.market_cap`,
resuelto **antes** de `derivados()` para que el FCF yield se calcule igual. Si
`fast_info` falla, se anota el aviso y se sigue: nunca aborta el activo.

#### Problema 2 — 8 que no devuelven absolutamente nada

**BRFS, CAJ, CBD, EBR, ELP, ERJ, LAAC, ORAN.** `.info` vacío, sin sector, sin
precio, en dos corridas separadas. Acá sí puede ser que el ADR se haya
deslistado del NYSE (a varios ADR europeos y japoneses les pasó entre 2023 y
2025) y haya que ir a la acción local o al símbolo OTC nuevo.

**No se adivina.** `local_bot/probe_vacios.py` prueba, por cada uno, `.info` +
`fast_info` + `history(5d)` sobre el símbolo original y sus alternativas
conocidas (`EMBR3.SA` para Embraer, `ORANY`/`ORA.PA` para Orange, `CAJPY`/`7751.T`
para Canon, etc.), y clasifica en `SIRVE` / `OPERA_SIN_INFO` / `NO_OPERA`. No
escribe ningún archivo: solo informa.

**Decisión de Marcos (25/08/2026): los 8 se dejan afuera y se sigue.** Pasaron a
`EXCLUIDOS` en `cedears_informe.py` **con el símbolo alternativo anotado en el
motivo**, así que retomarlo después es correr la sonda y mover una línea. Y se
borraron sus 8 registros huecos de `informe_detalle.json`.

**Universo final: 129 CEDEARs nuevos** (129 + 45 excluidos = los 174 de la
lista), y `informe_detalle.json` queda en **281 activos / 2,22 MB**.

Del arreglo de `marketCap`: de los 15, entraron **14**. Sigue sin
capitalización **SMSN.IL** (el GDR de Samsung en Londres), que igual tiene las
6 métricas y solo se queda sin FCF yield.

#### 🛡️ Dos guardarraíles en `api/informe.py` que faltaban

Los 8 huecos destaparon dos agujeros que no tenían nada que ver con los CEDEARs
y que estaban desde el principio:

**1. Registro presente pero vacío.** `armar_datos` solo chequeaba
`if fund is None and detalle is None`. Un registro que existe con `sector: None`
y `price: 0` pasaba el control y armaba un informe con todos los bloques en
cero y un veredicto calculado sobre la nada. Ahora se detecta y se rechaza con
un mensaje que dice qué pasó y qué correr. Importante: si el papel **sí** está
en el S&P, el registro hueco se ignora y el informe sale igual en modo
`reducido` con los datos del screener — probado con AAPL.

**2. Activos sin sector — los ETF.** Todos los puntajes son percentiles contra
el mismo sector; sin sector, los cinco bloques dan `None` y salía un documento
en blanco con veredicto "sin datos suficientes", que no explicaba nada.
**`SPY` está en `sp500_fundamentals.json`** porque es el índice de referencia
del screener, así que cualquiera podía escribirlo en el buscador y recibir ese
informe vacío. Ahora devuelve un mensaje que explica que un ETF se mira por su
composición, no por sus múltiplos.

### 🧩 Los dos archivos "M" que NO son de esta tanda

`git status` muestra dos modificados que no salieron del informe. Verificado el
25/08/2026, para que nadie los arrastre a un commit del informe por las dudas:

**`src/main.jsx` — es del SCREENER, y el cambio es fantasma.**

Es el punto de entrada del screener: `index.html` → `src/main.jsx` →
`src/App.jsx`, montando en `#root`. El informe tiene el suyo, aparte:
`informe.html` → `src/informe/main.jsx` → `src/informe/App.jsx`, montando en
`#root-informe`. Son dos apps que solo comparten dominio.

El diff son **únicamente saltos de línea** (LF → CRLF). Confirmado con
`git diff --ignore-cr-at-eol src/main.jsx`, que sale **vacío**: ni un carácter
de contenido cambió. Lo dejó alguna escritura previa desde Windows; el repo no
tiene `.gitattributes` ni `core.autocrlf` definido, así que git lo ve como
archivo entero reescrito.

→ Se descarta con `git checkout -- src/main.jsx`. No hay nada que salvar ahí.
No conviene meter un `.gitattributes` global ahora: renormalizaría todo el repo
de una y ensuciaría un diff que hoy está limpio.

**`PROYECTO_CONTEXTO.md` — es el contexto del SCREENER, y tiene contenido real.**

119 inserciones / 77 borrados de verdad (no saltos de línea). Es el archivo
gemelo de este: documenta el bug de F5 que devolvía todo en $0.00, el arreglo de
`runClientP1` para que use el snapshot local en vez de pegarle a Yahoo en vivo,
y la tabla de estado de F1–F7. Ese trabajo **ya está pusheado** en el código; lo
que quedó sin subir son las notas.

→ Va en un commit **separado**, del screener. Mezclarlo con el commit del
informe rompería la separación entre los dos proyectos, que es justamente la
regla del proyecto.

### El orden importa

`cedears_ok.txt` es la entrada de `--cedears-extra`. Si se corre el bot antes
del validador, usa candidatos sin validar y baja papeles que después hay que
sacar a mano.

```
0. git checkout -- src/main.jsx                  (descartar el diff fantasma)
1. cd local_bot
2. python validar_cedears.py                     (~5 min, una sola vez)
3. revisar el resumen que imprime
4. python fetch_informe.py --cedears-extra       (~12 min)
5. python fetch_informe.py <los que quedaron a medias>   (rescate del rate limit)
6. commit del INFORME  (los 9 archivos de esta tanda + informe_detalle.json)
7. commit del SCREENER (PROYECTO_CONTEXTO.md, aparte)
8. git push
```

### 🔒 `.git/index.lock` — lo dejé yo, y bloquea TODO git

El 25/08/2026 Marcos no pudo hacer ni `git checkout`, ni `git add`, ni
`git commit`: los tres cortaron con

```
fatal: Unable to create '.../.git/index.lock': File exists.
```

Causa: **`device_bash` corrió `git status` en su repo.** Git crea `index.lock`,
y al terminar no lo pudo borrar porque **`device_bash` no tiene permiso de
borrado** (`rm` da `Operation not permitted`). Quedó un lock de 0 bytes,
huérfano, sin ningún git corriendo.

**Regla: no correr comandos de git contra el repo de Marcos desde
`device_bash`.** Ni `git status`, que parece de solo lectura y no lo es —
refresca el índice y por eso toma el lock. Para ver el estado del repo se leen
los archivos directamente (con `ls`, `cat`, `python`), que no tocan `.git/`.

Y si ya pasó: **lo tiene que borrar Marcos**, porque desde acá no se puede.

```powershell
Remove-Item "C:\Users\otero\Desktop\sp500-screener-yf\.git\index.lock"
```

### 🚫 `npm run build` NO se corre en la PC de Marcos

**No tiene Node instalado** (`npm` no se reconoce en PowerShell, `node_modules/`
no existe, no hay `package-lock.json`). Nunca hizo falta: **Vercel compila al
recibir el push**. La verificación de que el proyecto compila se hace del lado
de Claude, con los archivos reales, antes de entregarlos.

Anotado porque ya lo puse por error en una guía de pasos y lo frenó en seco.

Dos commits, no uno. La separación entre los dos proyectos también vale para el
historial: dentro de tres meses, `git log` tiene que poder contar cuál de los
dos se tocó.

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

*Actualizado: 31 de agosto de 2026 · Tabla ACTUAL vs OBJETIVO en el informe · Dos bugs que tiraban el Motor B antes de la llamada · Estimador de costo recalibrado · Build verificado · Universo operable: 268 papeles, 28 candidatos nuevos · Benchmark vs SPY y pares correlacionados · Concentracion por industria · Topes de sector e industria en el optimizador · Excel con cantidades · Afinidad por perfil de riesgo · Tesis fuera del informe del cliente · 346 comprobaciones en JS + 3 suites de Python · Anterior: 21 de agosto de 2026 · Sonda corrida y analizada · Tesis híbrida y estética clara confirmadas · Pendiente: alcance del histórico y deploy*
