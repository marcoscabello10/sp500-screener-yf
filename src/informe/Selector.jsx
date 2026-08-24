import React, { useState, useRef, useMemo } from 'react'
import { C, F } from './estilos.js'

// ─────────────────────────────────────────────────────────────────────────────
// Selector de activo — tres caminos que conviven
//   1. Subir el Excel o el HTML que exporta F1/F5 del screener
//   2. Buscador sobre los 504 + los de afuera que esten en el detalle
//   3. Cartera propia de F5, leida del localStorage del screener
// Ademas guarda un historial propio de lo que fuiste abriendo.
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE_HISTORIAL = 'informe_historial_v1'

export function leerHistorial() {
  try { return JSON.parse(localStorage.getItem(CLAVE_HISTORIAL)) || [] }
  catch { return [] }
}

export function guardarEnHistorial(ticker) {
  try {
    const h = leerHistorial().filter(t => t !== ticker)
    h.unshift(ticker)
    localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(h.slice(0, 20)))
  } catch { /* modo incognito o storage lleno: no es critico */ }
}

// El screener guarda la cartera de F5 con la clave sp500_client_{nombre}_v1.
// Es la UNICA clave del screener que persiste algo util para nosotros: el
// resultado filtrado de F1 vive solo en estado de React y se recalcula.
export function leerCarterasF5() {
  const out = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith('sp500_client_') || !k.endsWith('_v1')) continue
      const d = JSON.parse(localStorage.getItem(k))
      const tickers = (d?.holdings || d?.tickers || d?.rows || [])
        .map(x => (typeof x === 'string' ? x : x?.ticker || x?.symbol))
        .filter(Boolean)
      if (tickers.length) {
        out.push({ nombre: k.replace('sp500_client_', '').replace('_v1', ''),
                   tickers: [...new Set(tickers.map(t => String(t).toUpperCase()))] })
      }
    }
  } catch { /* si falla, simplemente no hay carteras */ }
  return out
}

// ── Lectura de archivos ─────────────────────────────────────────────────────

const ES_TICKER = /^[A-Z][A-Z0-9.\-]{0,6}$/

// Misma deteccion flexible que ya usa F5 para importar carteras.
function esColumnaTicker(h) {
  const s = String(h || '').toLowerCase().trim()
  return s.includes('ticker') || s.includes('simbolo') || s.includes('símbolo')
      || s.includes('activo') || s === 'accion' || s === 'acción' || s === 'symbol'
}

function filasAActivos(filas, encabezado) {
  const iTicker = encabezado.findIndex(esColumnaTicker)
  if (iTicker < 0) return []
  const norm = h => String(h || '').toLowerCase()
  const iSector = encabezado.findIndex(h => norm(h).includes('sector'))
  const iNombre = encabezado.findIndex(h => norm(h).includes('nombre') || norm(h) === 'name')
  const iScore  = encabezado.findIndex(h => norm(h).includes('score') || norm(h).includes('puntaje'))
  const vistos = new Set()
  const out = []
  for (const f of filas) {
    const t = String(f[iTicker] ?? '').trim().toUpperCase()
    if (!t || !ES_TICKER.test(t) || vistos.has(t)) continue
    vistos.add(t)
    out.push({
      ticker: t,
      sector: iSector >= 0 ? f[iSector] : null,
      nombre: iNombre >= 0 ? f[iNombre] : null,
      score:  iScore  >= 0 ? parseFloat(f[iScore]) : null,
    })
  }
  return out
}

async function leerExcel(file) {
  // Carga diferida: la libreria xlsx pesa ~940 kB y solo hace falta si el
  // usuario efectivamente sube un Excel. Asi /informe arranca liviano.
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  // Se prueban todas las hojas: la de F1 se llama "Fundamentales", pero un
  // Excel de cartera puede tener otro nombre.
  for (const nombreHoja of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, defval: null })
    if (!aoa.length) continue
    // El encabezado no siempre esta en la primera fila (puede haber titulo)
    for (let i = 0; i < Math.min(5, aoa.length); i++) {
      const activos = filasAActivos(aoa.slice(i + 1), aoa[i] || [])
      if (activos.length) return { activos, hoja: nombreHoja }
    }
  }
  return { activos: [], hoja: null }
}

async function leerHTML(file) {
  const texto = await file.text()
  const doc = new DOMParser().parseFromString(texto, 'text/html')
  for (const tabla of Array.from(doc.querySelectorAll('table'))) {
    const filas = Array.from(tabla.querySelectorAll('tr'))
      .map(tr => Array.from(tr.querySelectorAll('th,td')).map(c => c.textContent.trim()))
    if (filas.length < 2) continue
    for (let i = 0; i < Math.min(3, filas.length); i++) {
      const activos = filasAActivos(filas.slice(i + 1), filas[i])
      if (activos.length) return { activos, hoja: 'tabla HTML' }
    }
  }
  // Sin tabla reconocible: ultimo recurso, buscar tickers sueltos en el texto
  const crudos = (doc.body?.textContent || '').match(/\b[A-Z]{1,5}(?:[.\-][A-Z])?\b/g) || []
  return { activos: [], hoja: null, candidatosSueltos: [...new Set(crudos)].slice(0, 60) }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Selector({ universo, onElegir, cargando }) {
  const [subidos, setSubidos] = useState(null)
  const [errorArchivo, setErrorArchivo] = useState(null)
  const [q, setQ] = useState('')
  const [arrastrando, setArrastrando] = useState(false)
  const inputRef = useRef(null)

  const historial = useMemo(() => leerHistorial(), [])
  const carteras = useMemo(() => leerCarterasF5(), [])

  async function procesar(file) {
    setErrorArchivo(null); setSubidos(null)
    if (!file) return
    try {
      const esHtml = /\.html?$/i.test(file.name)
      const r = esHtml ? await leerHTML(file) : await leerExcel(file)
      if (!r.activos.length) {
        setErrorArchivo(
          `No encontré una columna de tickers en "${file.name}". ` +
          `Esperaba un encabezado tipo "Ticker", "Símbolo" o "Activo" — ` +
          `es el formato que exporta F1 en la hoja "Fundamentales".`)
        return
      }
      setSubidos({ ...r, archivo: file.name })
    } catch (e) {
      setErrorArchivo(`No pude leer "${file.name}": ${e.message}`)
    }
  }

  const resultados = useMemo(() => {
    const s = q.trim().toUpperCase()
    if (s.length < 1) return []
    return universo
      .filter(a => a.symbol.startsWith(s) ||
                   (a.name || '').toUpperCase().includes(s))
      .slice(0, 12)
  }, [q, universo])

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 22px 60px' }}>
      <h1 style={{ fontSize: 27, marginBottom: 6 }}>Informe avanzado</h1>
      <p style={{ color: C.tenue, marginTop: 0, marginBottom: 28 }}>
        Análisis por activo sobre datos de Yahoo Finance y reportes 10-K de la SEC.
      </p>

      {/* ── Subir archivo ── */}
      <div
        onDragOver={e => { e.preventDefault(); setArrastrando(true) }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={e => { e.preventDefault(); setArrastrando(false); procesar(e.dataTransfer.files?.[0]) }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${arrastrando ? C.acento : C.bordeFuerte}`,
          background: arrastrando ? C.acentoFondo : C.panel,
          borderRadius: 10, padding: '26px 20px', textAlign: 'center',
          cursor: 'pointer', transition: 'all .15s',
        }}>
        <div style={{ fontSize: 16, color: C.titulo, fontWeight: 600 }}>
          Arrastrá el Excel o el HTML que exportaste de F1 o F5
        </div>
        <div style={{ color: C.tenue, fontSize: 13.5, marginTop: 5 }}>
          o hacé clic para elegirlo · .xlsx, .xls, .html
        </div>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.html,.htm"
               style={{ display: 'none' }}
               onChange={e => procesar(e.target.files?.[0])} />
      </div>

      {errorArchivo && (
        <div style={{ marginTop: 12, padding: '11px 14px', borderRadius: 8,
                      background: C.ambarFondo, color: C.ambar, fontSize: 14 }}>
          {errorArchivo}
        </div>
      )}

      {subidos && (
        <Grupo titulo={`${subidos.activos.length} activos en ${subidos.archivo}`}
               subtitulo={subidos.hoja ? `hoja "${subidos.hoja}"` : null}>
          {subidos.activos.map(a => (
            <Chip key={a.ticker} onClick={() => onElegir(a.ticker)} disabled={cargando}
                  principal={a.ticker}
                  secundario={a.score != null && !Number.isNaN(a.score)
                    ? `score ${a.score.toFixed(0)}` : (a.sector || '')} />
          ))}
        </Grupo>
      )}

      {/* ── Buscador ── */}
      <div style={{ marginTop: 30 }}>
        <Titulo>Buscar cualquier activo</Titulo>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Ticker o nombre — por ejemplo AAPL o Apple"
          style={{
            width: '100%', padding: '11px 14px', borderRadius: 8,
            border: `1px solid ${C.bordeFuerte}`, outline: 'none',
            color: C.cuerpo, background: '#fff',
          }} />
        {resultados.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {resultados.map(a => (
              <Chip key={a.symbol} onClick={() => onElegir(a.symbol)} disabled={cargando}
                    principal={a.symbol} secundario={a.name} />
            ))}
          </div>
        )}
        {q.trim().length >= 1 && resultados.length === 0 && (
          <p style={{ color: C.tenue, fontSize: 14 }}>
            No hay coincidencias en el snapshot. Si es un papel de afuera del S&amp;P 500,
            agregalo con <code>python fetch_informe.py {q.trim().toUpperCase()}</code> y
            volvé a pushear.
          </p>
        )}
      </div>

      {/* ── Cartera propia ── */}
      {carteras.map(c => (
        <Grupo key={c.nombre} titulo={`Cartera propia — ${c.nombre}`}>
          {c.tickers.map(t => (
            <Chip key={t} onClick={() => onElegir(t)} disabled={cargando} principal={t} />
          ))}
        </Grupo>
      ))}

      {/* ── Historial ── */}
      {historial.length > 0 && (
        <Grupo titulo="Vistos recientemente">
          {historial.map(t => (
            <Chip key={t} onClick={() => onElegir(t)} disabled={cargando} principal={t} />
          ))}
        </Grupo>
      )}

      <p style={{ marginTop: 40, fontSize: 12.5, color: C.tenue, lineHeight: 1.6 }}>
        Los datos de mercado salen del snapshot que genera el bot local; el histórico
        se consulta en vivo contra la SEC. Este análisis no constituye recomendación
        de inversión.
      </p>
    </div>
  )
}

function Titulo({ children }) {
  return <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '.05em',
                      color: C.subtitulo, marginBottom: 10 }}>{children}</h2>
}

function Grupo({ titulo, subtitulo, children }) {
  return (
    <div style={{ marginTop: 30 }}>
      <Titulo>{titulo}</Titulo>
      {subtitulo && <div style={{ color: C.tenue, fontSize: 13, marginTop: -6,
                                  marginBottom: 8 }}>{subtitulo}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </div>
  )
}

function Chip({ principal, secundario, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        background: '#fff', border: `1px solid ${C.bordeFuerte}`, borderRadius: 8,
        padding: '7px 12px', textAlign: 'left', opacity: disabled ? .5 : 1,
        display: 'flex', flexDirection: 'column', gap: 1, minWidth: 78,
      }}>
      <span style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo, fontSize: 14 }}>
        {principal}
      </span>
      {secundario && (
        <span style={{ fontSize: 11.5, color: C.tenue, maxWidth: 170,
                       overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap' }}>{secundario}</span>
      )}
    </button>
  )
}
