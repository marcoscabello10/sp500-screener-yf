import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Selector, { guardarEnHistorial } from './Selector.jsx'
import Informe from './Informe.jsx'
import Cartera from './Cartera.jsx'
import { PERFILES, PERFIL_POR_DEFECTO, OBJETIVOS, OBJETIVO_POR_DEFECTO,
         HORIZONTES, HORIZONTE_POR_DEFECTO, CLASES_RESTO } from './cartera.js'
import { scoresPorSector } from './sugerencias.js'
import { armarUniverso } from './universo.js'
import { C, F, CSS_GLOBAL } from './estilos.js'

// ─────────────────────────────────────────────────────────────────────────────
// App del INFORME AVANZADO (/informe.html). Separada del screener: no importa
// nada de src/App.jsx y tiene su propio bundle.
//
// Dos modos:
//   - individual: un activo, el informe completo en pantalla
//   - cartera: varios activos, el documento que se le manda al cliente
//
// La cartera se arma EN EL NAVEGADOR, pidiendo los informes de a uno. Hacerlo
// en el servidor serían ~50 pedidos a la SEC en una sola invocación y con 20
// activos se pasaría del límite de 60 segundos. Así además hay barra de
// progreso y se aprovecha el caché de lo ya visto.
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE_CACHE = 'informe_cache_v1'
const CLAVE_META = 'informe_meta_v1'
const DIAS_CACHE = 1   // el histórico de la SEC cambia por trimestre; 1 día sobra

function cacheLeer(ticker) {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE_CACHE)) || {}
    const e = c[ticker]
    if (!e) return null
    if ((Date.now() - e.ts) / 86400000 > DIAS_CACHE) return null
    return e.datos
  } catch { return null }
}

function cacheGuardar(ticker, datos) {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE_CACHE)) || {}
    c[ticker] = { ts: Date.now(), datos }
    const claves = Object.keys(c).sort((a, b) => c[b].ts - c[a].ts).slice(0, 40)
    const podado = {}
    claves.forEach(k => { podado[k] = c[k] })
    localStorage.setItem(CLAVE_CACHE, JSON.stringify(podado))
  } catch { /* storage lleno o incógnito: seguimos sin caché */ }
}

const META_VACIA = { cliente: '', comitente: '', preparadoPor: '', logo: '',
                     titulo: 'Análisis de cartera', perfil: PERFIL_POR_DEFECTO,
                     objetivo: OBJETIVO_POR_DEFECTO, horizonte: HORIZONTE_POR_DEFECTO }

function metaLeer() {
  try { return { ...META_VACIA, ...(JSON.parse(localStorage.getItem(CLAVE_META)) || {}) } }
  catch { return { ...META_VACIA } }
}

export default function App() {
  const [stocks, setStocks] = useState([])
  const [universo, setUniverso] = useState([])
  // codigo de BYMA -> ticker del ADR. Sale de informe_detalle.json.
  const [alias, setAlias] = useState(null)
  const [completos, setCompletos] = useState(new Set())
  // El detalle CRUDO, no solo los nombres. Antes se guardaban unicamente las
  // claves (para marcar cuales tenian informe completo) y los fundamentales de
  // los 130 CEDEAR de afuera del indice se tiraban a la basura despues de
  // bajarlos. Son justamente los que faltaban en la rotacion.
  const [detalle, setDetalle] = useState(null)
  const [datos, setDatos] = useState(null)
  const [cartera, setCartera] = useState(null)
  const [meta, setMeta] = useState(metaLeer)
  const [conAnexo, setConAnexo] = useState(false)
  const [pendientes, setPendientes] = useState(null)
  // Cantidad, precio de compra y valor por activo, tal como los dejo F5.
  // Vacio = cartera propuesta (o Excel sin cantidades): el informe sale igual,
  // solo que sin la capa de pesos.
  const [posiciones, setPosiciones] = useState({})   // tickers elegidos, antes de generar
  const [progreso, setProgreso] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  // ── EL UNIVERSO OPERABLE ──────────────────────────────────────────────────
  // `stocks` son las 504 del S&P. `detalle` trae ademas los 130 CEDEAR que no
  // estan en el indice, con los mismos fundamentales. Hasta el 31/08 esos 130
  // no entraban a ningun lado: aparecian en el buscador y no podian ser
  // candidatos de rotacion, porque el pool que se puntua era solo `stocks`.
  //
  // Medido: de 51 candidatos, 28 son de este grupo (PBR, HMY, SBS, NVO, ABEV,
  // BBD, VIST...). Mas de la mitad del abanico no existia.
  const mercado = useMemo(() => armarUniverso(stocks, detalle),
                          [stocks, detalle])
  // Los percentiles se calculan sobre TODO (634), no solo sobre lo comprable:
  // que un papel no cotice como CEDEAR no lo hace menos comparable como
  // empresa. El filtro por CEDEAR vive en `candidatosRotacion`, que es donde
  // corresponde — al ELEGIR, no al MEDIR.
  const scores = useMemo(() => scoresPorSector(mercado.todos), [mercado])

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/data/sp500_fundamentals.json')
        const d = await r.json()
        setStocks(d.stocks || [])
      } catch { /* sin snapshot el buscador queda vacío, no es fatal */ }
      try {
        const r = await fetch('/data/informe_detalle.json')
        const d = await r.json()
        setCompletos(new Set(Object.keys(d.activos || {})))
        setDetalle(d.activos || {})
        // El diccionario de codigos de BYMA (YPFD -> YPF, IRSA -> IRS). Viaja
        // en el archivo en vez de estar duplicado en JavaScript: ver el bloque
        // "LOS CODIGOS LOCALES" en universo.js.
        setAlias(d.alias_locales || null)
        setUniverso(u => {
          const yaEstan = new Set(u.map(a => a.symbol))
          const extra = Object.entries(d.activos || {})
            .filter(([sym]) => !yaEstan.has(sym))
            .map(([sym, a]) => ({ symbol: sym, name: a.name }))
          return [...u, ...extra]
        })
      } catch { /* idem */ }
    })()
  }, [])

  useEffect(() => {
    setUniverso(u => {
      const yaEstan = new Set(u.map(a => a.symbol))
      const base = stocks.filter(s => !yaEstan.has(s.symbol))
        .map(s => ({ symbol: s.symbol, name: s.name }))
      return [...base, ...u]
    })
  }, [stocks])

  const traer = useCallback(async (t, forzar = false) => {
    if (!forzar) {
      const c = cacheLeer(t)
      if (c) return c
    }
    const r = await fetch(`/api/informe?action=datos&ticker=${encodeURIComponent(t)}`)
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
    cacheGuardar(t, d)
    return d
  }, [])

  const pedir = useCallback(async (ticker, forzar = false) => {
    setError(null); setCargando(true)
    const t = String(ticker).toUpperCase().trim()
    try {
      const d = await traer(t, forzar)
      setDatos(d); setCartera(null); guardarEnHistorial(t)
      window.scrollTo(0, 0)
    } catch (e) {
      setError(`No pude generar el informe de ${t}: ${e.message}`)
    } finally { setCargando(false) }
  }, [traer])

  const generarCartera = useCallback(async (tickers) => {
    setError(null); setCargando(true); setPendientes(null)
    const out = []
    try {
      for (let i = 0; i < tickers.length; i++) {
        setProgreso({ hecho: i, total: tickers.length, actual: tickers[i] })
        try {
          out.push(await traer(tickers[i]))
          guardarEnHistorial(tickers[i])
        } catch (e) {
          out.push({ ticker: tickers[i], error: e.message })
        }
      }
      const fallidos = out.filter(o => o.error)
      if (fallidos.length) {
        setError(`No pude traer ${fallidos.length} de ${tickers.length}: ` +
                 fallidos.map(f => f.ticker).join(', ') +
                 '. El resto del informe se armó igual.')
      }
      setCartera(out); setDatos(null)
      window.scrollTo(0, 0)
    } finally { setProgreso(null); setCargando(false) }
  }, [traer])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const t = p.get('ticker')
    if (t) pedir(t)
  }, [pedir])

  function guardarMeta(m) {
    setMeta(m)
    try {
      // el logo puede pesar; se guarda igual para no volver a cargarlo cada vez
      localStorage.setItem(CLAVE_META, JSON.stringify(m))
    } catch { /* si no entra, se pierde solo la preferencia */ }
  }

  const volver = () => { setDatos(null); setCartera(null); setError(null) }

  return (
    <>
      <style>{CSS_GLOBAL}</style>

      {cargando && <BarraProgreso progreso={progreso} />}

      {error && (
        <div className="no-imprimir" style={{ maxWidth: 900, margin: '18px auto 0',
          padding: '12px 16px', background: C.ambarFondo, color: C.ambar,
          borderRadius: 8, fontSize: 14 }}>{error}</div>
      )}

      {pendientes && (
        <FormularioCartera
          tickers={pendientes} meta={meta} conAnexo={conAnexo}
          setMeta={guardarMeta} setConAnexo={setConAnexo}
          onCancelar={() => setPendientes(null)}
          onGenerar={() => generarCartera(pendientes)} />
      )}

      {cartera ? (
        <>
          <BarraAcciones etiqueta={`Cartera · ${cartera.length} activos`}
                         onVolver={volver} />
          <Cartera informes={cartera} meta={meta} stocks={mercado.operables}
                   mercado={mercado} scores={scores}
                   conAnexo={conAnexo} posiciones={posiciones}
                   otros={meta.otros} />
        </>
      ) : datos ? (
        <>
          <BarraAcciones etiqueta={`${datos.ticker} · informe ${datos.nivel}`}
                         onVolver={volver}
                         onRefrescar={() => pedir(datos.ticker, true)} />
          <Informe d={datos} onVolver={volver} />
        </>
      ) : (
        <Selector universo={universo} completos={completos} onElegir={pedir}
                  precios={mercado.porSymbol} alias={alias}
                  onCartera={(ts, pos) => { setPosiciones(pos || {}); setPendientes(ts) }}
                  cargando={cargando} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function BarraProgreso({ progreso }) {
  return (
    <div className="no-imprimir" style={{ position: 'fixed', top: 0, left: 0,
      right: 0, zIndex: 50 }}>
      <div style={{ height: 3, background: C.acentoFondo }}>
        <div style={{ height: '100%', background: C.acento, transition: 'width .2s',
          width: progreso ? `${(progreso.hecho / progreso.total) * 100}%` : '35%',
          animation: progreso ? 'none' : 'barra 1.1s ease-in-out infinite' }} />
      </div>
      {progreso && (
        <div style={{ background: '#fff', borderBottom: `1px solid ${C.borde}`,
          padding: '6px 22px', fontSize: 13, color: C.tenue }}>
          Analizando <b style={{ fontFamily: F.num, color: C.titulo }}>
          {progreso.actual}</b> — {progreso.hecho} de {progreso.total}
        </div>
      )}
      <style>{`@keyframes barra { 0% { margin-left: -35% } 100% { margin-left: 100% } }`}</style>
    </div>
  )
}

function Opciones({ titulo, opciones, valor, onCambio, pie }) {
  const elegida = opciones[valor] || Object.values(opciones)[0]
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, color: C.subtitulo, marginBottom: 5 }}>{titulo}</div>
      <div style={{ display: 'flex', gap: 7 }}>
        {Object.values(opciones).map(o => {
          const activo = valor === o.clave
          return (
            <button key={o.clave} onClick={() => onCambio(o.clave)}
              style={{ flex: 1, padding: '8px 6px', borderRadius: 7,
                       border: `1px solid ${activo ? C.acento : C.bordeFuerte}`,
                       background: activo ? C.acentoFondo : '#fff',
                       color: activo ? C.acento : C.cuerpo,
                       fontWeight: activo ? 600 : 400, fontSize: 13.5 }}>
              {o.nombre}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: 11.5, color: C.tenue, marginTop: 5, lineHeight: 1.5 }}>
        {pie(elegida)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// El resto de la cartera: lo que NO se sube al informe.
//
// Sin esto, los pesos salen sobre la suma de lo analizado. Con 5 CEDEARs que
// son la mitad de la cartera, cada peso sale al doble.
//
// Se aceptan montos Y porcentajes porque sirven para cosas distintas: los
// montos son exactos pero envejecen (si una posicion se movio, el total ya no
// cierra), y los porcentajes aguantan mejor el paso del tiempo. Marcos pidio
// las dos por ese motivo.
// ─────────────────────────────────────────────────────────────────────────────

function RestoDeCartera({ meta, setMeta }) {
  const otros = meta.otros || { modo: 'pct' }
  const set = (k, v) => setMeta({ ...meta, otros: { ...otros, [k]: v } })
  const esPct = (otros.modo || 'pct') === 'pct'
  const suma = CLASES_RESTO.reduce((a, c) => a + (Number(otros[c.clave]) || 0), 0)
  const sumaMal = esPct && suma >= 100

  return (
    <div style={{ marginBottom: 14, border: `1px solid ${C.borde}`,
                  borderRadius: 8, padding: '11px 13px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10,
                    marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, color: C.subtitulo }}>
          El resto de la cartera <span style={{ color: C.tenue }}>(opcional)</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {[['pct', '%'], ['monto', 'US$']].map(([m, txt]) => (
            <button key={m} onClick={() => set('modo', m)}
              style={{ padding: '3px 10px', borderRadius: 5, fontSize: 12.5,
                       border: `1px solid ${esPct === (m === 'pct') ? C.acento : C.bordeFuerte}`,
                       background: esPct === (m === 'pct') ? C.acentoFondo : '#fff',
                       color: esPct === (m === 'pct') ? C.acento : C.cuerpo }}>
              {txt}
            </button>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 11.5, color: C.tenue, margin: '0 0 8px', lineHeight: 1.5 }}>
        Lo que el cliente tiene y no entra en este informe. Sin esto, los pesos se
        calculan sobre los activos analizados y salen inflados.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        {CLASES_RESTO.map(c => (
          <label key={c.clave} style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: C.tenue, marginBottom: 2 }}>
              {c.nombre}
            </div>
            <input type="number" min="0" inputMode="decimal"
              value={otros[c.clave] ?? ''} placeholder={esPct ? '%' : 'US$'}
              onChange={e => set(c.clave, e.target.value === '' ? undefined
                                                               : Number(e.target.value))}
              style={{ width: '100%', padding: '7px 9px', borderRadius: 6,
                       border: `1px solid ${sumaMal ? C.rojo : C.bordeFuerte}`,
                       outline: 'none', color: C.cuerpo, fontSize: 13.5 }} />
          </label>
        ))}
      </div>
      {sumaMal && (
        <p style={{ fontSize: 11.5, color: C.rojo, margin: '6px 0 0' }}>
          Los porcentajes suman {Math.round(suma)}%. Tiene que quedar lugar para
          los activos de este informe.
        </p>
      )}
      {!sumaMal && suma > 0 && (
        <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>
          {esPct
            ? `Los activos de este informe serían el ${Math.round((100 - suma) * 10) / 10}% de la cartera.`
            : `Se suman US$ ${Math.round(suma).toLocaleString('es-AR')} al total para calcular los pesos.`}
        </p>
      )}
      <p style={{ fontSize: 11.5, color: C.tenue, margin: '6px 0 0' }}>
        Si el Excel trae la columna <b>% Posición</b>, se usa esa y estos campos
        no hacen falta.
      </p>
    </div>
  )
}

function FormularioCartera({ tickers, meta, conAnexo, setMeta, setConAnexo,
                             onCancelar, onGenerar }) {
  function cargarLogo(file) {
    if (!file) return
    const fr = new FileReader()
    fr.onload = () => setMeta({ ...meta, logo: fr.result })
    fr.readAsDataURL(file)
  }
  const campo = (k, label, placeholder) => (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, color: C.subtitulo, marginBottom: 3 }}>{label}</div>
      <input value={meta[k] || ''} placeholder={placeholder}
        onChange={e => setMeta({ ...meta, [k]: e.target.value })}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 7,
                 border: `1px solid ${C.bordeFuerte}`, outline: 'none',
                 color: C.cuerpo }} />
    </label>
  )
  return (
    <div className="no-imprimir" style={{ position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(11,46,79,.35)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 20 }} onClick={onCancelar}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff',
        borderRadius: 12, padding: '24px 26px', width: 480, maxWidth: '100%',
        maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: 19, marginBottom: 4 }}>Informe de cartera</h2>
        <p style={{ color: C.tenue, fontSize: 13.5, marginTop: 0, marginBottom: 18 }}>
          {tickers.length} activos. Estos datos van en la portada del documento.
        </p>

        {campo('cliente', 'Cliente', 'Nombre del cliente (opcional)')}
        {campo('comitente', 'Número de comitente', 'Opcional')}
        {campo('preparadoPor', 'Preparado por', 'Tu nombre')}

        {/* Las tres preguntas que el informe no puede deducir de los datos.
            El perfil fija los topes de concentración; el objetivo cambia con qué
            balanza se miran los bloques; el horizonte, qué riesgos son
            relevantes. Ninguna toca el veredicto de la empresa. */}
        <Opciones titulo="Perfil de la cartera" opciones={PERFILES}
                  valor={meta.perfil || PERFIL_POR_DEFECTO}
                  onCambio={v => setMeta({ ...meta, perfil: v })}
                  pie={o => `${o.resumen} Tope por posición ${o.maxPosicion}%, por sector ${o.maxSector}%.`} />

        <Opciones titulo="Objetivo" opciones={OBJETIVOS}
                  valor={meta.objetivo || OBJETIVO_POR_DEFECTO}
                  onCambio={v => setMeta({ ...meta, objetivo: v })}
                  pie={o => o.resumen} />

        <Opciones titulo="Horizonte" opciones={HORIZONTES}
                  valor={meta.horizonte || HORIZONTE_POR_DEFECTO}
                  onCambio={v => setMeta({ ...meta, horizonte: v })}
                  pie={o => o.nota} />

        <RestoDeCartera meta={meta} setMeta={setMeta} />

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, color: C.subtitulo, marginBottom: 4 }}>
            Logo o marca (opcional)
          </div>
          {meta.logo && (
            <img src={meta.logo} alt="" style={{ maxHeight: 40, marginBottom: 7,
                                                 display: 'block' }} />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="file" accept="image/*" style={{ fontSize: 13 }}
                   onChange={e => cargarLogo(e.target.files?.[0])} />
            {meta.logo && (
              <button onClick={() => setMeta({ ...meta, logo: '' })}
                style={{ background: 'none', border: 'none', color: C.tenue,
                         fontSize: 13 }}>Quitar</button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: C.tenue, marginTop: 4 }}>
            Queda guardado en este navegador, no se sube a ningún lado.
          </div>
        </div>

        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start',
                        marginBottom: 20, cursor: 'pointer' }}>
          <input type="checkbox" checked={conAnexo} style={{ marginTop: 3 }}
                 onChange={e => setConAnexo(e.target.checked)} />
          <span style={{ fontSize: 13.5 }}>
            Incluir anexo con el informe completo de cada activo
            <div style={{ color: C.tenue, fontSize: 12.5 }}>
              Suma gráficos y series históricas. Con {tickers.length} activos el
              documento pasa de ~{Math.max(3, Math.ceil(tickers.length * 0.7))} a
              ~{Math.ceil(tickers.length * 4)} páginas.
            </div>
            {/* Sin esta línea el botón de tesis era INENCONTRABLE en la vista de
                cartera: vive dentro del anexo, y el anexo arranca apagado. */}
            <div style={{ color: C.acento, fontSize: 12.5, marginTop: 3 }}>
              También habilita el botón de tesis con IA en cada activo. Los
              botones no gastan solos: solo cuando hacés clic en uno.
            </div>
          </span>
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancelar} style={{ background: 'none',
            border: `1px solid ${C.bordeFuerte}`, borderRadius: 7,
            padding: '9px 16px', color: C.subtitulo }}>Cancelar</button>
          <button onClick={onGenerar} style={{ background: C.acento, color: '#fff',
            border: 'none', borderRadius: 7, padding: '9px 20px',
            fontWeight: 600 }}>Generar</button>
        </div>
      </div>
    </div>
  )
}

function BarraAcciones({ etiqueta, onVolver, onRefrescar }) {
  return (
    <div className="no-imprimir" style={{
      position: 'sticky', top: 0, zIndex: 10, background: '#fff',
      borderBottom: `1px solid ${C.borde}`, padding: '9px 22px',
      display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
      <button onClick={onVolver} style={{ marginRight: 'auto', background: 'none',
        border: 'none', color: C.acento, fontSize: 13.5, padding: 0 }}>
        ← Volver
      </button>
      <span style={{ fontSize: 13, color: C.tenue }}>{etiqueta}</span>
      {onRefrescar && <Boton onClick={onRefrescar}>Actualizar datos</Boton>}
      <Boton onClick={() => window.print()} principal>Imprimir o guardar PDF</Boton>
    </div>
  )
}

function Boton({ children, onClick, principal }) {
  return (
    <button onClick={onClick} style={{
      background: principal ? C.acento : '#fff',
      color: principal ? '#fff' : C.subtitulo,
      border: `1px solid ${principal ? C.acento : C.bordeFuerte}`,
      borderRadius: 7, padding: '7px 14px', fontSize: 13.5, fontWeight: 500 }}>
      {children}
    </button>
  )
}
