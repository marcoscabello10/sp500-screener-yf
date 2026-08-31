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

// ── DÓNDE ESTÁN LOS ARCHIVOS ────────────────────────────────────────────────
// ⚠️ Todo se resuelve desde ESTE archivo, nunca desde el directorio en el que
// se corre ni desde una ruta absoluta.
//
// Las seis pruebas .cjs tenían clavada la ruta del contenedor de Claude
// (`/mnt/user-data/uploads/...`) y además cargaban los módulos desde `test/`,
// donde no viven. O sea: NUNCA pudieron correr en la máquina de Marcos. Es el
// mismo error que se arregló en las pruebas de Python el 28/08 y que se repitió
// acá — una prueba que solo corre en la máquina de quien la escribió no es una
// prueba, es una demostración.
const RAIZ = path.resolve(__dirname, '..');
const DATA = path.join(RAIZ, 'public', 'data') + path.sep;

// Los módulos viven repartidos: App.jsx en src/, el informe en src/informe/,
// el endpoint en api/. Se busca en ese orden y si no está, se dice cuál falta.
function ruta(nombre) {
  const posibles = [
    path.join(RAIZ, 'src', 'informe', nombre),
    path.join(RAIZ, 'src', nombre),
    path.join(RAIZ, 'api', nombre),
    path.join(__dirname, nombre),
  ];
  for (const p of posibles) if (fs.existsSync(p)) return p;
  throw new Error(`No encuentro "${nombre}". Esta prueba se corre desde la `
                + `raiz del repo: node test/${path.basename(__filename)}`);
}

const vm = require('vm');


function cargarESM(archivo, extra = {}) {
  let src = fs.readFileSync(ruta(archivo), 'utf8');
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
  DATA + 'sp500_fundamentals.json', 'utf8'));
const CONS = JSON.parse(fs.readFileSync(
  DATA + 'informe_consenso.json', 'utf8')).consenso;
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
// `reemplazos` solo va en las fichas completas: en una posicion que no hay que
// decidir, saber que se uso ROA en vez de ROE no cambia nada y se paga igual.
chequear('reemplazos es un array en todas las que requieren decision',
  datos.posiciones.filter(p => !p.en_orden).every(p => Array.isArray(p.reemplazos)));

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
const PY = fs.readFileSync(ruta('informe.py'), 'utf8');

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
// DOS NIVELES: los cuatro primeros van SIEMPRE, porque son lo que hace falta
// para nombrar una posicion en su linea. El resto solo en las fichas completas
// —una posicion en orden no tiene exceso que informar—. Si esta distincion se
// rompe, el modelo va a leer la ausencia como "falta el dato".
for (const campo of ['ticker', 'peso_pct', 'tope_pct', 'accion_calculada',
                     'puntaje_fundamental']) {
  chequear(`TODAS las posiciones traen ${campo}`,
    datos.posiciones.every(p => campo in p));
}
for (const campo of ['estado', 'exceso_pct', 'ganancia_pct', 'clase',
                     'banderas_altas']) {
  chequear(`las posiciones con decision traen ${campo}`,
    datos.posiciones.filter(p => !p.en_orden).every(p => campo in p));
}
chequear('toda posicion declara en que nivel de detalle viene',
  datos.posiciones.every(p => typeof p.en_orden === 'boolean'));

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


// ── 8. La afinidad mira el PERFIL, no solo el objetivo (31/08/2026) ────────
// Lo encontro Marcos: RGTI —especulativo, beta 2,6, sin ganancias— salia con
// ALTA afinidad para una cartera conservadora. `afinidad()` repesaba los cinco
// bloques por objetivo y horizonte y NUNCA miraba el perfil, que es la unica
// variable que dice cuanto riesgo tolera el cliente.
console.log('\n8. La afinidad descuenta el riesgo que el perfil no tolera');
const RGTI = {
  ticker: 'RGTI', nombre: 'Rigetti', sector: 'Technology',
  fundamentales: { marketCap: 1.2e9, pe: null, roe: -45 },
  consenso: { beta: 2.6 },
  riesgos: [{ severidad: 'alta', codigo: 'sin_ganancias', texto: 'no gana plata' }],
  senales: [{ bloque: 'valuacion', puntaje: 55 }, { bloque: 'crecimiento', puntaje: 95 },
            { bloque: 'salud_financiera', puntaje: 40 }, { bloque: 'dividendos', puntaje: 0 },
            { bloque: 'consenso', puntaje: 80 }],
};
const KO2 = {
  ticker: 'KO', nombre: 'Coca-Cola', sector: 'Consumer Staples',
  fundamentales: { marketCap: 2.6e11, pe: 24, roe: 40 },
  consenso: { beta: 0.6 }, riesgos: [],
  senales: [{ bloque: 'valuacion', puntaje: 50 }, { bloque: 'crecimiento', puntaje: 35 },
            { bloque: 'salud_financiera', puntaje: 70 }, { bloque: 'dividendos', puntaje: 85 },
            { bloque: 'consenso', puntaje: 55 }],
};
const af = (inf, perfil) => C.afinidadDetalle(inf, 'crecimiento', 'medio', perfil);
const rCons = af(RGTI, 'conservador'), rMod = af(RGTI, 'moderado'),
      rAgr = af(RGTI, 'agresivo'), koCons = af(KO2, 'conservador');
console.log(`     RGTI  base ${rCons.base} -> conservador ${rCons.score} · `
          + `moderado ${rMod.score} · agresivo ${rAgr.score}`);
console.log(`     KO    conservador ${koCons.score} (sin descuento)`);

chequear('el mismo papel da distinta afinidad segun el perfil',
  rCons.score < rMod.score && rMod.score < rAgr.score,
  `${rCons.score} / ${rMod.score} / ${rAgr.score}`);
// ESTE es el caso que reporto Marcos.
chequear('para un conservador, KO le gana a RGTI',
  koCons.score > rCons.score, `KO ${koCons.score} vs RGTI ${rCons.score}`);
chequear('y RGTI queda marcado como incompatible con el perfil conservador',
  rCons.incompatible === true);
chequear('pero NO es incompatible para un agresivo (lo tolera, no lo premia)',
  rAgr.incompatible === false && rAgr.castigo > 0,
  `castigo ${rAgr.castigo}`);
chequear('un papel tranquilo no recibe ningun descuento',
  koCons.castigo === 0 && koCons.score === koCons.base);
chequear('el descuento viene explicado motivo por motivo',
  rCons.motivos.length === 3
  && rCons.motivos.every(m => m.texto && m.puntos > 0),
  JSON.stringify(rCons.motivos));
// El castigo por beta es el unico que puede crecer sin limite: con beta 2,6 y
// tolerancia 0,95 daba 57,8 puntos, aplastaba a los otros dos y clavaba el
// score en 0 — que no distingue "inapropiado" de "catastrofico".
chequear('el castigo por beta tiene techo y no se come a los demas',
  rCons.motivos.find(m => m.codigo === 'beta').puntos <= C.CASTIGO_BETA_MAXIMO,
  `${rCons.motivos.find(m => m.codigo === 'beta').puntos}`);
chequear('y el score no queda clavado en 0', rCons.score > 0, `${rCons.score}`);
chequear('la suma de los motivos es el castigo total',
  Math.abs(rCons.motivos.reduce((a, m) => a + m.puntos, 0) - rCons.castigo) < 0.11);
// Sin beta NO se asume que es tranquilo: se marca.
const sinBeta = af({ ...RGTI, consenso: {} }, 'conservador');
chequear('sin beta se marca en vez de premiar la falta de dato',
  sinBeta.sinBeta === true && !sinBeta.motivos.some(m => m.codigo === 'beta'));
// Y la cadena real: analizarCartera tiene que pasar el perfil.
const cartCons = C.analizarCartera([RGTI, KO2],
  { RGTI: { cantidad: 10, precioCompra: 100, valorActual: 1000, gananciaPct: 0 },
    KO:   { cantidad: 10, precioCompra: 50,  valorActual: 1000, gananciaPct: 0 } },
  'conservador', 'crecimiento', 'medio', null);
const cartAgr = C.analizarCartera([RGTI, KO2],
  { RGTI: { cantidad: 10, precioCompra: 100, valorActual: 1000, gananciaPct: 0 },
    KO:   { cantidad: 10, precioCompra: 50,  valorActual: 1000, gananciaPct: 0 } },
  'agresivo', 'crecimiento', 'medio', null);
chequear('analizarCartera PASA el perfil (si no, esto daria igual)',
  cartCons.porTicker.RGTI.afinidad < cartAgr.porTicker.RGTI.afinidad,
  `${cartCons.porTicker.RGTI.afinidad} vs ${cartAgr.porTicker.RGTI.afinidad}`);
chequear('y el detalle viaja en el activo, para poder mostrar la cuenta',
  cartCons.porTicker.RGTI.afinidadDetalle?.motivos?.length > 0);

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
