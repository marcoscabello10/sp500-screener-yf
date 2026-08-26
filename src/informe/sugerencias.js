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
// promediado. Comparar un banco contra una tecnológica no dice nada.

// Las seis métricas de F1. "menor" indica que un valor bajo es mejor.
const METRICAS = [
  { k: 'pe',        menor: true  },
  { k: 'pb',        menor: true  },
  { k: 'roe',       menor: false },
  { k: 'de',        menor: true  },
  { k: 'evEbitda',  menor: true  },
  { k: 'netMargin', menor: false },
]

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

/** Puntaje 0-100 de cada acción dentro de su sector. */
export function scoresPorSector(stocks) {
  const porSector = {}
  for (const s of stocks) {
    if (!s.sector) continue
    ;(porSector[s.sector] ||= []).push(s)
  }
  const out = {}
  for (const [, lista] of Object.entries(porSector)) {
    const cols = {}
    for (const m of METRICAS) cols[m.k] = lista.map(s => s[m.k])
    for (const s of lista) {
      const ps = METRICAS
        .map(m => percentil(s[m.k], cols[m.k], m.menor))
        .filter(p => p != null)
      out[s.symbol] = ps.length >= 3
        ? Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 10) / 10
        : null
    }
  }
  return out
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
  const elegibles = stocks.filter(s =>
    s.hasCedear && !excluidos.has(s.symbol) && scores[s.symbol] != null)

  const mejorDe = lista => lista
    .slice().sort((a, b) => scores[b.symbol] - scores[a.symbol])[0] || null

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
    score: scores[s.symbol], pe: s.pe, roe: s.roe, netMargin: s.netMargin,
  })

  return {
    ticker, score: scores[ticker] ?? null, sector,
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
