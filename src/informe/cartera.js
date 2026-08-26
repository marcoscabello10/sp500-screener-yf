// ─────────────────────────────────────────────────────────────────────────────
// CAPA DE CARTERA — el segundo puntaje
//
// Hasta acá el informe respondía una sola pregunta: "¿es buena esta empresa?".
// El veredicto compra/neutral/venta contesta eso y nada más — compara la
// empresa contra su sector y no sabe absolutamente nada de la cartera.
//
// Este módulo contesta la otra: "¿está bien que pese ESTO en ESTA cartera?".
// Son preguntas distintas y las respuestas se cruzan de formas que importan:
// una empresa excelente que pesa el 40% es un problema, y una mediocre que pesa
// el 1% no es un problema, es ruido.
//
// LOS DOS PUNTAJES NO SE PROMEDIAN. Nunca. Promediarlos daría un número que no
// significa nada: mezclaría "cuán buena es" con "cuánto tenés". Se muestran
// separados y la recomendación sale de cruzarlos en una matriz explícita.
//
// De dónde salen los pesos: el screener (F5) ya calcula cantidad, precio de
// compra, valor actual, costo base, ganancia y peso real por posición, y lo
// guarda en localStorage. Acá se lee, no se recalcula.
// ─────────────────────────────────────────────────────────────────────────────

// Los topes salen del perfil, no de una tabla por activo. Decisión de Marcos
// (25/08/2026): así sirve igual para una cartera existente que para una
// propuesta, sin cargar nada activo por activo.
//
// `factorEquiponderado` es la parte importante y la menos obvia. Un tope duro
// del 8% en una cartera de 6 activos marcaría las SEIS posiciones en
// sobrepeso, porque equiponderada ya da 16,7% cada una. El tope real es el
// mayor entre el del perfil y un múltiplo del peso equiponderado: así el
// informe señala concentración de verdad y no el hecho aritmético de tener
// pocas posiciones.
export const PERFILES = {
  conservador: {
    clave: 'conservador', nombre: 'Conservador',
    maxPosicion: 8, maxSector: 25, factorEquiponderado: 1.4,
    resumen: 'Prioriza no perder. Tolera menos concentración y menos papeles ' +
             'especulativos.',
  },
  moderado: {
    clave: 'moderado', nombre: 'Moderado',
    maxPosicion: 12, maxSector: 35, factorEquiponderado: 1.8,
    resumen: 'Equilibrio entre crecimiento y control del riesgo.',
  },
  agresivo: {
    clave: 'agresivo', nombre: 'Agresivo',
    maxPosicion: 20, maxSector: 45, factorEquiponderado: 2.5,
    resumen: 'Acepta posiciones grandes y concentración sectorial a cambio de ' +
             'más crecimiento.',
  },
}
export const PERFIL_POR_DEFECTO = 'moderado'

// Cuánto puede pesar cada clase, como fracción del tope general. Una
// especulativa con el mismo tope que una Coca-Cola no tendría sentido.
export const TOPE_POR_CLASE = { core: 1, growth: 0.75, especulativo: 0.4 }

export const CLASE_TEXTO = {
  core: 'Core', growth: 'Growth', especulativo: 'Especulativo',
}

/**
 * Core / Growth / Especulativo, derivado de datos (decisión de Marcos: regla,
 * no criterio manual ni IA — es determinista y tiene que dar igual siempre).
 *
 * El orden de los cortes importa: primero se descarta lo especulativo, porque
 * una empresa que pierde plata no es "core" por más grande que sea.
 */
export function clasificar(inf) {
  const f = inf?.fundamentales || {}
  const c = inf?.consenso || {}
  const cap = f.marketCap || 0
  const beta = c.beta
  // Sin P/E y sin ROE positivo = no gana plata. El múltiplo no existe porque
  // no hay ganancia contra la cual calcularlo.
  const noGana = f.pe == null && !(f.roe > 0)

  if (noGana || (cap > 0 && cap < 2e9) || (beta != null && beta > 1.8)) {
    return 'especulativo'
  }
  if (cap >= 5e10 && (beta == null || beta <= 1.2)) return 'core'
  return 'growth'
}

export const ESTADO_TEXTO = {
  critico:  'Sobrepeso crítico',
  sobre:    'Sobrepeso',
  banda:    'En banda',
  sub:      'Subpeso',
}

/**
 * Cruce de los dos puntajes. ESTA matriz es el producto del módulo: es donde
 * "buena empresa" y "cuánto pesa" se combinan de forma explícita en vez de
 * quedar escondidos en un promedio.
 *
 *                     venta          neutral            compra
 *   sobrepeso   ->    salir          recortar           recortar (toma ganancia)
 *   en banda    ->    salir          mantener           mantener/reforzar
 *   subpeso     ->    salir          consolidar         reforzar
 */
export function accionCombinada(etiqueta, estado) {
  if (etiqueta === 'venta') return 'sacar'
  if (etiqueta === 'sin datos suficientes') return 'revisar a mano'
  if (estado === 'critico' || estado === 'sobre') return 'recortar'
  if (estado === 'sub') return etiqueta === 'compra' ? 'reforzar' : 'consolidar'
  return etiqueta === 'compra' ? 'reforzar' : 'mantener'
}

export const ACCION_PESO_TEXTO = {
  sacar: 'Sacar', recortar: 'Recortar', reforzar: 'Reforzar',
  mantener: 'Mantener', consolidar: 'Consolidar o salir',
  'revisar a mano': 'Revisar a mano',
}

const round1 = x => (x == null ? null : Math.round(x * 10) / 10)

/**
 * El análisis completo de la cartera con pesos.
 *
 * `posiciones` es un mapa {TICKER: {cantidad, precioCompra, valorActual,
 * costoBase, gananciaUSD, gananciaPct, pctActual}} tal como lo dejó F5.
 * Si viene vacío devuelve `hayPesos: false` y el informe sigue funcionando
 * exactamente como antes — sin pesos, pero sin romperse.
 */
export function analizarCartera(informes, posiciones, perfilClave) {
  const perfil = PERFILES[perfilClave] || PERFILES[PERFIL_POR_DEFECTO]
  const validos = (informes || []).filter(i => i && !i.error)
  const pos = posiciones || {}

  const conValor = validos.filter(i => (pos[i.ticker]?.valorActual) > 0)
  const valorTotal = conValor.reduce((a, i) => a + pos[i.ticker].valorActual, 0)
  const hayPesos = conValor.length > 0 && valorTotal > 0

  const n = validos.length || 1
  const pesoEquiponderado = 100 / n
  const topeGeneral = Math.max(perfil.maxPosicion,
                               perfil.factorEquiponderado * pesoEquiponderado)

  const activos = validos.map(i => {
    const p = pos[i.ticker] || {}
    const clase = clasificar(i)
    const topeClase = topeGeneral * TOPE_POR_CLASE[clase]
    // El peso se recalcula sobre el total de lo que efectivamente tiene valuación,
    // no se confía en el pctActual guardado: si la cartera se generó con más
    // activos de los que entraron al informe, ese porcentaje no cierra a 100.
    const peso = hayPesos && p.valorActual > 0
      ? (p.valorActual / valorTotal) * 100 : null

    let estado = null
    if (peso != null) {
      if (peso > topeClase * 1.5) estado = 'critico'
      else if (peso > topeClase) estado = 'sobre'
      else if (peso < pesoEquiponderado / 3) estado = 'sub'
      else estado = 'banda'
    }

    const etiqueta = i.veredicto?.etiqueta
    const excesoPct = (peso != null && peso > topeClase) ? peso - topeClase : null
    return {
      ticker: i.ticker,
      nombre: i.nombre,
      sector: i.sector || null,
      clase,
      etiqueta,
      puntajeFundamental: i.veredicto?.puntaje ?? null,
      banderas: (i.riesgos || []).filter(r => r.severidad === 'alta').length,
      cantidad: p.cantidad ?? null,
      precioCompra: p.precioCompra ?? null,
      valorActual: p.valorActual ?? null,
      gananciaPct: round1(p.gananciaPct),
      gananciaUSD: p.gananciaUSD ?? null,
      peso: round1(peso),
      topeClase: round1(topeClase),
      estado,
      excesoPct: round1(excesoPct),
      // Cuánto habría que vender para volver al tope. Es el número que hace
      // ejecutable la recomendación: "recortar" sin monto no se puede operar.
      excesoUSD: excesoPct != null ? Math.round(excesoPct / 100 * valorTotal) : null,
      accion: estado ? accionCombinada(etiqueta, estado)
                     : (i.veredicto?.accion || 'mantener'),
      // Take profit (punto 11): se recorta porque pesa de más, no porque la
      // empresa esté mal. La distinción es el punto: son dos motivos de venta
      // totalmente distintos y el cliente tiene que poder verlos separados.
      tomaGanancia: estado && (estado === 'sobre' || estado === 'critico')
                    && etiqueta !== 'venta' && p.gananciaPct > 15,
    }
  })

  // ── Sectores ──────────────────────────────────────────────────────────────
  const porSector = {}
  for (const a of activos) {
    const s = a.sector || 'Sin sector'
    porSector[s] = porSector[s] || { sector: s, valor: 0, n: 0 }
    porSector[s].n += 1
    porSector[s].valor += a.valorActual || 0
  }
  const nSectores = Object.keys(porSector).length || 1
  const topeSector = Math.max(perfil.maxSector, 1.3 * (100 / nSectores))
  const sectores = Object.values(porSector).map(s => {
    const pct = hayPesos ? (s.valor / valorTotal) * 100 : (s.n / activos.length) * 100
    return {
      ...s, pct: round1(pct), tope: round1(topeSector),
      excede: pct > topeSector,
      excesoUSD: hayPesos && pct > topeSector
        ? Math.round((pct - topeSector) / 100 * valorTotal) : null,
    }
  }).sort((a, b) => b.pct - a.pct)

  // ── Composición por clase ────────────────────────────────────────────────
  const clases = ['core', 'growth', 'especulativo'].map(k => {
    const del = activos.filter(a => a.clase === k)
    const pct = hayPesos
      ? del.reduce((acc, a) => acc + (a.peso || 0), 0)
      : (del.length / activos.length) * 100
    return { clase: k, n: del.length, pct: round1(pct) }
  }).filter(c => c.n > 0)

  return {
    hayPesos,
    perfil,
    valorTotal: hayPesos ? Math.round(valorTotal) : null,
    pesoEquiponderado: round1(pesoEquiponderado),
    topeGeneral: round1(topeGeneral),
    conPeso: conValor.length,
    sinPeso: validos.length - conValor.length,
    activos,
    sectores,
    clases,
    porTicker: Object.fromEntries(activos.map(a => [a.ticker, a])),
  }
}
