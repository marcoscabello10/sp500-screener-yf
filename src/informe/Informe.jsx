import React from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { C, F, semaforo, colorSeveridad, num, pct, dinero, fecha } from './estilos.js'
import Tesis from './tesis.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// El informe. Todo lo que se ve aca sale de action=datos, o sea CERO llamadas
// al modelo de lenguaje y costo cero. La tesis en prosa es un bloque aparte
// que se pide con clic explicito.
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_BLOQUE = {
  valuacion: 'Valuación',
  crecimiento: 'Crecimiento',
  salud_financiera: 'Salud financiera',
  dividendos: 'Dividendos',
  consenso: 'Consenso de analistas',
}

// Que metricas se muestran en la tabla de valuacion y como se formatean.
const METRICAS = [
  { k: 'pe',                de: 'fund', label: 'P/E actual',        fmt: v => `${num(v, 1)}x` },
  { k: 'forwardPE',         de: 'cons', label: 'P/E adelantado',    fmt: v => `${num(v, 1)}x` },
  { k: 'trailingPegRatio',  de: 'cons', label: 'PEG',               fmt: v => num(v, 2) },
  { k: 'pb',                de: 'fund', label: 'P/B',               fmt: v => `${num(v, 1)}x` },
  { k: 'evEbitda',          de: 'fund', label: 'EV/EBITDA',         fmt: v => `${num(v, 1)}x` },
  { k: 'priceToSales',      de: 'fund', label: 'P/Ventas',          fmt: v => `${num(v, 1)}x` },
  { k: 'roe',               de: 'fund', label: 'ROE',               fmt: v => pct(v) },
  { k: 'roa',               de: 'fund', label: 'ROA',               fmt: v => pct(v) },
  { k: 'grossMarginPct',    de: 'cons', label: 'Margen bruto',      fmt: v => pct(v) },
  { k: 'operatingMarginPct',de: 'cons', label: 'Margen operativo',  fmt: v => pct(v) },
  { k: 'netMargin',         de: 'fund', label: 'Margen neto',       fmt: v => pct(v) },
  { k: 'de',                de: 'fund', label: 'Deuda / Patrimonio',fmt: v => num(v, 2) },
  { k: 'netDebtToEbitda',   de: 'cons', label: 'Deuda neta / EBITDA', fmt: v => `${num(v, 1)}x` },
  { k: 'fcfYieldPct',       de: 'cons', label: 'Rend. flujo libre', fmt: v => pct(v) },
  { k: 'dividendYieldPct',  de: 'cons', label: 'Dividendo',         fmt: v => pct(v, 2) },
]

// Los chequeos concretos que acompanan a un riesgo. Un aviso que dice
// "revisar por que" sin decir QUE revisar le traslada el trabajo al lector;
// esto lista los puntos y, donde el dato estaba, ya viene contestado.
// Se exporta para que Cartera.jsx lo use en vez de tener su propia copia.
export function QueRevisar({ items }) {
  if (!items || !items.length) return null
  return (
    <ul style={{ margin: '7px 0 0', paddingLeft: 17, fontSize: 13,
                 color: C.tenue, lineHeight: 1.5 }}>
      {items.map((t, i) => <li key={i} style={{ marginBottom: 3 }}>{t}</li>)}
    </ul>
  )
}

export default function Informe({ d, onVolver, conTesis = true }) {
  const ocultar = new Set(d.sector_contexto?.ocultar || [])
  const notas = d.sector_contexto?.notas || {}
  const medianas = d.sector_contexto?.medianas || {}
  const hist = d.historico || {}
  const series = hist.series || {}

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '26px 22px 70px' }}>

      {onVolver && (
        <button onClick={onVolver} className="no-imprimir"
          style={{ background: 'none', border: 'none', color: C.acento, padding: 0,
                   marginBottom: 18, fontSize: 14 }}>
          ← Elegir otro activo
        </button>
      )}

      <Encabezado d={d} />
      <Veredicto d={d} />
      {/* La tesis va arriba de todo el detalle, pegada al veredicto: es la
          lectura en prosa de eso mismo. `conTesis` sigue existiendo por si
          alguna vista la quiere apagar, pero el anexo de la cartera YA NO la
          apaga: cada boton gasta solo cuando se lo clickea, asi que N botones
          no son N llamadas. */}
      {conTesis && <Tesis ticker={d.ticker} />}

      {d.avisos?.length > 0 && (
        <div className="evitar-corte" style={{ marginTop: 18 }}>
          {d.avisos.map((a, i) => (
            <div key={i} style={{
              background: C.panel, borderLeft: `3px solid ${C.bordeFuerte}`,
              padding: '9px 13px', marginBottom: 6, fontSize: 13.5, color: C.cuerpo,
              borderRadius: '0 6px 6px 0' }}>{a}</div>
          ))}
        </div>
      )}

      {d.riesgos?.length > 0 && (
        <Seccion titulo="Riesgos detectados">
          {d.riesgos.map((r, i) => {
            const c = colorSeveridad(r.severidad)
            return (
              <div key={i} className="evitar-corte" style={{
                background: c.fondo, borderRadius: 8, padding: '11px 14px',
                marginBottom: 8, display: 'flex', gap: 11 }}>
                <span style={{ color: c.color, fontWeight: 700, fontSize: 12,
                               textTransform: 'uppercase', minWidth: 46,
                               letterSpacing: '.04em' }}>{r.severidad}</span>
                <span style={{ color: C.cuerpo, fontSize: 14 }}>
                  {r.texto}
                  <QueRevisar items={r.revisar} />
                </span>
              </div>
            )
          })}
        </Seccion>
      )}

      <Seccion titulo="Señales por dimensión">
        {(d.senales || []).map(s => <BloqueSenal key={s.bloque} s={s} />)}
      </Seccion>

      <Seccion titulo={`Múltiplos contra el sector ${d.sector || ''}`}
               nota={d.sector_contexto?.n
                 ? `Comparado contra ${d.sector_contexto.n} empresas del mismo sector en el índice.`
                 : null}>
        <TablaMetricas d={d} ocultar={ocultar} medianas={medianas} notas={notas} />
      </Seccion>

      {hist.disponible && (
        <>
          <Seccion titulo="Crecimiento histórico"
                   nota={`Reportes 10-K auditados de la SEC · ${hist.anios_revenue} años, ` +
                         `de ${String(hist.desde).slice(0, 4)} a ${String(hist.hasta).slice(0, 4)}.`}>
            <TablaCagr cagr={hist.cagr} />
            <Grafico titulo="Ingresos anuales" serie={series.revenue}
                     lineas={[{ k: 'v', nombre: 'Ingresos', color: C.acento }]}
                     fmtY={dinero} />
          </Seccion>

          <Seccion titulo="Márgenes" nota="Porcentaje sobre ventas, año por año.">
            <GraficoMargenes margenes={series.margenes} />
          </Seccion>

          <Seccion titulo="Acciones en circulación"
                   nota="Bajando = recompras. Subiendo = dilución: tu porción se achica.">
            <Grafico titulo="Acciones diluidas promedio" serie={series.acciones}
                     lineas={[{ k: 'v', nombre: 'Acciones', color: C.subtitulo }]}
                     fmtY={dinero} />
          </Seccion>
        </>
      )}

      {d.consenso_forward?.earnings_estimate && (
        <Seccion titulo="Consenso a futuro"
                 nota="Son estimaciones de ANALISTAS, no proyecciones de la empresa.">
          <TablaForward f={d.consenso_forward} />
        </Seccion>
      )}

      {d.sentimiento && <Sentimiento s={d.sentimiento} />}

      <PieDeInforme d={d} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Encabezado({ d }) {
  const c = d.consenso || {}
  const f = d.fundamentales || {}
  return (
    <div className="evitar-corte" style={{ borderBottom: `2px solid ${C.titulo}`,
                                           paddingBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 30, fontFamily: F.num, letterSpacing: '-.01em' }}>
          {d.ticker}
        </h1>
        <span style={{ fontSize: 19, color: C.subtitulo }}>{d.nombre}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
        <Etiqueta>{d.sector || 'sector desconocido'}</Etiqueta>
        {d.hasCedear && <Etiqueta tono="acento">CEDEAR disponible</Etiqueta>}
        {!d.enSp500 && <Etiqueta>fuera del S&P 500</Etiqueta>}
        <Etiqueta tono={d.nivel === 'completo' ? 'verde' : 'ambar'}>
          informe {d.nivel}
        </Etiqueta>
      </div>
      <div style={{ display: 'flex', gap: 26, marginTop: 14, flexWrap: 'wrap' }}>
        <Dato label="Precio" valor={f.price != null ? `US$ ${num(f.price)}` : '—'} />
        <Dato label="Capitalización" valor={dinero(f.marketCap)} />
        <Dato label="Precio objetivo" valor={c.targetMeanPrice != null
          ? `US$ ${num(c.targetMeanPrice)}` : '—'} />
        <Dato label="Recorrido implícito" valor={pct(c.upsidePct, 1, true)}
              color={c.upsidePct > 0 ? C.verde : c.upsidePct < 0 ? C.rojo : null} />
      </div>
    </div>
  )
}

function Veredicto({ d }) {
  const v = d.veredicto || {}
  const s = semaforo(v.puntaje)
  return (
    <div className="evitar-corte" style={{
      marginTop: 20, background: s.fondo, borderRadius: 10, padding: '16px 20px',
      borderLeft: `5px solid ${s.color}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: s.color,
                       textTransform: 'uppercase', letterSpacing: '.02em' }}>
          {v.etiqueta}
        </span>
        {v.puntaje != null && (
          <span style={{ fontFamily: F.num, fontSize: 17, color: C.cuerpo }}>
            {num(v.puntaje, 1)}<span style={{ color: C.tenue, fontSize: 14 }}>/100</span>
          </span>
        )}
        {v.accion && (
          <span style={{ fontSize: 13.5, color: C.cuerpo }}>
            Si ya lo tenés en cartera: <b style={{ color: s.color }}>{v.accion}</b>.
          </span>
        )}
      </div>
      {v.limitado_por_bandera && (
        <div style={{ marginTop: 8, fontSize: 13.5, color: C.rojo, fontWeight: 600 }}>
          El puntaje daba compra, pero hay una bandera roja abierta: no se
          recomienda ampliar hasta resolverla.
        </div>
      )}
      {v.porque?.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13.5, color: C.cuerpo }}>
          {v.porque.join(' · ')}
        </div>
      )}
      {v.aclaracion && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: C.tenue, fontStyle: 'italic' }}>
          {v.aclaracion}
        </div>
      )}
    </div>
  )
}

function BloqueSenal({ s }) {
  const sem = semaforo(s.puntaje)
  return (
    <div className="evitar-corte" style={{
      border: `1px solid ${C.borde}`, borderRadius: 9, padding: '13px 16px',
      marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%',
                       background: sem.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, color: C.titulo, fontSize: 15.5 }}>
          {ETIQUETA_BLOQUE[s.bloque] || s.bloque}
        </span>
        {/* Si un bloque no pesa lo mismo que los demas, el informe lo dice.
            Un puntaje ponderado que no muestra sus pesos es una caja negra. */}
        {s.peso != null && s.peso !== 1 && s.puntaje != null && (
          <span style={{ fontSize: 11.5, color: C.tenue, border: `1px solid ${C.borde}`,
                         borderRadius: 4, padding: '1px 6px' }}>
            pesa ×{s.peso}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: F.num, fontSize: 14,
                       color: sem.color }}>
          {s.puntaje != null ? `${num(s.puntaje, 0)}/100` : 'sin datos'}
        </span>
      </div>
      {s.bloque === 'dividendos' && s.peso === 0.5 && s.puntaje != null && (
        <p style={{ fontSize: 12.5, color: C.tenue, margin: '7px 0 0' }}>
          Repartir o reinvertir es una decisión de política, no una medida de qué
          tan bueno es el negocio, así que este bloque vale la mitad. Si buscás
          renta, el objetivo de la cartera le devuelve el peso completo.
        </p>
      )}
      {s.notas?.length > 0 && (
        <ul style={{ margin: '9px 0 0', paddingLeft: 20, fontSize: 14 }}>
          {s.notas.map((n, i) => (
            <li key={i} style={{ marginBottom: 4, color: C.cuerpo }}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TablaMetricas({ d, ocultar, medianas, notas }) {
  const f = d.fundamentales || {}
  const c = d.consenso || {}
  const filas = METRICAS
    .filter(m => !ocultar.has(m.k))
    .map(m => ({ ...m, valor: m.de === 'fund' ? f[m.k] : c[m.k] }))
    .filter(m => m.valor != null)

  return (
    <>
      {ocultar.size > 0 && (
        <p style={{ fontSize: 13, color: C.tenue, marginTop: 0 }}>
          En {d.sector} no se muestran {[...ocultar].join(', ')}: no tienen
          significado económico en este sector.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Métrica</th>
            <th className="n">Valor</th>
            <th className="n">Mediana sector</th>
            <th style={{ width: 150 }}>Posición en el sector</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(m => (
            <React.Fragment key={m.k}>
              <tr>
                <td>{m.label}</td>
                <td className="n" style={{ fontWeight: 600, color: C.titulo }}>
                  {m.fmt(m.valor)}
                </td>
                <td className="n" style={{ color: C.tenue }}>
                  {medianas[m.k] != null ? m.fmt(medianas[m.k]) : '—'}
                </td>
                <td><BarraPercentil valor={m.valor} mediana={medianas[m.k]} /></td>
              </tr>
              {notas[m.k] && (
                <tr>
                  <td colSpan={4} style={{ paddingTop: 0, borderBottom: 'none',
                                           fontSize: 12.5, color: C.ambar }}>
                    {notas[m.k]}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </>
  )
}

// Barra simple: donde cae el valor respecto de la mediana del sector.
function BarraPercentil({ valor, mediana }) {
  if (valor == null || mediana == null || mediana === 0) {
    return <span style={{ color: C.tenue, fontSize: 12 }}>—</span>
  }
  const ratio = valor / mediana
  // se recorta a [0.4, 2.5] para que un outlier no aplaste la escala
  const r = Math.max(0.4, Math.min(2.5, ratio))
  const centro = 50
  const desvio = ((r - 1) / 1.5) * 45
  const izq = Math.min(centro, centro + desvio)
  const ancho = Math.abs(desvio)
  return (
    <div title={`${num(ratio, 2)}× la mediana del sector`}
         style={{ position: 'relative', height: 16, background: C.panel,
                  borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: `${centro}%`, top: 0, bottom: 0,
                    width: 1, background: C.bordeFuerte }} />
      <div style={{ position: 'absolute', left: `${izq}%`, width: `${ancho}%`,
                    top: 3, bottom: 3, borderRadius: 3,
                    background: desvio >= 0 ? C.acentoClaro : C.subtitulo }} />
    </div>
  )
}

function TablaCagr({ cagr = {} }) {
  const filas = [
    { label: 'Ingresos', k: 'revenue' },
    { label: 'Ganancia por acción', k: 'eps' },
    { label: 'Resultado neto', k: 'net_income' },
    { label: 'Acciones en circulación', k: 'acciones' },
  ]
  return (
    <table style={{ marginBottom: 18 }}>
      <thead>
        <tr>
          <th>Crecimiento anual compuesto</th>
          <th className="n">3 años</th><th className="n">5 años</th><th className="n">10 años</th>
        </tr>
      </thead>
      <tbody>
        {filas.map(f => (
          <tr key={f.k}>
            <td>{f.label}</td>
            {['3a', '5a', '10a'].map(v => {
              const val = cagr[`${f.k}_${v}`]
              const esAcc = f.k === 'acciones'
              const color = val == null ? C.tenue
                : (esAcc ? (val < 0 ? C.verde : val > 3 ? C.rojo : C.cuerpo)
                         : (val > 0 ? C.verde : C.rojo))
              return (
                <td key={v} className="n" style={{ color, fontWeight: val != null ? 600 : 400 }}>
                  {val != null ? pct(val, 1, true) : '—'}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function serieAData(serie) {
  if (!serie) return []
  return Object.entries(serie)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, v]) => ({ anio: f.slice(0, 4), v }))
}

function Grafico({ serie, lineas, fmtY }) {
  const data = serieAData(serie)
  if (data.length < 2) {
    return <p style={{ color: C.tenue, fontSize: 13.5 }}>Sin serie suficiente para graficar.</p>
  }
  return (
    <div className="evitar-corte" style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={C.borde} vertical={false} />
          <XAxis dataKey="anio" tick={{ fontSize: 12, fill: C.tenue }}
                 stroke={C.bordeFuerte} />
          <YAxis tickFormatter={fmtY} tick={{ fontSize: 12, fill: C.tenue }}
                 stroke={C.bordeFuerte} width={64} />
          <Tooltip formatter={v => fmtY(v)}
                   contentStyle={{ borderRadius: 8, border: `1px solid ${C.bordeFuerte}`,
                                   fontSize: 13 }} />
          {lineas.map(l => (
            <Line key={l.k} type="monotone" dataKey={l.k} name={l.nombre}
                  stroke={l.color} strokeWidth={2} dot={{ r: 2.5 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function GraficoMargenes({ margenes = {} }) {
  const anios = new Set()
  for (const m of Object.values(margenes || {}))
    Object.keys(m || {}).forEach(f => anios.add(f.slice(0, 4)))
  const data = [...anios].sort().map(a => {
    const fila = { anio: a }
    for (const [nombre, serie] of Object.entries(margenes || {})) {
      const clave = Object.keys(serie || {}).find(f => f.startsWith(a))
      if (clave) fila[nombre] = serie[clave]
    }
    return fila
  })
  if (data.length < 2) {
    return <p style={{ color: C.tenue, fontSize: 13.5 }}>Sin márgenes históricos disponibles.</p>
  }
  const colores = { bruto: C.acento, operativo: C.subtitulo, neto: C.verde }
  return (
    <div className="evitar-corte" style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={C.borde} vertical={false} />
          <XAxis dataKey="anio" tick={{ fontSize: 12, fill: C.tenue }} stroke={C.bordeFuerte} />
          <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: C.tenue }}
                 stroke={C.bordeFuerte} width={52} />
          <Tooltip formatter={v => pct(v)}
                   contentStyle={{ borderRadius: 8, border: `1px solid ${C.bordeFuerte}`,
                                   fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12.5 }} />
          {Object.keys(colores).filter(k => data.some(d => d[k] != null)).map(k => (
            <Line key={k} type="monotone" dataKey={k}
                  name={k[0].toUpperCase() + k.slice(1)}
                  stroke={colores[k]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function TablaForward({ f }) {
  const periodos = [['0q', 'Trimestre actual'], ['+1q', 'Próximo trimestre'],
                    ['0y', 'Año actual'], ['+1y', 'Próximo año']]
  const e = f.earnings_estimate || {}
  const r = f.revenue_estimate || {}
  return (
    <table>
      <thead>
        <tr>
          <th>Período</th><th className="n">EPS estimado</th><th className="n">Analistas</th>
          <th className="n">Ingresos estimados</th><th className="n">Crecimiento</th>
        </tr>
      </thead>
      <tbody>
        {periodos.filter(([k]) => e[k] || r[k]).map(([k, label]) => (
          <tr key={k}>
            <td>{label}</td>
            <td className="n">{e[k]?.avg != null ? `US$ ${num(e[k].avg)}` : '—'}</td>
            <td className="n" style={{ color: C.tenue }}>{e[k]?.numberOfAnalysts ?? '—'}</td>
            <td className="n">{r[k]?.avg != null ? dinero(r[k].avg) : '—'}</td>
            <td className="n" style={{ color: (r[k]?.growth ?? 0) > 0 ? C.verde : C.rojo }}>
              {r[k]?.growth != null ? pct(r[k].growth * 100, 1, true) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Sentimiento({ s }) {
  const ud = s.upgrades_downgrades
  const filas = ud ? Object.entries(ud).sort(([a], [b]) => b.localeCompare(a)).slice(0, 8) : []
  if (!filas.length) return null
  return (
    <Seccion titulo="Revisiones recientes de analistas"
             nota={s.upgrades_downgrades_total
               ? `${s.upgrades_downgrades_total} revisiones registradas en total.` : null}>
      <table>
        <thead>
          <tr><th>Fecha</th><th>Firma</th><th>Cambio</th><th className="n">Precio objetivo</th></tr>
        </thead>
        <tbody>
          {filas.map(([f, r]) => (
            <tr key={f}>
              <td style={{ fontFamily: F.num, fontSize: 13 }}>{f.slice(0, 10)}</td>
              <td>{r.Firm}</td>
              <td style={{ color: r.Action === 'up' ? C.verde
                         : r.Action === 'down' ? C.rojo : C.cuerpo }}>
                {r.FromGrade && r.FromGrade !== r.ToGrade
                  ? `${r.FromGrade} → ${r.ToGrade}` : r.ToGrade}
              </td>
              <td className="n">
                {r.currentPriceTarget ? `US$ ${num(r.currentPriceTarget)}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Seccion>
  )
}

function PieDeInforme({ d }) {
  const f = d.fuentes || {}
  return (
    <div className="evitar-corte" style={{ marginTop: 44, paddingTop: 18,
                                           borderTop: `1px solid ${C.borde}`,
                                           fontSize: 12.5, color: C.tenue, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 600, color: C.subtitulo, marginBottom: 5 }}>Fuentes</div>
      <div>
        Fundamentales y consenso: {f.fundamentales_y_consenso?.origen} ·
        datos al {fecha(f.fundamentales_y_consenso?.fecha)}
      </div>
      {f.consenso_a_futuro_y_sentimiento?.fecha && (
        <div>
          Consenso a futuro y sentimiento: {f.consenso_a_futuro_y_sentimiento.origen} ·
          datos al {fecha(f.consenso_a_futuro_y_sentimiento.fecha)}
        </div>
      )}
      <div>
        Histórico: {f.historico?.origen}
        {f.historico?.anios ? ` · ${f.historico.anios} años` : ''} ·
        consultado en vivo
      </div>
      <div style={{ marginTop: 10 }}>Informe generado el {fecha(d.generado_en)}.</div>
      <div style={{ marginTop: 10, fontStyle: 'italic' }}>{d.descargo}</div>
    </div>
  )
}

// ── Piezas chicas ───────────────────────────────────────────────────────────

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

function Etiqueta({ children, tono }) {
  const tonos = {
    acento: { c: C.acento, f: C.acentoFondo },
    verde:  { c: C.verde,  f: C.verdeFondo },
    ambar:  { c: C.ambar,  f: C.ambarFondo },
  }
  const t = tonos[tono] || { c: C.tenue, f: C.panel }
  return (
    <span style={{ background: t.f, color: t.c, borderRadius: 20, padding: '3px 11px',
                   fontSize: 12.5, fontWeight: 500 }}>{children}</span>
  )
}

function Dato({ label, valor, color }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: C.tenue, textTransform: 'uppercase',
                    letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontFamily: F.num, fontSize: 18, color: color || C.titulo,
                    fontWeight: 600 }}>{valor}</div>
    </div>
  )
}
