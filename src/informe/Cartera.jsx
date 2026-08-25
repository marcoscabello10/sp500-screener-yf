import React from 'react'
import Informe from './Informe.jsx'
import { planRotacion, concentracionPorSector, SECTOR_PESADO_PCT } from './sugerencias.js'
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

export default function Cartera({ informes, meta, stocks, scores, conAnexo }) {
  const validos = informes.filter(i => i && !i.error)

  const plan = planRotacion(validos, stocks, scores)

  const concentracion = concentracionPorSector(
    validos.map(i => ({ sector: i.sector })))

  const riesgosAltos = validos.flatMap(i =>
    (i.riesgos || []).filter(r => r.severidad === 'alta')
      .map(r => ({ ...r, ticker: i.ticker })))

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '26px 22px 70px' }}>
      <Portada meta={meta} n={validos.length} />
      <Rotacion plan={plan} total={validos.length} />
      <Resumen informes={validos} plan={plan} />
      <Composicion datos={concentracion} />
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

function Portada({ meta, n }) {
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

function Rotacion({ plan, total }) {
  const { sacar, mantener, reforzar, sinDatos, sectoresPesados } = plan
  const nada = sacar.length === 0

  return (
    <Seccion titulo="Qué hacer con esta cartera"
             nota="Una acción por activo, ordenada por urgencia. Sale de los
                   fundamentales a la fecha del dato: no contempla tu horizonte,
                   el costo impositivo de vender ni cuánto pesa cada papel en
                   pesos.">

      <div className="evitar-corte" style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {[['sacar', sacar.length], ['mantener', mantener.length],
          ['reforzar', reforzar.length], ['revisar a mano', sinDatos.length]]
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

      {sectoresPesados.length > 0 && (
        <p style={{ marginTop: 14, fontSize: 13.5, color: C.ambar }}>
          {sectoresPesados.join(' y ')} {sectoresPesados.length > 1 ? 'pesan' : 'pesa'}
          {' '}más del {SECTOR_PESADO_PCT}% de la cartera. Los reemplazos de otro
          sector evitan a propósito {sectoresPesados.length > 1 ? 'esos sectores' : 'ese sector'}:
          rotar dentro de lo que ya sobra arregla el papel y deja el problema.
        </p>
      )}

      {(reforzar.length > 0 || mantener.length > 0) && (
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
              {[...reforzar, ...mantener, ...sinDatos].map(f => (
                <tr key={f.ticker}>
                  <td>
                    <span style={{ fontFamily: F.num, fontWeight: 600,
                                   color: C.titulo }}>{f.ticker}</span>
                  </td>
                  <td style={{ fontSize: 13, color: C.tenue }}>{f.sector || '—'}</td>
                  <td><Pastilla accion={f.accion} chica /></td>
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

function Composicion({ datos }) {
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
    </Seccion>
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
            <span style={{ fontSize: 14 }}>{r.texto}</span>
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
