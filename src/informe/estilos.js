// Sistema visual del INFORME AVANZADO.
// Rompe a proposito con el screener (dark slate + monospace): esto es un
// documento para leer largo, imprimir y mandarle a un cliente.
//
// Decisiones de Marcos (23/08/2026):
//   - sans serif humanista
//   - acento celeste / cyan tecnologico
//   - subtitulos azul marino profundo
//   - cuerpo grafito
//
// Las tipografias son de sistema a proposito: no hay pedido a Google Fonts,
// asi que la pagina carga igual de rapido sin conexion a terceros y se imprime
// sin esperar una descarga. "Segoe UI" es humanista y esta en todo Windows.

export const C = {
  // superficies
  fondo:        '#FFFFFF',
  panel:        '#F6F9FB',
  panelHover:   '#EEF4F8',
  borde:        '#DDE5EC',
  bordeFuerte:  '#C3D2DE',

  // texto
  titulo:       '#0B2E4F',   // azul marino profundo
  subtitulo:    '#164A73',
  cuerpo:       '#3A4149',   // grafito
  tenue:        '#6B7681',

  // acento
  acento:       '#0891B2',   // cyan tecnologico
  acentoClaro:  '#06B6D4',
  acentoFondo:  '#E6F6FA',

  // semaforo
  verde:        '#0F7B4F',
  verdeFondo:   '#E7F5EE',
  ambar:        '#B45309',
  ambarFondo:   '#FDF3E3',
  rojo:         '#B4232B',
  rojoFondo:    '#FCEDED',
}

export const F = {
  texto: '"Segoe UI", "Source Sans 3", "Open Sans", ui-sans-serif, system-ui, ' +
         '-apple-system, "Helvetica Neue", Arial, sans-serif',
  num:   'ui-monospace, "Cascadia Mono", Consolas, "SF Mono", "Roboto Mono", monospace',
}

// Semaforo a partir de un puntaje 0-100
export function semaforo(p) {
  if (p === null || p === undefined) return { color: C.tenue, fondo: C.panel, label: 'sin datos' }
  if (p >= 65) return { color: C.verde, fondo: C.verdeFondo, label: 'favorable' }
  if (p >= 45) return { color: C.ambar, fondo: C.ambarFondo, label: 'neutral' }
  return { color: C.rojo, fondo: C.rojoFondo, label: 'desfavorable' }
}

export function colorSeveridad(s) {
  if (s === 'alta')  return { color: C.rojo,  fondo: C.rojoFondo }
  if (s === 'media') return { color: C.ambar, fondo: C.ambarFondo }
  return { color: C.tenue, fondo: C.panel }
}

// ── Formateo ────────────────────────────────────────────────────────────────
export function num(v, dec = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return Number(v).toLocaleString('es-AR', {
    minimumFractionDigits: dec, maximumFractionDigits: dec })
}

export function pct(v, dec = 1, signo = false) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const s = signo && v > 0 ? '+' : ''
  return `${s}${num(v, dec)}%`
}

export function dinero(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `${num(v / 1e12, 2)} B`      // billones (millones de millones)
  if (a >= 1e9)  return `${num(v / 1e9, 1)} MM`      // miles de millones
  if (a >= 1e6)  return `${num(v / 1e6, 1)} M`
  return num(v, 0)
}

export function fecha(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit' })
  } catch { return String(iso).slice(0, 16) }
}

// ── CSS global (incluye la hoja de impresion) ───────────────────────────────
export const CSS_GLOBAL = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: ${C.fondo};
    color: ${C.cuerpo};
    font-family: ${F.texto};
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3 { color: ${C.titulo}; font-weight: 600; line-height: 1.25; margin: 0; }
  a { color: ${C.acento}; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid ${C.borde}; }
  th { color: ${C.subtitulo}; font-weight: 600; font-size: 13px;
       text-transform: uppercase; letter-spacing: .03em; }
  td.n, th.n { text-align: right; font-family: ${F.num}; font-variant-numeric: tabular-nums; }
  button { font-family: inherit; font-size: inherit; cursor: pointer; }
  input { font-family: inherit; font-size: inherit; }

  /* ── Impresion / Guardar como PDF ──────────────────────────────────────── */
  @media print {
    @page { margin: 14mm 12mm; }
    body { font-size: 11pt; }
    .no-imprimir { display: none !important; }
    .evitar-corte { break-inside: avoid; page-break-inside: avoid; }
    .salto-antes { break-before: page; page-break-before: page; }
    /* que los fondos de color salgan en papel */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    a[href]:after { content: ""; }
  }
`
