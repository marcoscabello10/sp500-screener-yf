// Sugerencias de reemplazo para activos flojos.
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
 * Para un activo flojo, propone dos alternativas: la mejor de su propio sector
 * y la mejor de cualquier otro. Ambas con CEDEAR y fuera de la cartera actual.
 */
export function sugerirReemplazos(ticker, stocks, scores, enCartera, umbral = 45) {
  const propio = stocks.find(s => s.symbol === ticker)
  const scoreActual = scores[ticker]
  if (scoreActual == null || scoreActual >= umbral) return null

  const excluidos = new Set([...(enCartera || []), ticker])
  const elegibles = stocks.filter(s =>
    s.hasCedear && !excluidos.has(s.symbol) && scores[s.symbol] != null)

  const mejorDe = lista => lista
    .sort((a, b) => scores[b.symbol] - scores[a.symbol])[0] || null

  const mismoSector = propio?.sector
    ? mejorDe(elegibles.filter(s => s.sector === propio.sector)) : null
  const otroSector = propio?.sector
    ? mejorDe(elegibles.filter(s => s.sector !== propio.sector)) : mejorDe(elegibles)

  const armar = s => s && ({
    symbol: s.symbol, name: s.name, sector: s.sector,
    score: scores[s.symbol], pe: s.pe, roe: s.roe, netMargin: s.netMargin,
  })

  return {
    ticker, score: scoreActual, sector: propio?.sector || null,
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
