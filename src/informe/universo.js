// ─────────────────────────────────────────────────────────────────────────────
// EL UNIVERSO OPERABLE — qué papeles puede el informe siquiera considerar
//
// EL PROBLEMA QUE RESUELVE (31/08/2026)
// ------------------------------------
// El informe puntuaba y elegía candidatos sobre `sp500_fundamentals.json`, que
// son las 504 del índice. `candidatosRotacion()` ya filtraba por `hasCedear`,
// así que los candidatos salían de las 151 del S&P que se pueden comprar acá.
// Hasta ahí bien.
//
// Lo que faltaba son los OTROS: 130 CEDEARs que NO están en el S&P 500 —los ADR
// de Brasil, Europa, China, las mineras canadienses—. Están en
// `informe_detalle.json` con todos sus fundamentales, están en el histórico de
// precios, aparecen en el buscador… y **nunca podían ser candidatos**, porque
// no entraban al pool que se puntúa.
//
// O sea: la rotación elegía entre 151 papeles cuando el universo operable real
// es de ~268. Casi la mitad del abanico no existía para el informe.
//
// POR QUÉ UN MÓDULO Y NO TRES LÍNEAS EN App.jsx
// ---------------------------------------------
// Porque unir dos fuentes tiene reglas que hay que poder leer y probar: quién
// gana cuando un símbolo está en las dos, qué campos hay que derivar, y qué se
// descarta. Metido adentro de un `useEffect` eso no se prueba ni se explica.
//
// LO QUE ESTE MÓDULO NO HACE
// --------------------------
// No puntúa. Arma la lista y se va. El scoring sigue viviendo en
// `sugerencias.js`, en un solo lugar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deuda neta sobre EBITDA — el reemplazo del D/E cuando no hay patrimonio
 * contra qué medir. El screener ya lo trae calculado; para los de afuera hay
 * que derivarlo del bloque de consenso, con la MISMA regla que usa el bot:
 * los dos positivos, si no el número no significa nada.
 */
function deudaNetaEbitda(consenso) {
  const nd = consenso?.netDebt
  const eb = consenso?.ebitda
  if (!(nd > 0) || !(eb > 0)) return null
  return Math.round((nd / eb) * 1000) / 1000
}

/**
 * Un activo de `informe_detalle.json` con la MISMA forma que uno del screener.
 *
 * Esto es lo que hace que `sugerencias.js` no tenga que enterarse de que hay
 * dos fuentes: recibe una sola lista de objetos iguales. Si acá se escribiera
 * un campo distinto —`priceSales` en vez de `priceToSales`— la métrica se
 * perdería en silencio para 130 papeles y el puntaje saldría igual, más bajo,
 * sin un solo error en la consola.
 */
function normalizar(sym, a) {
  // El patrimonio negativo ya viene anulado por `fetch_informe.py` (BAK, CAR,
  // ETSY y PBI llegan con roe y de en null). Se recalcula igual: si algún día
  // el bot deja de hacerlo, acá no cambia nada; si nunca lo hizo, acá se
  // arregla. Es barato y saca una dependencia sobre otro repo.
  const neg = a.pb != null && a.pb < 0
  return {
    symbol: sym,
    name: a.name || sym,
    sector: a.sector || null,
    // `industry` NO viene en informe_detalle: es un campo que solo captura el
    // bot del screener. Se deja en null explícito en vez de omitirlo, para que
    // quien lo lea vea que falta y no que nadie lo pensó.
    industry: a.industry ?? null,
    pe: a.pe ?? null,
    pb: a.pb ?? null,
    roe: neg ? null : (a.roe ?? null),
    de: neg ? null : (a.de ?? null),
    evEbitda: a.evEbitda ?? null,
    netMargin: a.netMargin ?? null,
    roa: a.roa ?? null,
    priceToSales: a.priceToSales ?? null,
    ndEbitda: deudaNetaEbitda(a.consenso),
    marketCap: a.marketCap ?? null,
    price: a.price ?? null,
    changePercent: a.changePercent ?? null,
    revGrowth: a.revGrowth ?? null,
    patrimonioNegativo: neg,
    hasCedear: !!a.hasCedear,
    enSp500: !!a.enSp500,
    // La beta es la unica medida de riesgo que se puede tener ANTES de bajar
    // el historico de precios. Sin ella, los candidatos solo se pueden ordenar
    // por puntaje fundamental — que no sabe nada de riesgo— y una cartera que
    // necesita bajar volatilidad recibe las mismas sugerencias que una que no.
    beta: a.consenso?.beta ?? null,
    // De dónde salió cada papel. Sirve para poder decir en el informe "esto lo
    // sabemos por el bot del informe, no por el del screener" cuando algo no
    // cuadre, en vez de tener que adivinarlo.
    fuente: 'detalle',
  }
}

/**
 * Une las dos fuentes en UN universo.
 *
 * @param stocks   `d.stocks` de sp500_fundamentals.json (504, ya normalizados)
 * @param activos  `d.activos` de informe_detalle.json (281, por símbolo)
 *
 * Quién gana si un símbolo está en las dos: **el screener**. Es la fuente
 * canónica de su propio universo y es la que ve Marcos en F1; si el informe
 * usara otros números para las mismas 504 empresas, tendríamos dos verdades
 * para el mismo papel. Del detalle solo se toma `hasCedear`, que el screener
 * también trae pero que conviene refrescar desde el archivo que lo valida.
 */
export function armarUniverso(stocks, activos) {
  const base = Array.isArray(stocks) ? stocks : []
  const det = activos && typeof activos === 'object' ? activos : {}
  const yaEstan = new Set(base.map(s => s.symbol))

  const delScreener = base.map(s => ({
    ...s,
    // El snapshot del screener NO trae beta (vive en informe_consenso.json, que
    // el informe no baja). Sale del detalle, que cubre a los 151 del indice con
    // CEDEAR — o sea, a TODOS los que pueden ser candidatos.
    beta: s.beta ?? det[s.symbol]?.consenso?.beta ?? null,
    // Si el detalle dice que tiene CEDEAR, vale: es el archivo que lo validó
    // uno por uno contra el broker. Nunca al revés — un `false` del detalle no
    // le saca el CEDEAR a un papel que el screener marcó, porque el detalle
    // solo cubre 281 de las 504.
    hasCedear: !!(s.hasCedear || det[s.symbol]?.hasCedear),
    fuente: 'screener',
  }))

  const deAfuera = []
  const medibles = []
  for (const [sym, a] of Object.entries(det)) {
    if (yaEstan.has(sym)) continue
    if (!a) continue
    // ── LOS QUE COTIZAN EN PESOS ──────────────────────────────────────────
    // Salen por una puerta distinta y no vuelven a mezclarse. El motivo, en
    // una linea: sus numeros son de otra escala.
    //
    //   · el MULTIPLO se puede mostrar (P/E, ROE y margenes son cocientes:
    //     la moneda se cancela);
    //   · el PERCENTIL no, porque se calcula contra todo el sector y un
    //     market cap en pesos le corre el percentil a los otros treinta;
    //   · la SERIE DE PRECIOS tampoco — y esa es la que decide. Tres años en
    //     pesos son tres años de devaluacion, que `riesgo.js` leeria como
    //     volatilidad de la empresa y como correlacion entre dos papeles que
    //     solo comparten moneda.
    //
    // Entonces: no entran a `todos` (que ES el pool de percentiles) ni a
    // `operables` (de donde salen los candidatos). Entran a `porSymbol`, que
    // es lo que permite que una POSICION del cliente se encuentre, tenga
    // sector y sume a la concentracion.
    if (a.soloMedible) {
      medibles.push({ ...normalizar(sym, a), soloMedible: true,
                      moneda: a.moneda || 'ARS' })
      continue
    }
    if (!a.sector) continue                // sin sector no hay percentil posible
    deAfuera.push(normalizar(sym, a))
  }

  const todos = [...delScreener, ...deAfuera]
  const operables = todos.filter(s => s.hasCedear && s.sector)

  return {
    // Los que se pueden MOSTRAR pero no comparar. No estan en `todos` a
    // proposito: quien quiera el pool de percentiles no los tiene que filtrar,
    // porque nunca los recibe.
    medibles,
    // TODOS: es el pool contra el que se calculan los percentiles. Cuantas más
    // empresas comparables tenga un sector, más significativo es el percentil.
    // Acá NO se filtra por CEDEAR: que un papel no se pueda comprar en Buenos
    // Aires no lo hace menos comparable como empresa.
    todos,
    // OPERABLES: de acá salen los candidatos. Esto sí se filtra, porque
    // recomendar algo que no se puede comprar no es una recomendación.
    operables,
    // ⚠️ `porSymbol` SI los incluye, y es el unico lugar donde conviven. Es lo
    // que permite que una cartera con Aluar encuentre el papel, le ponga
    // sector y lo sume a la concentracion. Todo lo que compara o puntua sale
    // de `todos` o de `operables`, nunca de acá.
    porSymbol: Object.fromEntries([...todos, ...medibles].map(s => [s.symbol, s])),
    resumen: resumir(todos, operables, deAfuera.length, medibles.length),
  }
}

/**
 * Lo que hay que poder decir en el informe sobre su propio universo.
 *
 * Un sector con dos papeles operables no puede ofrecer rotación, y el informe
 * tiene que decirlo en vez de quedarse callado o —peor— ofrecer el único que
 * hay como si fuera una elección.
 */
function resumir(todos, operables, nDeAfuera, nMedibles = 0) {
  const porSector = {}
  for (const s of operables) {
    porSector[s.sector] = (porSector[s.sector] || 0) + 1
  }
  const sectores = Object.entries(porSector)
    .map(([sector, n]) => ({ sector, n, suficiente: n >= MIN_PARA_ROTAR }))
    .sort((a, b) => b.n - a.n)
  return {
    total: todos.length,
    operables: operables.length,
    delScreener: todos.length - nDeAfuera,
    deAfuera: nDeAfuera,
    // Los del Merval en pesos. Se cuentan aparte porque no son parte del
    // universo comparable: son papeles que se pueden tener, no elegir.
    soloMedibles: nMedibles,
    sectores,
    // Los sectores donde NO hay de dónde elegir. Es un dato del informe, no un
    // error: significa que ahí la única decisión posible es quedarse o salir.
    sectoresSinAlternativa: sectores.filter(s => !s.suficiente).map(s => s.sector),
  }
}

// Con menos de esto, "el mejor del sector" es el único del sector. El número
// es bajo a propósito: no es un umbral de calidad, es el mínimo para que la
// palabra "elegir" signifique algo.
export const MIN_PARA_ROTAR = 3
