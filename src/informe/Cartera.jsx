import React from 'react'
import Informe, { QueRevisar } from './Informe.jsx'
import TesisCartera from './tesisCartera.jsx'
import { analizarRiesgo } from './riesgo.js'
import { planRotacion, concentracionPorSector, SECTOR_PESADO_PCT,
         candidatosRotacion } from './sugerencias.js'
import { analizarCartera, stressTest, exposicion, concentracionPorIndustria,
         CLASE_TEXTO, ESTADO_TEXTO,
         ACCION_PESO_TEXTO, ORIGEN_PESOS, PERFIL_POR_DEFECTO,
         OBJETIVO_POR_DEFECTO, HORIZONTE_POR_DEFECTO,
         armarDatosTesis, planDePesos,
         suficienciaDeDatos } from './cartera.js'
import { C, F, semaforo, colorSeveridad, num, pct, fecha } from './estilos.js'

// ─────────────────────────────────────────────────────────────────────────────
// Informe de CARTERA — el documento que se le manda al cliente.
//
// Estructura:
//   1. Portada (cliente, comitente, fecha, logo opcional)
//   2. Qué hacer con esta cartera  ← la sección que se lee primero
//   3. Resumen: una fila por activo con su veredicto y su acción
//   4. Composición por sector
//   5. Puntos de atención (los riesgos altos de toda la cartera juntos)
//   6. Ficha de media página por activo
//   7. Anexo OPCIONAL con el informe completo de cada activo
//
// El orden no es casual. Antes el documento empezaba describiendo y terminaba,
// muy abajo, con "oportunidades a considerar". Quien lo recibía tenía que leer
// todo para saber qué se le estaba proponiendo. Ahora la conclusión —qué sale,
// qué se queda, qué se refuerza— va arriba, y el resto la respalda.
//
// Los activos se tratan por igual: NO se ponderan por cantidad ni precio de
// compra (decisión de Marcos, 24/08/2026). Esto sirve tanto para una cartera
// existente como para una propuesta.
// ─────────────────────────────────────────────────────────────────────────────

export default function Cartera({ informes, meta, stocks, scores, conAnexo,
                                 posiciones, otros, mercado = null }) {
  const validos = informes.filter(i => i && !i.error)

  // Los dos puntajes, calculados por separado y a proposito:
  //   plan  -> responde "¿es buena la empresa?"   (fundamental)
  //   cart  -> responde "¿esta bien que pese esto?" (cartera)
  // No se promedian nunca. Se cruzan en la matriz de cartera.js.
  const plan = planRotacion(validos, stocks, scores)
  const cart = analizarCartera(validos, posiciones,
                               meta.perfil || PERFIL_POR_DEFECTO,
                               meta.objetivo || OBJETIVO_POR_DEFECTO,
                               meta.horizonte || HORIZONTE_POR_DEFECTO,
                               otros)
  const stress = stressTest(cart)
  const expo = exposicion(cart)

  // El bloque de datos para la tesis con IA. Es SOLO reempaquetar lo que ya se
  // calculo arriba: si acá se calculara algo, habría dos fuentes de verdad y el
  // texto podría contradecir la tabla que está en esta misma página.
  const candidatos = candidatosRotacion(stocks, scores, validos.map(i => i.ticker),
                                        undefined,
                                        [...new Set(validos.map(i => i.sector))])

  // ── MOTOR B ───────────────────────────────────────────────────────────────
  // Baja el historico de precios (un estatico del mismo origen) y calcula
  // covarianza, aporte al riesgo y peso objetivo. Es asincrono porque el
  // archivo pesa ~9 MB, asi que el informe se dibuja primero SIN esto y los
  // campos de riesgo aparecen cuando estan.
  //
  // Si el historico no esta, `riesgo` queda null y todo lo demas funciona
  // igual: el Motor A no depende del B. Es el mismo interruptor de la fase B2.
  const [riesgo, setRiesgo] = React.useState(null)
  React.useEffect(() => {
    let vivo = true
    analizarRiesgo(cart, candidatos)
      .then(r => { if (vivo) setRiesgo(r) })
      .catch(e => {
        // No se silencia: si el calculo de riesgo falla, el informe sigue
        // andando pero hay que poder saber por que falto.
        console.warn('No se pudo calcular el riesgo de cartera:', e)
        if (vivo) setRiesgo({ disponible: false, motivo: String(e) })
      })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.activos.map(a => `${a.ticker}:${a.peso}`).join(',')])

  const datosTesis = armarDatosTesis(cart, stress, candidatos, scores, riesgo)

  // La tabla ACTUAL vs OBJETIVO. Sale del MISMO planDePesos() que viaja dentro
  // de `datosTesis`, asi que el texto de la tesis y esta tabla no pueden decir
  // montos distintos. Si el historico no esta, `plan` queda null y la seccion
  // no se dibuja: el resto del informe no cambia.
  const planPesos = planDePesos(cart, riesgo)
  // El nivel fino de la concentracion: "Financials 80%" puede ser cuatro bancos
  // o tres bancos y una aseguradora, y la tabla de sectores los dibuja igual.
  const industrias = concentracionPorIndustria(cart)

  const concentracion = concentracionPorSector(
    validos.map(i => ({ sector: i.sector })))

  const riesgosAltos = validos.flatMap(i =>
    (i.riesgos || []).filter(r => r.severidad === 'alta')
      .map(r => ({ ...r, ticker: i.ticker })))

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '26px 22px 70px' }}>
      <Portada meta={meta} n={validos.length} cart={cart} />

      {/* ANTES QUE NADA: ¿alcanza para decidir? Va arriba de todo porque es lo
          que decide con cuánta confianza hay que leer el resto. */}
      <CompuertaDeDatos s={suficienciaDeDatos(cart, riesgo, scores)} />

      {/* ⚠️ LA TESIS YA NO VIVE ADENTRO DEL INFORME (31/08/2026).
          Estaba arriba de todo, que era lo correcto mientras el informe era
          para Marcos. Pero el documento se le entrega AL CLIENTE, y la lectura
          interna —qué rotar, qué está sobrevaluado, el razonamiento del
          analista— no es para esos ojos. Confiar en "elijo las páginas al
          imprimir" es confiar en no equivocarse una sola vez.
          Ahora se abre en un panel aparte, marcado `no-imprimir`, así que no
          existe para el PDF por más que uno imprima todo. */}
      <TesisAparte datos={datosTesis} />

      {cart.hayPesos && expo && <Exposicion cart={cart} expo={expo} />}
      {cart.hayPesos && <Pesos cart={cart} />}
      {planPesos && <ActualVsObjetivo plan={planPesos} />}
      <Afinidad cart={cart} />
      {stress && <Stress cart={cart} stress={stress} />}
      <Rotacion plan={plan} total={validos.length} cart={cart} mercado={mercado} />
      <Resumen informes={validos} plan={plan} />
      <Composicion datos={concentracion} industrias={industrias} />
      {riesgosAltos.length > 0 && <PuntosDeAtencion riesgos={riesgosAltos} />}

      <Seccion titulo="Análisis por activo">
        {validos.map(i => <Ficha key={i.ticker} d={i} />)}
      </Seccion>

      {conAnexo && (
        <div className="salto-antes">
          <Seccion titulo="Anexo · informe completo de cada activo">
            <p style={{ color: C.tenue, fontSize: 13.5, marginTop: -6 }}>
              El detalle que respalda cada ficha, con series históricas y
              comparaciones contra el sector.
            </p>
          </Seccion>
          {validos.map(i => (
            <div key={i.ticker} className="salto-antes">
              {/* La tesis SI va en el anexo (28/08/2026). El motivo original
                  para apagarla —"serian N botones que gastan"— estaba mal
                  planteado: cada boton gasta SOLO cuando se lo clickea, asi
                  que N botones no son N llamadas. Marcos elige de cual quiere
                  la lectura en prosa, uno por uno, que es justamente la regla
                  de costo del proyecto: gastar solo cuando se lo pide.
                  Los botones llevan `no-imprimir`, asi que no salen en el PDF. */}
              <Informe d={i} onVolver={null} />
            </div>
          ))}
        </div>
      )}

      <Pie informes={validos} meta={meta} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Portada({ meta, n, cart }) {
  return (
    <div className="evitar-corte" style={{ borderBottom: `2px solid ${C.titulo}`,
                                           paddingBottom: 18, marginBottom: 6 }}>
      {meta.logo && (
        <img src={meta.logo} alt="" style={{ maxHeight: 54, maxWidth: 240,
                                             marginBottom: 14, display: 'block' }} />
      )}
      <h1 style={{ fontSize: 27, marginBottom: 4 }}>
        {meta.titulo || 'Análisis de cartera'}
      </h1>
      <div style={{ color: C.subtitulo, fontSize: 16 }}>
        {meta.cliente ? meta.cliente : 'Cartera propuesta'}
        {meta.comitente ? ` · comitente ${meta.comitente}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 26, marginTop: 14, flexWrap: 'wrap',
                    fontSize: 13, color: C.tenue }}>
        <span>{n} activos analizados</span>
        {cart?.hayPesos && (
          <span>Valor de la cartera: US$ {num(cart.valorTotal, 0)}</span>
        )}
        <span>Perfil: {cart?.perfil?.nombre || '—'}</span>
        <span>Fecha: {new Date().toLocaleDateString('es-AR', {
          day: '2-digit', month: 'long', year: 'numeric' })}</span>
        {meta.preparadoPor && <span>Preparado por {meta.preparadoPor}</span>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// La sección que da foco al documento: qué se hace con cada papel.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_ACCION = {
  sacar:            { color: C.rojo,  fondo: C.rojoFondo,  verbo: 'Sacar' },
  mantener:         { color: C.ambar, fondo: C.ambarFondo, verbo: 'Mantener' },
  reforzar:         { color: C.verde, fondo: C.verdeFondo, verbo: 'Reforzar' },
  'revisar a mano': { color: C.tenue, fondo: C.panel, verbo: 'Revisar a mano' },
  // Las dos que aparecen recien cuando hay pesos. "Recortar" no es "sacar":
  // la empresa esta bien, lo que esta mal es cuanto pesa.
  recortar:         { color: C.ambar, fondo: C.ambarFondo, verbo: 'Recortar' },
  consolidar:       { color: C.tenue, fondo: C.panel, verbo: 'Consolidar o salir' },
}

export function Pastilla({ accion, chica }) {
  const a = COLOR_ACCION[accion] || COLOR_ACCION.mantener
  return (
    <span style={{ background: a.fondo, color: a.color, borderRadius: 5,
                   padding: chica ? '2px 8px' : '3px 11px',
                   fontSize: chica ? 12 : 13, fontWeight: 700,
                   whiteSpace: 'nowrap' }}>
      {a.verbo}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PESOS — el segundo puntaje, el que el veredicto no puede ver.
//
// Solo aparece si la cartera trae cantidades y precios de compra. Sin eso no
// hay pesos que analizar y la sección entera se omite en vez de inventar una
// equiponderación que nadie pidió.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_ESTADO = {
  critico: C.rojo, sobre: C.ambar, banda: C.verde, sub: C.tenue,
}


// ─────────────────────────────────────────────────────────────────────────────
// EXPOSICIÓN POR CLASE DE ACTIVO
//
// Es lo que contesta "cuánto rotar de cada cosa". Solo aparece cuando se sabe
// qué hay fuera del informe — si no, no habría contra qué comparar.
//
// Límite que el documento declara en vez de esconder: acciones argentinas y
// renta fija local no tienen datos en las fuentes de este informe. Se pueden
// DIMENSIONAR pero no ANALIZAR.
// ─────────────────────────────────────────────────────────────────────────────

function Exposicion({ cart, expo }) {
  const { base, perfil, valorTotalCartera, cobertura } = cart
  const franjas = [
    { nombre: 'Acciones del exterior', pct: expo.exterior, color: C.acento,
      nota: 'analizadas en este informe' },
    ...base.resto.map(r => ({
      nombre: r.nombre, pct: r.pct, monto: r.monto,
      color: r.clave === 'accionesLocales' ? C.subtitulo
           : r.clave === 'rentaFija' ? C.verde : C.tenue,
      nota: r.clave === 'efectivo' ? null : 'sin datos para analizar',
    })),
  ].filter(f => f.pct > 0)

  return (
    <Seccion titulo="Cómo está repartida la cartera"
             nota={`Los pesos de todo este informe salen de ${ORIGEN_PESOS[cart.origenPesos]}.
                    Los activos analizados son el ${num(cobertura, 1)}% de la cartera.`}>

      <div className="evitar-corte" style={{ display: 'flex', height: 28,
        borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
        {franjas.map(f => (
          <div key={f.nombre} title={`${f.nombre}: ${f.pct}%`}
               style={{ width: `${f.pct}%`, background: f.color }} />
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Clase de activo</th><th className="n">Peso</th>
            <th className="n">Valor</th><th>Alcance del informe</th>
          </tr>
        </thead>
        <tbody>
          {franjas.map(f => (
            <tr key={f.nombre}>
              <td>
                <span style={{ display: 'inline-block', width: 9, height: 9,
                               borderRadius: 2, background: f.color, marginRight: 7 }} />
                {f.nombre}
              </td>
              <td className="n" style={{ fontWeight: 600 }}>{num(f.pct, 1)}%</td>
              <td className="n" style={{ color: C.tenue }}>
                {f.monto != null ? `US$ ${num(f.monto, 0)}`
                  : valorTotalCartera ? `US$ ${num(Math.round(f.pct / 100 * valorTotalCartera), 0)}` : '—'}
              </td>
              <td style={{ fontSize: 12.5, color: C.tenue }}>{f.nota || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="evitar-corte" style={{
        marginTop: 14, background: expo.excede ? C.ambarFondo : C.panel,
        borderRadius: 8, padding: '12px 15px' }}>
        <div style={{ fontSize: 15, fontWeight: 600,
                      color: expo.excede ? C.ambar : C.titulo, marginBottom: 5 }}>
          Renta variable: {num(expo.variable, 1)}% · tope del perfil {perfil.nombre.toLowerCase()}: {expo.tope}%
        </div>
        <p style={{ fontSize: 13.5, margin: 0 }}>
          {expo.excede ? (
            <>Está <b>{num(expo.excesoPct, 1)} puntos por encima</b> del tope.
            {expo.excesoUSD ? <> Volver al tope implica mover unos <b>US$ {num(expo.excesoUSD, 0)}</b> de
            acciones hacia renta fija o efectivo.</> : null}
            {' '}Cuánto sacar de cada papel sale de la sección de rotación: primero
            los que ya están marcados para salir o recortar.</>
          ) : expo.corto ? (
            <>Está bastante por debajo del tope. Para un perfil {perfil.nombre.toLowerCase()} eso
            no es prudencia, es desalineación con lo que el cliente pidió: hay
            {expo.faltaUSD ? <> unos <b>US$ {num(expo.faltaUSD, 0)}</b></> : ' capital'} sin
            trabajar en renta variable.</>
          ) : (
            <>Está dentro del tope del perfil. Las rotaciones que propone este
            informe son entre acciones, no entre clases de activo.</>
          )}
        </p>
        {expo.locales > 0 && (
          <p style={{ fontSize: 12.5, color: C.tenue, margin: '8px 0 0' }}>
            De esa renta variable, {num(expo.locales, 1)} puntos son acciones
            argentinas. Este informe no las analiza —no hay datos de fundamentales
            para ellas en sus fuentes— así que las cuenta para el riesgo pero no
            opina sobre cuáles conviene tener.
          </p>
        )}
      </div>
    </Seccion>
  )
}

function Pesos({ cart }) {
  const { perfil, activos, sectores, clases, valorTotal, sinPeso } = cart
  const fuera = activos.filter(a => a.estado === 'critico' || a.estado === 'sobre')
  const chicos = activos.filter(a => a.estado === 'sub')
  const sectoresFuera = sectores.filter(s => s.excede)

  return (
    <Seccion titulo="Cuánto pesa cada cosa"
             nota={`Perfil ${perfil.nombre.toLowerCase()}: tope de ${num(cart.topeGeneral, 0)}% por posición
                    (Core), ${num(cart.topeGeneral * 0.75, 0)}% Growth, ${num(cart.topeGeneral * 0.4, 0)}% Especulativo.
                    El tope no es fijo: es el mayor entre el del perfil y un múltiplo del peso
                    equiponderado (${num(cart.pesoEquiponderado, 1)}%), para no marcar sobrepeso
                    solo por tener pocas posiciones.`}>

      {cart.parcial === null && (
        <p style={{ fontSize: 13.5, color: C.ambar, marginTop: 0,
                    background: C.ambarFondo, borderRadius: 7, padding: '9px 12px' }}>
          <b>Estos porcentajes son sobre los activos de este informe, no sobre la
          cartera del cliente.</b> Si además tiene renta fija o acciones locales,
          los pesos reales son menores. Para que salgan bien, cargá la columna
          «% Posición» en el Excel o completá el resto de la cartera al generar
          el informe.
        </p>
      )}

      {sinPeso > 0 && (
        <p style={{ fontSize: 13.5, color: C.ambar, marginTop: 0 }}>
          {sinPeso} de los {activos.length} activos no tienen cantidad cargada, así
          que quedan fuera del cálculo de pesos. El resto suma 100%.
        </p>
      )}

      <div className="evitar-corte" style={{ display: 'flex', gap: 10,
                                             flexWrap: 'wrap', marginBottom: 14 }}>
        {clases.map(c => (
          <div key={c.clase} style={{ background: C.panel, borderRadius: 8,
                                      padding: '9px 15px', minWidth: 118 }}>
            <div style={{ fontFamily: F.num, fontSize: 20, fontWeight: 700,
                          color: C.titulo, lineHeight: 1.1 }}>{num(c.pct, 1)}%</div>
            <div style={{ fontSize: 12.5, color: C.tenue }}>
              {CLASE_TEXTO[c.clase]} · {c.n} activo{c.n > 1 ? 's' : ''}
            </div>
          </div>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Activo</th><th>Clase</th>
            <th className="n">Peso</th><th className="n">Tope</th>
            <th>Estado</th><th className="n">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {activos.slice().sort((a, b) => (b.peso ?? -1) - (a.peso ?? -1)).map(a => (
            <tr key={a.ticker}>
              <td>
                <span style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo }}>
                  {a.ticker}
                </span>
              </td>
              <td style={{ fontSize: 13, color: C.tenue }}>{CLASE_TEXTO[a.clase]}</td>
              <td className="n" style={{ fontWeight: a.estado === 'critico' ? 700 : 400,
                                         color: COLOR_ESTADO[a.estado] || C.cuerpo }}>
                {a.peso != null ? `${num(a.peso, 1)}%` : '—'}
              </td>
              <td className="n" style={{ color: C.tenue }}>{num(a.topeClase, 1)}%</td>
              <td style={{ fontSize: 12.5, color: COLOR_ESTADO[a.estado] || C.tenue }}>
                {ESTADO_TEXTO[a.estado] || '—'}
              </td>
              <td className="n" style={{
                color: a.gananciaPct > 0 ? C.verde : a.gananciaPct < 0 ? C.rojo : C.tenue }}>
                {a.gananciaPct != null ? pct(a.gananciaPct, 1, true) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {fuera.length > 0 && (
        <p style={{ fontSize: 13.5, marginTop: 12 }}>
          <b style={{ color: C.ambar }}>Por encima del tope:</b>{' '}
          {fuera.map(a => `${a.ticker} (${num(a.peso, 1)}%, US$ ${num(a.excesoUSD, 0)} de exceso)`)
            .join(' · ')}.
        </p>
      )}
      {chicos.length > 0 && (
        <p style={{ fontSize: 13.5, marginTop: 6, color: C.tenue }}>
          <b>Posiciones muy chicas:</b> {chicos.map(a => a.ticker).join(', ')}.
          Pesan menos de un tercio de lo equiponderado: aunque acierten, casi no
          mueven el resultado de la cartera. Conviene consolidarlas o salir.
        </p>
      )}
      {sectoresFuera.length > 0 && (
        <p style={{ fontSize: 13.5, marginTop: 6, color: C.ambar }}>
          <b>Sectores por encima del {num(sectoresFuera[0].tope, 0)}%:</b>{' '}
          {sectoresFuera.map(s => `${s.sector} ${num(s.pct, 1)}%`).join(' · ')}.
          {valorTotal ? ` Volver al tope implica mover unos US$ ${num(
            sectoresFuera.reduce((a, s) => a + (s.excesoUSD || 0), 0), 0)}.` : ''}
        </p>
      )}
      <RiesgoArgentino a={cart.argentina} valorTotal={valorTotal} />
    </Seccion>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LA COMPUERTA DE DATOS — el cartel que faltaba
//
// La cobertura vivía en cinco lugares con cinco escalas: las métricas por
// posición, la cobertura del cálculo de riesgo, la de la cartera, la de
// industria y el nivel de cada informe. Cinco números que había que cruzar
// mentalmente para contestar la única pregunta que importa: ¿alcanza para
// decidir? Nadie los cruzaba, y el informe salía completo —tabla, objetivo y
// prosa— sobre una cartera de la que sabíamos la mitad.
//
// Cuando los datos están completos NO se dibuja NADA. Es la mitad del valor
// de esto: un cartel que aparece siempre se ignora siempre.
// ─────────────────────────────────────────────────────────────────────────────
function CompuertaDeDatos({ s }) {
  if (!s || s.nivel === 'completo') return null
  const rojo = !s.puede_decidir
  return (
    <div style={{
      margin: '0 0 20px', padding: '13px 16px', borderRadius: 9,
      background: rojo ? C.rojoFondo : C.ambarFondo,
      color: rojo ? C.rojo : C.ambar, fontSize: 13.5, lineHeight: 1.55 }}>
      <strong>{s.resumen}</strong>
      {s.faltantes.length > 0 && (
        <ul style={{ margin: '7px 0 0', paddingLeft: 18 }}>
          {s.faltantes.map((f, i) => (
            <li key={i}>
              <b>{f.que}:</b> {f.detalle}
              <span style={{ opacity: 0.85 }}> — {f.consecuencia}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Lo accionable. Sin esto, esto sería un sexto porcentaje. */}
      {s.no_se_puede_afirmar.length > 0 && (
        <div style={{ marginTop: 9, fontSize: 12.5 }}>
          <b>Con estos datos NO se puede afirmar:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {s.no_se_puede_afirmar.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EL RIESGO PAÍS — lo que la tabla de sectores no puede mostrar
//
// Los ADR argentinos están repartidos entre Financials, Energy, Utilities,
// Materials, Communication Services y Real Estate. Cada uno entra cómodo en su
// tope de posición, ninguno satura su sector, y una cartera puede quedar 60%
// argentina sin que ninguna fila de la tabla de arriba se ponga en ámbar.
//
// Pero no son quince apuestas: son una. Cuando el país se mueve, se mueven
// todos — y eso tampoco lo captura bien la correlación histórica, porque el
// período de calma la subestima justo antes de que importe.
//
// Se muestra SIEMPRE que haya papeles argentinos, exceda o no. Que el número
// esté dentro del techo también es información: significa que hay lugar.
// ─────────────────────────────────────────────────────────────────────────────
function RiesgoArgentino({ a, valorTotal }) {
  if (!a || !a.n) return null
  const porConteo = a.denominador === 'cantidad de posiciones'
  return (
    <p style={{ fontSize: 13.5, marginTop: 6,
                color: a.excede ? C.ambar : C.tenue }}>
      <b>Riesgo Argentina: {num(a.pct, 1)}%</b>
      {a.tope != null && ` (máximo ${num(a.tope, 0)}% para este perfil)`}
      {' · '}{a.n} {a.n === 1 ? 'papel' : 'papeles'}: {a.tickers.join(', ')}.
      {porConteo
        ? ' Ojo: sin montos cargados esto es la proporción de POSICIONES, no de plata.'
        : a.excede
          ? (valorTotal && a.excesoUSD
              ? ` Volver al tope implica mover unos US$ ${num(a.excesoUSD, 0)}.`
              : ' Está por encima del techo del perfil.')
          : ''}
      {!porConteo && (
        <span style={{ display: 'block', fontSize: 12.5, color: C.tenue,
                       marginTop: 3 }}>
          Están en sectores distintos, así que ningún tope sectorial los junta —
          pero se mueven con el mismo factor. No es una opinión sobre las
          empresas.
        </span>
      )}
    </p>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AFINIDAD CON EL OBJETIVO (punto 13)
//
// Los MISMOS bloques que ya calculó el endpoint, mirados con otra balanza. No
// hay ningún dato nuevo acá: hay una ponderación distinta y explícita.
//
// El puntaje fundamental NO se toca. Aparecen los dos, y lo interesante es la
// diferencia: cuando son muy distintos, la empresa es buena pero para otra cosa.
// ─────────────────────────────────────────────────────────────────────────────

function Afinidad({ cart }) {
  const { objetivo, horizonte, activos, perfil } = cart
  const conAmbos = activos.filter(a => a.afinidad != null && a.puntajeFundamental != null)
  if (!conAmbos.length) return null
  const desalineados = conAmbos.filter(a => Math.abs(a.brechaObjetivo) >= 8)
    .sort((a, b) => a.brechaObjetivo - b.brechaObjetivo)

  return (
    <Seccion titulo={`Qué tan bien encaja: objetivo ${objetivo.nombre.toLowerCase()}, `
                    + `perfil ${perfil.nombre.toLowerCase()}`}
             nota={`${objetivo.resumen} Horizonte: ${horizonte.nombre.toLowerCase()}.
                    ${horizonte.nota}`}>

      <p style={{ fontSize: 13.5, marginTop: 0, marginBottom: 12, color: C.tenue }}>
        La afinidad usa exactamente los mismos bloques del análisis, con otra
        ponderación. No hay datos nuevos: hay otra balanza. Por eso el puntaje
        fundamental no cambia — se muestran los dos al lado.{' '}
        <b>Y después se descuenta el riesgo que este perfil no tolera</b>: la
        misma empresa puede encajar con un perfil agresivo y no con uno
        conservador, y ese descuento se muestra en la última columna.
      </p>

      <table>
        <thead>
          <tr>
            <th>Activo</th><th>Clase</th>
            <th className="n">Fundamental</th>
            <th className="n">Afinidad</th>
            <th className="n">Diferencia</th>
            <th>Descuento por riesgo</th>
          </tr>
        </thead>
        <tbody>
          {conAmbos.slice().sort((a, b) => b.afinidad - a.afinidad).map(a => (
            <tr key={a.ticker}>
              <td>
                <span style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo }}>
                  {a.ticker}
                </span>
              </td>
              <td style={{ fontSize: 13, color: C.tenue }}>{CLASE_TEXTO[a.clase]}</td>
              <td className="n">{num(a.puntajeFundamental, 0)}</td>
              <td className="n" style={{ fontWeight: 600,
                    color: semaforo(a.afinidad).color }}>{num(a.afinidad, 0)}</td>
              <td className="n" style={{
                    color: a.brechaObjetivo > 0 ? C.verde
                         : a.brechaObjetivo < 0 ? C.rojo : C.tenue }}>
                {pct(a.brechaObjetivo, 0, true).replace('%', '')}
              </td>
              {/* Un número que baja de 74 a 11 sin decir por qué es
                  indistinguible de un error. Acá va la cuenta. */}
              <td style={{ fontSize: 12.5 }}>
                {!a.afinidadDetalle || a.afinidadDetalle.castigo === 0 ? (
                  <span style={{ color: C.tenue }}>—</span>
                ) : (
                  <span style={{ color: a.afinidadDetalle.incompatible
                                        ? C.rojo : C.ambar }}>
                    <b>−{num(a.afinidadDetalle.castigo, 0)}</b>{' '}
                    {a.afinidadDetalle.motivos.map(m => m.texto).join('; ')}
                    {a.afinidadDetalle.incompatible
                      && <b> · no corresponde para este perfil</b>}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {desalineados.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {desalineados.slice(0, 4).map(a => (
            <p key={a.ticker} style={{ fontSize: 13.5, margin: '0 0 6px' }}>
              <b style={{ fontFamily: F.num, color: C.titulo }}>{a.ticker}</b>{' '}
              {a.brechaObjetivo < 0
                ? `puntúa ${num(a.puntajeFundamental, 0)} como empresa pero ${num(a.afinidad, 0)}
                   para una cartera de ${objetivo.nombre.toLowerCase()}: es buena, pero no para esto.`
                : `puntúa ${num(a.puntajeFundamental, 0)} como empresa y ${num(a.afinidad, 0)}
                   para este objetivo: encaja mejor de lo que su puntaje general sugiere.`}
            </p>
          ))}
        </div>
      )}
    </Seccion>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STRESS TEST (punto 19)
// ─────────────────────────────────────────────────────────────────────────────

function Stress({ cart, stress }) {
  const peor = stress.escenarios[0]
  return (
    <Seccion titulo="Qué pasa si las cosas salen mal"
             nota="Cuánto perdería la cartera en cuatro escenarios. Ninguno es una
                   predicción: son cuentas sobre los pesos de hoy.">
      <table>
        <thead>
          <tr>
            <th>Escenario</th>
            <th className="n">Impacto</th>
            <th className="n">En dólares</th>
            <th>Por qué ese número</th>
          </tr>
        </thead>
        <tbody>
          {stress.escenarios.map(e => (
            <tr key={e.titulo}>
              <td style={{ fontWeight: 600, color: C.titulo }}>{e.titulo}</td>
              <td className="n" style={{ color: C.rojo, fontWeight: 600 }}>
                {num(e.caidaPct, 1)}%
              </td>
              <td className="n" style={{ color: C.rojo }}>
                US$ {num(Math.abs(e.caidaUSD), 0)}
              </td>
              <td style={{ fontSize: 12.5, color: C.tenue }}>
                {e.detalle}
                {!e.modelo && ' Es aritmética sobre los pesos, sin modelo.'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {peor && (
        <p style={{ fontSize: 13.5, marginTop: 10 }}>
          El escenario más caro de los cuatro es <b>{peor.titulo.toLowerCase()}</b>:
          {' '}US$ {num(Math.abs(peor.caidaUSD), 0)}, un {num(Math.abs(peor.caidaPct), 1)}%
          de la cartera.
        </p>
      )}
      <p style={{ fontSize: 12.5, color: C.tenue, marginTop: 8, fontStyle: 'italic' }}>
        {stress.noCalculado}
      </p>
    </Seccion>
  )
}

function Rotacion({ plan, total, cart, mercado = null }) {
  const { sacar, mantener, reforzar, sinDatos, sectoresPesados } = plan
  const nada = sacar.length === 0

  // Con pesos, la accion sale de cruzar los DOS puntajes (matriz en cartera.js).
  // Sin pesos, sale solo del fundamental, como venia. Los contadores tienen que
  // reflejar lo que el documento realmente recomienda, no una de las dos mitades.
  const conPesos = cart?.hayPesos
  const recortar = conPesos ? cart.activos.filter(a => a.accion === 'recortar') : []
  const consolidar = conPesos ? cart.activos.filter(a => a.accion === 'consolidar') : []
  const contadores = conPesos
    ? ['sacar', 'recortar', 'consolidar', 'mantener', 'reforzar', 'revisar a mano']
        .map(k => [k, cart.activos.filter(a => a.accion === k).length])
    : [['sacar', sacar.length], ['mantener', mantener.length],
       ['reforzar', reforzar.length], ['revisar a mano', sinDatos.length]]

  return (
    <Seccion titulo="Qué hacer con esta cartera"
             nota={conPesos
               ? `Una acción por activo, del cruce de dos preguntas distintas:
                  si la empresa está bien, y si está bien que pese lo que pesa.
                  No contempla tu horizonte ni el costo impositivo de vender.`
               : `Una acción por activo, ordenada por urgencia. Sale solo de los
                  fundamentales: esta cartera no trae cantidades, así que el
                  informe no sabe cuánto pesa cada papel.`}>

      {/* De cuántos papeles se está eligiendo, y dónde no hay de dónde elegir.
          Antes el informe ofrecía "el mejor de Real Estate" sin decir que era
          el ÚNICO de Real Estate — una elección de uno no es una elección. */}
      {mercado?.resumen && (
        <p style={{ fontSize: 12.5, color: C.tenue, marginTop: -4,
                    marginBottom: 12 }}>
          Las alternativas salen de los <b>{mercado.resumen.operables} papeles
          que se pueden comprar como CEDEAR</b> ({mercado.resumen.deAfuera} de
          ellos fuera del S&amp;P 500), puntuados contra
          las {mercado.resumen.total} de su mismo sector.
          {mercado.resumen.sectoresSinAlternativa.length > 0 && (
            <> <span style={{ color: C.ambar }}>
              En {mercado.resumen.sectoresSinAlternativa.join(' y ')} no hay
              alternativa real: son menos de tres papeles operables, así que ahí
              la única decisión posible es quedarse o salir del sector.
            </span></>
          )}
        </p>
      )}

      <div className="evitar-corte" style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {contadores
          .filter(([, n]) => n > 0).map(([accion, n]) => {
            const a = COLOR_ACCION[accion]
            return (
              <div key={accion} style={{ background: a.fondo, borderRadius: 8,
                                         padding: '9px 15px', minWidth: 96 }}>
                <div style={{ fontFamily: F.num, fontSize: 22, fontWeight: 700,
                              color: a.color, lineHeight: 1.1 }}>{n}</div>
                <div style={{ fontSize: 12.5, color: a.color }}>
                  {a.verbo.toLowerCase()}
                </div>
              </div>
            )
          })}
      </div>

      {nada ? (
        <p style={{ fontSize: 14.5 }}>
          Ningún activo de los {total} analizados cae en venta por
          fundamentales. No hay rotación que proponer hoy.
        </p>
      ) : (
        <>
          <h3 style={{ fontSize: 15, color: C.rojo, margin: '0 0 4px' }}>
            Conviene sacar — en este orden
          </h3>
          <p style={{ color: C.tenue, fontSize: 13, marginTop: 0, marginBottom: 12 }}>
            Primero los que tienen banderas rojas abiertas; después, a igualdad
            de banderas, los de peor puntaje contra su propio sector.
          </p>
          {sacar.map((f, i) => <FilaSacar key={f.ticker} f={f} orden={i + 1} />)}
        </>
      )}

      {recortar.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3 style={{ fontSize: 15, color: C.ambar, margin: '0 0 4px' }}>
            Conviene recortar — no por la empresa, por el tamaño
          </h3>
          <p style={{ color: C.tenue, fontSize: 13, marginTop: 0, marginBottom: 10 }}>
            Estos papeles no tienen problemas de fundamentales. Lo que está fuera
            de lugar es cuánto pesan: si cualquiera de ellos cae fuerte, se lleva
            puesta la cartera. Recortar no es salir.
          </p>
          <table>
            <thead>
              <tr>
                <th>Activo</th><th>Veredicto</th>
                <th className="n">Peso</th><th className="n">Tope</th>
                <th className="n">Vender aprox.</th><th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {recortar.map(a => (
                <tr key={a.ticker}>
                  <td>
                    <span style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo }}>
                      {a.ticker}
                    </span>
                    <span style={{ color: C.tenue, fontSize: 12, marginLeft: 6 }}>
                      {CLASE_TEXTO[a.clase]}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, textTransform: 'capitalize' }}>{a.etiqueta}</td>
                  <td className="n" style={{ color: COLOR_ESTADO[a.estado], fontWeight: 600 }}>
                    {num(a.peso, 1)}%
                  </td>
                  <td className="n" style={{ color: C.tenue }}>{num(a.topeClase, 1)}%</td>
                  <td className="n">US$ {num(a.excesoUSD, 0)}</td>
                  <td style={{ fontSize: 12.5, color: C.tenue }}>
                    {a.tomaGanancia
                      ? `Sale con ${pct(a.gananciaPct, 0, true)} de ganancia: es toma de ganancia, no corrección de un error.`
                      : a.estado === 'critico' ? 'Sobrepeso crítico.' : 'Sobre el tope del perfil.'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {consolidar.length > 0 && (
        <p style={{ marginTop: 14, fontSize: 13.5, color: C.tenue }}>
          <b>Consolidar o salir:</b> {consolidar.map(a => `${a.ticker} (${num(a.peso, 1)}%)`).join(' · ')}.
          Son posiciones tan chicas que su resultado casi no cambia el de la
          cartera, pero siguen ocupando atención y costo de operar.
        </p>
      )}

      {sectoresPesados.length > 0 && !conPesos && (
        <p style={{ marginTop: 14, fontSize: 13.5, color: C.ambar }}>
          {sectoresPesados.join(' y ')} {sectoresPesados.length > 1 ? 'pesan' : 'pesa'}
          {' '}más del {SECTOR_PESADO_PCT}% de la cartera. Los reemplazos de otro
          sector evitan a propósito {sectoresPesados.length > 1 ? 'esos sectores' : 'ese sector'}:
          rotar dentro de lo que ya sobra arregla el papel y deja el problema.
        </p>
      )}

      {[...reforzar, ...mantener, ...sinDatos].some(f => !conPesos ||
          !['recortar', 'consolidar', 'sacar'].includes(cart.porTicker[f.ticker]?.accion)) && (
        <div className="evitar-corte" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 15, color: C.subtitulo, margin: '0 0 8px' }}>
            El resto de la cartera
          </h3>
          <table>
            <thead>
              <tr>
                <th>Activo</th><th>Sector</th><th>Acción</th>
                <th className="n">Puntaje</th><th>Por qué</th>
              </tr>
            </thead>
            <tbody>
              {/* Con pesos, algunos de estos pasaron a recortar o consolidar y ya
                  tienen su propio bloque arriba: si no se filtran, el mismo activo
                  aparece dos veces con dos recomendaciones distintas. */}
              {[...reforzar, ...mantener, ...sinDatos]
                .filter(f => !conPesos ||
                  !['recortar', 'consolidar', 'sacar'].includes(
                    cart.porTicker[f.ticker]?.accion))
                .map(f => (
                <tr key={f.ticker}>
                  <td>
                    <span style={{ fontFamily: F.num, fontWeight: 600,
                                   color: C.titulo }}>{f.ticker}</span>
                    {conPesos && cart.porTicker[f.ticker]?.peso != null && (
                      <span style={{ color: C.tenue, fontSize: 12, marginLeft: 6,
                                     fontFamily: F.num }}>
                        {num(cart.porTicker[f.ticker].peso, 1)}%
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 13, color: C.tenue }}>{f.sector || '—'}</td>
                  <td><Pastilla accion={conPesos
                        ? (cart.porTicker[f.ticker]?.accion || f.accion) : f.accion} chica /></td>
                  <td className="n">{f.puntaje != null ? num(f.puntaje, 0) : '—'}</td>
                  <td style={{ fontSize: 13 }}>
                    {f.limitadoPorBandera
                      ? 'Puntaje de compra, pero con una bandera roja abierta no se recomienda ampliar.'
                      : f.motivo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  )
}

function FilaSacar({ f, orden }) {
  const r = f.reemplazos
  const alternativas = [['Mismo sector', r?.mismoSector],
                        ['Otro sector', r?.otroSector]].filter(([, a]) => a)
  return (
    <div className="evitar-corte" style={{
      border: `1px solid ${C.borde}`, borderLeft: `4px solid ${C.rojo}`,
      borderRadius: 9, padding: '13px 16px', marginBottom: 10 }}>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10,
                    flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.num, fontSize: 13, color: C.tenue }}>
          {orden}.
        </span>
        <span style={{ fontFamily: F.num, fontSize: 17, fontWeight: 700,
                       color: C.titulo }}>{f.ticker}</span>
        <span style={{ color: C.subtitulo, fontSize: 14 }}>{f.nombre}</span>
        <span style={{ fontSize: 12.5, color: C.tenue }}>{f.sector}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8,
                       alignItems: 'center' }}>
          {f.banderas > 0 && (
            <span style={{ fontSize: 12, color: C.rojo }}>
              {f.banderas} bandera{f.banderas > 1 ? 's' : ''} roja{f.banderas > 1 ? 's' : ''}
            </span>
          )}
          {f.puntaje != null && (
            <span style={{ fontFamily: F.num, fontSize: 13, color: C.tenue }}>
              {num(f.puntaje, 0)}/100
            </span>
          )}
          <Pastilla accion="sacar" />
        </span>
      </div>

      <p style={{ fontSize: 13.5, margin: '9px 0 0' }}>{f.motivo}</p>

      {alternativas.length > 0 && (
        <div style={{ marginTop: 11 }}>
          <div style={{ fontSize: 12, color: C.tenue, textTransform: 'uppercase',
                        letterSpacing: '.03em', marginBottom: 5 }}>
            En su lugar, para revisar
          </div>
          <table>
            <thead>
              <tr>
                <th>Alternativa</th><th>Sector</th>
                <th className="n">Puntaje</th><th className="n">P/E</th>
                <th className="n">ROE</th>
              </tr>
            </thead>
            <tbody>
              {alternativas.map(([label, a]) => (
                <tr key={label}>
                  <td>
                    <span style={{ fontFamily: F.num, fontWeight: 600,
                                   color: C.titulo }}>{a.symbol}</span>
                    <span style={{ color: C.tenue, fontSize: 12.5, marginLeft: 7 }}>
                      {a.name}
                    </span>
                    <div style={{ fontSize: 11.5, color: C.tenue }}>{label}</div>
                  </td>
                  <td style={{ fontSize: 13.5, color: C.tenue }}>{a.sector}</td>
                  <td className="n" style={{ color: C.verde, fontWeight: 600 }}>
                    {num(a.score, 0)}
                  </td>
                  <td className="n">{a.pe != null ? `${num(a.pe, 1)}x` : '—'}</td>
                  <td className="n">{pct(a.roe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Resumen({ informes, plan }) {
  return (
    <Seccion titulo="Resumen">
      <table>
        <thead>
          <tr>
            <th>Activo</th><th>Sector</th><th>Veredicto</th><th>Acción</th>
            <th className="n">Puntaje</th><th className="n">Recorrido</th>
            <th className="n">Riesgos</th>
          </tr>
        </thead>
        <tbody>
          {informes.map(i => {
            const v = i.veredicto || {}
            const s = semaforo(v.puntaje)
            const altos = (i.riesgos || []).filter(r => r.severidad === 'alta').length
            return (
              <tr key={i.ticker}>
                <td>
                  <span style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo }}>
                    {i.ticker}
                  </span>
                  <span style={{ color: C.tenue, fontSize: 12.5, marginLeft: 7 }}>
                    {i.nombre}
                  </span>
                </td>
                <td style={{ fontSize: 13.5, color: C.tenue }}>{i.sector || '—'}</td>
                <td>
                  <span style={{ background: s.fondo, color: s.color, borderRadius: 5,
                                 padding: '2px 9px', fontSize: 12.5, fontWeight: 600,
                                 textTransform: 'capitalize' }}>
                    {v.etiqueta}
                  </span>
                </td>
                <td>
                  <Pastilla accion={plan.porTicker[i.ticker]?.accion || v.accion} chica />
                </td>
                <td className="n">{v.puntaje != null ? num(v.puntaje, 0) : '—'}</td>
                <td className="n" style={{
                  color: (i.consenso?.upsidePct ?? 0) > 0 ? C.verde : C.rojo }}>
                  {pct(i.consenso?.upsidePct, 1, true)}
                </td>
                <td className="n" style={{ color: altos ? C.rojo : C.tenue }}>
                  {altos || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Seccion>
  )
}

function Composicion({ datos, industrias = null }) {
  const colores = [C.acento, C.subtitulo, C.verde, C.ambar, C.acentoClaro,
                   C.titulo, C.tenue]
  return (
    <Seccion titulo="Composición por sector"
             nota="Cantidad de activos por sector, sin ponderar por monto invertido.">
      <div className="evitar-corte" style={{ display: 'flex', height: 26,
                                             borderRadius: 6, overflow: 'hidden',
                                             marginBottom: 12 }}>
        {datos.map((d, i) => (
          <div key={d.sector} title={`${d.sector}: ${d.n}`}
               style={{ width: `${d.pct}%`, background: colores[i % colores.length] }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13 }}>
        {datos.map((d, i) => (
          <span key={d.sector} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2,
                           background: colores[i % colores.length] }} />
            {d.sector} · {d.n} ({d.pct}%)
          </span>
        ))}
      </div>
      {datos[0] && datos[0].pct > 50 && (
        <p style={{ marginTop: 12, fontSize: 13.5, color: C.ambar }}>
          Más de la mitad de la cartera está en {datos[0].sector}. Una caída
          sectorial impactaría de forma desproporcionada.
        </p>
      )}

      {/* El nivel fino. "Financials 80%" puede ser cuatro bancos —una sola
          apuesta con cuatro nombres— o tres bancos y una aseguradora. Arriba
          se dibujan idénticos. */}
      {industrias?.confiable && industrias.concentradas.length > 0 && (
        <div className="evitar-corte" style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: 14.5, color: C.subtitulo, margin: '0 0 6px' }}>
            Dentro de cada sector
          </h4>
          <p style={{ fontSize: 13.5, marginTop: 0, marginBottom: 8 }}>
            Un sector puede parecer repartido y no estarlo. Estas industrias
            juntan dos o más posiciones:
          </p>
          <table style={{ maxWidth: 620 }}>
            <thead>
              <tr>
                <th>Industria</th><th>Sector</th>
                <th className="n">Peso</th><th>Posiciones</th>
              </tr>
            </thead>
            <tbody>
              {industrias.concentradas.map(g => (
                <tr key={g.industry}>
                  <td style={{ color: C.titulo, fontWeight: 600 }}>{g.industry}</td>
                  <td style={{ fontSize: 13, color: C.tenue }}>{g.sector}</td>
                  <td className="n" style={{ fontWeight: 600, color: C.ambar }}>
                    {num(g.pct, 1)}%
                  </td>
                  <td style={{ fontFamily: F.num, fontSize: 13 }}>
                    {g.tickers.join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Faltar el dato NO es lo mismo que no haber concentración, y callarse
          se lee como lo segundo. */}
      {industrias && !industrias.confiable && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: C.tenue }}>
          No se puede analizar la concentración por industria: solo{' '}
          {num(industrias.cobertura_pct, 0)}% de las posiciones traen ese dato
          {industrias.sin_dato.length > 0
            && ` (faltan en ${industrias.sin_dato.slice(0, 8).join(', ')}`
               + `${industrias.sin_dato.length > 8 ? '…' : ''})`}.
          Se completa corriendo <code>fetch_informe.py</code> de nuevo.
        </p>
      )}
    </Seccion>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTUAL vs OBJETIVO — la tabla que faltaba
//
// Todo lo que hay acá ya se calculaba y no se dibujaba en ningún lado: el peso
// objetivo por paridad de riesgo, el aporte al riesgo de cada posición y la
// correlación con el resto. El informe sabía decir "AAPL excede el tope de 12%"
// y no sabía decir "AAPL pesa 30% y aporta el 60% del riesgo, moverlo a KO baja
// la volatilidad 3,6 puntos y moverlo a MSFT baja 0,4".
//
// No lleva `no-imprimir`: esta sección SÍ va al PDF del cliente. Es la que
// convierte el diagnóstico en algo que se puede operar el lunes.
// ─────────────────────────────────────────────────────────────────────────────
const COLOR_MOV = { comprar: C.verde, vender: C.rojo, mantener: C.tenue }
const TEXTO_MOV = { comprar: 'Comprar', vender: 'Vender', mantener: 'Queda igual' }

function ActualVsObjetivo({ plan }) {
  const mueve = plan.filas.filter(f => f.movimiento !== 'mantener')
  // Sin mejora medible, la recomendación honesta es no hacer nada. Se dice acá
  // arriba, antes de la tabla, para que no se lea como una lista de tareas.
  const valeLaPena = plan.mejoraVol != null && plan.mejoraVol >= 0.3

  return (
    <Seccion titulo="Cuánto debería pesar cada cosa"
             nota={`El peso objetivo reparte el riesgo, no el dinero: busca que cada posición
                    aporte una porción parecida de la volatilidad total, respetando los topes
                    del perfil. Se calcula con ${plan.filas.length ? '3 años de precios' : 'el histórico'}
                    diarios y no usa ningún pronóstico de retorno.`}>

      <div className="evitar-corte" style={{ display: 'flex', gap: 10,
                                             flexWrap: 'wrap', marginBottom: 14 }}>
        <Dato valor={`${num(plan.volActual, 1)}%`} etiqueta="Volatilidad hoy" />
        <Dato valor={`${num(plan.volObjetivo, 1)}%`} etiqueta="Si se ejecuta" />
        <Dato valor={plan.mejoraVol != null
                       ? `${plan.mejoraVol > 0 ? '−' : '+'}${num(Math.abs(plan.mejoraVol), 1)} pts`
                       : '—'}
              etiqueta="Cambio de riesgo"
              color={valeLaPena ? C.verde : C.tenue} />
        <Dato valor={String(plan.nMovimientos)} etiqueta={`Movimiento${plan.nMovimientos === 1 ? '' : 's'}`} />
      </div>

      {!valeLaPena && (
        <p style={{ fontSize: 13.5, color: C.tenue, marginTop: 0 }}>
          <b>Los ajustes no cambian el riesgo de forma apreciable</b> ({plan.mejoraVol != null
          ? `${num(plan.mejoraVol, 1)} puntos` : 'sin medir'}). La cartera ya está razonablemente
          repartida: se pueden hacer, pero no hay urgencia en hacerlos.
        </p>
      )}

      {plan.coberturaPct != null && plan.coberturaPct < 99 && (
        <p style={{ fontSize: 13.5, color: C.ambar, marginTop: 0,
                    background: C.ambarFondo, borderRadius: 7, padding: '9px 12px' }}>
          Este cálculo cubre el {num(plan.coberturaPct, 1)}% de las acciones de la cartera.
          {plan.sinDatos.length > 0 && ` Sin histórico suficiente: ${plan.sinDatos.join(', ')}.`}
        </p>
      )}

      {plan.topesInsuficientes && (
        <p style={{ fontSize: 13.5, color: C.ambar, marginTop: 0 }}>
          <b>Los topes no alcanzan.</b> {plan.topesInsuficientes.nota}
        </p>
      )}

      {/* La explicación que hace falta ANTES de la tabla: si no, el lector ve
          cuatro bancos recortados y ninguno excedía su tope individual. */}
      {plan.gruposLimitantes && plan.gruposLimitantes.length > 0 && (
        <div style={{ background: C.ambarFondo, borderRadius: 7,
                      padding: '10px 13px', marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, color: C.ambar, fontWeight: 600,
                        marginBottom: 5 }}>
            Hay recortes que no son por el papel, son por el grupo
          </div>
          {plan.gruposLimitantes.map(g => (
            <div key={`${g.tipo}-${g.nombre}`}
                 style={{ fontSize: 13.5, marginTop: 3 }}>
              <b>{g.nombre}</b> {g.tipo === 'industria' ? '(industria)' : '(sector)'}
              {' '}pesa {num(g.actual_pct, 1)}% y el máximo es {num(g.tope_pct, 1)}%,
              así que baja a {num(g.objetivo_pct, 1)}%. Se achican{' '}
              <span style={{ fontFamily: F.num }}>{g.tickers.join(', ')}</span> —
              no porque estén mal, sino porque juntos pesan de más. Se recorta
              más al que más riesgo aporta.
            </div>
          ))}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Activo</th>
            <th className="n">Pesa</th>
            <th className="n">Debería</th>
            <th className="n">Δ</th>
            <th className="n">Monto</th>
            <th className="n">Aporta al riesgo</th>
            <th className="n">Corr.</th>
            <th>Qué hacer</th>
          </tr>
        </thead>
        <tbody>
          {plan.filas.map(f => (
            <tr key={f.ticker}>
              <td>
                <span style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo }}>
                  {f.ticker}
                </span>
                {f.limitadoPorGrupo?.length > 0 ? (
                  <span style={{ fontSize: 11.5, color: C.ambar }}>
                    {' '}· por {f.limitadoPorGrupo[0]}
                  </span>
                ) : f.limitadoPorTope && (
                  <span style={{ fontSize: 11.5, color: C.tenue }}> · en el tope</span>
                )}
              </td>
              <td className="n">{f.peso != null ? `${num(f.peso, 1)}%` : '—'}</td>
              <td className="n" style={{ color: C.titulo, fontWeight: 600 }}>
                {f.objetivo != null ? `${num(f.objetivo, 1)}%` : '—'}
              </td>
              <td className="n" style={{ color: COLOR_MOV[f.movimiento] }}>
                {f.delta != null ? `${f.delta > 0 ? '+' : ''}${num(f.delta, 1)} pp` : '—'}
              </td>
              <td className="n" style={{ color: COLOR_MOV[f.movimiento] }}>
                {f.movimiento === 'mantener' || f.montoUSD == null
                  ? '—'
                  : `US$ ${num(Math.abs(f.montoUSD), 0)}`}
                {f.movimiento !== 'mantener' && f.acciones != null && f.acciones !== 0 && (
                  <span style={{ fontSize: 11.5, color: C.tenue }}>
                    {' '}({Math.abs(f.acciones)} acc.)
                  </span>
                )}
              </td>
              {/* Las dos columnas que separan "pesa mucho" de "arriesga mucho".
                  Son la lectura que el informe no tenía: un papel puede estar
                  dentro del tope y aportar el triple de riesgo que su peso. */}
              <td className="n" style={{
                    fontWeight: f.concentraRiesgo ? 700 : 400,
                    color: f.concentraRiesgo ? C.ambar : C.cuerpo }}>
                {f.aporteRiesgo != null ? `${num(f.aporteRiesgo, 1)}%` : '—'}
              </td>
              <td className="n" style={{ color: C.tenue }}>
                {f.correlacion != null ? num(f.correlacion, 2) : '—'}
              </td>
              <td style={{ fontSize: 12.5, color: COLOR_MOV[f.movimiento] }}>
                {TEXTO_MOV[f.movimiento]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {plan.refuerzosBloqueados?.length > 0 && (
        <p style={{ fontSize: 13.5, color: C.ambar, marginTop: 14,
                    background: C.ambarFondo, borderRadius: 7, padding: '9px 12px' }}>
          <b>Ojo con {plan.refuerzosBloqueados.map(f => f.ticker).join(' y ')}.</b>{' '}
          El reparto por riesgo los agranda, pero su sector ya toca el techo
          después del ajuste: agrandarlos ahí no diversifica nada, mueve plata
          de un bolsillo al otro del mismo pantalón. Esa parte conviene que
          salga del sector — las opciones están abajo.
        </p>
      )}

      {plan.menu?.length > 0 && <MenuDeRotacion menu={plan.menu}
                                  volPlan={plan.volObjetivo} />}
      {plan.entradas?.length > 0 && <EntrarEnAlgoNuevo entradas={plan.entradas}
                                      volPlan={plan.volObjetivo} />}
      {plan.benchmark && <ContraElIndice b={plan.benchmark} />}
      {plan.pares && plan.pares.length > 0 && <UnaSolaApuesta pares={plan.pares} />}

      {mueve.length > 0 && (
        <p style={{ fontSize: 13.5, marginTop: 12 }}>
          <b>En total:</b> vender US$ {num(plan.venderUSD, 0)} y comprar
          US$ {num(plan.comprarUSD, 0)}.{' '}
          {Math.abs(plan.venderUSD - plan.comprarUSD) > plan.venderUSD * 0.1 && (
            <span style={{ color: C.tenue }}>
              La diferencia sale de —o va a— las posiciones sin datos de riesgo y
              el resto de la cartera.
            </span>
          )}
        </p>
      )}

      <p style={{ fontSize: 12.5, color: C.tenue, marginTop: 10 }}>
        Los ajustes de menos de {num(plan.umbralPP, 1)} punto porcentual quedan como están:
        están adentro del error del propio cálculo. La correlación es contra el resto de
        la cartera, ponderada por peso —cerca de 1 significa que ese papel repite lo que ya
        hay—. Las correlaciones son históricas y tienden a subir justo en las caídas, así
        que esta tabla convive con el escenario de estrés, no lo reemplaza.
      </p>
    </Seccion>
  )
}

// ── CONTRA EL ÍNDICE ────────────────────────────────────────────────────────
// SPY estaba en el snapshot desde el primer día (1.674 puntos) y no se
// comparaba con nada. Sin benchmark, "rinde 24% con 16% de volatilidad" no se
// puede juzgar: la pregunta que el cliente hace igual es si eso le gana a
// comprar el índice y quedarse quieto.
function ContraElIndice({ b }) {
  const gana = b.retorno_sobre_volatilidad != null
    && b.retorno_sobre_volatilidad_benchmark != null
    && b.retorno_sobre_volatilidad > b.retorno_sobre_volatilidad_benchmark
  const fila = (etiqueta, cart, idx, suf = '') => (
    <tr>
      <td style={{ color: C.tenue }}>{etiqueta}</td>
      <td className="n" style={{ fontWeight: 600, color: C.titulo }}>
        {cart != null ? `${num(cart, cart < 10 ? 2 : 1)}${suf}` : '—'}
      </td>
      <td className="n" style={{ color: C.tenue }}>
        {idx != null ? `${num(idx, idx < 10 ? 2 : 1)}${suf}` : '—'}
      </td>
    </tr>
  )
  return (
    <div className="evitar-corte" style={{ marginTop: 18 }}>
      <h4 style={{ fontSize: 14.5, color: C.subtitulo, margin: '0 0 8px' }}>
        Comparada con el índice
      </h4>
      <table style={{ maxWidth: 470 }}>
        <thead>
          <tr><th></th><th className="n">Esta cartera</th><th className="n">S&amp;P 500</th></tr>
        </thead>
        <tbody>
          {fila('Rendimiento anual', b.retorno_cartera_pct, b.retorno_benchmark_pct, '%')}
          {fila('Volatilidad', b.volatilidad_cartera_pct, b.volatilidad_benchmark_pct, '%')}
          {fila('Rendimiento por unidad de riesgo',
                b.retorno_sobre_volatilidad, b.retorno_sobre_volatilidad_benchmark)}
        </tbody>
      </table>
      <p style={{ fontSize: 12.5, color: C.tenue, marginTop: 8 }}>
        Beta {num(b.beta_vs_benchmark, 2)} —{' '}
        {b.beta_vs_benchmark > 1.05 ? 'amplifica los movimientos del índice'
          : b.beta_vs_benchmark < 0.95 ? 'los amortigua'
          : 'se mueve casi igual que el índice'}.{' '}
        <b style={{ color: gana ? C.verde : C.ambar }}>
          {gana ? 'Paga mejor el riesgo que toma que el índice.'
                : 'El índice paga mejor el riesgo que toma.'}
        </b>{' '}
        ⚠️ Todo esto es <b>lo que pasó</b> en los últimos {b.ventana_dias} días de
        rueda, no una proyección. La última fila divide rendimiento por
        volatilidad y no descuenta ninguna tasa libre de riesgo — cuál es la tasa
        libre de riesgo para un argentino es otra discusión, y este informe no la
        zanja.
      </p>
    </div>
  )
}

// ── DOS PAPELES, UNA SOLA APUESTA ───────────────────────────────────────────
// La "concentración temática" del prompt original de Marcos, que nunca se había
// implementado. Es la única lectura del informe que NO se puede deducir de la
// tabla de sectores: dos papeles de sectores distintos pueden moverse juntos, y
// ahí el cliente cree que diversificó cuando no lo hizo.
function UnaSolaApuesta({ pares }) {
  return (
    <div className="evitar-corte" style={{ marginTop: 18 }}>
      <h4 style={{ fontSize: 14.5, color: C.subtitulo, margin: '0 0 8px' }}>
        Posiciones que se mueven juntas
      </h4>
      <p style={{ fontSize: 13.5, marginTop: 0 }}>
        Estos pares se movieron casi igual durante los últimos tres años. No son
        dos posiciones: son <b>una sola apuesta</b> del tamaño de las dos, así que
        el peso que hay que comparar contra el tope es el combinado.
      </p>
      <table style={{ maxWidth: 580 }}>
        <thead>
          <tr>
            <th>Par</th><th className="n">Correlación</th>
            <th className="n">Peso combinado</th><th></th>
          </tr>
        </thead>
        <tbody>
          {pares.map(p => (
            <tr key={`${p.a}-${p.b}`}>
              <td style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo }}>
                {p.a} + {p.b}
              </td>
              <td className="n">{num(p.correlacion, 2)}</td>
              <td className="n" style={{ fontWeight: 600 }}>
                {num(p.peso_combinado_pct, 1)}%
              </td>
              <td style={{ fontSize: 12.5,
                           color: p.mismo_sector ? C.tenue : C.ambar }}>
                {p.mismo_sector
                  ? 'mismo sector'
                  : 'sectores distintos — la tabla de sectores no lo muestra'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LA TESIS, EN UN PANEL APARTE
//
// Dos motivos, y el segundo es el que manda:
//   1. El botón queda LEJOS del cuerpo del informe, al pie, donde no interrumpe
//      la lectura del documento.
//   2. Todo lo que sale de acá lleva `no-imprimir`. El PDF que se le manda al
//      cliente NO puede contener esto ni por accidente, y "me acuerdo de sacar
//      esas páginas al imprimir" no es una garantía: es una costumbre que falla
//      el día que uno está apurado.
//
// Es un panel dentro de la misma página y no un `window.open` a propósito: una
// ventana nueva perdería todo el estado ya calculado —tendría que rehacer el
// análisis— y encima la bloquean la mitad de los navegadores.
// ─────────────────────────────────────────────────────────────────────────────
function TesisAparte({ datos }) {
  const [abierto, setAbierto] = React.useState(false)

  // Escape cierra. Es lo que espera cualquiera frente a algo que tapa la
  // pantalla, y sin esto la única salida es el botón de arriba a la derecha.
  React.useEffect(() => {
    if (!abierto) return
    const alTecla = e => { if (e.key === 'Escape') setAbierto(false) }
    window.addEventListener('keydown', alTecla)
    return () => window.removeEventListener('keydown', alTecla)
  }, [abierto])

  return (
    <>
      <div className="no-imprimir" style={{
        display: 'flex', justifyContent: 'flex-end', margin: '4px 0 18px' }}>
        <button onClick={() => setAbierto(true)}
          style={{ background: '#fff', color: C.subtitulo,
                   border: `1px solid ${C.bordeFuerte}`, borderRadius: 7,
                   padding: '7px 14px', fontSize: 13, fontWeight: 600 }}>
          Análisis interno de la cartera →
        </button>
      </div>

      {abierto && (
        <div className="no-imprimir"
             onClick={e => { if (e.target === e.currentTarget) setAbierto(false) }}
             style={{ position: 'fixed', inset: 0, zIndex: 50,
                      background: 'rgba(11,46,79,.35)',
                      display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ background: '#fff', width: 'min(760px, 100%)',
                        height: '100%', overflowY: 'auto',
                        boxShadow: '-4px 0 24px rgba(11,46,79,.18)' }}>
            <div style={{ position: 'sticky', top: 0, background: '#fff',
                          borderBottom: `1px solid ${C.borde}`, zIndex: 1,
                          padding: '13px 20px', display: 'flex',
                          alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.titulo }}>
                  Análisis interno
                </div>
                <div style={{ fontSize: 12.5, color: C.tenue }}>
                  Esto <b>no</b> sale en el informe impreso ni en el PDF del cliente.
                </div>
              </div>
              <button onClick={() => setAbierto(false)}
                style={{ marginLeft: 'auto', background: 'none',
                         border: `1px solid ${C.borde}`, borderRadius: 6,
                         padding: '6px 12px', fontSize: 13, color: C.tenue }}>
                Cerrar
              </button>
            </div>
            <div style={{ padding: '4px 20px 40px' }}>
              <TesisCartera datos={datos} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ADÓNDE ROTAR — una opción por sector
//
// El criterio no es obvio y se midió antes de elegirlo, sobre una cartera real:
//
//   solo por PUNTAJE del screener  -> ofrecía HMY (87,5) que SUBÍA la
//                                     volatilidad 2,26 puntos.
//   solo por MEJORA de riesgo      -> ofrecía O (baja 5,79) con puntaje 53:
//                                     una empresa mediocre porque diversifica.
//   filtrar y DESPUÉS puntuar      -> SBS(86,7) PBR(86,2) MO(80): bajan el
//                                     riesgo Y son buenas empresas.
//
// La mejora de riesgo es una COMPUERTA, no un ranking. Entre lo que pasa la
// compuerta manda el puntaje del screener, que es el criterio de la casa.
// ─────────────────────────────────────────────────────────────────────────────
function MenuDeRotacion({ menu, volPlan }) {
  return (
    <div className="evitar-corte" style={{ marginTop: 18 }}>
      <h4 style={{ fontSize: 14.5, color: C.subtitulo, margin: '0 0 6px' }}>
        Adónde rotar, por sector
      </h4>
      <p style={{ fontSize: 13.5, marginTop: 0, marginBottom: 8 }}>
        Una opción por sector, entre las que <b>bajan el riesgo de esta cartera
        de forma medible</b>. De las que pasan ese filtro se muestra la de mejor
        puntaje del screener. Los sectores que ya están en su tope no aparecen:
        poner plata ahí sería cambiar una concentración por otra.
      </p>
      <table style={{ maxWidth: 660 }}>
        <thead>
          <tr>
            <th>Sector</th><th>Activo</th>
            <th className="n">Puntaje</th><th className="n">Datos</th>
            <th className="n">Beta</th>
            <th className="n">Baja el riesgo</th>
            <th className="n">Corr.</th>
          </tr>
        </thead>
        <tbody>
          {menu.map(m => (
            <tr key={m.ticker}>
              <td style={{ fontSize: 13 }}>{m.sector}</td>
              <td style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo }}>
                {m.ticker}
                {m.defensivo && (
                  <span style={{ fontSize: 11.5, color: C.verde }}> · defensivo</span>
                )}
              </td>
              <td className="n" style={{ fontWeight: 600,
                    color: semaforo(m.puntaje).color }}>{num(m.puntaje, 0)}</td>
              <td className="n" style={{ fontSize: 12.5, color: C.tenue }}>
                {m.metricas || '—'}
              </td>
              <td className="n" style={{ color: C.tenue }}>
                {m.beta != null ? num(m.beta, 2) : '—'}
              </td>
              <td className="n" style={{ fontWeight: 700, color: C.verde }}>
                −{num(m.mejora_vs_plan_pts, 1)} pts
              </td>
              <td className="n" style={{ color: C.tenue }}>
                {m.correlacion_media != null ? num(m.correlacion_media, 2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12.5, color: C.tenue, marginTop: 8 }}>
        «Baja el riesgo» es contra el plan de arriba, que deja la cartera en{' '}
        {num(volPlan, 1)}%: es lo que se gana eligiendo esta opción en vez de
        repartir el recorte entre las posiciones que ya están. No son
        excluyentes — se puede tomar una, dos o repartir entre las tres.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ¿Y SI LA PLATA VA A ALGO NUEVO?
//
// La paridad de riesgo reparte entre las posiciones QUE YA ESTÁN: cuando
// recorta la más grande, lo único que sabe hacer con esa plata es agrandar las
// otras. Sobre una cartera real de 7 papeles, las tres compras del plan eran
// las tres posiciones que el cliente ya tenía — y al mismo tiempo el módulo de
// riesgo ya había medido que un papel de afuera bajaba la volatilidad cinco
// veces más.
//
// Esta tabla es esa comparación, con la misma matriz de covarianza: el plan
// contra cada alternativa. No reemplaza al plan; lo pone a competir.
// ─────────────────────────────────────────────────────────────────────────────
function EntrarEnAlgoNuevo({ entradas, volPlan }) {
  return (
    <div className="evitar-corte" style={{ marginTop: 18 }}>
      <h4 style={{ fontSize: 14.5, color: C.subtitulo, margin: '0 0 6px' }}>
        Si esa plata fuera a algo nuevo
      </h4>
      <p style={{ fontSize: 13.5, marginTop: 0, marginBottom: 8 }}>
        El plan de arriba reparte el recorte entre las posiciones que ya están.
        Estas son las alternativas: papeles que <b>no</b> están en la cartera y
        que, con la misma plata, la dejarían más tranquila.
      </p>
      <table style={{ maxWidth: 640 }}>
        <thead>
          <tr>
            <th>Activo</th><th>Sector</th>
            <th className="n">Entraría con</th>
            <th className="n">Volatilidad</th>
            <th className="n">Contra el plan</th>
            <th className="n">Corr.</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ color: C.tenue }}>— el plan de arriba —</td>
            <td></td><td></td>
            <td className="n" style={{ color: C.tenue }}>{num(volPlan, 1)}%</td>
            <td className="n" style={{ color: C.tenue }}>—</td>
            <td></td>
          </tr>
          {entradas.map(e => (
            <tr key={e.ticker}>
              <td style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo }}>
                {e.ticker}
              </td>
              <td style={{ fontSize: 13, color: C.tenue }}>{e.sector}</td>
              <td className="n">{num(e.peso_si_entra_pct, 1)}%</td>
              <td className="n" style={{ fontWeight: 600, color: C.titulo }}>
                {num(e.volatilidad_si_entra_pct, 1)}%
              </td>
              <td className="n" style={{ fontWeight: 700, color: C.verde }}>
                −{num(e.mejora_vs_plan_pts, 1)} pts
              </td>
              <td className="n" style={{ color: C.tenue }}>
                {num(e.correlacion_media, 2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12.5, color: C.tenue, marginTop: 8 }}>
        La correlación explica casi todo: un papel que se mueve al revés que la
        cartera baja el riesgo aunque él mismo sea volátil. El peso de entrada es
        el máximo que permite el tope del perfil — se puede repartir entre dos o
        tres de estos en vez de poner todo en uno, y el efecto es parecido.
      </p>
    </div>
  )
}

function Dato({ valor, etiqueta, color }) {
  return (
    <div style={{ background: C.panel, borderRadius: 8, padding: '9px 15px', minWidth: 118 }}>
      <div style={{ fontFamily: F.num, fontSize: 20, fontWeight: 700,
                    color: color || C.titulo, lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: 12.5, color: C.tenue }}>{etiqueta}</div>
    </div>
  )
}

function PuntosDeAtencion({ riesgos }) {
  return (
    <Seccion titulo="Puntos de atención"
             nota="Señales de severidad alta detectadas en la cartera.">
      {riesgos.map((r, i) => {
        const c = colorSeveridad(r.severidad)
        return (
          <div key={i} className="evitar-corte" style={{
            background: c.fondo, borderRadius: 8, padding: '11px 14px',
            marginBottom: 8, display: 'flex', gap: 11 }}>
            <span style={{ fontFamily: F.num, fontWeight: 700, color: c.color,
                           minWidth: 48 }}>{r.ticker}</span>
            <span style={{ fontSize: 14 }}>
              {r.texto}
              <QueRevisar items={r.revisar} />
            </span>
          </div>
        )
      })}
    </Seccion>
  )
}

// Ficha corta: lo esencial de un activo en media página, sin gráficos.
function Ficha({ d }) {
  const v = d.veredicto || {}
  const s = semaforo(v.puntaje)
  const c = d.consenso || {}
  const f = d.fundamentales || {}
  const cagr = d.historico?.cagr || {}
  const ocultar = new Set(d.sector_contexto?.ocultar || [])

  const metricas = [
    ['P/E', f.pe, v => `${num(v, 1)}x`],
    ['P/E adel.', c.forwardPE, v => `${num(v, 1)}x`],
    ['ROE', f.roe, v => pct(v)],
    ['Margen neto', f.netMargin, v => pct(v)],
    ['Deuda/EBITDA', ocultar.has('netDebtToEbitda') ? null : c.netDebtToEbitda,
     v => `${num(v, 1)}x`],
    ['Dividendo', c.dividendYieldPct, v => pct(v, 2)],
  ].filter(([, val]) => val != null)

  return (
    <div className="evitar-corte" style={{
      border: `1px solid ${C.borde}`, borderRadius: 9, padding: '15px 18px',
      marginBottom: 14, borderLeft: `4px solid ${s.color}` }}>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10,
                    flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.num, fontSize: 19, fontWeight: 700,
                       color: C.titulo }}>{d.ticker}</span>
        <span style={{ color: C.subtitulo, fontSize: 15 }}>{d.nombre}</span>
        <span style={{ fontSize: 12.5, color: C.tenue }}>{d.sector}</span>
        <span style={{ marginLeft: 'auto', background: s.fondo, color: s.color,
                       borderRadius: 5, padding: '2px 10px', fontSize: 13,
                       fontWeight: 600, textTransform: 'capitalize' }}>
          {v.etiqueta}{v.puntaje != null ? ` · ${num(v.puntaje, 0)}/100` : ''}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '12px 0' }}>
        {metricas.map(([label, val, fmt]) => (
          <div key={label}>
            <div style={{ fontSize: 11, color: C.tenue, textTransform: 'uppercase',
                          letterSpacing: '.03em' }}>{label}</div>
            <div style={{ fontFamily: F.num, fontSize: 15, color: C.titulo,
                          fontWeight: 600 }}>{fmt(val)}</div>
          </div>
        ))}
      </div>

      {(cagr.revenue_3a != null || cagr.revenue_5a != null) && (
        <div style={{ fontSize: 13.5, color: C.cuerpo, marginBottom: 8 }}>
          <b style={{ color: C.subtitulo }}>Crecimiento de ingresos:</b>{' '}
          {['3a', '5a', '10a'].map(w => cagr[`revenue_${w}`] != null
            ? `${w.replace('a', ' años')} ${pct(cagr[`revenue_${w}`], 1, true)}` : null)
            .filter(Boolean).join(' · ') || '—'}
        </div>
      )}

      {/* las dos notas más relevantes de todo el análisis */}
      <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13.5 }}>
        {(d.senales || []).flatMap(x => x.notas || []).slice(0, 3).map((n, i) => (
          <li key={i} style={{ marginBottom: 3 }}>{n}</li>
        ))}
      </ul>

      {(d.riesgos || []).filter(r => r.severidad === 'alta').map((r, i) => (
        <div key={i} style={{ background: C.rojoFondo, color: C.rojo, fontSize: 13,
                              borderRadius: 6, padding: '7px 11px', marginTop: 6 }}>
          {r.texto}
          <QueRevisar items={r.revisar} />
        </div>
      ))}
    </div>
  )
}

function Pie({ informes, meta }) {
  const f = informes[0]?.fuentes || {}
  return (
    <div className="evitar-corte" style={{ marginTop: 44, paddingTop: 18,
      borderTop: `1px solid ${C.borde}`, fontSize: 12.5, color: C.tenue,
      lineHeight: 1.7 }}>
      <div style={{ fontWeight: 600, color: C.subtitulo, marginBottom: 5 }}>
        Fuentes y alcance
      </div>
      <div>
        Precios, múltiplos y consenso de analistas: {f.fundamentales_y_consenso?.origen}
        {' '}· datos al {fecha(f.fundamentales_y_consenso?.fecha)}
      </div>
      <div>Series históricas: {f.historico?.origen}</div>
      <div>
        Los activos se analizan por igual, sin ponderar por cantidad ni por
        precio de compra. Los puntajes comparan cada empresa contra las demás
        de su propio sector.
      </div>
      <div style={{ marginTop: 10 }}>
        Documento generado el {fecha(new Date().toISOString())}
        {meta.preparadoPor ? ` por ${meta.preparadoPor}` : ''}.
      </div>
      <div style={{ marginTop: 10, fontStyle: 'italic' }}>
        {informes[0]?.descargo || 'Este informe es análisis automatizado sobre ' +
         'datos públicos y NO constituye recomendación de inversión.'}
      </div>
    </div>
  )
}

function Seccion({ titulo, nota, children }) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 18, marginBottom: nota ? 3 : 12 }}>{titulo}</h2>
      {nota && <p style={{ color: C.tenue, fontSize: 13, marginTop: 0,
                           marginBottom: 12 }}>{nota}</p>}
      {children}
    </section>
  )
}
