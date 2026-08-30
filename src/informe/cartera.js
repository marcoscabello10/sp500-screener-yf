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
    const fit = afinidad(i, objetivoClave, horizonteClave)
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
      // Cuanto cambia la lectura al mirarla con el objetivo puesto. Si la
      // diferencia es grande, el informe lo dice: significa que la empresa es
      // buena pero para otra cosa.
      brechaObjetivo: (fit != null && puntajeBase != null)
        ? round1(fit - puntajeBase) : null,
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
    // Sobre la cartera COMPLETA, igual que los pesos por posición: un sector
    // que es el 40% de lo analizado pero el 19% de la cartera no es un problema
    // de concentración.
    const pct = hayPesos
      ? activos.filter(a => (a.sector || 'Sin sector') === s.sector)
               .reduce((acc, a) => acc + (a.peso || 0), 0)
      : (s.n / activos.length) * 100
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
export function afinidad(inf, objetivoClave, horizonteClave) {
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
  return Math.round((suma / pesos) * 10) / 10
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
export function armarDatosTesis(cart, estres, candidatos = [], scores = {}) {
  if (!cart || !Array.isArray(cart.activos)) return null

  const exp = exposicion(cart)
  const cob = sym => {
    const s = scores[sym]
    if (!s || s.nUsadas == null) return { metricas: null, reemplazos: [] }
    return { metricas: `${s.nUsadas}/${s.nAplicables}`,
             reemplazos: s.reemplazos || [] }
  }
  // El peor escenario del stress test, que es el que contesta la pregunta que
  // todo cliente hace primero: "¿cuánto puedo perder?".
  const peor = (estres?.escenarios || [])[0] || null

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

    sectores: (cart.sectores || [])
      .filter(s => s.pct > 0)
      .map(s => ({
        sector: s.sector, pct: r1(s.pct), tope: r1(s.tope),
        excede: !!s.excede, exceso_usd: s.excesoUSD ?? null,
      })),

    posiciones: (cart.activos || []).map(a => ({
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
    })),

    candidatos: (candidatos || []).map(c => ({
      ticker: c.ticker, sector: c.sector,
      puntaje: c.puntaje, metricas: c.metricas,
    })),
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
