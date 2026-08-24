import React, { useState, useEffect, useCallback } from 'react'
import Selector, { guardarEnHistorial } from './Selector.jsx'
import Informe from './Informe.jsx'
import { C, CSS_GLOBAL } from './estilos.js'

// ─────────────────────────────────────────────────────────────────────────────
// App del INFORME AVANZADO. Vive en /informe.html, separada del screener:
// no importa nada de src/App.jsx y tiene su propio bundle.
//
// Caché: los informes generados se guardan por ticker con vencimiento. Sin
// esto, cada recarga volvería a consultar la SEC (y más adelante, a pagar por
// la tesis). Mismo criterio que los cachés del screener.
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE_CACHE = 'informe_cache_v1'
const DIAS_CACHE = 1     // el histórico de la SEC cambia por trimestre; 1 día es holgado

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
    // no dejar crecer el caché sin límite
    const claves = Object.keys(c).sort((a, b) => c[b].ts - c[a].ts).slice(0, 15)
    const podado = {}
    claves.forEach(k => { podado[k] = c[k] })
    localStorage.setItem(CLAVE_CACHE, JSON.stringify(podado))
  } catch { /* storage lleno o modo incógnito: seguimos sin caché */ }
}

export default function App() {
  const [universo, setUniverso] = useState([])
  const [completos, setCompletos] = useState(new Set())
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  // Universo para el buscador: los 504 del snapshot + los de afuera que el bot
  // haya traído. Son archivos estáticos, los sirve el CDN.
  useEffect(() => {
    (async () => {
      const acc = []
      try {
        const r = await fetch('/data/sp500_fundamentals.json')
        const d = await r.json()
        acc.push(...(d.stocks || []).map(s => ({ symbol: s.symbol, name: s.name })))
      } catch { /* sin snapshot el buscador queda vacío, no es fatal */ }
      try {
        const r = await fetch('/data/informe_detalle.json')
        const d = await r.json()
        const yaEstan = new Set(acc.map(a => a.symbol))
        for (const [sym, a] of Object.entries(d.activos || {})) {
          if (!yaEstan.has(sym)) acc.push({ symbol: sym, name: a.name })
        }
        // los que tienen informe COMPLETO (consenso a futuro + sentimiento)
        setCompletos(new Set(Object.keys(d.activos || {})))
      } catch { /* idem */ }
      setUniverso(acc)
    })()
  }, [])

  const pedir = useCallback(async (ticker, forzar = false) => {
    setError(null)
    const t = String(ticker).toUpperCase().trim()
    if (!forzar) {
      const c = cacheLeer(t)
      if (c) { setDatos(c); guardarEnHistorial(t); window.scrollTo(0, 0); return }
    }
    setCargando(true)
    try {
      const r = await fetch(`/api/informe?action=datos&ticker=${encodeURIComponent(t)}`)
      const d = await r.json()
      if (!r.ok) { setError(d.error || `Error ${r.status}`); return }
      setDatos(d); cacheGuardar(t, d); guardarEnHistorial(t)
      window.scrollTo(0, 0)
    } catch (e) {
      setError(`No pude generar el informe: ${e.message}`)
    } finally {
      setCargando(false)
    }
  }, [])

  // ?ticker=AAPL abre el informe directo — así funcionará el botón que
  // agreguemos más adelante en F1 y F5.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('ticker')
    if (t) pedir(t)
  }, [pedir])

  return (
    <>
      <style>{CSS_GLOBAL}</style>

      {cargando && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3,
                      background: C.acentoFondo, zIndex: 50 }}>
          <div style={{ height: '100%', width: '38%', background: C.acento,
                        animation: 'barra 1.1s ease-in-out infinite' }} />
          <style>{`@keyframes barra {
            0% { margin-left: -38% } 100% { margin-left: 100% } }`}</style>
        </div>
      )}

      {error && (
        <div style={{ maxWidth: 880, margin: '18px auto 0', padding: '12px 16px',
                      background: C.rojoFondo, color: C.rojo, borderRadius: 8,
                      fontSize: 14 }}>
          {error}
        </div>
      )}

      {datos
        ? <>
            <BarraAcciones datos={datos} onRefrescar={() => pedir(datos.ticker, true)} />
            <Informe d={datos} onVolver={() => { setDatos(null); setError(null) }} />
          </>
        : <Selector universo={universo} completos={completos}
                    onElegir={pedir} cargando={cargando} />}
    </>
  )
}

function BarraAcciones({ datos, onRefrescar }) {
  return (
    <div className="no-imprimir" style={{
      position: 'sticky', top: 0, zIndex: 10, background: '#fff',
      borderBottom: `1px solid ${C.borde}`, padding: '9px 22px',
      display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
      <span style={{ marginRight: 'auto', fontSize: 13, color: C.tenue }}>
        {datos.ticker} · informe {datos.nivel}
      </span>
      <Boton onClick={onRefrescar}>Actualizar datos</Boton>
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
