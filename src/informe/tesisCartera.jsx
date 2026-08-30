// ─────────────────────────────────────────────────────────────────────────────
// TESIS DE CARTERA — el botón y su resultado
//
// Es la llamada MÁS CARA del proyecto y la única que crece con el tamaño de la
// cartera. Por eso el componente hace cuatro cosas antes de dejar gastar:
//
//   1. Muestra el costo y el tiempo ESTIMADOS antes del clic. La regla del
//      proyecto es gastar solo cuando se lo pide; para pedirlo con criterio hay
//      que saber cuánto sale. La estimación no gasta nada: es aritmética.
//   2. Avisa si la cartera es tan grande que la respuesta no va a entrar en los
//      60 segundos que le da Vercel, ANTES de que se pague una llamada que va a
//      morir en un 504.
//   3. Cachea por HUELLA de la cartera. Si no cambió ningún papel, ningún peso,
//      ni el perfil/objetivo/horizonte, no se vuelve a llamar. Es el ahorro más
//      grande de todos: no pagar dos veces lo mismo.
//   4. Bloquea los botones mientras genera. Un doble clic nervioso no puede
//      convertirse en dos llamadas.
//
// Y muestra SIEMPRE lo que costó y de dónde salió. Un gasto que no se ve es un
// gasto que no se controla.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react'
import { C, F } from './estilos.js'
import { huellaCartera } from './cartera.js'

const CLAVE = 'informe_tesis_cartera_v1'
const DIAS_VALIDA = 7
const MAX_GUARDADAS = 8      // pesan bastante más que una tesis individual

function leerTodo() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || {} } catch { return {} }
}

function cacheLeer(huella, proveedor, modo) {
  const t = leerTodo()[`${huella}|${proveedor}|${modo}`]
  if (!t) return null
  return (Date.now() - (t.guardadoEn || 0)) / 86400000 < DIAS_VALIDA ? t : null
}

function cacheGuardar(huella, proveedor, modo, tesis) {
  try {
    const c = leerTodo()
    c[`${huella}|${proveedor}|${modo}`] = { ...tesis, guardadoEn: Date.now() }
    const claves = Object.keys(c)
    if (claves.length > MAX_GUARDADAS) {
      claves.sort((a, b) => (c[a].guardadoEn || 0) - (c[b].guardadoEn || 0))
      claves.slice(0, claves.length - MAX_GUARDADAS).forEach(k => delete c[k])
    }
    localStorage.setItem(CLAVE, JSON.stringify(c))
  } catch {
    // Si no entra, la tesis igual se muestra: solo no queda guardada. NO se
    // silencia del todo — el aviso va a la consola, porque un caché que nunca
    // guarda hace que todo se vuelva a pagar y eso ya nos pasó una vez.
    console.warn('No se pudo guardar la tesis de cartera en el caché: la '
                 + 'próxima vez se va a volver a pagar.')
  }
}

const COLOR_PROVEEDOR = {
  anthropic: { fondo: '#0B2E4F', texto: '#fff' },
  openai:    { fondo: '#0F7B4F', texto: '#fff' },
}

const usd = v => v == null ? '—' : `USD ${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}`

export default function TesisCartera({ datos }) {
  const [proveedores, setProveedores] = useState(null)
  const [estimacion, setEstimacion] = useState(null)
  const [modo, setModo] = useState('rapido')
  const [tesis, setTesis] = useState(null)
  const [generando, setGenerando] = useState(null)
  const [error, setError] = useState(null)

  const n = datos?.posiciones?.length || 0
  const huella = datos ? huellaCartera(datos) : null

  // Ninguna de estas dos consultas gasta: una pregunta qué claves hay cargadas
  // y la otra hace una cuenta. Las dos son GET y no tocan ningún modelo.
  useEffect(() => {
    let vivo = true
    fetch('/api/informe?action=proveedores')
      .then(r => r.json())
      .then(d => { if (vivo) setProveedores(d.proveedores || {}) })
      .catch(() => { if (vivo) setProveedores({}) })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!n) return
    let vivo = true
    fetch(`/api/informe?action=estimar_cartera&posiciones=${n}`)
      .then(r => r.json())
      .then(d => { if (vivo) setEstimacion(d) })
      .catch(() => { if (vivo) setEstimacion(null) })
    return () => { vivo = false }
  }, [n])

  // Al cambiar la cartera se muestra lo que YA esté guardado, sin pedir nada.
  useEffect(() => {
    setError(null)
    if (!huella) { setTesis(null); return }
    setTesis(cacheLeer(huella, 'anthropic', modo)
             || cacheLeer(huella, 'openai', modo) || null)
  }, [huella, modo])

  async function generar(proveedor) {
    const guardada = cacheLeer(huella, proveedor, modo)
    if (guardada) { setTesis(guardada); setError(null); return }
    setGenerando(proveedor); setError(null)
    try {
      const r = await fetch(
        `/api/informe?action=tesis_cartera&proveedor=${proveedor}&modo=${modo}`,
        { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`)
      cacheGuardar(huella, proveedor, modo, d)
      setTesis(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerando(null)
    }
  }

  if (proveedores === null || !datos || !n) return null

  const activos = Object.entries(proveedores).filter(([, p]) => p.disponible)
  if (!activos.length) {
    return (
      <div className="no-imprimir" style={avisoBase}>
        Tesis de cartera apagada: no hay ninguna clave cargada en Vercel. Sin
        clave no se puede gastar, así que no se muestran los botones.
      </div>
    )
  }

  const est = estimacion?.[modo]
  const noEntra = est && est.entra_en_el_limite === false

  return (
    <div style={{ margin: '22px 0' }}>
      <div className="no-imprimir">
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline',
                      flexWrap: 'wrap', marginBottom: 8 }}>
          <strong style={{ fontSize: 15 }}>Tesis de la cartera con IA</strong>
          <span style={{ fontSize: 12.5, color: C.tenue }}>
            {n} posicion{n === 1 ? '' : 'es'} · analiza el conjunto, no cada
            activo por separado
          </span>
        </div>

        {/* Elegir modo ANTES de gastar, con los dos números a la vista. */}
        <div style={{ display: 'flex', gap: 7, marginBottom: 9, flexWrap: 'wrap' }}>
          {['rapido', 'profundo'].map(m => {
            const e = estimacion?.[m]
            const sel = modo === m
            return (
              <button key={m} onClick={() => setModo(m)} disabled={!!generando}
                style={{
                  background: sel ? C.panelHover : 'transparent',
                  border: `1px solid ${sel ? C.bordeFuerte : C.borde}`,
                  borderRadius: 8, padding: '6px 11px', cursor: 'pointer',
                  fontSize: 12.5, textAlign: 'left', lineHeight: 1.35 }}>
                <div style={{ fontWeight: sel ? 700 : 400 }}>
                  {m === 'rapido' ? 'Rápido' : 'Profundo'}
                </div>
                {e && (
                  <div style={{ color: C.tenue, fontSize: 11.5 }}>
                    {usd(e.costo_estimado_usd)} · ~{e.segundos_estimados}s
                    {e.entra_en_el_limite === false && ' ⚠️'}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {noEntra && (
          <div style={{ ...avisoBase, background: C.ambarFondo, color: C.ambar,
                        border: 'none' }}>
            Con {n} posiciones, el modo profundo tarda ~{est.segundos_estimados}s
            y el servidor corta a los 60. <strong>Probablemente falle después de
            cobrar la llamada.</strong> Conviene el modo rápido.
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {activos.map(([clave, p]) => {
            const col = COLOR_PROVEEDOR[clave] || { fondo: C.titulo, texto: '#fff' }
            const yaEsta = !!cacheLeer(huella, clave, modo)
            return (
              <button key={clave} onClick={() => generar(clave)}
                disabled={!!generando}
                style={{
                  background: generando ? C.borde : col.fondo,
                  color: generando ? C.tenue : col.texto,
                  border: 'none', borderRadius: 9, padding: '9px 15px',
                  cursor: generando ? 'default' : 'pointer', fontSize: 13.5,
                  fontFamily: F.texto }}>
                {generando === clave
                  ? 'Analizando la cartera...'
                  : yaEsta
                    ? `Ver la de ${p.nombre} (ya generada, no gasta)`
                    : `Analizar con ${p.nombre}`}
              </button>
            )
          })}
        </div>

        {est && !yaHayGuardada(huella, modo, activos) && (
          <div style={{ fontSize: 11.5, color: C.tenue, marginTop: 7 }}>
            Estimado: {usd(est.costo_estimado_usd)} · ~{est.segundos_estimados}s ·
            modelo {est.modelo}. La primera vez cuesta un poco más
            ({usd(est.costo_primera_vez_usd)}): después las reglas salen de caché.
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...avisoBase, background: C.rojoFondo, color: C.rojo,
                      border: 'none' }} className="no-imprimir">
          {error}
        </div>
      )}

      {tesis && <ResultadoTesis t={tesis} />}
    </div>
  )
}

function yaHayGuardada(huella, modo, activos) {
  return activos.some(([clave]) => !!cacheLeer(huella, clave, modo))
}

const avisoBase = {
  background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 8,
  padding: '9px 13px', margin: '10px 0', fontSize: 12.5, color: C.tenue,
}

function ResultadoTesis({ t }) {
  return (
    <div style={{ marginTop: 14 }}>
      {/* Los avisos de la validación van ARRIBA del texto, no al pie: si el
          modelo se contradijo con un número, hay que saberlo antes de leerlo.
          Y no se corrige en silencio: esconder que se equivocó impide saber
          cuándo confiar. */}
      {(t.avisos || []).length > 0 && (
        <div style={{ background: C.ambarFondo, color: C.ambar, borderRadius: 8,
                      padding: '10px 13px', marginBottom: 12, fontSize: 12.5 }}>
          <strong>Revisar antes de usar esto:</strong>
          <ul style={{ margin: '5px 0 0', paddingLeft: 17, lineHeight: 1.5 }}>
            {t.avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      <div style={{ fontSize: 14, lineHeight: 1.62, color: C.cuerpo,
                    whiteSpace: 'pre-wrap' }}>
        {t.texto}
      </div>

      <div className="no-imprimir" style={{
        marginTop: 12, paddingTop: 9, borderTop: `1px solid ${C.borde}`,
        fontSize: 11.5, color: C.tenue }}>
        {t.proveedor_nombre} · {t.modelo} · modo {t.modo} ·{' '}
        {t.n_posiciones} posiciones · {t.tokens?.entrada}+{t.tokens?.salida} tokens
        {t.tokens?.desde_cache
          ? ` (${t.tokens.desde_cache} del caché de reglas)` : ''} ·{' '}
        {usd(t.costo_estimado_usd)}
        {t.segundos ? ` · ${t.segundos}s` : ''}
        {t.guardadoEn && (
          <> · guardada el {new Date(t.guardadoEn).toLocaleDateString('es-AR')}
            {' '}(no se volvió a pagar)</>
        )}
      </div>
    </div>
  )
}
