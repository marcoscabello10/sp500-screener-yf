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
// ⚠️ `maxArgentina` — el tope que ningun tope de sector puede poner.
//
// Los ADR argentinos estan repartidos entre Financials (GGAL, BMA, BBAR,
// SUPV), Energy (YPF, VIST, TGS), Utilities (PAM, CEPU, EDN), Materials
// (LOMA, TS), Communication Services (TEO) y Real Estate (IRS, CRESY). Cada
// uno entra comodo en su tope de posicion y ninguno satura su sector, asi que
// una cartera puede terminar 40% argentina sin que ninguna regla se queje.
//
// Pero no son quince apuestas: son una. Cuando el pais se mueve, se mueven
// todos, y eso no lo captura ni el sector ni —bien— la correlacion historica,
// porque el periodo de calma la subestima justo antes de que importe.
//
// Los numeros los definio Marcos (02/09/2026). No son de mercado: son el techo
// que quiere que el plan respete. La lista de que papeles cuentan vive en
// `cedears_informe.ARGENTINA` y viaja en el dato (`riesgo_pais`), no duplicada
// acá: una lista en dos lenguajes se desincroniza.
export const PERFILES = {
  conservador: {
    clave: 'conservador', nombre: 'Conservador',
    maxPosicion: 8, maxSector: 25, maxArgentina: 10, factorEquiponderado: 1.4,
    resumen: 'Prioriza no perder. Tolera menos concentración y menos papeles ' +
             'especulativos.',
  },
  moderado: {
    clave: 'moderado', nombre: 'Moderado',
    maxPosicion: 12, maxSector: 35, maxArgentina: 20, factorEquiponderado: 1.8,
    resumen: 'Equilibrio entre crecimiento y control del riesgo.',
  },
  agresivo: {
    clave: 'agresivo', nombre: 'Agresivo',
    maxPosicion: 20, maxSector: 45, maxArgentina: 30, factorEquiponderado: 2.5,
    resumen: 'Acepta posiciones grandes y concentración sectorial a cambio de ' +
             'más crecimiento.',
  },
}
export const PERFIL_POR_DEFECTO = 'moderado'

// ─────────────────────────────────────────────────────────────────────────────
// CUÁNTO RIESGO TOLERA CADA PERFIL
//
// ⚠️ EL AGUJERO QUE ESTO TAPA (31/08/2026, lo encontró Marcos)
// `afinidad()` repesaba los cinco bloques de señales según el OBJETIVO (renta /
// equilibrado / crecimiento) y el HORIZONTE… y **nunca miraba el PERFIL**. O
// sea: la única variable que expresa cuánto riesgo tolera el cliente no entraba
// en el número que dice "¿esto le sirve a ESTE cliente?".
//
// El resultado que lo delató: **RGTI le salía con alta afinidad a una cartera
// conservadora.** Es un papel especulativo de beta altísima. La función medía
// "¿es buena para este objetivo?" y no "¿es apropiada para esta tolerancia?",
// que son dos preguntas y solo una estaba contestada.
//
// Los números son un JUICIO declarado, no una ley de mercado. Están acá arriba
// y con nombre justamente para poder discutirlos.
// ─────────────────────────────────────────────────────────────────────────────
// Techo del castigo por beta. Es el único de los tres que puede crecer sin
// límite (la beta no tiene tope), así que sin esto se comía a los otros dos.
export const CASTIGO_BETA_MAXIMO = 30

export const TOLERANCIA = {
  conservador: {
    // Beta a partir de la cual el papel empieza a "pasarse" para este perfil.
    betaTolerada: 0.95,
    // Cuántos puntos de afinidad cuesta cada 0,1 de beta por encima.
    castigoPorBeta: 3.5,
    // Un especulativo en una cartera conservadora no es "un poco peor": es
    // otra categoría de producto. El castigo es grande a propósito.
    castigoEspeculativo: 25,
    castigoGrowth: 6,
    // Cada bandera roja del activo.
    castigoPorBandera: 8,
    // Por debajo de esto la afinidad se marca como incompatible, no solo baja.
    corteIncompatible: 40,
  },
  moderado: {
    betaTolerada: 1.20, castigoPorBeta: 2.0, castigoEspeculativo: 10,
    castigoGrowth: 0, castigoPorBandera: 5, corteIncompatible: 30,
  },
  agresivo: {
    // Un perfil agresivo NO premia el riesgo: lo tolera. Por eso el castigo
    // baja mucho pero no llega a cero — beta 2,5 sigue siendo beta 2,5.
    betaTolerada: 1.60, castigoPorBeta: 1.0, castigoEspeculativo: 0,
    castigoGrowth: 0, castigoPorBandera: 3, corteIncompatible: 20,
  },
}

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
// ─────────────────────────────────────────────────────────────────────────────
// EL RESTO DE LA CARTERA — lo que el informe no puede analizar pero sí pesar
//
// El problema, que Marcos vio antes de que pasara: si sube 5 CEDEARs que son la
// mitad de la cartera del cliente, y el peso se calcula dividiendo por la suma
// de esos 5, **cada peso sale al doble**. El informe dice "AAPL pesa 22%" y en
// la cartera real pesa 11%. Nada avisa: los porcentajes suman 100 y parecen
// correctos.
//
// Hay tres formas de saber cuánto pesa de verdad, y se prueban en este orden:
//
//   1. `% Posición` del Excel (`pctExcel`). Es la mejor: viene del reporte del
//      broker, ya está calculada sobre la cartera completa y no se desactualiza
//      con el precio. F5 ya la parsea y ya llegaba hasta acá sin usarse.
//   2. Los montos del resto (renta fija, acciones locales, efectivo). Precisos,
//      pero envejecen: si una posición se movió, el total ya no cierra.
//   3. Los porcentajes del resto. Menos exactos que los montos pero más
//      estables, que es justo lo que Marcos señaló.
//
// Si no hay ninguna, se reparte el 100% entre lo analizado **y el documento lo
// dice**. Un porcentaje sin denominador declarado no es un dato, es una trampa.
// ─────────────────────────────────────────────────────────────────────────────

export const CLASES_RESTO = [
  { clave: 'rentaFija', nombre: 'Renta fija', riesgo: 'bajo' },
  { clave: 'accionesLocales', nombre: 'Acciones argentinas', riesgo: 'alto' },
  { clave: 'efectivo', nombre: 'Efectivo', riesgo: 'nulo' },
]

// Cuánta renta variable tolera cada perfil, sobre la cartera COMPLETA.
// Acciones del exterior + acciones locales. La renta fija y el efectivo no
// cuentan.
export const TOPE_RENTA_VARIABLE = {
  conservador: 50, moderado: 70, agresivo: 90,
}

export const ORIGEN_PESOS = {
  excel: 'la columna "% Posición" del Excel',
  montos: 'los montos del resto de la cartera',
  porcentajes: 'los porcentajes del resto de la cartera',
  parcial: 'solo los activos analizados',
}

/**
 * Resuelve el denominador de los pesos y cuánto de la cartera cubre el informe.
 *
 * Devuelve { origen, cobertura, pesoDe(ticker, valor), resto: [...] }
 * donde `cobertura` es el % de la cartera que representan los activos
 * analizados. 100 significa "esto es toda la cartera".
 */
function resolverBase(posiciones, valorAnalizado, otros) {
  const pos = posiciones || {}
  // Ojo: NO se mira `pctActual`. Ese lo calcula F5 dividiendo por la suma de lo
  // que subiste, o sea que ya viene con el mismo error que estamos corrigiendo.
  // El que sirve es `pctExcel`, que es lo que escribiste vos en el Excel.
  const conPct = Object.values(pos).filter(
    p => p && Number.isFinite(p.pctExcel) && p.pctExcel > 0)
  const pctExcelTotal = conPct.reduce((a, p) => a + p.pctExcel, 0)
  const conValor = Object.values(pos).filter(p => p && p.valorActual > 0).length

  // 1. La columna del Excel, si cubre a la mayoría de las posiciones.
  if (conPct.length && conPct.length >= conValor * 0.6 && pctExcelTotal > 0
      && pctExcelTotal <= 100.5) {
    return {
      origen: 'excel',
      cobertura: Math.min(100, Math.round(pctExcelTotal * 10) / 10),
      pesoDe: (t, v) => (Number.isFinite(pos[t]?.pctExcel) ? pos[t].pctExcel : null),
      resto: [],
    }
  }

  const o = otros || {}
  const clavesConDato = CLASES_RESTO.filter(c => Number.isFinite(o[c.clave]) && o[c.clave] > 0)

  // 2. Montos del resto.
  if (o.modo === 'monto' && clavesConDato.length && valorAnalizado > 0) {
    const sumaResto = clavesConDato.reduce((a, c) => a + o[c.clave], 0)
    const total = valorAnalizado + sumaResto
    return {
      origen: 'montos',
      cobertura: Math.round(valorAnalizado / total * 1000) / 10,
      valorTotalCartera: Math.round(total),
      pesoDe: (t, v) => (v > 0 ? v / total * 100 : null),
      resto: clavesConDato.map(c => ({
        ...c, monto: Math.round(o[c.clave]),
        pct: Math.round(o[c.clave] / total * 1000) / 10,
      })),
    }
  }

  // 3. Porcentajes del resto.
  if (o.modo === 'pct' && clavesConDato.length && valorAnalizado > 0) {
    const sumaResto = clavesConDato.reduce((a, c) => a + o[c.clave], 0)
    if (sumaResto < 100) {
      const cobertura = Math.round((100 - sumaResto) * 10) / 10
      return {
        origen: 'porcentajes',
        cobertura,
        // El total implícito: si lo analizado vale X y es el `cobertura`%,
        // la cartera entera vale X / (cobertura/100).
        valorTotalCartera: Math.round(valorAnalizado / (cobertura / 100)),
        pesoDe: (t, v) => (v > 0 ? v / valorAnalizado * cobertura : null),
        resto: clavesConDato.map(c => ({
          ...c, pct: Math.round(o[c.clave] * 10) / 10,
          monto: Math.round(o[c.clave] / 100 * (valorAnalizado / (cobertura / 100))),
        })),
      }
    }
  }

  // 4. Sin nada: se reparte entre lo analizado, y se avisa.
  return {
    origen: 'parcial',
    cobertura: 100,
    pesoDe: (t, v) => (v > 0 && valorAnalizado > 0 ? v / valorAnalizado * 100 : null),
    resto: [],
  }
}

/**
 * Exposición por clase de activo y cuánto habría que mover para encajar con el
 * perfil. Es la respuesta a "cuánto rotar de cada cosa".
 */
export function exposicion(cart) {
  const { base, perfil, activos, valorTotalCartera } = cart
  if (!base || base.origen === 'parcial') return null

  const exterior = activos.reduce((a, x) => a + (x.peso || 0), 0)
  const locales = (base.resto.find(r => r.clave === 'accionesLocales') || {}).pct || 0
  const variable = Math.round((exterior + locales) * 10) / 10
  const tope = TOPE_RENTA_VARIABLE[perfil.clave] ?? 70
  const exceso = Math.round((variable - tope) * 10) / 10

  return {
    exterior: Math.round(exterior * 10) / 10,
    locales: Math.round(locales * 10) / 10,
    variable,
    tope,
    excede: variable > tope,
    excesoPct: exceso > 0 ? exceso : null,
    excesoUSD: (exceso > 0 && valorTotalCartera)
      ? Math.round(exceso / 100 * valorTotalCartera) : null,
    // El caso contrario también importa: un perfil agresivo con 30% en acciones
    // no está "seguro", está desalineado con lo que el cliente pidió.
    corto: variable < tope * 0.6,
    faltaUSD: (variable < tope * 0.6 && valorTotalCartera)
      ? Math.round((tope * 0.6 - variable) / 100 * valorTotalCartera) : null,
  }
}

export function analizarCartera(informes, posiciones, perfilClave,
                                objetivoClave, horizonteClave, otros) {
  const perfil = PERFILES[perfilClave] || PERFILES[PERFIL_POR_DEFECTO]
  const validos = (informes || []).filter(i => i && !i.error)
  const pos = posiciones || {}

  const conValor = validos.filter(i => (pos[i.ticker]?.valorActual) > 0)
  const valorTotal = conValor.reduce((a, i) => a + pos[i.ticker].valorActual, 0)
  const hayPesos = conValor.length > 0 && valorTotal > 0

  // De acá sale el DENOMINADOR de los pesos. Sin esto, dividir por la suma de
  // lo analizado convierte una cartera parcial en una cartera entera.
  const base = resolverBase(pos, valorTotal, otros)

  const n = validos.length || 1
  // El ancla equiponderada se escala por la cobertura: si 5 posiciones son el
  // 48% de la cartera, equiponderado es 9,6% cada una, no 20%. Sin esta
  // corrección los topes quedarian al doble y no marcarian nada.
  const pesoEquiponderado = base.cobertura / n
  const topeGeneral = Math.max(perfil.maxPosicion,
                               perfil.factorEquiponderado * pesoEquiponderado)

  const activos = validos.map(i => {
    const p = pos[i.ticker] || {}
    const clase = clasificar(i)
    const topeClase = topeGeneral * TOPE_POR_CLASE[clase]
    // El peso se recalcula sobre el total de lo que efectivamente tiene valuación,
    // no se confía en el pctActual guardado: si la cartera se generó con más
    // activos de los que entraron al informe, ese porcentaje no cierra a 100.
    const peso = hayPesos ? base.pesoDe(i.ticker, p.valorActual) : null

    let estado = null
    if (peso != null) {
      if (peso > topeClase * 1.5) estado = 'critico'
      else if (peso > topeClase) estado = 'sobre'
      else if (peso < pesoEquiponderado / 3) estado = 'sub'
      else estado = 'banda'
    }

    const etiqueta = i.veredicto?.etiqueta
    const excesoPct = (peso != null && peso > topeClase) ? peso - topeClase : null
    // ⚠️ EL PERFIL VIAJA. Sin este cuarto argumento la afinidad ignoraba la
    // tolerancia al riesgo del cliente, que es justo lo que la hace distinta
    // del puntaje fundamental.
    const fitDet = afinidadDetalle(i, objetivoClave, horizonteClave, perfilClave)
    const fit = fitDet ? fitDet.score : null
    // ⚠️ Se llamaba `base` y TAPABA al `base` de afuera (el que resuelve el
    // denominador de los pesos) durante todo el callback — incluida la linea
    // de arriba, que quedaba leyendo una constante todavia sin inicializar.
    // Es el MISMO bug de shadowing que ya paso en probe_edgar.py: una variable
    // corta reusada en dos alcances anidados.
    const puntajeBase = i.veredicto?.puntaje ?? null
    return {
      ticker: i.ticker,
      beta: i.consenso?.beta ?? null,
      // Afinidad con el objetivo: los MISMOS bloques, otra balanza. Va al lado
      // del puntaje fundamental, nunca en lugar de el.
      afinidad: fit,
      // La cuenta a la vista: cuanto salio del objetivo y cuanto se descontó
      // por riesgo, con el motivo de cada descuento.
      afinidadDetalle: fitDet,
      // Cuanto cambia la lectura al mirarla con el objetivo puesto. Si la
      // diferencia es grande, el informe lo dice: significa que la empresa es
      // buena pero para otra cosa.
      brechaObjetivo: (fit != null && puntajeBase != null)
        ? round1(fit - puntajeBase) : null,
      nombre: i.nombre,
      sector: i.sector || null,
      // El nivel FINO. Puede venir null y eso NO es lo mismo que "no tiene":
      // es "todavia no lo sabemos". Se distingue en `concentracionPorIndustria`.
      industry: i.industry || null,
      // ── Las dos marcas que vienen del bot ────────────────────────────────
      // `riesgoPais` agrupa lo que el sector no agrupa (ver `maxArgentina`).
      // `soloMedible` dice que este papel cotiza en pesos: se puede tener y
      // mostrar, pero no puntuar contra el resto ni medir su riesgo.
      riesgoPais: i.riesgo_pais || null,
      soloMedible: !!i.solo_medible,
      moneda: i.moneda || 'USD',
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
    // Sobre la cartera COMPLETA, igual que los pesos por posición: un sector
    // que es el 40% de lo analizado pero el 19% de la cartera no es un problema
    // de concentración.
    // ⚠️ CUANDO NO HAY MONTOS, ESTO NO ES UN PESO
    // Sin importes cargados el porcentaje se calcula por CANTIDAD de papeles:
    // "3 de 5 posiciones son Technology" = 60%. Eso NO es exposición.
    //
    // Y hasta ahora salía al informe como `pct` con `excede: true`, sin ninguna
    // marca. Una cartera con tres tecnológicas de 2% cada una aparecía como
    // "Technology excede el 35%" — una alarma falsa, y el modelo no tenía cómo
    // darse cuenta. `denominador` existe para que quien lo lea sepa qué está
    // mirando; sin él, todo porcentaje se lee como plata.
    const pct = hayPesos
      ? activos.filter(a => (a.sector || 'Sin sector') === s.sector)
               .reduce((acc, a) => acc + (a.peso || 0), 0)
      : (s.n / activos.length) * 100
    return {
      ...s, pct: round1(pct), tope: round1(topeSector),
      denominador: hayPesos ? 'valor de la cartera' : 'cantidad de posiciones',
      // Un exceso "por cantidad" no es un exceso de exposición: no se marca.
      excede: hayPesos && pct > topeSector,
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
    return { clase: k, n: del.length, pct: round1(pct),
             denominador: hayPesos ? 'valor de la cartera' : 'cantidad de posiciones' }
  }).filter(c => c.n > 0)

  return {
    hayPesos,
    base,
    cobertura: base.cobertura,
    origenPesos: base.origen,
    // Cuando la cartera esta cubierta solo en parte, el documento tiene que
    // decirlo: si no, muestra porcentajes que suman 100 sobre un universo que
    // no es la cartera del cliente.
    parcial: base.origen === 'parcial' ? null : base.cobertura < 99.5,
    valorTotalCartera: base.valorTotalCartera
      ?? (hayPesos && base.cobertura > 0
          ? Math.round(valorTotal / (base.cobertura / 100)) : null),
    perfil,
    objetivo: OBJETIVOS[objetivoClave] || OBJETIVOS[OBJETIVO_POR_DEFECTO],
    horizonte: HORIZONTES[horizonteClave] || HORIZONTES[HORIZONTE_POR_DEFECTO],
    valorTotal: hayPesos ? Math.round(valorTotal) : null,
    pesoEquiponderado: round1(pesoEquiponderado),
    topeGeneral: round1(topeGeneral),
    conPeso: conValor.length,
    sinPeso: validos.length - conValor.length,
    activos,
    sectores,
    clases,
    // ── El riesgo pais, medido igual que un sector ────────────────────────
    // Se calcula acá y no en `riesgo.js` por el mismo motivo que el tope de
    // sector: es un numero que el informe MUESTRA, y si cada lado lo
    // recalculara, la tabla y el objetivo podrian discrepar. `riesgo.js` lo
    // recibe y lo respeta; no lo vuelve a pensar.
    argentina: (() => {
      const suyos = activos.filter(a => a.riesgoPais === 'argentina')
      if (!suyos.length) return null
      const pct = hayPesos
        ? suyos.reduce((acc, a) => acc + (a.peso || 0), 0)
        : (suyos.length / activos.length) * 100
      const tope = perfil.maxArgentina ?? null
      return {
        pct: round1(pct),
        tope,
        n: suyos.length,
        tickers: suyos.map(a => a.ticker),
        // El mismo denominador que los sectores: sin montos esto es un
        // CONTEO, y un conteo leido como exposicion es una alarma falsa.
        denominador: hayPesos ? 'valor de la cartera' : 'cantidad de posiciones',
        excede: hayPesos && tope != null && pct > tope,
        excesoUSD: hayPesos && tope != null && pct > tope
          ? Math.round((pct - tope) / 100 * valorTotal) : null,
      }
    })(),
    porTicker: Object.fromEntries(activos.map(a => [a.ticker, a])),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 2 — PARA QUÉ ES ESTA CARTERA
//
// El veredicto de cada empresa es el mismo para todos: no sabe si quien la
// tiene busca renta o crecimiento. Y no debería saberlo — el endpoint cachea
// `action=datos` por ticker, así que si el puntaje dependiera del objetivo de
// la cartera, el caché estaría mal la mitad de las veces.
//
// Por eso el ajuste por objetivo se hace ACÁ, en el navegador, repesando los
// bloques que el endpoint ya devolvió. El puntaje fundamental queda intacto y
// al lado aparece el de afinidad. Son dos números que responden dos preguntas:
//   "¿es buena empresa?"  y  "¿es buena PARA ESTO?"
// ─────────────────────────────────────────────────────────────────────────────

export const OBJETIVOS = {
  renta: {
    clave: 'renta', nombre: 'Renta',
    resumen: 'El objetivo es el flujo de dividendos. Pesa más lo que paga y ' +
             'la solidez para seguir pagándolo.',
    pesos: { valuacion: 1, crecimiento: 0.5, salud_financiera: 1.5, dividendos: 2.5, consenso: 0.75 },
  },
  equilibrado: {
    clave: 'equilibrado', nombre: 'Equilibrado',
    resumen: 'Sin preferencia declarada: todos los bloques pesan igual.',
    pesos: { valuacion: 1, crecimiento: 1, salud_financiera: 1, dividendos: 1, consenso: 1 },
  },
  crecimiento: {
    clave: 'crecimiento', nombre: 'Crecimiento',
    resumen: 'El objetivo es que el capital crezca. El dividendo casi no ' +
             'cuenta; el crecimiento de ingresos manda.',
    pesos: { valuacion: 0.75, crecimiento: 2.5, salud_financiera: 0.75, dividendos: 0.25, consenso: 1 },
  },
}
export const OBJETIVO_POR_DEFECTO = 'equilibrado'

// El horizonte mueve poco a propósito. Un modelo que cambiara mucho el puntaje
// según si mirás a 2 o a 7 años estaría fingiendo una precisión que los datos
// no dan. Lo que sí cambia de verdad es QUÉ RIESGOS son relevantes: a dos años
// la volatilidad importa; a diez, importa que el negocio crezca.
export const HORIZONTES = {
  corto: {
    clave: 'corto', nombre: 'Menos de 2 años',
    ajuste: { crecimiento: 0.7, consenso: 1.3 },
    riesgosRelevantes: ['volatilidad', 'lejos_del_maximo', 'short_alto'],
    nota: 'A menos de dos años, la volatilidad y el ánimo del mercado pesan ' +
          'más que el crecimiento de largo plazo: no hay tiempo para que una ' +
          'tesis de años se cumpla.',
  },
  medio: {
    clave: 'medio', nombre: '2 a 5 años',
    ajuste: {},
    riesgosRelevantes: ['trampa_valor', 'dilucion_fuerte', 'volatilidad'],
    nota: 'A cinco años hay tiempo para que el negocio se note, pero no tanto ' +
          'como para ignorar una caída fuerte en el medio.',
  },
  largo: {
    clave: 'largo', nombre: 'Más de 5 años',
    ajuste: { crecimiento: 1.4, consenso: 0.7 },
    riesgosRelevantes: ['trampa_valor', 'dilucion_fuerte', 'upside_sin_ganancias'],
    nota: 'A más de cinco años el precio objetivo de los analistas —que mira a ' +
          '12 meses— dice poco, y la dilución y el crecimiento real dicen casi ' +
          'todo.',
  },
}
export const HORIZONTE_POR_DEFECTO = 'medio'

/**
 * Afinidad con el objetivo: los MISMOS bloques que calculó el endpoint,
 * repesados. No se inventa ningún dato nuevo — se los mira con otra balanza.
 *
 * Devuelve null si no hay bloques con puntaje: mejor no decir nada que dar un
 * número construido sobre aire.
 */
export function afinidad(inf, objetivoClave, horizonteClave, perfilClave) {
  const d = afinidadDetalle(inf, objetivoClave, horizonteClave, perfilClave)
  return d ? d.score : null
}

/**
 * La afinidad, pero mostrando la cuenta.
 *
 * Devuelve el puntaje del OBJETIVO, el castigo por RIESGO y el motivo de cada
 * descuento. El detalle no es un lujo: un número que baja de 71 a 38 sin decir
 * por qué es indistinguible de un error, y lo primero que hace quien lo lee es
 * desconfiar de todo el informe.
 */
export function afinidadDetalle(inf, objetivoClave, horizonteClave, perfilClave) {
  const obj = OBJETIVOS[objetivoClave] || OBJETIVOS[OBJETIVO_POR_DEFECTO]
  const hor = HORIZONTES[horizonteClave] || HORIZONTES[HORIZONTE_POR_DEFECTO]
  let suma = 0, pesos = 0
  for (const s of inf?.senales || []) {
    if (s.puntaje == null) continue
    const w = (obj.pesos[s.bloque] ?? 1) * (hor.ajuste[s.bloque] ?? 1)
    if (w <= 0) continue
    suma += s.puntaje * w
    pesos += w
  }
  if (!pesos) return null
  const base = (suma / pesos)

  // ── El castigo por riesgo, que es lo que faltaba ─────────────────────────
  const tol = TOLERANCIA[perfilClave] || TOLERANCIA[PERFIL_POR_DEFECTO]
  const clase = clasificar(inf)
  const beta = inf?.consenso?.beta
  const banderas = (inf?.riesgos || []).filter(r => r.severidad === 'alta').length
  const motivos = []
  let castigo = 0

  if (beta != null && beta > tol.betaTolerada) {
    const exceso = beta - tol.betaTolerada
    // ⚠️ CON TECHO. Sin él, una beta de 2,6 contra una tolerancia de 0,95 daba
    // 57,8 puntos de castigo: se llevaba puesto el puntaje entero, aplastaba a
    // los otros dos motivos y el resultado quedaba clavado en 0. Un 0 no
    // distingue "inapropiado" de "catastrófico", y perder esa diferencia hace
    // que el número deje de servir para ordenar.
    // El techo mantiene los tres castigos en escalas comparables.
    const c = Math.min(CASTIGO_BETA_MAXIMO, (exceso / 0.1) * tol.castigoPorBeta)
    castigo += c
    motivos.push({ codigo: 'beta', puntos: round1(c),
                   texto: `beta ${round1(beta)} contra ${tol.betaTolerada} `
                        + `que tolera este perfil` })
  }
  if (clase === 'especulativo' && tol.castigoEspeculativo > 0) {
    castigo += tol.castigoEspeculativo
    motivos.push({ codigo: 'especulativo', puntos: tol.castigoEspeculativo,
                   texto: 'es un papel especulativo (poca capitalización, sin '
                        + 'ganancias o beta muy alta)' })
  }
  if (clase === 'growth' && tol.castigoGrowth > 0) {
    castigo += tol.castigoGrowth
    motivos.push({ codigo: 'growth', puntos: tol.castigoGrowth,
                   texto: 'es un papel de crecimiento, más volátil que un core' })
  }
  if (banderas > 0 && tol.castigoPorBandera > 0) {
    const c = banderas * tol.castigoPorBandera
    castigo += c
    motivos.push({ codigo: 'banderas', puntos: c,
                   texto: `${banderas} riesgo${banderas > 1 ? 's' : ''} de `
                        + `severidad alta` })
  }
  // ⚠️ Sin beta NO se asume que es tranquilo. Es el caso de los CEDEAR nuevos
  // y de los papeles recién listados, que suelen ser justo los más volátiles.
  // Se avisa en vez de premiarlos por falta de dato.
  const sinBeta = beta == null

  const score = Math.max(0, Math.min(100, base - castigo))
  return {
    score: round1(score),
    base: round1(base),
    castigo: round1(castigo),
    motivos,
    clase,
    beta: beta ?? null,
    sinBeta,
    // "Baja" y "no corresponde para este perfil" son cosas distintas. Un papel
    // puede tener afinidad 45 por ser mediocre, o 45 por ser una ruleta: la
    // segunda es una respuesta cualitativa, no un lugar en un ranking.
    incompatible: castigo > 0 && score < tol.corteIncompatible,
    perfil: (PERFILES[perfilClave] || PERFILES[PERFIL_POR_DEFECTO]).clave,
  }
}

/** Los riesgos del activo que de verdad importan para este horizonte. */
export function riesgosDelHorizonte(inf, horizonteClave) {
  const hor = HORIZONTES[horizonteClave] || HORIZONTES[HORIZONTE_POR_DEFECTO]
  return (inf?.riesgos || []).filter(r =>
    r.severidad === 'alta' || hor.riesgosRelevantes.includes(r.codigo))
}

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST (punto 19)
//
// Regla que se respeta acá: solo se calcula lo que los datos sostienen.
//
//   · "el mercado cae 20%"      -> usa beta, que está medido. Es un MODELO.
//   · los otros tres escenarios -> aritmética directa sobre los pesos, sin
//                                  modelo ni supuesto de correlación.
//
// El escenario de tasas (+100 pb) NO se calcula. Haría falta la sensibilidad de
// cada empresa a la tasa, que no está en ninguna fuente que tengamos. Poner un
// número inventado ahí sería peor que no ponerlo: se leería igual de serio.
// ─────────────────────────────────────────────────────────────────────────────

export function stressTest(cart) {
  if (!cart?.hayPesos) return null
  const { activos, valorTotal, sectores } = cart
  const conPeso = activos.filter(a => a.peso != null)
  if (!conPeso.length) return null

  const esc = []

  // 1. Mercado -20%, ponderado por beta. Único con modelo.
  const conBeta = conPeso.filter(a => a.beta != null)
  const pesoConBeta = conBeta.reduce((s, a) => s + a.peso, 0)
  if (pesoConBeta > 50) {
    const betaCartera = conBeta.reduce((s, a) => s + a.peso * a.beta, 0) / pesoConBeta
    esc.push({
      titulo: 'El mercado cae 20%',
      caidaPct: Math.round(betaCartera * -20 * 10) / 10,
      caidaUSD: Math.round(betaCartera * -0.20 * valorTotal),
      detalle: `Beta promedio de la cartera ${Math.round(betaCartera * 100) / 100}` +
               (betaCartera > 1.05 ? ': se mueve más que el mercado.'
                : betaCartera < 0.95 ? ': se mueve menos que el mercado.'
                : ': se mueve casi igual que el mercado.') +
               (pesoConBeta < 99 ? ` Calculado sobre el ${Math.round(pesoConBeta)}% de la cartera, que es la parte con beta conocida.` : ''),
      modelo: true,
    })
  }

  // 2. La posición más grande cae 30%. Aritmética pura.
  const mayor = conPeso.slice().sort((a, b) => b.peso - a.peso)[0]
  if (mayor) {
    esc.push({
      titulo: `${mayor.ticker} cae 30%`,
      caidaPct: Math.round(mayor.peso * -0.30 * 10) / 10,
      caidaUSD: Math.round(mayor.peso / 100 * -0.30 * valorTotal),
      detalle: `Es la posición más grande, con el ${Math.round(mayor.peso * 10) / 10}% de la cartera.`,
      modelo: false,
    })
  }

  // 3. El sector más pesado cae 25%.
  const sectorTop = sectores[0]
  if (sectorTop && sectorTop.pct > 15) {
    esc.push({
      titulo: `${sectorTop.sector} cae 25%`,
      caidaPct: Math.round(sectorTop.pct * -0.25 * 10) / 10,
      caidaUSD: Math.round(sectorTop.pct / 100 * -0.25 * valorTotal),
      detalle: `Es el sector más pesado, con el ${sectorTop.pct}% de la cartera.`,
      modelo: false,
    })
  }

  // 4. Todo lo especulativo cae 50%.
  const pesoEspec = conPeso.filter(a => a.clase === 'especulativo')
    .reduce((s, a) => s + a.peso, 0)
  if (pesoEspec > 0) {
    esc.push({
      titulo: 'Los especulativos caen 50%',
      caidaPct: Math.round(pesoEspec * -0.50 * 10) / 10,
      caidaUSD: Math.round(pesoEspec / 100 * -0.50 * valorTotal),
      detalle: `Pesan ${Math.round(pesoEspec * 10) / 10}% en total.`,
      modelo: false,
    })
  }

  return {
    escenarios: esc.sort((a, b) => a.caidaPct - b.caidaPct),
    noCalculado: 'Un movimiento de tasas no se estima: haría falta la ' +
                 'sensibilidad de cada empresa a la tasa, que ninguna de las ' +
                 'fuentes que usa este informe provee. Un número inventado ahí ' +
                 'se leería igual de serio que los otros, y no lo es.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE DE DATOS PARA LA TESIS DE CARTERA
//
// Acá NO se calcula nada nuevo: se junta y se renombra lo que `analizarCartera`
// y `stressTest` ya devolvieron. Ese es todo el punto del diseño — el código
// decide los números y el modelo solo los explica. Si esta función calculara
// algo, habría dos fuentes de verdad y el texto podría contradecir la tabla
// que está tres centímetros más arriba en la misma página.
//
// Las claves salen en snake_case y en castellano porque son las que el prompt
// nombra. Cambiar una acá sin cambiarla en `api/informe.py` deja al modelo
// leyendo un campo que no existe, y eso NO da error: da una tesis que ignora
// ese dato en silencio. Es exactamente lo que pasó con el pase de acentos.
// ─────────────────────────────────────────────────────────────────────────────

/** Redondeo a un decimal, tolerante a null. */
const r1 = v => (v == null || !isFinite(v)) ? null : Math.round(v * 10) / 10

// ⚠️ `scores` es OBLIGATORIO aunque el parámetro tenga default.
// `metricas_usadas` y `reemplazos` NO están en los activos de analizarCartera:
// vienen de `scoresPorSector()` en sugerencias.js, indexados por símbolo. Sin
// pasarlos, esos dos campos salen null, el modelo no sabe de qué papeles tiene
// pocos datos, y la CONFIANZA que declara deja de estar atada a nada medido.
// Y no daría ningún error: daría una tesis con confianza "alta" en todo.
export function armarDatosTesis(cart, estres, candidatos = [], scores = {},
                                riesgo = null) {
  if (!cart || !Array.isArray(cart.activos)) return null

  const exp = exposicion(cart)
  // Los campos del Motor B por ticker. Si no hay historico, no salen: NO se
  // rellenan con ceros, que se leerian como "no aporta riesgo".
  const riesgoDe = (r, sym) => {
    if (!r?.disponible) return null
    const p = (r.posiciones || []).find(x => x.ticker === sym)
    if (!p) return { sin_datos_de_riesgo: true }
    return {
      volatilidad_pct: p.volatilidad_pct,
      aporte_al_riesgo_pct: p.aporte_al_riesgo_pct,
      correlacion_media_con_la_cartera: p.correlacion_media,
      peso_objetivo_pct: p.peso_objetivo_pct,
      limitado_por_tope: p.limitado_por_tope,
    }
  }
  const cob = sym => {
    const s = scores[sym]
    if (!s || s.nUsadas == null) return { metricas: null, reemplazos: [] }
    return { metricas: `${s.nUsadas}/${s.nAplicables}`,
             reemplazos: s.reemplazos || [] }
  }
  // El peor escenario del stress test, que es el que contesta la pregunta que
  // todo cliente hace primero: "¿cuánto puedo perder?".
  const peor = (estres?.escenarios || [])[0] || null

  // ── Detalle proporcional a la decisión ──────────────────────────────────
  // Una posición que está en orden no necesita doce campos: necesita que el
  // modelo la nombre y siga. Medido sobre una cartera de 15 con el reparto
  // típico (4 accionables, 11 en orden), el bloque completo son 1.937 tokens y
  // las 11 que no requieren decisión se llevan 1.423 — el 62% del gasto en lo
  // que no hay que decidir. Comprimidas son 214.
  //
  // El criterio es explícito: se comprime solo lo que no tiene NADA que
  // discutir. Cualquier duda (una bandera, un exceso, aportar mucho más riesgo
  // que peso) manda la ficha completa.
  // ⚠️ Los estados son `critico | sobre | banda | sub` — NO "neutral"/"bajo".
  // El primer intento usó esos dos nombres, que no existen: la condición no se
  // cumplía nunca y la compresión no comprimía nada. No fallaba: simplemente
  // mandaba todo completo, como antes, sin una sola señal.
  const requiereDecision = (a, r) => {
    if (a.accion !== 'mantener') return true
    if (a.estado !== 'banda') return true
    if ((a.banderas || 0) > 0) return true
    if (a.tomaGanancia) return true
    // Aporta bastante más riesgo del que su peso sugiere: hay algo que decir
    // aunque la acción calculada sea "mantener".
    if (r && r.aporte_al_riesgo_pct != null && a.peso > 0
        && r.aporte_al_riesgo_pct > a.peso * 1.5) return true
    return false
  }

  return {
    perfil: cart.perfil?.nombre || cart.perfil?.clave || null,
    objetivo: cart.objetivo?.nombre || null,
    horizonte: cart.horizonte?.nombre || null,

    cartera: {
      valor_total_usd: cart.valorTotalCartera ?? cart.valorTotal ?? null,
      cobertura_analizada_pct: r1(cart.cobertura),
      // Si la cartera está cubierta solo en parte, el modelo TIENE que saberlo:
      // si no, habla de porcentajes que suman 100 sobre un universo que no es
      // la cartera del cliente.
      es_parcial: !!cart.parcial,
      // Los nombres salen de `exposicion()`: `variable` y `tope`, no
      // `rentaVariablePct`. Un campo mal escrito acá sale null sin avisar.
      renta_variable_pct: exp?.variable ?? null,
      tope_renta_variable_pct: exp?.tope ?? null,
      resto: (cart.base?.resto || [])
        .filter(c => c.pct > 0)
        .map(c => ({ clase: c.nombre || c.clave, pct: r1(c.pct) })),
    },

    topes: {
      por_posicion: cart.perfil?.maxPosicion ?? null,
      por_sector: cart.perfil?.maxSector ?? null,
      equiponderado: r1(cart.pesoEquiponderado),
    },

    estres: peor ? {
      peor_escenario: peor.titulo,
      caida_pct: peor.caidaPct,
      caida_usd: peor.caidaUSD,
    } : null,

    // ── LA COMPUERTA DE DATOS ────────────────────────────────────────────
    // Va PRIMERO en el payload a proposito: es lo que decide con cuanta
    // confianza se puede escribir todo lo demas. ~60 tokens, y evita el error
    // mas caro que puede cometer este informe — sonar seguro sobre una cartera
    // de la que sabemos la mitad.
    datos: (() => {
      const s = suficienciaDeDatos(cart, riesgo, scores)
      if (!s) return null
      return {
        nivel: s.nivel,
        puede_decidir: s.puede_decidir,
        con_reservas: s.con_reservas,
        // Solo lo accionable: la lista de frases prohibidas. Los detalles de
        // cada hueco ya viajan en `riesgo`, `cartera` y `posiciones`.
        no_se_puede_afirmar: s.no_se_puede_afirmar,
      }
    })(),

    // El riesgo pais, si lo hay. Son ~8 tokens y sin esto el modelo no puede
    // explicar por que se recorta un papel que esta perfecto dentro de su
    // sector y dentro de su tope de posicion.
    argentina: cart.argentina,

    // El nivel FINO de la concentracion. Solo viajan las industrias que son un
    // hallazgo (2+ papeles pesando >= 15%), no las 12 filas: el modelo no
    // necesita el listado, necesita saber donde hay una sola apuesta con
    // varios nombres.
    industrias: (() => {
      const ind = concentracionPorIndustria(cart)
      if (!ind || !ind.confiable) {
        return ind ? { disponible: false,
                       motivo: `solo ${ind.cobertura_pct}% de las posiciones `
                             + `traen industria`,
                       sin_dato: ind.sin_dato } : null
      }
      return {
        disponible: true,
        cobertura_pct: ind.cobertura_pct,
        sin_dato: ind.sin_dato,
        concentradas: ind.concentradas.map(g => ({
          industria: g.industry, sector: g.sector,
          pct: g.pct, denominador: g.denominador, tickers: g.tickers,
        })),
      }
    })(),

    sectores: (cart.sectores || [])
      .filter(s => s.pct > 0)
      .map(s => ({
        sector: s.sector, pct: r1(s.pct), tope: r1(s.tope),
        // El denominador viaja SIEMPRE. Un porcentaje sin denominador se lee
        // como exposición aunque sea un conteo, y ahí nace la alarma falsa.
        denominador: s.denominador,
        excede: !!s.excede, exceso_usd: s.excesoUSD ?? null,
      })),

    posiciones: (cart.activos || []).map(a => {
      const r = riesgoDe(riesgo, a.ticker)
      // Las que están en orden van en formato corto, con lo justo para que el
      // modelo las nombre en su línea: quién es, cuánto pesa, cuánto debería,
      // cuánto riesgo aporta y qué hacer.
      if (!requiereDecision(a, r)) {
        return {
          ticker: a.ticker,
          // ⚠️ El NOMBRE viaja aunque la ficha vaya comprimida. La seccion
          // "Para el cliente" se escribe con nombres de empresa —"Wells Fargo",
          // no "WFC"— y sin este campo el modelo no los tiene: no puede
          // deducirlos del ticker. Son ~3 tokens por posicion y son la
          // diferencia entre un texto que se le manda a un cliente y una
          // planilla.
          nombre: a.nombre,
          sector: a.sector,
          peso_pct: r1(a.peso), tope_pct: r1(a.topeClase),
          puntaje_fundamental: a.puntajeFundamental,
          metricas_usadas: cob(a.ticker).metricas,
          accion_calculada: a.accion,
          ...(r ? { aporte_al_riesgo_pct: r.aporte_al_riesgo_pct,
                    peso_objetivo_pct: r.peso_objetivo_pct } : {}),
          en_orden: true,
        }
      }
      return {
      ticker: a.ticker,
      nombre: a.nombre,
      sector: a.sector,
      clase: a.clase,
      puntaje_fundamental: a.puntajeFundamental,
      afinidad_objetivo: a.afinidad,
      banderas_altas: a.banderas,
      // Cobertura de datos: es lo que ata la CONFIANZA que el modelo declara a
      // algo medido, en vez de a lo convencido que suene. Sin esto, "confianza
      // alta" vuelve siempre.
      metricas_usadas: cob(a.ticker).metricas,
      reemplazos: cob(a.ticker).reemplazos,
      peso_pct: r1(a.peso),
      tope_pct: r1(a.topeClase),
      estado: a.estado,
      exceso_pct: r1(a.excesoPct),
      exceso_usd: a.excesoUSD ?? null,
      // Para poder expresar el recorte en ACCIONES ENTERAS: no se venden
      // fracciones, y "recortar USD 40" de un papel de USD 500 no se opera.
      acciones: a.cantidad ?? null,
      ganancia_pct: r1(a.gananciaPct),
      accion_calculada: a.accion,
      toma_ganancia: !!a.tomaGanancia,
      beta: a.beta,
      // ── MOTOR B: lo que la posicion le hace a la CARTERA, no a si misma ──
      // Sin esto el informe solo sabia decir "excede el tope". Con esto puede
      // decir "pesa 30% pero aporta el 60% del riesgo", que es otra cosa.
      ...(r || {}),
      en_orden: false,
    }}),

    // Los candidatos, con lo que le APORTAN A ESTA CARTERA cuando se puede
    // medir. Sin el delta de volatilidad, el unico criterio era el puntaje
    // fundamental — y medido, eso elegia la PEOR de cuatro opciones.
    candidatos: (candidatos || []).map(c => {
      const r = riesgo?.disponible
        ? (riesgo.candidatos || []).find(x => x.ticker === c.ticker) : null
      return {
        ticker: c.ticker, nombre: c.nombre, sector: c.sector,
        puntaje: c.puntaje, metricas: c.metricas,
        // Sin esto el modelo solo podia ordenar por puntaje fundamental, que
        // no sabe nada de riesgo: una cartera con 33% de volatilidad recibia
        // las mismas sugerencias que una tranquila.
        beta: c.beta ?? null,
        defensivo: !!c.defensivo,
        sector_nuevo: !!c.sector_nuevo,
        ...(r ? { volatilidad_pct: r.volatilidad,
                  correlacion_media_con_la_cartera: r.correlacion_media,
                  delta_volatilidad_cartera: r.delta_volatilidad,
                  // Lo que convierte "este papel es bueno" en una ORDEN:
                  // cuanto mejor queda la cartera si la plata del recorte va
                  // ACA en vez de agrandar lo que ya hay.
                  peso_si_entra_pct: r.peso_si_entra_pct,
                  volatilidad_si_entra_pct: r.volatilidad_si_entra_pct,
                  mejora_vs_plan_pts: r.mejora_vs_plan_pts } : {}),
      }
    }),

    // ── Riesgo del conjunto ─────────────────────────────────────────────────
    riesgo: riesgo?.disponible ? {
      volatilidad_cartera_pct: riesgo.volatilidad_cartera_pct,
      volatilidad_si_se_llega_al_objetivo_pct: riesgo.volatilidad_si_objetivo_pct,
      ventana_dias: riesgo.ventana_dias,
      // Si no todas las posiciones tienen historico, la volatilidad es la del
      // pedazo que si lo tiene. Se dice.
      cobertura_del_calculo_pct: riesgo.cobertura_pct,
      posiciones_sin_datos: (riesgo.sin_datos || []).map(s => s.ticker),
      topes_insuficientes: riesgo.topes_insuficientes,
      // Capa 3: contra que se compara todo esto. Sin benchmark, "rinde 12% con
      // 16% de volatilidad" no se puede juzgar.
      benchmark: riesgo.benchmark,
      // Por que se recorta un papel que, mirado solo, estaba dentro de su tope.
      // Sin esto el objetivo baja cuatro bancos y no hay forma de explicarlo.
      grupos_limitantes: riesgo.grupos_limitantes,
      // La "concentracion tematica": pares que se mueven juntos y por lo tanto
      // son UNA apuesta con dos nombres. No lo muestra ninguna tabla de pesos
      // por sector, porque pueden estar en sectores distintos.
      pares_que_son_una_apuesta: riesgo.pares_correlacionados,
    } : { disponible: false, motivo: riesgo?.motivo || 'no se calculo' },

    // ── El plan, ya en numeros operables ────────────────────────────────────
    // EL MISMO objeto que se dibuja en la tabla del informe. Van solo los
    // movimientos (las que quedan como estan ya viajan en `posiciones`), asi
    // que cuesta poco y le saca al modelo la unica cuenta que podria hacer mal:
    // cuanto mover. Su trabajo es el ORDEN y el porque, no la aritmetica.
    plan: (() => {
      const pl = planDePesos(cart, riesgo)
      if (!pl) return null
      return {
        umbral_pp: pl.umbralPP,
        // ⚠️ EL PLAN SOLO REPARTE ENTRE LO QUE YA ESTA. Estas son las entradas
        // NUEVAS que lo mejoran, medidas con la misma matriz. Sin esto el
        // modelo solo podia recomendar agrandar posiciones existentes.
        // Una opcion por sector, los 3 mejores. Filtradas por mejora medible y
        // ordenadas por el puntaje del screener.
        menu_por_sector: pl.menu.map(c => ({
          ticker: c.ticker, nombre: c.nombre, sector: c.sector, puntaje: c.puntaje,
          metricas: c.metricas, beta: c.beta, defensivo: c.defensivo,
          entra_con_pct: c.peso_si_entra_pct,
          volatilidad_resultante_pct: c.volatilidad_si_entra_pct,
          mejor_que_el_plan_en_puntos: c.mejora_vs_plan_pts,
          correlacion_con_la_cartera: c.correlacion_media,
        })),
        // Si esto es verdadero, "comprar mas de lo que ya tenes" NO es una
        // opcion: todas las compras del plan caen en sectores que ya tocan su
        // techo, asi que la plata tiene que salir del sector.
        refuerzo_interno_bloqueado: pl.refuerzoBloqueado,
        entradas_nuevas: pl.entradas.map(c => ({
          ticker: c.ticker, nombre: c.nombre, sector: c.sector,
          entra_con_pct: c.peso_si_entra_pct,
          volatilidad_resultante_pct: c.volatilidad_si_entra_pct,
          mejor_que_el_plan_en_puntos: c.mejora_vs_plan_pts,
          correlacion_con_la_cartera: c.correlacion_media,
        })),
        volatilidad_actual_pct: pl.volActual,
        volatilidad_si_se_ejecuta_pct: pl.volObjetivo,
        mejora_puntos: pl.mejoraVol,
        comprar_usd: pl.comprarUSD,
        vender_usd: pl.venderUSD,
        movimientos: pl.filas
          .filter(f => f.movimiento !== 'mantener')
          .map(f => ({
            ticker: f.ticker,
            movimiento: f.movimiento,
            de_pct: f.peso, a_pct: f.objetivo, delta_pp: f.delta,
            monto_usd: f.montoUSD, acciones: f.acciones,
            aporte_al_riesgo_pct: f.aporteRiesgo,
            limitado_por_tope: f.limitadoPorTope,
            // Si es true, este refuerzo NO se puede recomendar: su sector ya
            // toca el techo y agrandar adentro no diversifica nada.
            refuerzo_en_sector_al_tope: f.refuerzoEnSectorAlTope,
          })),
      }
    })(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCENTRACIÓN POR INDUSTRIA — lo que el sector no muestra
//
// Pregunta de Marcos (31/08): si tengo WFC del S&P y un banco brasileño que
// solo existe como CEDEAR, ¿me los suma?
//
// Por SECTOR sí, y siempre lo hizo: el peso sale del `sector` de cada posición
// de la cartera, no del universo, así que WFC + BBD + BBVA dan "Financials 80%"
// y marca el exceso. Verificado con una cartera de prueba.
//
// Lo que NO mostraba es el nivel fino. "Financials 80%" puede ser:
//
//     tres bancos y una aseguradora   -> concentrado, pero repartido
//     cuatro bancos                   -> UNA apuesta con cuatro nombres
//
// y la tabla de sectores los dibuja idénticos. Eso es lo que esto resuelve.
//
// ⚠️ SE COMPLEMENTA CON LOS PARES CORRELACIONADOS, NO LOS REEMPLAZA.
// Son dos preguntas distintas y ninguna implica la otra:
//   · la industria mira la ETIQUETA (dos bancos son dos bancos)
//   · la correlación mira el COMPORTAMIENTO (dos papeles que se mueven juntos,
//     aunque uno sea minero y el otro industrial)
// Un banco brasileño y uno estadounidense comparten industria y pueden
// correlacionar poco. Dos mineras de oro de industrias distintas se mueven
// como una. Hacen falta las dos lecturas.
// ─────────────────────────────────────────────────────────────────────────────

// Con menos de dos posiciones no hay concentración de la que hablar, y por
// debajo de este peso tampoco: una industria con 4% no es un hallazgo.
export const INDUSTRIA_PESO_MINIMO = 15

export function concentracionPorIndustria(cart) {
  if (!cart || !Array.isArray(cart.activos)) return null
  const hayPesos = !!cart.hayPesos
  const activos = cart.activos

  const grupos = {}
  const sinDato = []
  for (const a of activos) {
    if (!a.industry) { sinDato.push(a.ticker); continue }
    const g = (grupos[a.industry] ||= {
      industry: a.industry, sector: a.sector || null, tickers: [], pct: 0, n: 0,
    })
    g.tickers.push(a.ticker)
    g.n += 1
    g.pct += (a.peso || 0)
  }

  const total = Object.values(grupos)
    .map(g => ({
      ...g,
      // El denominador viaja SIEMPRE, igual que en los sectores: sin montos
      // esto es un CONTEO de papeles y leerlo como plata es la alarma falsa
      // que ya nos comimos una vez.
      pct: hayPesos ? round1(g.pct) : round1((g.n / activos.length) * 100),
      denominador: hayPesos ? 'valor de la cartera' : 'cantidad de posiciones',
    }))
    .sort((a, b) => b.pct - a.pct)

  // Solo se marca lo que es una concentración de verdad: dos o más papeles de
  // la misma industria pesando junto más que el umbral. Un solo papel al 20%
  // ya lo dice la tabla de pesos; repetirlo acá sería ruido.
  const concentradas = total.filter(g =>
    g.n >= 2 && hayPesos && g.pct >= INDUSTRIA_PESO_MINIMO)

  return {
    industrias: total,
    concentradas,
    // Los que no tienen el dato se NOMBRAN. Sin esto, una cartera donde falta
    // la mitad de las industrias se vería igual que una repartida de verdad, y
    // el silencio se leería como "no hay concentración".
    sin_dato: sinDato,
    cobertura_pct: activos.length
      ? round1(((activos.length - sinDato.length) / activos.length) * 100) : 0,
    // Sin este dato en la mayoría de las posiciones, la lectura no se sostiene
    // y es mejor decirlo que dibujar una tabla a medias.
    confiable: activos.length > 0 && sinDato.length <= activos.length / 2,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LA TABLA ACTUAL vs OBJETIVO
//
// Todo lo que hace falta para ejecutar ya estaba calculado y repartido en dos
// lugares: el peso y el tope en `analizarCartera()`, el peso objetivo y el
// aporte al riesgo en `riesgo.js`. Lo que faltaba era cruzarlos y decir el
// número que se opera: cuántos puntos porcentuales sobran o faltan, cuántos
// dólares son y —cuando se sabe el precio— cuántas acciones.
//
// Es determinístico A PROPÓSITO. Es la mitad del Motor B, y si lo escribiera el
// modelo tendríamos dos fuentes de verdad: el texto diría un monto y la tabla
// otro. Acá se calcula una vez, se dibuja y se manda al prompt EL MISMO objeto.
// ─────────────────────────────────────────────────────────────────────────────

// Por debajo de esto no se mueve nada. No es por el costo de operar —Marcos
// paga una cuota fija mensual, así que el monto nunca justifica no operar— sino
// porque medio punto de diferencia está adentro del error del propio modelo de
// riesgo: la covarianza es histórica y no tiene esa precisión. Mover por 0,4 pp
// es ruido con cara de decisión.
export const UMBRAL_AJUSTE_PP = 1.0

// ─────────────────────────────────────────────────────────────────────────────
// EL MENÚ DE ROTACIÓN, POR SECTOR
//
// Pedido de Marcos (31/08): *"que recomiende otras opciones… de Financials ej
// JPM porque…, de Consumo ej MO porque…"*. Tres sectores, una opción por
// sector, con el motivo.
//
// EL CRITERIO, y por qué es el que es. Se midieron los tres sobre su cartera:
//
//   solo por PUNTAJE del screener  -> mete HMY (87,5) que SUBE la volatilidad
//                                     2,26 puntos. Es el error que veníamos
//                                     corrigiendo toda la sesión.
//   solo por MEJORA de riesgo      -> mete O (baja 5,79) con puntaje 53. Le
//                                     ofrece al cliente una empresa mediocre
//                                     porque diversifica.
//   FILTRAR y después PUNTUAR      -> SBS(86,7) PBR(86,2) MO(80), los tres
//                                     bajan el riesgo Y son buenas empresas.
//
// O sea: la mejora de riesgo es una COMPUERTA, no un ranking. Primero se
// descarta lo que no ayuda a la cartera; entre lo que queda, manda el puntaje
// del screener — que es el criterio de Marcos y el que él sabe defender.
// ─────────────────────────────────────────────────────────────────────────────

// Cuánto tiene que bajar la volatilidad para que valga la pena ofrecerlo. Por
// debajo de esto la diferencia está adentro del error de la covarianza.
export const UMBRAL_MENU_PTS = 2.0
export const SECTORES_EN_EL_MENU = 3

/**
 * Una opción por sector, los tres mejores sectores.
 *
 * Se excluyen los sectores que YA exceden su tope: poner plata nueva ahí sería
 * cambiar una concentración por otra, que es justo lo que el informe prohíbe.
 */
export function menuDeRotacion(cart, riesgo) {
  if (!riesgo?.disponible) return []
  const alTope = new Set((cart?.sectores || [])
    .filter(s => s.excede).map(s => s.sector))

  const mejorPorSector = {}
  for (const c of (riesgo.candidatos || [])) {
    if (!c.sector || alTope.has(c.sector)) continue
    // LA COMPUERTA: si no mejora la cartera de forma medible, no se ofrece.
    // Da igual lo buena que sea la empresa.
    if (!(c.mejora_vs_plan_pts >= UMBRAL_MENU_PTS)) continue
    const actual = mejorPorSector[c.sector]
    // Entre los que pasan la compuerta, manda el PUNTAJE. Desempate por mejora,
    // y después alfabético: dos corridas con los mismos datos tienen que dar el
    // mismo documento.
    if (!actual
        || (c.puntaje ?? 0) > (actual.puntaje ?? 0)
        || ((c.puntaje ?? 0) === (actual.puntaje ?? 0)
            && c.mejora_vs_plan_pts > actual.mejora_vs_plan_pts)) {
      mejorPorSector[c.sector] = c
    }
  }
  return Object.values(mejorPorSector)
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0)
                 || a.ticker.localeCompare(b.ticker))
    .slice(0, SECTORES_EN_EL_MENU)
}

export function planDePesos(cart, riesgo) {
  if (!cart || !Array.isArray(cart.activos)) return null
  if (!riesgo || !riesgo.disponible) return null

  // El denominador es la cartera COMPLETA, igual que los pesos: si los montos
  // se calcularan sobre lo analizado, un ajuste de 3 pp saldría inflado en la
  // proporción exacta en que la cartera está sin cubrir.
  const valor = cart.valorTotalCartera ?? cart.valorTotal ?? null
  const porTicker = cart.porTicker || {}

  const filas = (riesgo.posiciones || []).map(p => {
    const a = porTicker[p.ticker] || {}
    const peso = a.peso ?? null
    const obj = p.peso_objetivo_pct ?? null
    const delta = (peso != null && obj != null) ? round1(obj - peso) : null
    const montoUSD = (delta != null && valor > 0)
      ? Math.round(delta / 100 * valor) : null
    // El precio sale de lo que ya está cargado, no de una llamada nueva.
    const precio = (a.cantidad > 0 && a.valorActual > 0)
      ? a.valorActual / a.cantidad : null
    // Acciones ENTERAS y hacia abajo en valor absoluto: redondear para arriba
    // haría vender más de lo que hay o comprar más de lo que se decidió.
    const acciones = (montoUSD != null && precio > 0)
      ? Math.trunc(montoUSD / precio) : null

    const mueve = delta != null && Math.abs(delta) >= UMBRAL_AJUSTE_PP
    return {
      ticker: p.ticker,
      sector: a.sector || null,
      clase: a.clase || null,
      peso, objetivo: obj, delta,
      montoUSD, acciones,
      precio: precio != null ? Math.round(precio * 100) / 100 : null,
      aporteRiesgo: p.aporte_al_riesgo_pct ?? null,
      volatilidad: p.volatilidad_pct ?? null,
      correlacion: p.correlacion_media ?? null,
      limitadoPorTope: !!p.limitado_por_tope,
      limitadoPorGrupo: p.limitado_por_grupo || [],
      // Un refuerzo DENTRO de un sector que ya toca su techo no es rotacion:
      // es mover plata de un bolsillo al otro del mismo pantalon.
      refuerzoEnSectorAlTope: !!p.refuerzo_en_sector_al_tope,
      topeClase: a.topeClase ?? null,
      accionCartera: a.accion || null,
      // Un papel puede pesar de más y aportar POCO riesgo (o al revés). Marcar
      // los dos por separado es lo que deja ver la diferencia entre las dos
      // lecturas en vez de promediarlas.
      concentraRiesgo: (p.aporte_al_riesgo_pct != null && peso > 0
                        && p.aporte_al_riesgo_pct > peso * 1.5),
      movimiento: !mueve ? 'mantener' : (delta > 0 ? 'comprar' : 'vender'),
    }
  })

  // Se ordena por tamaño del ajuste: lo primero que se lee es lo primero que
  // hay que hacer.
  filas.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0))

  const compras = filas.filter(f => f.movimiento === 'comprar')
  const ventas = filas.filter(f => f.movimiento === 'vender')
  const suma = (arr) => arr.reduce((acc, f) => acc + Math.abs(f.montoUSD || 0), 0)

  return {
    filas,
    // Las que no tienen histórico no se esconden ni se les inventa un objetivo:
    // se nombran aparte, igual que las métricas fundamentales que faltan.
    sinDatos: (riesgo.sin_datos || []).map(s => s.ticker),
    valorReferencia: valor,
    umbralPP: UMBRAL_AJUSTE_PP,
    nMovimientos: compras.length + ventas.length,
    // Los refuerzos que NO corresponden porque su sector ya esta lleno. La
    // plata de esos tiene que salir del sector, no quedarse adentro.
    refuerzosBloqueados: compras.filter(f => f.refuerzoEnSectorAlTope),
    comprarUSD: Math.round(suma(compras)),
    venderUSD: Math.round(suma(ventas)),
    // El único número que dice si todo esto vale la pena. Si mover diez
    // posiciones baja la volatilidad 0,3 puntos, la respuesta honesta es no
    // hacer nada — y el informe tiene que poder decirlo.
    volActual: riesgo.volatilidad_cartera_pct ?? null,
    volObjetivo: riesgo.volatilidad_si_objetivo_pct ?? null,
    mejoraVol: (riesgo.volatilidad_cartera_pct != null
                && riesgo.volatilidad_si_objetivo_pct != null)
      ? round1(riesgo.volatilidad_cartera_pct - riesgo.volatilidad_si_objetivo_pct)
      : null,
    coberturaPct: riesgo.cobertura_pct ?? null,
    topesInsuficientes: riesgo.topes_insuficientes || null,
    // Viajan por acá para que la sección del informe lea UNA sola fuente. Si
    // el componente fuera a buscarlos a `riesgo` por su lado, habría dos
    // caminos hacia el mismo dato y uno se olvidaría de actualizar.
    benchmark: riesgo.benchmark || null,
    pares: riesgo.pares_correlacionados || [],
    // El menú por sector, y si el refuerzo interno sigue siendo una opción.
    menu: menuDeRotacion(cart, riesgo),
    // ⚠️ Esto NO es todo-o-nada, y la primera version lo trataba asi.
    // En la cartera de Marcos las compras del plan eran AAPL y MSFT (Technology,
    // que SI toca su techo) y HIMS (Healthcare, que no). Un unico booleano decia
    // "no bloqueado" y dejaba pasar los dos refuerzos que no correspondian.
    // Se marca CADA UNO.
    gruposLimitantes: riesgo.grupos_limitantes || [],
    // Las mejores entradas NUEVAS, medidas contra este mismo plan. Solo las que
    // de verdad mejoran: ofrecer una que empeora seria ruido con cara de opcion.
    entradas: (riesgo.candidatos || [])
      .filter(c => c.mejora_vs_plan_pts != null && c.mejora_vs_plan_pts > 0.3)
      .slice(0, 3),
  }
}

/**
 * Huella de la cartera, para el caché.
 *
 * Cambia si cambia CUALQUIER cosa que movería la tesis: los papeles, sus pesos,
 * el perfil, el objetivo o el horizonte. NO cambia con el valor absoluto de la
 * cartera —si todo sube 3% el análisis es el mismo— ni con el orden en que
 * llegaron los activos.
 *
 * El peso se redondea a un decimal a propósito: sin eso, un centavo de
 * diferencia en la cotización invalidaría el caché y la tesis se volvería a
 * pagar cada vez que se abre la página.
 */
export function huellaCartera(datos) {
  if (!datos) return null
  const posiciones = (datos.posiciones || [])
    .map(p => `${p.ticker}:${p.peso_pct}`)
    .sort()
    .join(',')
  return [datos.perfil, datos.objetivo, datos.horizonte, posiciones].join('|')
}

// ─────────────────────────────────────────────────────────────────────────────
// LOS HECHOS PARA EL CLIENTE — el insumo de la SEGUNDA llamada
//
// POR QUÉ EXISTE (02/09/2026)
// ---------------------------
// El texto para el cliente dejó de ser la sección 5 de la primera llamada y
// pasó a ser una llamada aparte. Esa llamada recibe DOS cosas: la decisión ya
// escrita (secciones 1 a 4) y este bloque.
//
// Y hace falta este bloque, no alcanza con la decisión, por tres motivos que
// se descubrieron leyendo los textos que salían mal:
//
//   1. LOS NOMBRES. La decisión habla en tickers —"WFC · 12% → 8%"— porque es
//      un documento de trabajo. El texto del cliente tiene PROHIBIDO usar
//      tickers. Sin un diccionario ticker→nombre, el modelo tiene que
//      adivinar de qué empresa habla "LRCX", y adivinar nombres de empresas es
//      exactamente la clase de invento que no se puede permitir en algo que se
//      imprime y se entrega.
//
//   2. LO QUE EL PLAN NO ARREGLA. La decisión dice qué hacer; casi nunca dice
//      qué queda sin hacer. Si el perfil admite 70% en acciones y la cartera
//      tiene 100%, ningún rebalanceo entre acciones lo resuelve —y el texto no
//      puede terminar diciendo "queda adaptada al perfil", porque no lo está.
//
//   3. LOS DOS NÚMEROS DE VOLATILIDAD. Son el único número que el texto tiene
//      permitido usar, y tienen que llegar como números, no extraídos de un
//      párrafo por lectura.
//
// LO QUE NO HACE: no decide nada. Si el plan no existe o el riesgo no se pudo
// calcular, los campos faltan y el prompt tiene una rama para cada ausencia.
// Un campo inventado acá se convierte en una frase falsa en un documento que
// firma una persona.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diccionario ticker → nombre de TODO lo que el texto podría llegar a nombrar:
 * las posiciones, el menú por sector y las entradas nuevas.
 *
 * Sale barato —unos 6 tokens por papel— y es lo único que permite cumplir la
 * regla "nombres, nunca tickers".
 */
function nombresQueSePuedenUsar(datos) {
  const m = {}
  const meter = x => {
    if (x && x.ticker && x.nombre && !m[x.ticker]) m[x.ticker] = x.nombre
  }
  ;(datos.posiciones || []).forEach(meter)
  ;((datos.plan || {}).menu_por_sector || []).forEach(meter)
  ;((datos.plan || {}).entradas_nuevas || []).forEach(meter)
  return m
}

/**
 * Lo que el plan NO resuelve. Es la parte que un informe malo esconde.
 *
 * Cada entrada es una frase corta y ya redactada en lenguaje de cliente: el
 * modelo la reformula, no la interpreta. Si acá llegara jerga —"topes
 * insuficientes"— saldría jerga en el documento del cliente.
 */
function loQueQuedaPendiente(datos) {
  const p = []
  const c = datos.cartera || {}
  const r = datos.riesgo || {}

  // 1. La mezcla entre acciones y el resto. Ningún rebalanceo DENTRO de las
  //    acciones puede arreglar esto, y es lo que más veces quedó sin decirse.
  if (c.renta_variable_pct != null && c.tope_renta_variable_pct != null
      && c.renta_variable_pct > c.tope_renta_variable_pct + 1) {
    p.push(`La cartera tiene ${r1(c.renta_variable_pct)}% en acciones y para `
         + `este perfil corresponde hasta ${r1(c.tope_renta_variable_pct)}%. `
         + `Eso no se resuelve moviendo acciones entre sí: es una decisión `
         + `aparte entre acciones, renta fija y liquidez.`)
  }

  // 2. Los topes que no se pueden cumplir con lo que hay adentro. Traducido:
  //    "por más que reparta, con estas empresas no alcanza".
  if (r.topes_insuficientes) {
    p.push(`Con las empresas que hoy tiene la cartera no alcanza para llegar `
         + `al equilibrio que buscamos: haría falta incorporar algo nuevo.`)
  }

  // 3. La volatilidad se calculó sobre una parte. Decir "la cartera queda en
  //    15,3%" cuando el número cubre el 60% de la cartera es mentir por omisión.
  if (r.cobertura_del_calculo_pct != null && r.cobertura_del_calculo_pct < 95) {
    p.push(`Los números de riesgo cubren el ${r1(r.cobertura_del_calculo_pct)}% `
         + `de la cartera: hay posiciones sin historial suficiente para medirlas.`)
  }

  return p
}

/**
 * El bloque de hechos de la segunda llamada. Chico a propósito: medido, entra
 * en ~80-160 tokens según el tamaño de la cartera.
 *
 * @param datos  el MISMO objeto que se le manda a la primera llamada
 *               (`armarDatosTesis`). No se recalcula nada: si acá se derivara
 *               un número por otro camino, el texto del cliente podría
 *               contradecir a la decisión que dice traducir.
 */
export function hechosParaElCliente(datos) {
  if (!datos) return null
  const c = datos.cartera || {}
  const r = datos.riesgo || {}
  const pl = datos.plan || null
  const b = r.benchmark || null
  const pos = datos.posiciones || []

  const h = {
    perfil: datos.perfil || null,
    objetivo: datos.objetivo || null,
    nombres: nombresQueSePuedenUsar(datos),
  }

  // La cartera analizada puede ser un PEDAZO de lo que el cliente tiene. Si lo
  // es, el primer párrafo tiene que decirlo, y para eso tiene que saberlo.
  if (c.es_parcial) {
    h.cartera_parcial = true
    h.cobertura_pct = r1(c.cobertura_analizada_pct)
  }

  // Los DOS números, y solo si están los dos. Uno solo no se puede comparar y
  // el prompt tiene prohibido escribir el párrafo del resultado sin la
  // comparación.
  if (pl && pl.volatilidad_actual_pct != null
      && pl.volatilidad_si_se_ejecuta_pct != null) {
    h.volatilidad_antes_pct = pl.volatilidad_actual_pct
    h.volatilidad_despues_pct = pl.volatilidad_si_se_ejecuta_pct
  }

  // Lo bueno, si lo hay, MEDIDO. El párrafo 1 pide empezar por lo positivo, y
  // sin un dato atrás eso se convierte en un elogio de relleno.
  if (b && b.retorno_cartera_pct != null && b.retorno_benchmark_pct != null) {
    h.retorno_3_anios_pct = b.retorno_cartera_pct
    h.retorno_indice_3_anios_pct = b.retorno_benchmark_pct
  }
  const conGanancia = pos.filter(p => p.ganancia_pct != null && p.ganancia_pct > 0)
  if (conGanancia.length) {
    h.posiciones_en_ganancia = conGanancia.length
    h.posiciones_totales = pos.length
  }

  const pendiente = loQueQuedaPendiente(datos)
  if (pendiente.length) h.pendiente = pendiente

  // Si con los datos que hay no se puede decidir, el texto del cliente NO
  // puede sonar como una recomendacion. Es el unico campo de este bloque que
  // puede cambiar el TONO entero del texto, y por eso viaja aunque cueste.
  const d = datos.datos || null
  if (d && d.puede_decidir === false) h.datos_insuficientes = true

  return h
}

// ─────────────────────────────────────────────────────────────────────────────
// LA COMPUERTA DE DATOS — un solo lugar que diga "con esto no alcanza"
//
// EL PROBLEMA QUE RESUELVE (03/09/2026)
// ------------------------------------
// La cobertura de datos estaba repartida en CINCO campos, cada uno con su
// propia escala y su propio silencio:
//
//   1. `metricas_usadas` por posición    "4/6" — ¿y eso alcanza o no?
//   2. `riesgo.cobertura_del_calculo_pct` 87% — ¿de qué? ¿de las acciones?
//   3. `cartera.cobertura_analizada_pct`  71% — otra cosa distinta
//   4. `industrias.cobertura_pct`         60% — otra más
//   5. `nivel: completo | reducido`       por informe individual
//
// Cinco números que hay que leer juntos y cruzar mentalmente para contestar la
// única pregunta que importa: **¿alcanza para decidir?**. Nadie los cruza. Y el
// resultado era el peor posible: el informe salía COMPLETO, con su tabla, su
// objetivo y su prosa, sobre una cartera de la que sabíamos la mitad — y el
// único rastro eran cinco porcentajes en cinco lugares distintos.
//
// LO QUE ESTA FUNCIÓN AGREGA, Y NO ES UN SEXTO NÚMERO
// --------------------------------------------------
// `no_se_puede_afirmar`: la lista de frases que el informe NO tiene derecho a
// decir con los datos que hay. Eso es lo accionable. Un "87% de cobertura" no
// le dice nada a nadie; "no se puede decir que la volatilidad de la cartera es
// 15,3%, porque ese número cubre el 87%" sí.
//
// LO QUE NO HACE: no bloquea. Un informe con datos parciales sigue siendo útil
// —a veces es todo lo que hay— y esconderlo sería peor. Lo que no puede pasar
// es que se lea como si fuera completo.
// ─────────────────────────────────────────────────────────────────────────────

// Los tres umbrales. Se nombran para poder discutirlos de a uno.
//
// MINIMO_POSICIONES: con una sola posición no hay cartera que analizar — no hay
// concentración, no hay correlación, no hay rebalanceo posible.
export const MINIMO_POSICIONES = 2
// Debajo de esto, los porcentajes son sobre un universo que no es la cartera
// del cliente y no hay forma honesta de presentarlos.
export const COBERTURA_MINIMA_PCT = 50
// Y desde acá para arriba se considera cobertura plena. No es 100 a propósito:
// exigir el 100% haría que cualquier papel raro degrade el informe entero.
export const COBERTURA_PLENA_PCT = 95
// Desde acá NO se puede seguir hablando de "la calidad promedio de la cartera":
// con un tercio sin puntaje, el promedio es sobre otra cosa. Debajo de esto el
// hueco se anota igual, pero no calla nada — una compuerta que se queja siempre
// se ignora siempre, y entonces no protege de nada.
export const SIN_PUNTAJE_CALLA_PCT = 33
// Y desde acá el hueco es grave: media cartera sin puntaje no es un detalle.
export const SIN_PUNTAJE_GRAVE_PCT = 50

/**
 * @param cart    lo que devuelve `analizarCartera()`
 * @param riesgo  lo que devuelve `analizarRiesgo()`, o null
 * @param scores  { ticker: {score, nUsadas, nAplicables} } de `sugerencias.js`
 */
export function suficienciaDeDatos(cart, riesgo = null, scores = {}) {
  if (!cart) return null
  const activos = cart.activos || []
  const conPeso = activos.filter(a => (a.peso || 0) > 0)
  const faltantes = []
  const noSePuedeAfirmar = []

  // ── 1. ¿Hay cartera? ────────────────────────────────────────────────────
  if (activos.length < MINIMO_POSICIONES) {
    faltantes.push({
      que: 'posiciones',
      detalle: `hay ${activos.length}, hacen falta al menos ${MINIMO_POSICIONES}`,
      consecuencia: 'no hay cartera que analizar, solo un papel suelto',
    })
    noSePuedeAfirmar.push('nada sobre diversificación ni sobre concentración')
  }

  // ── 2. ¿Cuánto de la cartera del cliente estamos mirando? ───────────────
  const cob = cart.cobertura
  if (cob != null && cob < COBERTURA_PLENA_PCT) {
    const grave = cob < COBERTURA_MINIMA_PCT
    faltantes.push({
      que: 'cobertura de la cartera',
      detalle: `se analiza el ${r1(cob)}% de lo que tiene el cliente`,
      consecuencia: grave
        ? 'los porcentajes son sobre menos de la mitad de la cartera'
        : 'los porcentajes son sobre la parte analizada, no sobre el total',
      grave,
    })
    noSePuedeAfirmar.push(
      `que la cartera esté concentrada o diversificada: se mira el ${r1(cob)}%`)
  }

  // ── 3. ¿Cuántas posiciones tienen un puntaje publicable? ────────────────
  // Un puntaje null NO es un puntaje bajo: es "no sabemos". La diferencia
  // importa porque un null se lee como cero en cualquier promedio.
  const sinPuntaje = activos.filter(a => {
    const s = scores[a.ticker]
    return !s || s.score == null
  })
  if (sinPuntaje.length) {
    // ⚠️ SE MIDE POR PESO, NO POR CONTEO, y es la misma leccion que este
    // proyecto ya aprendio dos veces con los sectores: una posicion del 1% sin
    // puntaje no invalida nada, una del 40% si. Contando papeles, las dos
    // pesan igual — y entonces un papel chico y raro apagaria el informe.
    //
    // Cuando no hay montos cargados no queda otra que contar, y ahi el numero
    // es un conteo: se dice.
    const hayPesos = conPeso.length > 0
    const pct = hayPesos
      ? Math.round(sinPuntaje.reduce((a, x) => a + (x.peso || 0), 0))
      : Math.round(sinPuntaje.length / activos.length * 100)
    faltantes.push({
      que: 'puntaje fundamental',
      detalle: `${sinPuntaje.length} de ${activos.length} posiciones sin puntaje `
             + `(${sinPuntaje.map(a => a.ticker).join(', ')})`
             + (hayPesos ? ` · pesan el ${pct}% de la cartera` : ''),
      consecuencia: 'no se las puede comparar contra su sector',
      grave: pct >= SIN_PUNTAJE_GRAVE_PCT,
    })
    if (pct >= SIN_PUNTAJE_CALLA_PCT) {
      noSePuedeAfirmar.push(
        'que la calidad promedio de la cartera sea alta o baja: '
        + `${pct}% ${hayPesos ? 'de la cartera' : 'de las posiciones'} `
        + `no tiene puntaje`)
    }
  }

  // ── 4. ¿El riesgo se pudo medir, y sobre qué parte? ─────────────────────
  if (!riesgo || riesgo.disponible === false) {
    faltantes.push({
      que: 'riesgo del conjunto',
      detalle: riesgo?.motivo || 'no se calculó',
      consecuencia: 'sin volatilidad, correlaciones ni peso objetivo',
      grave: true,
    })
    noSePuedeAfirmar.push('ningún número de volatilidad ni de aporte al riesgo')
    noSePuedeAfirmar.push('que una posición aporte más riesgo del que su peso sugiere')
  } else {
    const cr = riesgo.cobertura_pct
    if (cr != null && cr < COBERTURA_PLENA_PCT) {
      const fuera = (riesgo.sin_datos || [])
      faltantes.push({
        que: 'histórico de precios',
        detalle: `los números de riesgo cubren el ${r1(cr)}% de las acciones`
               + (fuera.length
                  ? ` · fuera: ${fuera.map(s => `${s.ticker} (${s.motivo || 'sin histórico'})`).join(', ')}`
                  : ''),
        consecuencia: 'la volatilidad es la del pedazo que sí se pudo medir',
        grave: cr < COBERTURA_MINIMA_PCT,
      })
      noSePuedeAfirmar.push(
        `que la volatilidad de la cartera sea X%: ese número cubre el ${r1(cr)}%`)
    }
  }

  // ── 5. La industria, que es el nivel fino ───────────────────────────────
  // Se recalcula acá en vez de leerse de `cart`: `analizarCartera` no la
  // guarda, la arma `concentracionPorIndustria` cuando se la pide. Leer un
  // campo que no existe habria dado `undefined` y esta comprobacion nunca
  // habria disparado — en silencio, que es el error que este modulo combate.
  const ind = concentracionPorIndustria(cart)
  if (ind && ind.confiable === false && (ind.industrias || []).length) {
    faltantes.push({
      que: 'industria',
      detalle: `solo el ${r1(ind.cobertura_pct)}% de las posiciones traen `
             + `industria` + (ind.sin_dato?.length
                ? ` · sin dato: ${ind.sin_dato.join(', ')}` : ''),
      consecuencia: 'no se puede distinguir cuatro bancos de un sector repartido',
    })
    noSePuedeAfirmar.push(
      'que un sector concentrado esté repartido entre negocios distintos')
  }

  // ── El veredicto ────────────────────────────────────────────────────────
  const hayGrave = faltantes.some(f => f.grave)
  const insuficiente = activos.length < MINIMO_POSICIONES
    || (cob != null && cob < COBERTURA_MINIMA_PCT)
  const nivel = insuficiente ? 'insuficiente'
              : (faltantes.length ? 'parcial' : 'completo')

  return {
    nivel,
    // La única pregunta que importa, contestada con un booleano.
    puede_decidir: nivel !== 'insuficiente',
    // Y si hay algo grave, se dice aunque se pueda decidir: "parcial con un
    // agujero grande" y "parcial con un detalle" no son lo mismo.
    con_reservas: hayGrave,
    faltantes,
    // LO ACCIONABLE. Sin esto, esta función sería un sexto porcentaje.
    no_se_puede_afirmar: noSePuedeAfirmar,
    resumen: nivel === 'completo'
      ? 'Los datos alcanzan para decidir.'
      : nivel === 'parcial'
        ? `Alcanza para decidir, con reservas: ${faltantes.length} `
          + `${faltantes.length === 1 ? 'hueco' : 'huecos'} de datos.`
        : 'Con estos datos no se puede sacar una conclusión de cartera.',
  }
}
