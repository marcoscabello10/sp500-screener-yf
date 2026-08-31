// ─────────────────────────────────────────────────────────────────────────────
// MOTOR B — el riesgo del CONJUNTO
//
// Por qué existe
// --------------
// `analizarCartera()` implementa RESTRICCIONES: mira cada posición contra un
// tope y dice cuánto sobra. Eso contesta "¿qué no puede pasar?", no "¿qué
// conviene?". Un tope dice "no más de 12%"; un peso objetivo dice "debería ser
// 9%".
//
// Y le falta lo único que hace que una cartera sea distinta de una lista de
// activos: **la relación entre ellos**. Medido sobre una cartera real:
//
//     AAPL pesaba 30% y aportaba el 60% del riesgo.
//     Recortarla y poner el excedente en KO bajaba la volatilidad 3,6 puntos.
//     Ponerlo en MSFT la bajaba 0,4.
//
// Nueve veces de diferencia entre la mejor y la peor decisión, y las dos son
// "recortar AAPL al tope". La diferencia es enteramente correlación — y el
// informe no la miraba.
//
// De dónde salen los datos
// ------------------------
// De `public/data/historico_precios.json`, el mismo snapshot que alimenta al
// screener desde la fase B2. Es un estático del MISMO origen, así que el
// navegador lo baja igual que baja los fundamentales: cero llamadas nuevas,
// cero tokens, todo determinístico.
//
// Por qué paridad de riesgo y NO Markowitz
// ----------------------------------------
// Markowitz necesita un retorno esperado por activo, y el único que tenemos es
// el precio objetivo de los analistas a 12 meses — un predictor pobre. Con
// retornos malos, la optimización de media-varianza produce carteras extremas
// con cara de precisión: concentra todo en lo que casualmente tenga el mejor
// número de entrada.
//
// La paridad de riesgo NO necesita ningún pronóstico. Reparte el peso para que
// cada posición aporte un riesgo parecido. Es más humilde y mucho más robusta.
// El retorno esperado se muestra AL LADO, etiquetado como lo que es, y no entra
// en la cuenta.
//
// Lo que este módulo NO puede hacer, y hay que decirlo
// ---------------------------------------------------
//   · La covarianza es HISTÓRICA. Mira hacia atrás, y las correlaciones suelen
//     subir justo cuando uno preferiría que no. El stress test que ya existe
//     sigue siendo el complemento honesto, no un adorno.
//   · Un papel con poca historia no tiene covarianza confiable. Se marca "sin
//     datos de riesgo" en vez de inventarle un número.
//   · Si faltan papeles, la volatilidad que se informa es la del subconjunto
//     que SÍ tiene datos. Eso se dice explícitamente: una volatilidad calculada
//     sobre el 70% de la cartera no es la volatilidad de la cartera.
// ─────────────────────────────────────────────────────────────────────────────

const URL_HISTORICO = '/data/historico_precios.json'

// Días hábiles de ventana. 3 años es el equilibrio habitual: suficiente para
// que la covarianza no sea ruido, corto como para que siga describiendo el
// régimen actual.
export const DIAS_VENTANA = 756

// Menos que esto y la covarianza es ruido con forma de número.
export const MIN_RETORNOS = 60

// Memoria del tab: el archivo pesa ~9 MB y no cambia dentro de una sesión.
// NO va a localStorage — no entra en la cuota, y el browser ya lo cachea por
// HTTP igual que a cualquier estático.
let _memoria = null

export async function cargarHistorico() {
  if (_memoria !== null) return _memoria
  try {
    const r = await fetch(URL_HISTORICO, { cache: 'no-cache' })
    if (!r.ok) { _memoria = false; return false }
    const d = await r.json()
    if (!d || !Array.isArray(d.fechas) || !d.series) { _memoria = false; return false }
    _memoria = d
    return d
  } catch {
    _memoria = false
    return false
  }
}

// ── Álgebra, escrita a mano y a propósito ───────────────────────────────────
// Son matrices de 15x15 como mucho: traer una librería para esto sería sumar
// una dependencia y un bundle más grande a cambio de nada.

function retornosDe(serie, desde) {
  // Los `null` son días en que el papel no cotizaba. Se SALTEAN, no se
  // rellenan: rellenar inventa un retorno de 0% que baja la volatilidad.
  const v = []
  for (let i = desde; i < serie.length; i++) if (serie[i] != null) v.push(serie[i])
  const r = []
  for (let i = 1; i < v.length; i++) {
    if (v[i - 1] > 0) r.push((v[i] - v[i - 1]) / v[i - 1])
  }
  return r
}

const media = v => v.reduce((a, b) => a + b, 0) / v.length

function covarianza(a, b) {
  const ma = media(a), mb = media(b)
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb)
  return s / (a.length - 1)
}

/** Volatilidad anualizada, en %. */
const anual = v => Math.sqrt(Math.max(v, 0) * 252) * 100

/** Varianza de una cartera dados pesos (fracciones) y la matriz de covarianza. */
function varianzaCartera(w, cov) {
  let s = 0
  for (let i = 0; i < w.length; i++)
    for (let j = 0; j < w.length; j++) s += w[i] * w[j] * cov[i][j]
  return s
}

/** Contribución marginal: (Σw)_i. Es la derivada del riesgo respecto del peso. */
function marginales(w, cov) {
  return w.map((_, i) => w.reduce((a, wj, j) => a + wj * cov[i][j], 0))
}

// ── Paridad de riesgo ───────────────────────────────────────────────────────
//
// Se busca w tal que w_i · (Σw)_i sea IGUAL para todos: que cada posición
// aporte el mismo riesgo. El punto fijo de eso es w ∝ 1/(Σw)_i, así que se
// itera exactamente eso.
//
// La iteración va AMORTIGUADA (mitad del paso nuevo, mitad del viejo). Sin
// amortiguar oscila y en carteras con un activo mucho más volátil que el resto
// puede no converger — y una función que a veces no converge, en producción,
// devuelve un número cualquiera sin avisar.
function paridadRiesgo(cov, iteraciones = 200) {
  const n = cov.length
  if (!n) return []
  let w = new Array(n).fill(1 / n)
  for (let k = 0; k < iteraciones; k++) {
    const m = marginales(w, cov)
    const inv = m.map(x => (x > 1e-12 ? 1 / x : 0))
    const suma = inv.reduce((a, b) => a + b, 0)
    if (!(suma > 0)) break
    const nuevo = inv.map(x => x / suma)
    let cambio = 0
    for (let i = 0; i < n; i++) {
      const v = 0.5 * w[i] + 0.5 * nuevo[i]
      cambio = Math.max(cambio, Math.abs(v - w[i]))
      w[i] = v
    }
    if (cambio < 1e-7) break
  }
  const s = w.reduce((a, b) => a + b, 0)
  return w.map(x => x / s)
}

/**
 * Aplica los topes que YA definen los perfiles y reparte el excedente entre
 * las posiciones que todavía tienen lugar.
 *
 * Los topes no se tiran: la paridad de riesgo dice cuánto DEBERÍA pesar cada
 * cosa por su riesgo, y el perfil dice cuánto se le permite pesar. El objetivo
 * final respeta las dos cosas, y se informa cuáles quedaron topeadas — porque
 * "esta posición está limitada por el tope de su clase" es una explicación
 * distinta de "esta posición es riesgosa".
 */
// Un sector es una restricción de GRUPO, no de posición, y hasta el 31/08 el
// optimizador no lo sabía: solo aplicaba el tope por papel.
//
// El resultado era una contradicción dentro del mismo informe. Con cuatro
// bancos al 12,5% (Financials 50%, tope 35%), la tabla decía "Financials excede
// el 35%" y dos filas más abajo proponía un objetivo de 41,3% — que también lo
// excede. Los dos números salían del sistema y se desmentían entre ellos.
//
// El factor de la industria es un JUICIO, no una ley, y por eso es una
// constante con nombre y no un número escondido en una cuenta. La idea: una
// industria es un corte más fino que el sector, así que su techo tiene que ser
// más bajo — cuatro bancos no son lo mismo que dos bancos, una aseguradora y
// un gestor de fondos, aunque los cuatro sean "Financials". 0,7 deja lugar a
// dos o tres industrias por sector sin volverlo inoperable.
export const FACTOR_TOPE_INDUSTRIA = 0.7

/**
 * Proyecta los pesos sobre los topes: por posición Y por grupo.
 *
 * @param grupos  [{ nombre, tipo, idx: [i...], tope }] con `tope` en la misma
 *                escala que `topes` (fracción de la parte de acciones).
 *
 * Dentro de un grupo que hay que achicar, el recorte se reparte
 * PROPORCIONALMENTE al peso que la paridad de riesgo ya le había asignado a
 * cada miembro. Eso no es una comodidad: la paridad ya le dio menos peso al que
 * aporta más riesgo, así que recortar proporcional CONSERVA ese orden y el que
 * más arriesga termina cortado más en términos absolutos. Repartir el recorte
 * en partes iguales lo rompería.
 */
function aplicarTopes(w, topes, grupos = [], iteraciones = 80) {
  const n = w.length
  let x = w.slice()
  const topeados = new Set()
  const gruposActivos = new Set()
  for (let k = 0; k < iteraciones; k++) {
    let excedente = 0
    const libres = []
    for (let i = 0; i < n; i++) {
      const t = topes[i]
      if (t != null && x[i] > t + 1e-9) {
        excedente += x[i] - t
        x[i] = t
        topeados.add(i)
      } else if (!topeados.has(i)) {
        libres.push(i)
      }
    }

    // ── Los topes de GRUPO ────────────────────────────────────────────────
    // Se aplican DESPUÉS de los de posición: un papel que ya toca su propio
    // techo no puede además absorber el sobrante de su sector.
    const enGrupoLleno = new Set()
    for (const g of (grupos || [])) {
      if (!(g.tope > 0) || !g.idx?.length) continue
      const suma = g.idx.reduce((a, i) => a + x[i], 0)
      if (suma > g.tope + 1e-9) {
        const factor = g.tope / suma
        for (const i of g.idx) x[i] *= factor
        excedente += suma - g.tope
        gruposActivos.add(g.nombre)
      }
      // Aunque no exceda, si está al ras no puede recibir el excedente de otro:
      // hacerlo lo pondría por encima en la vuelta siguiente y el bucle
      // oscilaría entre dos estados sin converger nunca.
      if (suma >= g.tope - 1e-9) for (const i of g.idx) enGrupoLleno.add(i)
    }

    if (excedente < 1e-9) break
    // Solo reciben los que no tocan su tope propio NI están en un grupo lleno.
    const receptores = libres.filter(i => !enGrupoLleno.has(i))
    const base = receptores.reduce((a, i) => a + x[i], 0)
    if (!(base > 0)) break     // no hay dónde poner el excedente: se avisa abajo
    for (const i of receptores) x[i] += excedente * (x[i] / base)
  }
  // ⚠️ EL CASO QUE NO SE PUEDE TAPAR
  // Si TODAS las posiciones tocan su tope, los pesos objetivo no llegan a
  // sumar el total de acciones: con 5 papeles y un tope de 12% el máximo
  // asignable es 60%, y si las acciones son el 75% de la cartera sobran 15
  // puntos que no tienen dónde ir.
  //
  // Devolver igual unos pesos que no suman seria mentir por omision. Se informa
  // el faltante, porque ademas es un consejo util y concreto: con esta cantidad
  // de posiciones, los topes del perfil son inalcanzables. Hacen falta mas
  // papeles o un perfil mas concentrado.
  const suma = x.reduce((a, b) => a + b, 0)
  return { pesos: x, topeados: [...topeados], sumaAlcanzada: suma,
           // Qué grupos tuvieron que achicarse. Es lo que le permite al informe
           // decir POR QUÉ se recorta un papel que, mirado solo, estaba bien.
           gruposLimitantes: [...gruposActivos] }
}

// ── La función que usa el informe ───────────────────────────────────────────

/**
 * @param cart        lo que devuelve analizarCartera()
 * @param candidatos  los de candidatosRotacion(), para medir su aporte
 * @returns null si no hay histórico o no alcanzan los papeles con datos.
 */
// ── EL BENCHMARK ────────────────────────────────────────────────────────────
// SPY está en el snapshot desde el primer día (1.674 puntos) y no se comparaba
// con nada. Era la capa 3 del marco de Marcos y el dato más barato que quedaba
// sin usar: sin un benchmark, "la cartera rinde 12% con 16% de volatilidad" no
// se puede juzgar. Con él, la pregunta pasa a ser la correcta: ¿esto paga el
// riesgo que toma, comparado con no hacer nada y comprar el índice?
//
// ⚠️ El retorno es HISTÓRICO, de la ventana del snapshot. No es una proyección
// y el informe tiene que decirlo así. Se muestra al lado de la volatilidad
// justamente para que no se lea solo.
function contraBenchmark(snap, desde, largo, w, con, cov, varCartera) {
  const serie = snap.series?.SPY
  if (!serie) return null
  const rb = retornosDe(serie, desde)
  if (rb.length < largo) return null
  const b = rb.slice(-largo)

  const volB = anual(covarianza(b, b))
  // Retorno de la cartera: la combinación lineal de los retornos diarios con
  // los pesos actuales. Es lo que habría rendido ESTA cartera, no la suma de
  // lo que rindió cada papel por su cuenta.
  const rp = []
  for (let t = 0; t < largo; t++) {
    let x = 0
    for (let i = 0; i < con.length; i++) x += w[i] * con[i].r.slice(-largo)[t]
    rp.push(x)
  }
  const anualizar = (r) => (Math.pow(
    r.reduce((a, x) => a * (1 + x), 1), 252 / r.length) - 1) * 100
  const retP = anualizar(rp)
  const retB = anualizar(b)

  // Beta de la cartera contra el índice, y correlación. Beta 1 significa que se
  // mueve igual; 0,7 que amortigua; 1,3 que amplifica.
  const covPB = covarianza(rp, b)
  const varB = covarianza(b, b)
  const beta = varB > 0 ? covPB / varB : null
  const corr = Math.sqrt(varCartera * varB) > 0
    ? covPB / Math.sqrt(varCartera * varB) : null

  const r1 = x => x == null ? null : Math.round(x * 10) / 10
  const r2 = x => x == null ? null : Math.round(x * 100) / 100
  return {
    simbolo: 'SPY',
    retorno_cartera_pct: r1(retP),
    retorno_benchmark_pct: r1(retB),
    exceso_pct: r1(retP - retB),
    volatilidad_cartera_pct: r1(anual(varCartera)),
    volatilidad_benchmark_pct: r1(volB),
    beta_vs_benchmark: r2(beta),
    correlacion_vs_benchmark: r2(corr),
    // Retorno por unidad de riesgo, de los dos. Es la comparación que contesta
    // "¿vale la pena esta cartera contra comprar el índice?" en un solo número.
    // NO es un Sharpe: no se le resta la tasa libre de riesgo, porque cuál es
    // la tasa libre de riesgo para un argentino es una discusión que este
    // informe no tiene por qué zanjar.
    retorno_sobre_volatilidad: r2(anual(varCartera) > 0 ? retP / anual(varCartera) : null),
    retorno_sobre_volatilidad_benchmark: r2(volB > 0 ? retB / volB : null),
    ventana_dias: largo,
  }
}

// ── PARES QUE SON UNA SOLA APUESTA ──────────────────────────────────────────
// La "concentración temática" del prompt original de Marcos, que nunca se había
// implementado. Dos papeles con correlación 0,85 no son dos posiciones: son una
// con el doble de tamaño, y ninguna tabla de pesos por sector lo muestra —
// pueden estar en sectores distintos y seguir siendo la misma apuesta.
//
// EL UMBRAL ESTÁ MEDIDO, no elegido a ojo. Sobre 496 pares de 32 papeles
// grandes con 3 años de retornos DIARIOS:
//
//     min -0,23 · p25 0,07 · mediana 0,15 · p75 0,28 · p90 0,44 · p95 0,71
//
// Las correlaciones diarias son MUCHO más bajas de lo que la intuición dice
// (AAPL–MSFT da 0,35, no 0,8): el ruido de un día tapa el movimiento común.
// Por eso 0,7 es el percentil ~94 y marca solo el 5% de los pares — y los que
// marca son exactamente los que son una sola apuesta:
//
//     RIO–BHP 0,89 · XOM–CVX 0,82 · KGC–PAAS 0,81 · BAC–WFC 0,81 · GFI–HMY 0,81
//
// Esto se volvió MUCHO más útil al sumar los CEDEAR de afuera del índice: el
// universo nuevo trae siete mineras (VALE, RIO, BHP, GFI, HMY, KGC, PAAS).
// Tener tres se siente diversificado y es una sola posición.
export const CORR_PAR_ALTA = 0.7

function paresCorrelacionados(con, cov, w) {
  const n = con.length
  const out = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.sqrt(cov[i][i] * cov[j][j])
      if (!(d > 0)) continue
      const c = cov[i][j] / d
      if (c < CORR_PAR_ALTA) continue
      out.push({
        a: con[i].ticker, b: con[j].ticker,
        correlacion: Math.round(c * 100) / 100,
        // Cuánto pesa la apuesta combinada. Es el número que convierte el dato
        // en una decisión: dos papeles al 6% con correlación 0,8 son una
        // posición del 12%, y ahí sí se puede comparar contra el tope.
        peso_combinado_pct: Math.round((con[i].peso + con[j].peso) * 10) / 10,
        mismo_sector: (con[i].sector || null) === (con[j].sector || null),
      })
    }
  }
  return out.sort((x, y) => y.peso_combinado_pct - x.peso_combinado_pct)
}

export async function analizarRiesgo(cart, candidatos = []) {
  // El tope de sector lo calcula `analizarCartera()` y viaja en cada fila de
  // `cart.sectores`. Es el MISMO numero que el informe ya imprime: si acá se
  // recalculara, la tabla y el objetivo podrian discrepar.
  const topeSector = (cart?.sectores || [])[0]?.tope ?? null
  // Cuanto puede pesar una posicion NUEVA. Sale del perfil, igual que todo lo
  // demas: una entrada no puede nacer excedida.
  const topeGeneral = cart?.topeGeneral ?? null
  const snap = await cargarHistorico()
  if (!snap) return { disponible: false, motivo: 'no está el histórico de precios' }

  const activos = (cart?.activos || []).filter(a => a.peso > 0)
  if (activos.length < 2) {
    return { disponible: false,
             motivo: 'hacen falta al menos dos posiciones con peso' }
  }

  const desde = Math.max(0, (snap.fechas.length - 1) - DIAS_VENTANA)

  // Quién tiene datos y quién no. Los que no, se nombran: no se los esconde ni
  // se les inventa una volatilidad.
  const con = [], sin = []
  for (const a of activos) {
    const serie = snap.series[a.ticker]
    const r = serie ? retornosDe(serie, desde) : []
    if (r.length >= MIN_RETORNOS) con.push({ ...a, r })
    else sin.push({ ticker: a.ticker, puntos: r.length })
  }
  if (con.length < 2) {
    return { disponible: false,
             motivo: `solo ${con.length} posición(es) tienen histórico suficiente` }
  }

  // Eje común: todos los retornos recortados al más corto, tomando los ÚLTIMOS.
  // Sin esto, dos papeles con distinta cantidad de días se compararían sobre
  // períodos distintos y la covarianza no significaría nada.
  const largo = Math.min(...con.map(c => c.r.length))
  const R = con.map(c => c.r.slice(-largo))

  const n = con.length
  const cov = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => covarianza(R[i], R[j])))

  // Pesos actuales, renormalizados a la parte de acciones CON datos. La suma
  // de esa parte se conserva: este módulo no decide cuánta renta variable
  // tener —eso es TOPE_RENTA_VARIABLE— sino cómo repartir la que hay.
  const pesoAcciones = con.reduce((a, c) => a + c.peso, 0)
  const w = con.map(c => c.peso / pesoAcciones)

  const varActual = varianzaCartera(w, cov)
  const volActual = anual(varActual)
  const mrg = marginales(w, cov)
  const contrib = w.map((wi, i) => varActual > 0 ? wi * mrg[i] / varActual * 100 : null)

  const vol = con.map((_, i) => anual(cov[i][i]))
  const corrDe = (i, j) => cov[i][j] / Math.sqrt(cov[i][i] * cov[j][j])
  // Correlación media con el RESTO de la cartera, ponderada por peso: es lo que
  // dice si un papel diversifica o viene a repetir lo que ya hay.
  const corrMedia = con.map((_, i) => {
    let s = 0, p = 0
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      s += corrDe(i, j) * w[j]; p += w[j]
    }
    return p > 0 ? s / p : null
  })

  // ── El peso objetivo ──────────────────────────────────────────────────────
  const erc = paridadRiesgo(cov)
  // Los topes vienen en % de la cartera COMPLETA; acá se trabaja en fracción de
  // la parte de acciones, así que se convierten.
  const topes = con.map(c => c.topeClase != null
    ? (c.topeClase / 100) / (pesoAcciones / 100) : null)

  // ── LOS TOPES DE GRUPO ────────────────────────────────────────────────────
  // El tope de sector ya existía en `analizarCartera()` y el informe lo mostraba
  // —"Financials excede el 35%"— pero el optimizador no lo conocía, así que
  // proponía objetivos que también lo excedían. Dos números del mismo sistema
  // desmintiéndose. Acá entran como restricción de verdad.
  const aEscala = pct => (pct / 100) / (pesoAcciones / 100)
  const grupos = []
  const juntarPor = (campo, tope, tipo) => {
    if (!(tope > 0)) return
    const idx = {}
    con.forEach((c, i) => {
      const v = c[campo]
      if (!v) return                    // sin el dato no se puede agrupar
      ;(idx[v] ||= []).push(i)
    })
    for (const [nombre, ids] of Object.entries(idx)) {
      // Un grupo de UNO ya está cubierto por el tope de posición; agregarlo
      // como grupo solo duplicaría la restricción.
      if (ids.length < 2) continue
      grupos.push({ nombre: `${tipo}:${nombre}`, tipo, nombre_corto: nombre,
                    idx: ids, tope: aEscala(tope) })
    }
  }
  juntarPor('sector', topeSector, 'sector')
  // La industria solo entra si el dato está. Los CEDEAR de afuera del índice
  // llegan sin `industry` hasta que se vuelva a correr `fetch_informe.py`, y
  // agrupar a medias sería peor que no agrupar: limitaría a los que SÍ tienen
  // el dato y dejaría libres a los que no.
  const conIndustria = con.filter(c => c.industry).length
  if (conIndustria === con.length && topeSector > 0) {
    juntarPor('industry', topeSector * FACTOR_TOPE_INDUSTRIA, 'industria')
  }

  const { pesos: objFrac, topeados, sumaAlcanzada, gruposLimitantes } =
    aplicarTopes(erc, topes, grupos)
  // Y de vuelta a % de la cartera completa, que es la escala de toda la app.
  const objetivo = objFrac.map(x => Math.round(x * pesoAcciones * 10) / 10)

  // ¿Los topes dejan lugar para toda la parte de acciones?
  const faltante = Math.round((1 - sumaAlcanzada) * pesoAcciones * 10) / 10
  const topesInsuficientes = faltante > 0.5
    ? { faltan_pct: faltante,
        maximo_asignable_pct: Math.round(sumaAlcanzada * pesoAcciones * 10) / 10,
        acciones_pct: Math.round(pesoAcciones * 10) / 10,
        n_posiciones: n,
        // El consejo concreto, en vez de un numero que no cierra.
        // Desde que hay topes de GRUPO, el faltante puede venir de dos lados y
        // el consejo es distinto en cada caso: si sobra plata porque los
        // sectores estan llenos, agregar otro papel del MISMO sector no
        // resuelve nada — hace falta un sector nuevo.
        por_grupo: (gruposLimitantes || []).length > 0,
        nota: `Con ${n} posiciones el maximo que se puede asignar es `
            + `${Math.round(sumaAlcanzada * pesoAcciones)}% de la cartera, `
            + `pero las acciones pesan ${Math.round(pesoAcciones)}%. `
            + ((gruposLimitantes || []).length > 0
               ? `Los topes de ${gruposLimitantes.map(g => g.split(':')[1])
                    .join(' y ')} estan llenos, asi que hace falta un papel de `
                 + `OTRO sector —sumar otro del mismo no cambia nada— o bajar `
                 + `la exposicion a acciones.`
               : `Hacen falta mas posiciones, o bajar la exposicion a `
                 + `acciones.`) }
    : null

  // La volatilidad objetivo se calcula sobre los pesos NORMALIZADOS, para que
  // sea comparable con la actual: si no, estaria midiendo una cartera con menos
  // plata invertida y saldria artificialmente baja.
  const objNorm = sumaAlcanzada > 0 ? objFrac.map(x => x / sumaAlcanzada) : objFrac
  const volObjetivo = anual(varianzaCartera(objNorm, cov))

  // ── El aporte de cada candidato de rotación ───────────────────────────────
  // Se mide de verdad: cuánto cambia la volatilidad si entra con un peso
  // representativo. Es la única forma de contestar "¿mejora la cartera?" en vez
  // de "¿es mejor empresa?".
  const pesoPrueba = 1 / (n + 1)

  // ── ¿Y SI LA PLATA VA A UNA POSICIÓN NUEVA? ──────────────────────────────
  //
  // ⚠️ ESTE ES EL AGUJERO MÁS GRANDE QUE TUVO EL MOTOR B, y lo encontró Marcos
  // leyendo la salida: *"me vuelve a recomendar lo mismo"*.
  //
  // La paridad de riesgo reparte el peso entre las posiciones QUE YA ESTÁN.
  // Por construcción no puede proponer una entrada nueva: cuando recorta AMD,
  // la única cosa que sabe hacer con esa plata es agrandar AAPL, MSFT y HIMS.
  // Medido sobre su cartera real, las tres compras del plan eran las tres
  // posiciones que ya tenía.
  //
  // Y al mismo tiempo, dos líneas más abajo, este mismo módulo ya había medido
  // que MO bajaba la volatilidad 5,19 puntos y PG 4,89, los dos con correlación
  // NEGATIVA contra su cartera. El dato existía y no se convertía en una orden.
  //
  // Acá se cierra el círculo: para cada candidato se calcula la volatilidad de
  // la cartera objetivo SI la plata que iba a agrandar posiciones existentes se
  // va a ese papel. Es la misma matriz, una cuenta más, cero tokens — y
  // contesta la pregunta exacta: *"¿más AAPL, o MO?"*.
  const subeCada = objNorm.map((x, i) => Math.max(0, x - w[i]))
  const subeTotal = subeCada.reduce((a, b) => a + b, 0)
  // Cuánto puede pesar una entrada nueva: lo que sobra, acotado por el tope de
  // posición del perfil. Una posición nueva no puede nacer excedida.
  const topeEntrada = topeGeneral > 0 ? aEscala(topeGeneral) : 1
  const pesoEntrada = Math.min(subeTotal, topeEntrada)

  const aporteCandidatos = []
  for (const c of (candidatos || []).slice(0, 20)) {
    const serie = snap.series[c.ticker]
    const r = serie ? retornosDe(serie, desde) : []
    if (r.length < largo) continue
    const rc = r.slice(-largo)
    const cov2 = cov.map(fila => fila.slice())
    cov2.push(new Array(n).fill(0))
    for (let i = 0; i < n; i++) {
      const v = covarianza(R[i], rc)
      cov2[i].push(v); cov2[n][i] = v
    }
    cov2[n].push(covarianza(rc, rc))
    const w2 = w.map(x => x * (1 - pesoPrueba)).concat(pesoPrueba)
    let corr = 0, p = 0
    for (let i = 0; i < n; i++) {
      corr += (cov2[n][i] / Math.sqrt(cov2[n][n] * cov[i][i])) * w[i]; p += w[i]
    }
    // El plan CON este papel adentro: los aumentos previstos se recortan en
    // proporción y esa plata entra acá. Todo lo demás queda igual, así que la
    // diferencia de volatilidad es atribuible SOLO a esta decisión.
    let volConEntrada = null
    if (subeTotal > 1e-9 && pesoEntrada > 1e-9) {
      const factor = pesoEntrada / subeTotal
      const wc = objNorm.map((x, i) => x - subeCada[i] * factor).concat(pesoEntrada)
      volConEntrada = anual(varianzaCartera(wc, cov2))
    }
    aporteCandidatos.push({
      ticker: c.ticker, sector: c.sector, puntaje: c.puntaje,
      volatilidad: Math.round(anual(cov2[n][n]) * 10) / 10,
      correlacion_media: p > 0 ? Math.round(corr / p * 100) / 100 : null,
      delta_volatilidad: Math.round((anual(varianzaCartera(w2, cov2)) - volActual) * 100) / 100,
      // ── Lo nuevo, y es lo que hace ejecutable la rotación ────────────────
      // Cuánto pesaría si entra, y cuánto MEJOR o PEOR queda la cartera que
      // con el plan que solo agranda lo que ya hay. Negativo = mejor.
      peso_si_entra_pct: Math.round(pesoEntrada * pesoAcciones * 10) / 10,
      volatilidad_si_entra_pct: volConEntrada == null ? null
        : Math.round(volConEntrada * 10) / 10,
      mejora_vs_plan_pts: volConEntrada == null ? null
        : Math.round((volObjetivo - volConEntrada) * 100) / 100,
    })
  }
  // Se ordena por lo que de verdad decide: cuánto mejora contra el plan base.
  // Los que no se pudieron medir van al final.
  aporteCandidatos.sort((a, b) =>
    (a.mejora_vs_plan_pts == null) - (b.mejora_vs_plan_pts == null)
    || (b.mejora_vs_plan_pts ?? -99) - (a.mejora_vs_plan_pts ?? -99))

  return {
    disponible: true,
    ventana_dias: largo,
    volatilidad_cartera_pct: Math.round(volActual * 10) / 10,
    volatilidad_si_objetivo_pct: Math.round(volObjetivo * 10) / 10,
    // ⚠️ Si faltan papeles, esto NO es la volatilidad de la cartera sino la del
    // pedazo que tiene datos. Se dice, no se disimula.
    cobertura_pct: Math.round(pesoAcciones / (cart.activos || [])
      .reduce((a, x) => a + (x.peso || 0), 0) * 1000) / 10,
    sin_datos: sin,
    topes_insuficientes: topesInsuficientes,
    posiciones: con.map((c, i) => ({
      ticker: c.ticker,
      volatilidad_pct: Math.round(vol[i] * 10) / 10,
      aporte_al_riesgo_pct: contrib[i] == null ? null : Math.round(contrib[i] * 10) / 10,
      correlacion_media: corrMedia[i] == null ? null : Math.round(corrMedia[i] * 100) / 100,
      peso_objetivo_pct: objetivo[i],
      limitado_por_tope: topeados.includes(i),
      // "Te recorto porque VOS pesas de mas" y "te recorto porque TU SECTOR
      // pesa de mas" son dos explicaciones distintas, y la segunda es la que
      // el cliente no entiende si no se la dicen: el papel puede estar
      // perfecto y aun asi tener que achicarse.
      limitado_por_grupo: (gruposLimitantes || [])
        .filter(g => grupos.find(x => x.nombre === g)?.idx.includes(i))
        .map(g => grupos.find(x => x.nombre === g).nombre_corto),
    })),
    candidatos: aporteCandidatos,
    // Las dos lecturas que faltaban, y las dos son cuentas sobre la misma
    // matriz que ya se calculo: no cuestan una llamada nueva ni un token.
    // Los grupos que OBLIGARON a recortar. Sin esto, el objetivo baja cuatro
    // bancos y no hay forma de explicar por que: cada uno mirado solo estaba
    // dentro de su tope.
    grupos_limitantes: (gruposLimitantes || []).map(g => {
      const def = grupos.find(x => x.nombre === g)
      return {
        tipo: def.tipo, nombre: def.nombre_corto,
        tope_pct: Math.round(def.tope * pesoAcciones * 10) / 10,
        actual_pct: Math.round(
          def.idx.reduce((a, i) => a + con[i].peso, 0) * 10) / 10,
        objetivo_pct: Math.round(
          def.idx.reduce((a, i) => a + objetivo[i], 0) * 10) / 10,
        tickers: def.idx.map(i => con[i].ticker),
      }
    }),
    benchmark: contraBenchmark(snap, desde, largo, w, con, cov, varActual),
    pares_correlacionados: paresCorrelacionados(con, cov, w),
  }
}

/**
 * Antes/después de una lista de operaciones.
 *
 * `movimientos` es { TICKER: nuevoPesoEnPctDeLaCarteraCompleta }.
 * Devuelve las dos volatilidades y la diferencia, o null si no hay datos.
 *
 * Existe para que el informe pueda decir "esto baja la volatilidad de 15,9% a
 * 12,3%" en vez de "conviene recortar", que es lo que decía antes.
 */
export async function simular(cart, movimientos) {
  const snap = await cargarHistorico()
  if (!snap) return null
  const desde = Math.max(0, (snap.fechas.length - 1) - DIAS_VENTANA)

  const con = []
  for (const a of (cart?.activos || [])) {
    const nuevo = movimientos[a.ticker] != null ? movimientos[a.ticker] : a.peso
    if (!(nuevo > 0) && !(a.peso > 0)) continue
    const serie = snap.series[a.ticker]
    const r = serie ? retornosDe(serie, desde) : []
    if (r.length >= MIN_RETORNOS) con.push({ ticker: a.ticker, antes: a.peso, despues: nuevo, r })
  }
  if (con.length < 2) return null

  const largo = Math.min(...con.map(c => c.r.length))
  const R = con.map(c => c.r.slice(-largo))
  const n = con.length
  const cov = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => covarianza(R[i], R[j])))

  const norm = key => {
    const s = con.reduce((a, c) => a + c[key], 0)
    return s > 0 ? con.map(c => c[key] / s) : null
  }
  const wa = norm('antes'), wd = norm('despues')
  if (!wa || !wd) return null

  const va = anual(varianzaCartera(wa, cov))
  const vd = anual(varianzaCartera(wd, cov))
  return {
    volatilidad_antes_pct: Math.round(va * 10) / 10,
    volatilidad_despues_pct: Math.round(vd * 10) / 10,
    delta_pct: Math.round((vd - va) * 10) / 10,
  }
}
