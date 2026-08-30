// Prueba del bloque de datos de la tesis de cartera.
//
// LO QUE IMPORTA ACA: el contrato entre dos lenguajes.
// `armarDatosTesis()` en JS produce un objeto que `api/informe.py` consume y
// que el prompt nombra campo por campo. Si una clave se escribe distinto en un
// lado, NO da error: da una tesis que ignora ese dato en silencio. Es
// exactamente lo que paso con el pase de acentos, que dejo el informe en blanco
// sin una sola linea en la consola.
//
// Por eso esta prueba corre la cadena REAL —analizarCartera -> armarDatosTesis—
// y despues compara las claves contra las que el prompt de Python realmente
// menciona, leyendolas del archivo.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function cargarESM(archivo, extra = {}) {
  let src = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
  const exportados = [];
  src = src.replace(/^export (function|const|let) (\w+)/gm, (_, k, n) => {
    exportados.push(n); return `${k} ${n}`;
  });
  src = src.replace(/^import .*$/gm, '');
  const sandbox = { console, Math, Object, Array, Number, Set, Map, JSON,
                    isFinite, isNaN, ...extra };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return vm.runInContext(`({${exportados.join(',')}})`, sandbox);
}

const C = cargarESM('cartera.js');
const S = cargarESM('sugerencias.js');

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

// ── Una cartera realista, con los casos que importan ────────────────────────
function informe(t, nombre, sector, puntaje, etiqueta, riesgos = 0) {
  return {
    ticker: t, nombre, sector,
    veredicto: { puntaje, etiqueta, accion:
      etiqueta === 'compra' ? 'reforzar' : etiqueta === 'venta' ? 'sacar' : 'mantener' },
    riesgos: Array.from({ length: riesgos }, (_, i) => ({
      severidad: 'alta', codigo: `r${i}`, texto: 'algo' })),
    senales: [{ bloque: 'valuacion', titulo: 'Valuación', puntaje: 40, notas: ['x'] }],
    consenso: { beta: 1.1 },
  };
}
const INFORMES = [
  informe('AAPL', 'Apple Inc.', 'Technology', 72, 'neutral'),
  informe('MSFT', 'Microsoft', 'Technology', 78, 'compra'),
  informe('KO', 'Coca-Cola', 'Consumer Staples', 61, 'neutral'),
  informe('JPM', 'JP Morgan', 'Financials', 66, 'neutral'),
  informe('XOM', 'Exxon', 'Energy', 44, 'venta', 2),
];
// AAPL pesa de mas a proposito: es el caso que dispara "recortar".
const POSICIONES = {
  AAPL: { cantidad: 60, precioCompra: 150, valorActual: 18000, gananciaPct: 100 },
  MSFT: { cantidad: 20, precioCompra: 300, valorActual: 8000, gananciaPct: 33 },
  KO:   { cantidad: 100, precioCompra: 55, valorActual: 6000, gananciaPct: 9 },
  JPM:  { cantidad: 30, precioCompra: 140, valorActual: 9000, gananciaPct: 114 },
  XOM:  { cantidad: 40, precioCompra: 100, valorActual: 4000, gananciaPct: 0 },
};
const OTROS = { modo: 'monto', rentaFija: 10000, efectivo: 5000 };

const cart = C.analizarCartera(INFORMES, POSICIONES, 'moderado', 'equilibrado',
                               'medio', OTROS);
const estres = C.stressTest(cart);

// Los scores, como los produce sugerencias.js sobre el snapshot real.
const FUND = JSON.parse(fs.readFileSync(
  '/mnt/user-data/uploads/sp500-screener-yf/public/data/sp500_fundamentals.json', 'utf8'));
const CONS = JSON.parse(fs.readFileSync(
  '/mnt/user-data/uploads/sp500-screener-yf/public/data/informe_consenso.json', 'utf8')).consenso;
const STOCKS = FUND.stocks.filter(s => s.sector).map(s => {
  const c = CONS[s.symbol] || {};
  const neg = s.pb != null && s.pb < 0;
  let nde = null;
  if (c.netDebt > 0 && c.ebitda > 0) nde = Math.round(c.netDebt / c.ebitda * 1000) / 1000;
  return { ...s, roe: neg ? null : s.roe, de: neg ? null : s.de, ndEbitda: nde };
});
const scores = S.scoresPorSector(STOCKS);
const candidatos = S.candidatosRotacion(STOCKS, scores, INFORMES.map(i => i.ticker));

const datos = C.armarDatosTesis(cart, estres, candidatos, scores);

console.log(`Cartera de prueba: ${datos.posiciones.length} posiciones, `
          + `${datos.candidatos.length} candidatos\n`);

// ── 1. Los numeros salen de analizarCartera, no se recalculan ──────────────
console.log('1. Los numeros son LOS MISMOS que ya se muestran en la tabla');
for (const p of datos.posiciones) {
  const a = cart.porTicker[p.ticker];
  chequear(`${p.ticker}: peso ${p.peso_pct}% coincide con la tabla`,
    Math.abs(p.peso_pct - a.peso) < 0.051, `${p.peso_pct} vs ${a.peso}`);
}
const aapl = datos.posiciones.find(p => p.ticker === 'AAPL');
chequear('el exceso en USD viaja (es lo que hace ejecutable el recorte)',
  aapl.exceso_usd != null && aapl.exceso_usd > 0, `${aapl.exceso_usd}`);
chequear('y la cantidad de acciones tambien (no se venden fracciones)',
  aapl.acciones === 60, `${aapl.acciones}`);
chequear('la accion calculada viaja tal cual',
  aapl.accion_calculada === cart.porTicker.AAPL.accion);

// ── 2. La cobertura de datos, que es lo que ata la confianza ───────────────
console.log('\n2. Cobertura de datos por posicion');
chequear('todas las posiciones traen metricas_usadas',
  datos.posiciones.every(p => /^\d+\/\d+$/.test(p.metricas_usadas || '')),
  JSON.stringify(datos.posiciones.map(p => [p.ticker, p.metricas_usadas])));
chequear('JPM (banco) tiene denominador 5, no 6',
  datos.posiciones.find(p => p.ticker === 'JPM').metricas_usadas.endsWith('/5'),
  datos.posiciones.find(p => p.ticker === 'JPM').metricas_usadas);
chequear('reemplazos es un array en todas',
  datos.posiciones.every(p => Array.isArray(p.reemplazos)));

// ── 3. La cartera completa, no solo las acciones ───────────────────────────
console.log('\n3. La cartera NO suma 100% en acciones');
chequear('renta_variable_pct sale del calculo, no null',
  typeof datos.cartera.renta_variable_pct === 'number',
  `${datos.cartera.renta_variable_pct}`);
chequear('tope_renta_variable_pct sale (moderado = 70)',
  datos.cartera.tope_renta_variable_pct === 70,
  `${datos.cartera.tope_renta_variable_pct}`);
chequear('el resto de la cartera viaja con sus clases',
  datos.cartera.resto.length === 2
  && datos.cartera.resto.every(c => c.clase && c.pct > 0),
  JSON.stringify(datos.cartera.resto));
chequear('la cobertura analizada es menor a 100 (hay renta fija y efectivo)',
  datos.cartera.cobertura_analizada_pct < 100,
  `${datos.cartera.cobertura_analizada_pct}`);
chequear('el valor total incluye el resto',
  datos.cartera.valor_total_usd === 60000, `${datos.cartera.valor_total_usd}`);

// ── 4. El stress test ──────────────────────────────────────────────────────
console.log('\n4. El escenario de estres');
chequear('viaja el peor escenario', datos.estres && datos.estres.caida_pct < 0,
  JSON.stringify(datos.estres));
chequear('es efectivamente el PEOR de los calculados',
  datos.estres.caida_pct === estres.escenarios[0].caidaPct);
console.log(`     "${datos.estres.peor_escenario}": ${datos.estres.caida_pct}%`);

// ── 5. EL CONTRATO CON PYTHON ──────────────────────────────────────────────
// Esto es lo que esta prueba existe para atrapar.
console.log('\n5. Contrato con api/informe.py y con el prompt');
// El informe.py de AL LADO, no una copia vieja en uploads: si la prueba lee un
// archivo que no es el que se despliega, verifica un contrato que ya no existe.
const PY = fs.readFileSync(path.join(__dirname, 'informe.py'), 'utf8');

// 5a. Las claves que _resumen_cartera lee del nivel superior.
// ⚠️ SOLO del cuerpo de esa funcion: `_filtrar_candidatos` usa la misma
// variable `c` para un CANDIDATO, asi que buscar en todo el archivo traia
// `ticker` y `sector` como si fueran claves del nivel superior.
const cuerpo = PY.slice(PY.indexOf('def _resumen_cartera'));
const finFn = cuerpo.indexOf('\ndef ', 1);
const soloResumen = finFn > 0 ? cuerpo.slice(0, finFn) : cuerpo;
const leePy = [...soloResumen.matchAll(/c\.get\('([a-z_]+)'\)/g)].map(m => m[1]);
const faltan = [...new Set(leePy)].filter(k => !(k in datos));
chequear('todas las claves que lee _resumen_cartera existen en el bloque',
  faltan.length === 0, `faltan: ${faltan.join(', ')}`);

// 5b. Los campos de posicion que el codigo Python nombra.
for (const campo of ['estado', 'accion_calculada', 'peso_pct', 'tope_pct',
                     'exceso_pct', 'ganancia_pct', 'puntaje_fundamental']) {
  chequear(`las posiciones traen ${campo}`,
    datos.posiciones.every(p => campo in p));
}

// 5c. Los campos que el PROMPT nombra por su nombre. Si el prompt habla de
//     `metricas_usadas` y el bloque manda `metricas`, el modelo lee un campo
//     que no existe y no se entera nadie.
for (const campo of ['metricas_usadas']) {
  chequear(`el prompt nombra ${campo} y el bloque lo manda`,
    PY.includes(campo) && datos.posiciones.every(p => campo in p));
}

// 5d. Los campos que Python DESCARTA no deberian mandarse: es peso muerto.
const fuera = (PY.match(/_POS_FUERA = \(([^)]*)\)/) || [])[1] || '';
const descartados = [...fuera.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
const mandadosDeMas = descartados.filter(
  k => datos.posiciones.some(p => k in p) && k !== 'cantidad');
console.log(`     Python descarta: ${descartados.join(', ')}`);
chequear('no se mandan campos que Python va a tirar (salvo los renombrados)',
  mandadosDeMas.length === 0, `se mandan igual: ${mandadosDeMas.join(', ')}`);

// ── 6. La huella del cache ─────────────────────────────────────────────────
console.log('\n6. La huella para el cache');
const h1 = C.huellaCartera(datos);
chequear('la huella es estable entre dos corridas iguales',
  h1 === C.huellaCartera(C.armarDatosTesis(cart, estres, candidatos, scores)));

// Cambiar el orden de los activos NO deberia cambiar la huella.
const alReves = { ...datos, posiciones: [...datos.posiciones].reverse() };
chequear('el ORDEN de los activos no cambia la huella',
  C.huellaCartera(alReves) === h1);

// Cambiar el perfil SI.
chequear('cambiar el perfil cambia la huella',
  C.huellaCartera({ ...datos, perfil: 'agresivo' }) !== h1);
chequear('cambiar el objetivo cambia la huella',
  C.huellaCartera({ ...datos, objetivo: 'renta' }) !== h1);

// Un cambio de peso REAL si, uno de centavos no.
const casiIgual = { ...datos, posiciones: datos.posiciones.map(
  p => p.ticker === 'AAPL' ? { ...p, peso_pct: p.peso_pct } : p) };
chequear('un peso identico no cambia la huella',
  C.huellaCartera(casiIgual) === h1);
const distinto = { ...datos, posiciones: datos.posiciones.map(
  p => p.ticker === 'AAPL' ? { ...p, peso_pct: p.peso_pct + 3 } : p) };
chequear('un peso distinto SI cambia la huella',
  C.huellaCartera(distinto) !== h1);
// Sacar un papel tambien.
chequear('sacar una posicion cambia la huella',
  C.huellaCartera({ ...datos, posiciones: datos.posiciones.slice(1) }) !== h1);

// ── 7. Tamaño ──────────────────────────────────────────────────────────────
console.log('\n7. Tamano del bloque');
const tok = Math.round(JSON.stringify(datos).length / 4);
console.log(`     ${tok} tokens con ${datos.posiciones.length} posiciones y `
          + `${datos.candidatos.length} candidatos`);
chequear('el bloque no se va de escala', tok < 3000, `${tok} tokens`);

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones` : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
