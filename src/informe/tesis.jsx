import React, { useState, useEffect } from 'react'
import { C, F } from './estilos.js'

// ─────────────────────────────────────────────────────────────────────────────
// TESIS EN PROSA — el único botón de todo el proyecto que cuesta plata
//
// Diseño pedido por Marcos, textual:
//   "dos clicks diferentes, solo que gaste si selecciono uno, si elijo openai
//    no use tokens de anthropic o viceversa"
//
// Cómo se cumple acá arriba (el endpoint tiene su propia mitad de la regla):
//
//   · Un botón POR PROVEEDOR. No hay un botón "generar" que decida solo cuál
//     usar — esa decisión es de Marcos y cuesta dinero, así que la toma él.
//   · Solo aparece el botón de un proveedor si su clave está cargada. Sin
//     clave no hay botón, y sin botón no hay forma de gastar por accidente.
//   · Cada tesis se guarda en localStorage POR TICKER Y POR PROVEEDOR. Volver
//     a abrir el informe no vuelve a cobrar; y si generaste con los dos,
//     quedan las dos y podés compararlas sin pagar de nuevo.
//   · Mientras genera, los botones se bloquean: un doble clic nervioso no
//     puede convertirse en dos llamadas.
//
// Y se muestra SIEMPRE lo que costó. No para asustar —son fracciones de
// centavo— sino porque un gasto que no se ve es un gasto que no se controla.
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE = 'informe_tesis_v1'
const DIAS_VALIDA = 7

function leerCache() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || {} } catch { return {} }
}

function cacheLeer(ticker, proveedor) {
  const t = leerCache()[`${ticker}|${proveedor}`]
  if (!t) return null
  const dias = (Date.now() - (t.guardadoEn || 0)) / 86400000
  return dias < DIAS_VALIDA ? t : null
}

function cacheGuardar(ticker, proveedor, tesis) {
  try {
    const c = leerCache()
    c[`${ticker}|${proveedor}`] = { ...tesis, guardadoEn: Date.now() }
    // Se poda para no llenar el localStorage: 40 tesis alcanzan de sobra y
    // cada una pesa poco más de lo que ocupa su texto.
    const claves = Object.keys(c)
    if (claves.length > 40) {
      claves.sort((a, b) => (c[a].guardadoEn || 0) - (c[b].guardadoEn || 0))
      claves.slice(0, claves.length - 40).forEach(k => delete c[k])
    }
    localStorage.setItem(CLAVE, JSON.stringify(c))
  } catch { /* si no entra, la tesis igual se muestra; solo no queda guardada */ }
}

const COLOR_PROVEEDOR = {
  anthropic: { fondo: '#0B2E4F', texto: '#fff' },
  openai:    { fondo: '#0F7B4F', texto: '#fff' },
}

export default function Tesis({ ticker }) {
  const [proveedores, setProveedores] = useState(null)
  const [tesis, setTesis] = useState(null)
  const [generando, setGenerando] = useState(null)
  const [error, setError] = useState(null)

  // Esta consulta NO gasta: solo pregunta qué claves están cargadas.
  useEffect(() => {
    let vivo = true
    fetch('/api/informe?action=proveedores')
      .then(r => r.json())
      .then(d => { if (vivo) setProveedores(d.proveedores || {}) })
      .catch(() => { if (vivo) setProveedores({}) })
    return () => { vivo = false }
  }, [])

  // Al cambiar de activo, se muestra lo que ya esté guardado — sin pedir nada.
  useEffect(() => {
    setError(null)
    const guardada = cacheLeer(ticker, 'anthropic') || cacheLeer(ticker, 'openai')
    setTesis(guardada || null)
  }, [ticker])

  async function generar(proveedor) {
    const guardada = cacheLeer(ticker, proveedor)
    if (guardada) { setTesis(guardada); setError(null); return }
    setGenerando(proveedor); setError(null)
    try {
      const r = await fetch(`/api/informe?action=tesis&ticker=${encodeURIComponent(ticker)}`
                            + `&proveedor=${proveedor}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      cacheGuardar(ticker, proveedor, d)
      setTesis(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerando(null)
    }
  }

  if (proveedores === null) return null
  const activos = Object.entries(proveedores).filter(([, p]) => p.disponible)

  // Sin ninguna clave cargada no hay botones — no se puede gastar. Pero ANTES
  // esto era `return null` a secas y el componente desaparecia SIN DECIR NADA:
  // desde la pantalla no habia forma de distinguir "falta la clave" de "hay un
  // bug". Es el mismo problema que el `catch {}` vacio del cache de historico.
  // Ahora lo dice, y dice exactamente que variable falta.
  if (!activos.length) {
    const faltan = Object.entries(proveedores).map(([k]) => k.toUpperCase() + '_API_KEY')
    return (
      <div className="no-imprimir" style={{
        background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 8,
        padding: '9px 13px', margin: '14px 0', fontSize: 12.5, color: C.tenue }}>
        Tesis con IA apagada: no hay ninguna clave cargada en Vercel
        {faltan.length ? ` (${faltan.join(' o ')})` : ''}. Sin clave no se puede
        gastar, asi que no se muestran los botones.
      </div>
    )
  }

  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 18, marginBottom: 3 }}>Tesis en prosa</h2>
      <p style={{ color: C.tenue, fontSize: 13, marginTop: 0, marginBottom: 12 }}>
        Lo único del informe que se le pide a un modelo de lenguaje, y lo único
        que cuesta dinero. Todo lo de arriba se calcula sin gastar nada. Elegís
        con qué proveedor generarla: se usa ese y solo ese.
      </p>

      <div className="no-imprimir" style={{ display: 'flex', gap: 9,
                                            flexWrap: 'wrap', marginBottom: 14 }}>
        {activos.map(([clave, p]) => {
          const yaEsta = !!cacheLeer(ticker, clave)
          const c = COLOR_PROVEEDOR[clave] || COLOR_PROVEEDOR.anthropic
          const ocupado = generando !== null
          return (
            <button key={clave} onClick={() => generar(clave)} disabled={ocupado}
              style={{ background: yaEsta ? '#fff' : c.fondo,
                       color: yaEsta ? c.fondo : c.texto,
                       border: `1px solid ${c.fondo}`, borderRadius: 7,
                       padding: '9px 16px', fontSize: 14, fontWeight: 600,
                       opacity: ocupado ? .5 : 1 }}>
              {generando === clave ? 'Generando…'
                : yaEsta ? `Ver la de ${p.nombre}`
                : `Generar con ${p.nombre}`}
              <span style={{ display: 'block', fontSize: 11, fontWeight: 400,
                             opacity: .8 }}>
                {p.modelo}{yaEsta ? ' · ya generada, no vuelve a cobrar' : ''}
              </span>
            </button>
          )
        })}
      </div>

      {error && (
        <div style={{ background: C.ambarFondo, color: C.ambar, borderRadius: 8,
                      padding: '11px 14px', fontSize: 13.5, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {tesis && (
        <div className="evitar-corte" style={{
          border: `1px solid ${C.borde}`, borderLeft: `4px solid ${C.acento}`,
          borderRadius: 9, padding: '15px 18px' }}>
          {tesis.texto.split('\n').filter(Boolean).map((p, i) => (
            <p key={i} style={{ fontSize: 14.5, lineHeight: 1.7,
                                margin: i ? '10px 0 0' : 0 }}>{p}</p>
          ))}
          <div style={{ marginTop: 12, paddingTop: 9,
                        borderTop: `1px solid ${C.borde}`,
                        fontSize: 12, color: C.tenue, display: 'flex',
                        gap: 16, flexWrap: 'wrap' }}>
            <span>Redactada por {tesis.proveedor_nombre} · {tesis.modelo}</span>
            {tesis.tokens && (
              <span style={{ fontFamily: F.num }}>
                {tesis.tokens.entrada} + {tesis.tokens.salida} tokens
              </span>
            )}
            {tesis.costo_estimado_usd != null && (
              <span style={{ fontFamily: F.num }}>
                ≈ US$ {tesis.costo_estimado_usd.toFixed(5)}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: C.tenue, fontStyle: 'italic',
                      marginTop: 8, marginBottom: 0 }}>
            Texto generado por un modelo de lenguaje a partir de los datos de
            este informe. No agrega información: la ordena. Los números que cita
            son los mismos que están más arriba.
          </p>
        </div>
      )}
    </section>
  )
}
