// ─────────────────────────────────────────────────────────────────────────────
// FASE D — EL P/E CONTRA SU PROPIA HISTORIA
//
// LA PREGUNTA QUE EL INFORME NO PODÍA CONTESTAR
// ---------------------------------------------
// Todo el puntaje de este proyecto es un PERCENTIL DENTRO DEL SECTOR: "Apple
// cotiza a 30x contra una mediana de 24x en Technology". Eso contesta *¿está
// cara comparada con sus pares?* y no contesta *¿está cara para lo que ella
// suele valer?*
//
// Y son preguntas distintas, con respuestas que se contradicen seguido:
//
//   · un papel puede ser el más caro de su sector y estar en el punto más
//     barato de su propia historia (todo el sector se abarató);
//   · y al revés: el más barato del sector, en su propio máximo histórico.
//
// La segunda lectura es la que ve una re-calificación —el mercado le empezó a
// pagar más o menos por lo mismo— y la que caza una trampa de valor: un P/E
// bajo que además es bajo contra su propia historia suele ser el mercado
// diciendo algo, no una oportunidad.
//
// POR QUÉ SALE GRATIS
// -------------------
// No hay ninguna fuente nueva. Los dos ingredientes ya están:
//   · `historico_precios.json` — 6,7 años de cierres, que baja el Motor B;
//   · `historico.series.eps`   — el EPS diluido por año fiscal, que ya viene
//                                de EDGAR en `action=datos`, auditado.
// Cero llamadas, cero tokens, cero API.
//
// ⚠️ LO QUE ESTE NÚMERO **NO** ES
// El P/E que se arma acá usa el EPS ANUAL REPORTADO, no el TTM. Son cosas
// distintas y el informe lo dice: entre dos balances, el numerador se mueve
// (el precio) y el denominador no. Contra su propia historia eso está bien
// —siempre se midió igual— pero no se puede comparar contra el P/E TTM que
// muestra cualquier otra pantalla.
// ─────────────────────────────────────────────────────────────────────────────

// Un balance anual no se conoce el día que cierra el ejercicio: se publica dos
// o tres meses después. Usar el EPS desde el día del cierre sería mirar el
// pasado con información que ese día nadie tenía, y el P/E histórico saldría
// sistemáticamente más barato de lo que fue.
export const DIAS_DE_LAG = 75

// Con menos puntos la distribución no significa nada: un percentil sobre
// veinte días es ruido con cara de estadística.
export const MINIMO_PUNTOS = 250

// Un P/E por encima de esto no informa: es una empresa con la ganancia casi en
// cero, donde el múltiplo explota y arrastra toda la escala.
export const PE_MAXIMO_UTIL = 200

// Ancho intercuartil minimo, como fraccion de la mediana, para que el
// percentil signifique algo. Con 5% quiere decir: entre el cuartil 25 y el 75
// tiene que haber al menos un 5% de diferencia de multiplo. Debajo de eso, el
// papel cotizo siempre al mismo P/E y "esta en su percentil 90" es ruido.
export const DISPERSION_MINIMA = 0.05

function mediana(v) {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Percentil por el metodo del punto medio: los menores MAS la mitad de los
 * empates.
 *
 * ⚠️ Contar solo los menores estricto parece lo mismo y no lo es. Un papel
 * cuyo P/E casi no se movio tiene la mayor parte de la serie EMPATADA con el
 * valor de hoy: con "menores estricto" eso da percentil 0 —"en la parte mas
 * barata de su historia"— cuando la verdad es que esta exactamente donde
 * siempre estuvo. Es la clase de error que no rompe nada y dice lo contrario.
 */
function percentilDe(v, x) {
  if (!v.length || x == null) return null
  let menores = 0, iguales = 0
  for (const y of v) {
    if (y < x) menores++
    else if (y === x) iguales++
  }
  return Math.round((menores + iguales / 2) / v.length * 100)
}

function cuantil(v, q) {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))
  return s[i]
}

const r1 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 10) / 10

/**
 * El EPS que se conocía en cada fecha.
 *
 * @param eps  { '2024-09-28': 6.08, ... } tal como viene de EDGAR
 * @returns    [{ desde: 'AAAA-MM-DD', eps }] ordenado, ya con el lag aplicado
 *
 * `desde` es la fecha a partir de la cual ese EPS ya era público. Antes de esa
 * fecha, el número que corresponde es el del año anterior.
 */
export function epsConocidoDesde(eps) {
  const out = []
  for (const [cierre, v] of Object.entries(eps || {})) {
    if (v == null || !isFinite(v)) continue
    const t = Date.parse(cierre)
    if (!isFinite(t)) continue
    const publicado = new Date(t + DIAS_DE_LAG * 86400000)
    out.push({ desde: publicado.toISOString().slice(0, 10), eps: v, cierre })
  }
  return out.sort((a, b) => a.desde.localeCompare(b.desde))
}

/**
 * La serie de P/E, día por día.
 *
 * @param fechas   d.fechas de historico_precios.json
 * @param serie    d.series[ticker] — cierres, con `null` los días sin cotizar
 * @param eps      d.historico.series.eps de action=datos
 */
export function seriePE(fechas, serie, eps) {
  const conocidos = epsConocidoDesde(eps)
  if (!conocidos.length || !Array.isArray(fechas) || !Array.isArray(serie)) {
    return []
  }
  const out = []
  let i = 0          // puntero al último EPS ya publicado
  for (let k = 0; k < fechas.length; k++) {
    const f = fechas[k]
    while (i + 1 < conocidos.length && conocidos[i + 1].desde <= f) i++
    // Antes del primer balance conocido no hay P/E que calcular.
    if (conocidos[i].desde > f) continue
    const precio = serie[k]
    const e = conocidos[i].eps
    // EPS <= 0 no da un P/E: da un número negativo que no significa "barato".
    // Es el mismo error que el P/B negativo, que ya costó un bug entero.
    if (precio == null || !(precio > 0) || !(e > 0)) continue
    const pe = precio / e
    if (pe > PE_MAXIMO_UTIL) continue
    out.push({ fecha: f, pe })
  }
  return out
}

/**
 * Dónde cae el P/E de hoy dentro de su propia historia.
 *
 * @param peActual  el P/E que muestra el informe (TTM, de Yahoo). Puede ser
 *                  null: entonces se usa el último punto de la serie propia.
 */
export function valuacionContraSuHistoria(fechas, serie, eps, peActual = null) {
  const s = seriePE(fechas, serie, eps)
  if (s.length < MINIMO_PUNTOS) {
    return {
      disponible: false,
      motivo: s.length
        ? `solo ${s.length} días con P/E calculable, hacen falta ${MINIMO_PUNTOS}`
        : 'no hay EPS reportado o el precio no está en el snapshot',
      n_puntos: s.length,
    }
  }
  const vals = s.map(x => x.pe)
  // El P/E "de hoy" según ESTA misma definición. Es el que hay que comparar
  // contra la serie: mezclar el TTM de Yahoo con una serie de EPS anual daría
  // un percentil que compara dos cosas distintas.
  const propio = s[s.length - 1].pe
  const med = mediana(vals)
  const p = percentilDe(vals, propio)
  const q25 = cuantil(vals, 0.25)
  const q75 = cuantil(vals, 0.75)

  // ⚠️ SI LA SERIE CASI NO SE MOVIO, EL PERCENTIL NO SIGNIFICA NADA.
  // Un papel cuyo P/E vivio entre 14,8 y 15,2 esta siempre "en su percentil
  // 90" o "en su percentil 10" por diferencias de centavos. El numero sale
  // igual y suena a senal. Debajo de este ancho, se dice que no hay lectura en
  // vez de inventar una.
  const anchoRelativo = (med > 0 && q25 != null && q75 != null)
    ? (q75 - q25) / med : 0
  const hayDispersion = anchoRelativo >= DISPERSION_MINIMA

  // La lectura en castellano. Los cortes son anchos a propósito: entre el 35 y
  // el 65 no hay nada que decir, y decir algo igual sería inventar una señal.
  const lectura = !hayDispersion
    ? 'sin cambios: su múltiplo casi no se movió en todo el período'
    : p == null ? null
    : p <= 20 ? 'en la parte más barata de su propia historia'
    : p <= 35 ? 'por debajo de lo que suele valer'
    : p < 65  ? 'en línea con lo que suele valer'
    : p < 80  ? 'por encima de lo que suele valer'
    : 'en la parte más cara de su propia historia'

  return {
    disponible: true,
    n_puntos: s.length,
    desde: s[0].fecha,
    hasta: s[s.length - 1].fecha,
    pe_propio: r1(propio),
    // El de Yahoo va al lado, para que se vea que NO son el mismo número y no
    // parezca que uno de los dos está mal.
    pe_ttm_informe: r1(peActual),
    mediana: r1(med),
    p25: r1(q25),
    p75: r1(q75),
    // Cuando esto es falso, el percentil sigue estando pero NO se puede leer
    // como senal: la serie no tuvo recorrido donde caer.
    hay_dispersion: hayDispersion,
    ancho_relativo_pct: r1(anchoRelativo * 100),
    minimo: r1(Math.min(...vals)),
    maximo: r1(Math.max(...vals)),
    percentil: p,
    vs_mediana_pct: med > 0 ? r1((propio / med - 1) * 100) : null,
    lectura,
    // La serie adelgazada, para dibujarla sin mandar 1.677 puntos al DOM.
    puntos: adelgazar(s, 120),
    nota: 'Calculado con el EPS ANUAL reportado a la SEC, no con el TTM: entre '
        + 'dos balances se mueve el precio y no la ganancia. Sirve para '
        + 'comparar el papel contra sí mismo, no contra el P/E de otra '
        + 'pantalla. El EPS se aplica ' + DIAS_DE_LAG + ' días después del '
        + 'cierre del ejercicio, que es cuando se publica.',
  }
}

/** Uno de cada N, conservando el último. Para el gráfico, no para la cuenta. */
function adelgazar(s, n) {
  if (s.length <= n) return s.map(x => ({ f: x.fecha, pe: r1(x.pe) }))
  const paso = Math.ceil(s.length / n)
  const out = []
  for (let i = 0; i < s.length; i += paso) out.push(s[i])
  if (out[out.length - 1] !== s[s.length - 1]) out.push(s[s.length - 1])
  return out.map(x => ({ f: x.fecha, pe: r1(x.pe) }))
}
