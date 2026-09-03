import React, { useState, useRef, useMemo } from 'react'
import { C, F } from './estilos.js'
import { resolverTicker } from './universo.js'

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
//
// ⚠️ FORMA REAL (verificada en src/App.jsx, clientCacheSave):
//     { fundData: { "Technology": [ {symbol, sector, price, pe, ..., cantidad,
//                                    precioCompra, valorActual, costoBase,
//                                    gananciaUSD, gananciaPct, pctActual}, ... ],
//                   "Financials": [ ... ] },
//       spy: {...}, timestamp: 1724... }
//
// Antes esta funcion buscaba `holdings` / `tickers` / `rows`, que NO existen en
// esa clave. El resultado no era un error: era silencio. `tickers` quedaba
// vacio, el grupo no se agregaba, y el bloque "Cartera propia" simplemente
// nunca aparecia en el informe. Nadie lo noto porque no habia nada que fallara.
//
// Y lo importante: el screener YA guarda cantidad, precio de compra y valor
// por posicion. No hay que tocar App.jsx para tener los pesos; habia que
// leerlos bien.
const CADUCIDAD_DIAS = 7   // mismo CLIENT_CACHE_DAYS que usa el screener

export function leerCarterasF5() {
  const out = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith('sp500_client_') || !k.endsWith('_v1')) continue
      const d = JSON.parse(localStorage.getItem(k))
      if (!d) continue

      // forma actual: fundData agrupado por sector
      let activos = []
      if (d.fundData && typeof d.fundData === 'object' && !Array.isArray(d.fundData)) {
        activos = Object.values(d.fundData).flat().filter(Boolean)
      }
      // respaldo por si alguna version vieja guardo una lista plana
      if (!activos.length) {
        activos = (d.holdings || d.tickers || d.rows || [])
          .map(x => (typeof x === 'string' ? { symbol: x } : x))
          .filter(Boolean)
      }

      const posiciones = {}
      const tickers = []
      for (const a of activos) {
        const t = String(a.symbol || a.ticker || '').toUpperCase().trim()
        if (!t || t === 'SPY' || posiciones[t]) continue
        tickers.push(t)
        posiciones[t] = {
          cantidad: a.cantidad ?? null,
          precioCompra: a.precioCompra ?? null,
          valorActual: a.valorActual ?? null,
          costoBase: a.costoBase ?? null,
          gananciaUSD: a.gananciaUSD ?? null,
          gananciaPct: a.gananciaPct ?? null,
          pctActual: a.pctActual ?? null,
        }
      }
      if (!tickers.length) continue

      const edadDias = d.timestamp ? (Date.now() - d.timestamp) / 86400000 : null
      out.push({
        nombre: k.replace('sp500_client_', '').replace('_v1', ''),
        tickers,
        posiciones,
        conPesos: tickers.filter(t => posiciones[t].valorActual > 0).length,
        edadDias: edadDias == null ? null : Math.round(edadDias * 10) / 10,
        vencida: edadDias != null && edadDias > CADUCIDAD_DIAS,
      })
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

// Sin tildes y sin mayusculas, para que "Precio de Compra", "PRECIO DE COMPRA"
// y "precio compra" sean lo mismo. Es la unica forma de que la plantilla
// aguante que alguien la retoque a mano.
const sinTilde = h => String(h || '').toLowerCase().trim()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * Un numero de una celda de Excel, en cualquiera de las formas en que llega.
 *
 * xlsx devuelve numeros de verdad cuando la celda es numerica, pero si el
 * cliente la formateo como texto llega "1.234,56" o "US$ 288,61". Sin esto,
 * `parseFloat("1.234,56")` da 1.234 — mil veces menos, sin ningun error.
 */
function aNumero(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim().replace(/[^\d.,\-]/g, '')
  if (!s) return null
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.')
  if (coma > -1 && punto > -1) {
    // El ultimo separador es el decimal; el otro es de miles.
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.')
                     : s.replace(/,/g, '')
  } else if (coma > -1) {
    // Una sola coma: decimal si deja 1 o 2 digitos ("1,5"), miles si deja 3.
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function filasAActivos(filas, encabezado, alias = null) {
  const iTicker = encabezado.findIndex(esColumnaTicker)
  if (iTicker < 0) return []
  const norm = h => String(h || '').toLowerCase()
  const iSector = encabezado.findIndex(h => norm(h).includes('sector'))
  const iNombre = encabezado.findIndex(h => norm(h).includes('nombre') || norm(h) === 'name')
  const iScore  = encabezado.findIndex(h => norm(h).includes('score') || norm(h).includes('puntaje'))

  // ── LAS TRES COLUMNAS QUE LA PLANTILLA PROMETE Y NADIE LEIA ──────────────
  // ⚠️ Hasta el 31/08/2026 esta funcion leia ticker, sector, nombre y score, y
  // NADA MAS. La plantilla que Marcos le manda al cliente pide Cantidad,
  // Precio de compra y % Posicion, la hoja "Instrucciones" explica las tres...
  // y el informe las tiraba. Las posiciones salian UNICAMENTE de las carteras
  // que F5 deja en localStorage, asi que subir el Excel daba una lista de
  // tickers sin pesos y el informe entero se degradaba a "cartera propuesta"
  // sin decir por que.
  const iCant   = encabezado.findIndex(h => /^cantidad|nominal/.test(sinTilde(h)))
  const iPrecio = encabezado.findIndex(h => {
    const x = sinTilde(h)
    return x.includes('precio') && (x.includes('compra') || x.includes('costo'))
  })
  const iPct = encabezado.findIndex(h => {
    const x = sinTilde(h)
    return (x.includes('%') || x.includes('porcentaje') || x.includes('peso'))
        && (x.includes('posicion') || x.includes('cartera') || x.includes('peso')
            || x.trim() === '%')
  })

  const vistos = new Set()
  const out = []
  for (const f of filas) {
    const crudo = String(f[iTicker] ?? '').trim().toUpperCase()
    // ── EL CODIGO DE BYMA NO ES EL TICKER (03/09/2026) ────────────────────
    // Un cliente argentino escribe "YPFD", no "YPF"; "PAMP", no "PAM"; y a
    // veces "YPFD.BA" si exporto del broker. Hasta ahora ninguna de esas
    // formas encontraba el papel, y el sintoma era el peor: la posicion
    // desaparecia del informe SIN error y SIN aviso, como si el cliente
    // hubiera escrito cualquier cosa.
    //
    // `resolverTicker` saca el sufijo `.BA` y traduce con el diccionario que
    // viaja en informe_detalle.json. Si el diccionario no esta, devuelve el
    // ticker limpio: el comportamiento de antes, nunca peor.
    const t = resolverTicker(crudo, alias)
    if (!t || !ES_TICKER.test(t) || vistos.has(t)) continue
    vistos.add(t)
    out.push({
      ticker: t,
      // Lo que el cliente escribio, cuando NO es lo mismo. El informe lo
      // muestra: "Aparece como YPFD en tu Excel" evita la pregunta obvia.
      ...(crudo !== t ? { tickerOriginal: crudo } : {}),
      sector: iSector >= 0 ? f[iSector] : null,
      nombre: iNombre >= 0 ? f[iNombre] : null,
      score:  iScore  >= 0 ? parseFloat(f[iScore]) : null,
      cantidad:     iCant   >= 0 ? aNumero(f[iCant])   : null,
      precioCompra: iPrecio >= 0 ? aNumero(f[iPrecio]) : null,
      pctCrudo:     iPct    >= 0 ? aNumero(f[iPct])    : null,
    })
  }
  return normalizarPorcentajes(out)
}

/**
 * El % Posicion llega en DOS escalas distintas segun como se cargo la celda.
 *
 * Si el cliente la formateo como porcentaje, Excel guarda 0,216 para "21,6%".
 * Si la escribio como numero suelto, guarda 21,6. Las dos son validas y hay
 * que distinguirlas, porque leer 0,216 como "0,216%" haria que el informe crea
 * que esa posicion es el 0,2% de la cartera: los pesos saldrian ~100 veces mas
 * chicos y NO se dispararia ninguna alerta de sobrepeso. Silencioso y total.
 *
 * La regla: si NINGUN valor pasa de 1 y la suma no llega a 1,5, son fracciones.
 * Un 1,5 en escala 0-100 seria una cartera del 1,5%, que no existe.
 */
function normalizarPorcentajes(activos) {
  const vals = activos.map(a => a.pctCrudo).filter(v => v != null && v > 0)
  if (!vals.length) return activos.map(a => ({ ...a, pctExcel: null }))
  const suma = vals.reduce((a, b) => a + b, 0)
  const esFraccion = vals.every(v => v <= 1) && suma <= 1.5
  return activos.map(a => ({
    ...a,
    pctExcel: a.pctCrudo == null || !(a.pctCrudo > 0) ? null
      : Math.round((esFraccion ? a.pctCrudo * 100 : a.pctCrudo) * 1000) / 1000,
  }))
}

async function leerExcel(file, alias) {
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
      const activos = filasAActivos(aoa.slice(i + 1), aoa[i] || [], alias)
      if (activos.length) return { activos, hoja: nombreHoja }
    }
  }
  return { activos: [], hoja: null }
}

async function leerHTML(file, alias) {
  const texto = await file.text()
  const doc = new DOMParser().parseFromString(texto, 'text/html')
  for (const tabla of Array.from(doc.querySelectorAll('table'))) {
    const filas = Array.from(tabla.querySelectorAll('tr'))
      .map(tr => Array.from(tr.querySelectorAll('th,td')).map(c => c.textContent.trim()))
    if (filas.length < 2) continue
    for (let i = 0; i < Math.min(3, filas.length); i++) {
      const activos = filasAActivos(filas.slice(i + 1), filas[i], alias)
      if (activos.length) return { activos, hoja: 'tabla HTML' }
    }
  }
  // Sin tabla reconocible: ultimo recurso, buscar tickers sueltos en el texto
  const crudos = (doc.body?.textContent || '').match(/\b[A-Z]{1,5}(?:[.\-][A-Z])?\b/g) || []
  return { activos: [], hoja: null, candidatosSueltos: [...new Set(crudos)].slice(0, 60) }
}

function nombreDe(universo, ticker) {
  return universo.find(a => a.symbol === ticker)?.name || null
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Selector({ universo, completos, onElegir, onCartera,
                                  cargando, precios = null, alias = null }) {
  const [seleccion, setSeleccion] = useState(() => new Set())

  const alternar = t => setSeleccion(s => {
    const n = new Set(s)
    n.has(t) ? n.delete(t) : n.add(t)
    return n
  })
  const seleccionarTodos = ts => setSeleccion(s => {
    const n = new Set(s)
    const faltan = ts.filter(t => !n.has(t))
    if (faltan.length) faltan.forEach(t => n.add(t))
    else ts.forEach(t => n.delete(t))
    return n
  })
  const [subidos, setSubidos] = useState(null)
  const [errorArchivo, setErrorArchivo] = useState(null)
  const [q, setQ] = useState('')
  const [arrastrando, setArrastrando] = useState(false)
  const inputRef = useRef(null)

  const historial = useMemo(() => leerHistorial(), [])
  const carteras = useMemo(() => leerCarterasF5(), [])

  // Las posiciones (cantidad, precio de compra, valor) de TODAS las carteras de
  // F5 en un solo mapa. La seleccion mezcla activos de varios origenes —
  // buscador, cartera propia, historial — asi que al generar el informe se
  // manda solo el pedazo que corresponde a lo seleccionado. Un activo elegido
  // desde el buscador simplemente no tiene posicion, y el informe lo trata
  // como cartera propuesta en vez de cartera existente.
  const posicionesF5 = useMemo(() => {
    const m = {}
    for (const c of carteras) Object.assign(m, c.posiciones || {})
    return m
  }, [carteras])

  // ── Las posiciones que vienen del ARCHIVO ────────────────────────────────
  // El Excel trae cantidad y precio de compra; el valor de mercado sale del
  // precio de HOY, que ya esta en el universo. Sin este cruce, `cantidad` sola
  // no alcanza: la capa de pesos necesita plata, no nominales.
  const posicionesArchivo = useMemo(() => {
    const m = {}
    for (const a of (subidos?.activos || [])) {
      const tienePeso = a.cantidad > 0 || a.pctExcel > 0
      if (!tienePeso) continue
      const precioHoy = precios?.[a.ticker]?.price ?? null
      const valorActual = (a.cantidad > 0 && precioHoy > 0)
        ? Math.round(a.cantidad * precioHoy * 100) / 100 : null
      const costoBase = (a.cantidad > 0 && a.precioCompra > 0)
        ? Math.round(a.cantidad * a.precioCompra * 100) / 100 : null
      const gananciaUSD = (valorActual != null && costoBase != null)
        ? Math.round((valorActual - costoBase) * 100) / 100 : null
      m[a.ticker] = {
        cantidad: a.cantidad ?? null,
        precioCompra: a.precioCompra ?? null,
        valorActual,
        costoBase,
        gananciaUSD,
        gananciaPct: (gananciaUSD != null && costoBase > 0)
          ? Math.round(gananciaUSD / costoBase * 1000) / 10 : null,
        // El % del Excel es el ANCLA del denominador: dice cuanto pesa esto
        // sobre la cartera COMPLETA, incluyendo lo que no se subio.
        pctExcel: a.pctExcel ?? null,
        pctActual: null,
        origen: 'excel',
      }
    }
    return m
  }, [subidos, precios])

  // El archivo gana sobre F5: es lo que Marcos acaba de subir.
  const posicionesTodas = useMemo(
    () => ({ ...posicionesF5, ...posicionesArchivo }),
    [posicionesF5, posicionesArchivo])

  async function procesar(file) {
    setErrorArchivo(null); setSubidos(null)
    if (!file) return
    try {
      const esHtml = /\.html?$/i.test(file.name)
      const r = esHtml ? await leerHTML(file, alias) : await leerExcel(file, alias)
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
        <Grupo titulo={subidos.archivo}
               subtitulo={subidos.hoja ? `hoja "${subidos.hoja}"` : null}
               activos={subidos.activos} onElegir={onElegir} cargando={cargando}
               completos={completos} seleccion={seleccion} alternar={alternar}
               seleccionarTodos={seleccionarTodos} />
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
          <>
            <p style={{ color: C.tenue, fontSize: 13, margin: '8px 0 0' }}>
              Clic en el activo para verlo solo; tildá la casilla para sumarlo a
              una comparación con otros.
            </p>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {/* Estos Chip nacieron sin casilla, así que desde el buscador solo
                  se podía abrir un activo por vez. Los de cartera e historial sí
                  la tenían: era la misma tarjeta usada de dos formas distintas.
                  Ahora comparten la selección, que es lo que alimenta el informe
                  de cartera. */}
              {resultados.map(a => (
                <Chip key={a.symbol} onClick={() => onElegir(a.symbol)} disabled={cargando}
                      principal={a.symbol} secundario={a.name}
                      completo={completos?.has(a.symbol)}
                      seleccionado={seleccion.has(a.symbol)}
                      onAlternar={() => alternar(a.symbol)} />
              ))}
            </div>
          </>
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
        <Grupo key={c.nombre} titulo={`Cartera propia — ${c.nombre}`}
               subtitulo={
                 (c.conPesos
                   ? `${c.conPesos} de ${c.tickers.length} con cantidad y precio de compra: `
                     + 'el informe puede analizar pesos y rotación.'
                   : 'Sin cantidades en el Excel: se analiza como lista, sin pesos.')
                 + (c.vencida
                     ? ` ⚠ El snapshot de F5 tiene ${c.edadDias} días; volvé a correr F5 para actualizar precios.`
                     : '')
               }
               activos={c.tickers.map(t => ({ ticker: t, nombre: nombreDe(universo, t) }))}
               onElegir={onElegir} cargando={cargando} completos={completos}
               seleccion={seleccion} alternar={alternar}
               seleccionarTodos={seleccionarTodos} />
      ))}

      {/* ── Historial ── */}
      {historial.length > 0 && (
        <Grupo titulo="Vistos recientemente"
               activos={historial.map(t => ({ ticker: t, nombre: nombreDe(universo, t) }))}
               onElegir={onElegir} cargando={cargando} completos={completos}
               seleccion={seleccion} alternar={alternar}
               seleccionarTodos={seleccionarTodos} />
      )}

      {seleccion.size > 0 && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
          background: '#fff', borderTop: `1px solid ${C.bordeFuerte}`,
          boxShadow: '0 -2px 14px rgba(11,46,79,.08)', padding: '12px 22px',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: C.titulo }}>
            <b style={{ fontFamily: F.num }}>{seleccion.size}</b>
            {seleccion.size === 1 ? ' activo seleccionado' : ' activos seleccionados'}
          </span>
          <button onClick={() => setSeleccion(new Set())}
            style={{ background: 'none', border: 'none', color: C.tenue,
                     fontSize: 13.5 }}>Limpiar</button>
          <button onClick={() => onCartera([...seleccion],
                    Object.fromEntries([...seleccion]
                      .filter(t => posicionesTodas[t])
                      .map(t => [t, posicionesTodas[t]])))} disabled={cargando}
            style={{ marginLeft: 'auto', background: C.acento, color: '#fff',
                     border: 'none', borderRadius: 7, padding: '9px 18px',
                     fontSize: 14, fontWeight: 600, opacity: cargando ? .5 : 1 }}>
            Generar informe de cartera →
          </button>
        </div>
      )}

      {completos?.size > 0 && (
        <p style={{ marginTop: 26, fontSize: 12.5, color: C.tenue }}>
          <Punto /> marca los {completos.size} activos con informe <b>completo</b>
          {' '}(incluye consenso a futuro y sentimiento). El resto sale en modo
          reducido: para completarlos, corré <code>python fetch_informe.py --cedears</code>.
        </p>
      )}

      <p style={{ marginTop: 18, fontSize: 12.5, color: C.tenue, lineHeight: 1.6 }}>
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

// Umbral a partir del cual los chips dejan de servir y conviene una tabla.
const UMBRAL_TABLA = 12

export function Grupo({ titulo, subtitulo, activos, onElegir, cargando, completos,
                       seleccion, alternar, seleccionarTodos }) {
  const [filtro, setFiltro] = useState('')
  const [orden, setOrden] = useState(null)   // null = orden original del archivo

  const hayScore = activos.some(a => a.score != null && !Number.isNaN(a.score))
  const esGrande = activos.length > UMBRAL_TABLA

  const visibles = useMemo(() => {
    const f = filtro.trim().toUpperCase()
    let out = f
      ? activos.filter(a => a.ticker.startsWith(f) ||
          String(a.nombre || '').toUpperCase().includes(f) ||
          String(a.sector || '').toUpperCase().includes(f))
      : [...activos]
    if (orden) {
      const dir = orden.desc ? -1 : 1
      out.sort((a, b) => {
        const x = a[orden.campo], y = b[orden.campo]
        if (x == null) return 1
        if (y == null) return -1
        return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
      })
    }
    return out
  }, [activos, filtro, orden])

  function ordenar(campo) {
    setOrden(o => o?.campo === campo ? { campo, desc: !o.desc } : { campo, desc: campo === 'score' })
  }

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Titulo>{titulo}</Titulo>
        {esGrande && (
          <span style={{ fontSize: 12.5, color: C.tenue, marginBottom: 10 }}>
            {visibles.length === activos.length
              ? `${activos.length} activos`
              : `${visibles.length} de ${activos.length}`}
          </span>
        )}
      </div>
      {subtitulo && <div style={{ color: C.tenue, fontSize: 13, marginTop: -6,
                                  marginBottom: 8 }}>{subtitulo}</div>}

      {!esGrande ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {visibles.map(a => (
            <Chip key={a.ticker} onClick={() => onElegir(a.ticker)} disabled={cargando}
                  seleccionado={seleccion?.has(a.ticker)}
                  onAlternar={alternar ? () => alternar(a.ticker) : null}
                  principal={a.ticker} completo={completos?.has(a.ticker)}
                  secundario={a.score != null && !Number.isNaN(a.score)
                    ? `score ${Number(a.score).toFixed(0)}` : (a.sector || a.nombre || '')} />
          ))}
        </div>
      ) : (
        <>
          <input
            value={filtro} onChange={e => setFiltro(e.target.value)}
            placeholder="Filtrar por ticker, nombre o sector…"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 7,
                     border: `1px solid ${C.borde}`, outline: 'none', marginBottom: 8,
                     color: C.cuerpo }} />
          <div style={{ maxHeight: 420, overflowY: 'auto',
                        border: `1px solid ${C.borde}`, borderRadius: 8 }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <tr>
                  {alternar && (
                    <th style={{ width: 30 }}>
                      <input type="checkbox"
                        checked={visibles.length > 0 &&
                                 visibles.every(a => seleccion?.has(a.ticker))}
                        onChange={() => seleccionarTodos(visibles.map(a => a.ticker))}
                        title="Seleccionar todos los visibles" />
                    </th>
                  )}
                  <Th onClick={() => ordenar('ticker')} activo={orden?.campo === 'ticker'}
                      desc={orden?.desc}>Ticker</Th>
                  <Th onClick={() => ordenar('nombre')} activo={orden?.campo === 'nombre'}
                      desc={orden?.desc}>Nombre</Th>
                  <Th onClick={() => ordenar('sector')} activo={orden?.campo === 'sector'}
                      desc={orden?.desc}>Sector</Th>
                  {hayScore && (
                    <Th n onClick={() => ordenar('score')} activo={orden?.campo === 'score'}
                        desc={orden?.desc}>Score</Th>
                  )}
                  <th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {visibles.map(a => (
                  <tr key={a.ticker} onClick={() => !cargando && onElegir(a.ticker)}
                      style={{ cursor: cargando ? 'default' : 'pointer',
                               background: seleccion?.has(a.ticker) ? C.acentoFondo
                                                                   : 'transparent' }}>
                    {alternar && (
                      <td onClick={e => { e.stopPropagation(); alternar(a.ticker) }}>
                        <input type="checkbox" checked={seleccion?.has(a.ticker) || false}
                               onChange={() => {}} />
                      </td>
                    )}
                    <td style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo,
                                 whiteSpace: 'nowrap' }}>
                      {a.ticker}
                      {completos?.has(a.ticker) && <Punto />}
                    </td>
                    <td style={{ maxWidth: 250, overflow: 'hidden',
                                 textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.nombre || '—'}
                    </td>
                    <td style={{ color: C.tenue, fontSize: 13.5 }}>{a.sector || '—'}</td>
                    {hayScore && (
                      <td className="n">
                        {a.score != null && !Number.isNaN(a.score)
                          ? Number(a.score).toFixed(0) : '—'}
                      </td>
                    )}
                    <td style={{ color: C.acento, textAlign: 'right' }}>›</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibles.length === 0 && (
              <div style={{ padding: 18, textAlign: 'center', color: C.tenue,
                            fontSize: 14 }}>
                Ningún activo coincide con “{filtro}”.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Th({ children, onClick, activo, desc, n }) {
  return (
    <th className={n ? 'n' : undefined} onClick={onClick}
        style={{ cursor: 'pointer', userSelect: 'none',
                 color: activo ? C.acento : C.subtitulo }}>
      {children}{activo ? (desc ? ' ↓' : ' ↑') : ''}
    </th>
  )
}

// Marca los que tienen informe completo (consenso a futuro y sentimiento).
function Punto() {
  return <span title="Informe completo disponible"
    style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
             background: C.acento, marginLeft: 6, verticalAlign: 'middle' }} />
}

function Chip({ principal, secundario, onClick, disabled, completo,
                seleccionado, onAlternar }) {
  return (
    <div style={{
      background: seleccionado ? C.acentoFondo : '#fff',
      border: `1px solid ${seleccionado ? C.acento : C.bordeFuerte}`,
      borderRadius: 8, padding: '7px 12px', opacity: disabled ? .5 : 1,
      display: 'flex', alignItems: 'center', gap: 8, minWidth: 78 }}>
      {onAlternar && (
        <input type="checkbox" checked={!!seleccionado} onChange={onAlternar}
               style={{ cursor: 'pointer' }} />
      )}
      <button onClick={onClick} disabled={disabled}
        style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left',
                 display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontFamily: F.num, fontWeight: 600, color: C.titulo, fontSize: 14 }}>
        {principal}{completo && <Punto />}
      </span>
      {secundario && (
        <span style={{ fontSize: 11.5, color: C.tenue, maxWidth: 170,
                       overflow: 'hidden', textOverflow: 'ellipsis',
                       whiteSpace: 'nowrap' }}>{secundario}</span>
      )}
      </button>
    </div>
  )
}
