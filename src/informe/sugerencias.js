// Rotación de cartera: qué sacar, qué mantener, qué reforzar — y por qué cosa.
//
// ⚠️ Esto REIMPLEMENTA el criterio de scoring de F1, no importa su código:
// el informe y el screener son proyectos separados y no comparten módulos.
// La consecuencia práctica: los puntajes de acá pueden diferir en algunos
// puntos de los que muestra F5, porque son dos implementaciones del mismo
// criterio, no la misma función. Si algún día divergen de verdad, este archivo
// es el que hay que revisar.
//
// Criterio (igual que F1): percentil dentro del PROPIO SECTOR de cada métrica,
// promediado POR PESO. Comparar un banco contra una tecnológica no dice nada.
//
// 📌 28/08/2026 — este archivo se puso al día con el arreglo del patrimonio
// negativo que se hizo en App.jsx. Van DOS veces que el criterio cambia en un
// lado y no en el otro. Las tres copias que hay que revisar juntas son:
//     src/App.jsx::norm            (screener)
//     api/informe.py::percentil    (informe, backend)
//     este archivo::percentil      (informe, front)
// No se pueden unificar —los proyectos están separados a propósito y uno es
// Python— pero sí hay que tocarlas de a tres.

// Las seis métricas de F1, con su PESO y su REEMPLAZO.
//
// ⚠️ Los tres campos importan y los tres se desincronizaron alguna vez:
//
//   `peso`  — F1 promedia PONDERADO (el ROE pesa 22%, el D/E 13%). Acá se
//             promediaba SIMPLE, así que un candidato podía rankear distinto
//             que en la tabla de F1 que Marcos tiene delante. Corregido.
//
//   `alt`   — 33 empresas del S&P tienen patrimonio neto negativo (MCD, BKNG,
//             MO, PM, SBUX, ABBV…). Ahí el P/B, el ROE y el D/E no significan
//             nada, y sin reemplazo el papel perdía TRES métricas y quedaba
//             por debajo del corte. Se sustituyen por los múltiplos que se usan
//             justamente cuando no hay patrimonio contra qué medir.
//
//   `noAplicaEn` — un banco no tiene EBITDA con sentido (la deuda es su materia
//             prima). Es "no aplica", distinto de "falta el dato".
const METRICAS = [
  { k: 'pe',        menor: true,  peso: 0.20 },
  { k: 'pb',        menor: true,  peso: 0.15, alt: 'priceToSales' },
  { k: 'roe',       menor: false, peso: 0.22, alt: 'roa' },
  { k: 'de',        menor: true,  peso: 0.13, alt: 'ndEbitda' },
  { k: 'evEbitda',  menor: true,  peso: 0.15, noAplicaEn: ['Financials'] },
  { k: 'netMargin', menor: false, peso: 0.15 },
]

// Mínimo de métricas para que un puntaje sea publicable. Con menos de tres, el
// número sale de tan poca información que ordena por ruido.
const MIN_METRICAS = 3

// A partir de acá un sector pesa demasiado y conviene que la rotación salga
// de ahí y no entre ahí. No es una regla de mercado: es el umbral con el que
// el documento decide qué recomendar, y está escrito para poder discutirlo.
export const SECTOR_PESADO_PCT = 35

function percentil(valor, valores, menor) {
  // Un múltiplo negativo no es "barato", es que la empresa pierde plata.
  let v = valores.filter(x => x != null && !Number.isNaN(x))
  if (menor) {
    v = v.filter(x => x > 0)
    if (valor == null || valor <= 0) return null
  }
  if (valor == null || v.length < 5) return null
  const debajo = v.filter(x => x < valor).length
  const p = (debajo / v.length) * 100
  return menor ? 100 - p : p
}

/**
 * Qué se usa realmente para una métrica en un papel: la propia si sirve, si no
 * el reemplazo. Devuelve el CAMPO además del valor, porque el campo define
 * contra quién se compara: un ROA se compara contra ROAs, nunca contra ROEs.
 * Son escalas distintas — el ROA siempre da más bajo porque no lleva
 * apalancamiento— y mezclarlos castigaría al reemplazado sin motivo.
 */
function metricaEfectiva(s, m) {
  if (m.noAplicaEn?.includes(s.sector)) return null
  const sirve = v => v != null && !Number.isNaN(v) && (!m.menor || v > 0)
  if (sirve(s[m.k])) return { campo: m.k, valor: s[m.k], alt: false }
  if (m.alt && sirve(s[m.alt])) return { campo: m.alt, valor: s[m.alt], alt: true }
  return null
}

/**
 * Puntaje 0-100 de cada acción dentro de su sector, promedio PONDERADO.
 *
 * Devuelve { [symbol]: {score, nUsadas, nAplicables, reemplazos} } — no solo el
 * número. La cobertura hace falta aguas arriba: la tesis de cartera tiene que
 * poder decir "de este papel sé poco" en vez de opinar con tres datos.
 */
export function scoresPorSector(stocks) {
  const porSector = {}
  for (const s of stocks) {
    if (!s.sector) continue
    ;(porSector[s.sector] ||= []).push(s)
  }
  const out = {}
  for (const [sector, lista] of Object.entries(porSector)) {
    // Se resuelve una vez por papel y métrica: adentro del bucle de cada papel
    // sería O(n²) rearmando el pool entero cada vez.
    const resueltas = {}
    for (const m of METRICAS) resueltas[m.k] = lista.map(s => metricaEfectiva(s, m))
    const aplicables = METRICAS.filter(m => !m.noAplicaEn?.includes(sector))

    // Pool de comparación POR CAMPO. Es TODO el sector que tenga ese campo, no
    // solo los que lo usan como reemplazo.
    //
    // ⚠️ Acá estaba el error: el primer intento comparaba el P/S de MO contra
    // el P/S de los OTROS que también usan P/S como reemplazo. En Consumer
    // Staples los únicos con patrimonio negativo son MO y PM, o sea un pool de
    // DOS, y `percentil` exige cinco. Resultado: el reemplazo se caía en
    // silencio, MO quedaba con 3 de 6 métricas y —justamente por eso— salía
    // 93,8 y primero del sector, que es la misma enfermedad que se acaba de
    // arreglar.
    //
    // El P/S existe para TODAS las empresas del sector, no solo para las de
    // patrimonio negativo. Comparar contra todas es a la vez más correcto y lo
    // que hace que el pool alcance. Lo que sigue prohibido es mezclar ESCALAS
    // (un ROA contra ROEs), y eso se respeta: el pool se arma por CAMPO.
    const pool = {}
    const campoDe = m => new Set(resueltas[m.k].filter(Boolean).map(e => e.campo))
    for (const m of METRICAS)
      for (const campo of campoDe(m))
        pool[campo] = pool[campo] || lista.map(s => s[campo])

    lista.forEach((s, i) => {
      let suma = 0, pesoUsado = 0, nUsadas = 0
      const reemplazos = []
      for (const m of aplicables) {
        const e = resueltas[m.k][i]
        if (!e) continue
        const p = percentil(e.valor, pool[e.campo], m.menor)
        if (p == null) continue
        suma += p * m.peso
        pesoUsado += m.peso
        nUsadas++
        if (e.alt) reemplazos.push(`${m.k}→${e.campo}`)
      }
      out[s.symbol] = nUsadas >= MIN_METRICAS
        ? { score: Math.round((suma / pesoUsado) * 10) / 10,
            nUsadas, nAplicables: aplicables.length, reemplazos }
        : { score: null, nUsadas, nAplicables: aplicables.length, reemplazos }
    })
  }
  return out
}

/** El puntaje suelto, para el código que solo quiere el número. */
export function soloScore(scores) {
  return Object.fromEntries(
    Object.entries(scores).map(([k, v]) => [k, v && v.score]))
}

/**
 * Alternativas para un activo que sale: la mejor de su propio sector y la mejor
 * de cualquier otro. Ambas con CEDEAR y fuera de la cartera actual.
 *
 * evitarSectores: sectores que ya pesan demasiado. La alternativa "de otro
 * sector" no puede caer ahí — si no, la rotación arregla el papel y empeora la
 * concentración, que es el problema más caro de los dos.
 */
export function sugerirReemplazos(ticker, stocks, scores, enCartera,
                                  evitarSectores = [], sectorDelActivo = null) {
  const propio = stocks.find(s => s.symbol === ticker)
  const excluidos = new Set([...(enCartera || []), ticker])
  const evitar = new Set(evitarSectores)
  // `scores[x]` ya NO es un numero suelto sino {score, nUsadas, ...}: hace falta
  // la cobertura aguas arriba. Se lee siempre por este helper para que no quede
  // ningun `scores[x] - scores[y]` comparando objetos, que en JS da NaN sin
  // avisar y ordena cualquier cosa.
  const pts = sym => scores[sym]?.score ?? null
  const elegibles = stocks.filter(s =>
    s.hasCedear && !excluidos.has(s.symbol) && pts(s.symbol) != null)

  const mejorDe = lista => lista
    .slice().sort((a, b) => pts(b.symbol) - pts(a.symbol))[0] || null

  // Un papel de la cartera puede no estar en `stocks` — es lo que pasa con los
  // CEDEAR de afuera del S&P 500. Sin este respaldo se quedaba sin sector y el
  // informe no le ofrecía ninguna alternativa de su propio rubro, que suele ser
  // la más útil: cambiar un banco por otro banco.
  const sector = propio?.sector || sectorDelActivo || null
  const mismoSector = sector
    ? mejorDe(elegibles.filter(s => s.sector === sector)) : null
  let otroSector = mejorDe(elegibles.filter(s =>
    s.sector !== sector && !evitar.has(s.sector)))
  // Si todo lo bueno está en sectores ya pesados, es preferible ofrecer algo
  // antes que nada; el documento avisa aparte de la concentración.
  if (!otroSector) otroSector = mejorDe(elegibles.filter(s => s.sector !== sector))

  const armar = s => s && ({
    symbol: s.symbol, name: s.name, sector: s.sector,
    score: pts(s.symbol), pe: s.pe, roe: s.roe, netMargin: s.netMargin,
    // Cobertura del candidato: sin esto el documento ofrecia un reemplazo con
    // 3 de 6 metricas al lado de uno con 6 de 6, como si valieran lo mismo.
    metricas: `${scores[s.symbol]?.nUsadas ?? 0}/${scores[s.symbol]?.nAplicables ?? 6}`,
    reemplazos: scores[s.symbol]?.reemplazos || [],
  })

  return {
    ticker, score: pts(ticker), sector,
    mismoSector: armar(mismoSector),
    otroSector: armar(otroSector),
  }
}

/** Concentración por sector de un conjunto de activos (sin ponderar por monto). */
export function concentracionPorSector(activos) {
  const conteo = {}
  for (const a of activos) {
    const s = a.sector || 'Sin sector'
    conteo[s] = (conteo[s] || 0) + 1
  }
  const total = activos.length || 1
  return Object.entries(conteo)
    .map(([sector, n]) => ({ sector, n, pct: Math.round((n / total) * 1000) / 10 }))
    .sort((a, b) => b.n - a.n)
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN DE ROTACIÓN
//
// La acción sale del veredicto que ya calculó el backend (venta→sacar,
// neutral→mantener, compra→reforzar). No se inventa una segunda escala: si el
// informe individual dice VENTA y la cartera dijera "mantener", el cliente
// estaría leyendo dos documentos que se contradicen.
//
// Lo único que agrega este módulo es el ORDEN — cuál sacar primero — y el
// motivo en una línea, que es lo que hace accionable la sección.
// ─────────────────────────────────────────────────────────────────────────────

const ORDEN = { sacar: 0, 'revisar a mano': 1, mantener: 2, reforzar: 3 }

/** Una línea que explica por qué sale. Lo primero es lo más grave. */
function motivoCorto(inf) {
  const altos = (inf.riesgos || []).filter(r => r.severidad === 'alta')
  if (altos.length) return altos[0].texto
  const peor = (inf.senales || [])
    .filter(s => s.puntaje != null)
    .sort((a, b) => a.puntaje - b.puntaje)[0]
  if (peor) {
    // `titulo` viene acentuado desde el endpoint; `bloque` es el identificador
    // sin acento y solo sirve de respaldo para un informe cacheado de antes.
    return `El bloque más débil es ${peor.titulo || peor.bloque.replace(/_/g, ' ')} `
      + `(${Math.round(peor.puntaje)}/100)`
      + (peor.notas?.[0] ? `: ${peor.notas[0]}` : '.')
  }
  return 'Sin datos suficientes para sostener una posición.'
}

/**
 * Arma el plan completo.
 *
 * informes: los informes ya resueltos (los que tienen error se ignoran).
 * Devuelve { sacar, mantener, reforzar, sinDatos, sectoresPesados }.
 * Cada entrada de `sacar` trae ya sus reemplazos, sin repetir candidatos entre
 * activos: proponer el mismo papel dos veces en un documento queda pobre.
 */
export function planRotacion(informes, stocks, scores) {
  const validos = (informes || []).filter(i => i && !i.error)
  const enCartera = validos.map(i => i.ticker)

  const concentracion = concentracionPorSector(validos.map(i => ({ sector: i.sector })))
  const sectoresPesados = concentracion
    .filter(c => c.pct > SECTOR_PESADO_PCT).map(c => c.sector)

  const filas = validos.map(i => {
    const v = i.veredicto || {}
    const altos = (i.riesgos || []).filter(r => r.severidad === 'alta')
    return {
      ticker: i.ticker,
      nombre: i.nombre,
      sector: i.sector || null,
      accion: v.accion || 'mantener',
      etiqueta: v.etiqueta,
      puntaje: v.puntaje ?? null,
      banderas: altos.length,
      limitadoPorBandera: !!v.limitado_por_bandera,
      sectorPesado: sectoresPesados.includes(i.sector),
      motivo: motivoCorto(i),
    }
  })

  // Orden: primero lo que sale, y dentro de eso lo más urgente. Un papel con
  // banderas rojas sale antes que uno simplemente flojo, y a igualdad de
  // banderas sale antes el de peor puntaje. El desempate final es alfabético
  // para que dos corridas con los mismos datos den el mismo documento.
  filas.sort((a, b) =>
    (ORDEN[a.accion] ?? 9) - (ORDEN[b.accion] ?? 9)
    || b.banderas - a.banderas
    || (a.puntaje ?? 101) - (b.puntaje ?? 101)
    || a.ticker.localeCompare(b.ticker))

  const yaSugeridos = []
  const sacar = filas.filter(f => f.accion === 'sacar').map(f => {
    const s = sugerirReemplazos(f.ticker, stocks, scores,
                                [...enCartera, ...yaSugeridos], sectoresPesados,
                                f.sector)
    if (s?.mismoSector) yaSugeridos.push(s.mismoSector.symbol)
    if (s?.otroSector) yaSugeridos.push(s.otroSector.symbol)
    return { ...f, reemplazos: s }
  })

  return {
    sacar,
    mantener: filas.filter(f => f.accion === 'mantener'),
    reforzar: filas.filter(f => f.accion === 'reforzar'),
    sinDatos: filas.filter(f => f.accion === 'revisar a mano'),
    sectoresPesados,
    porTicker: Object.fromEntries(filas.map(f => [f.ticker, f])),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POOL DE CANDIDATOS PARA LA TESIS DE CARTERA
//
// Es lo mismo que muestra F1 —las mejores por sector, solo CEDEAR— pero armado
// acá para no depender de que el screener haya corrido.
//
// Por que un tope por sector y no "todos los CEDEAR":
//   Los candidatos VAN DENTRO DEL PROMPT, y ahi cada papel cuesta tokens en
//   cada llamada. Los 150 CEDEAR son ~4.500 tokens; los 5 mejores por sector
//   son ~55 papeles y ~1.650. El modelo no necesita el padron completo: necesita
//   los mejores de cada rubro para poder elegir.
//
// Por que se excluye la cartera ANTES de cortar y no despues:
//   Si se corta primero y se excluye despues, un sector donde el cliente ya
//   tiene 3 de los 5 mejores queda con 2 candidatos. Excluyendo primero,
//   siempre quedan 5 candidatos REALES.
//
// Sectores chicos: Real Estate tiene 1 CEDEAR y Utilities 3. Devuelven 1 y 3.
// No es un error, es todo lo que existe.
export const CANDIDATOS_POR_SECTOR = 5

/**
 * @param stocks     el snapshot completo (sp500_fundamentals)
 * @param scores     lo que devuelve scoresPorSector
 * @param enCartera  tickers que el cliente ya tiene (se excluyen)
 * @param porSector  cuantos por sector (default CANDIDATOS_POR_SECTOR)
 */
export function candidatosRotacion(stocks, scores, enCartera = [],
                                   porSector = CANDIDATOS_POR_SECTOR,
                                   sectoresEnCartera = []) {
  // Un sector donde el cliente NO tiene nada es el mejor destino posible para
  // diversificar. Se marca para que el modelo pueda decirlo, en vez de tener
  // que deducirlo comparando dos listas.
  const yaTiene = new Set(sectoresEnCartera)
  const ya = new Set(enCartera)
  const pts = sym => scores[sym]?.score ?? null
  const grupos = {}
  for (const s of stocks) {
    if (!s.sector || !s.hasCedear || ya.has(s.symbol)) continue
    if (pts(s.symbol) == null) continue
    ;(grupos[s.sector] ||= []).push(s)
  }
  const out = []
  for (const [sector, lista] of Object.entries(grupos)) {
    lista
      // Desempate alfabetico: dos corridas con los mismos datos tienen que dar
      // el mismo documento. Sin esto el orden depende del sort del navegador.
      .sort((a, b) => pts(b.symbol) - pts(a.symbol) || a.symbol.localeCompare(b.symbol))
      .slice(0, porSector)
      .forEach(s => out.push({
        ticker: s.symbol,
        nombre: s.name,
        sector,
        puntaje: pts(s.symbol),
        metricas: `${scores[s.symbol].nUsadas}/${scores[s.symbol].nAplicables}`,
        reemplazos: scores[s.symbol].reemplazos,
        // ── La dimension que faltaba: RIESGO ─────────────────────────────
        // Hasta el 31/08 el candidato viajaba con puntaje fundamental y nada
        // mas. Una cartera con 33% de volatilidad que hay que bajar recibia
        // exactamente las mismas sugerencias que una tranquila, porque el
        // puntaje no sabe nada de riesgo.
        beta: s.beta ?? null,
        // Defensivo = se mueve MENOS que el mercado. No es una opinion: es
        // beta < 1 medida contra el indice.
        defensivo: s.beta != null && s.beta < 0.9,
        // Un sector que no esta en la cartera diversifica por definicion.
        sector_nuevo: !yaTiene.has(sector),
      }))
  }
  return out.sort((a, b) => a.sector.localeCompare(b.sector) || b.puntaje - a.puntaje)
}
