// Prueba del LECTOR DE EXCEL (Selector.jsx).
//
// POR QUE EXISTE
// --------------
// El 31/08/2026 Marcos subio la plantilla que el mismo le manda al cliente,
// con Cantidad, Precio de compra y % Posicion cargados, y el informe salio sin
// pesos. `filasAActivos()` leia ticker, sector, nombre y score y NADA MAS: las
// tres columnas que la plantilla promete —y que la hoja "Instrucciones"
// explica una por una— se tiraban al piso.
//
// No daba error. El informe se degradaba solo a "cartera propuesta" y ninguna
// alerta de sobrepeso podia dispararse, porque no habia pesos que comparar.
//
// Esta prueba corre el parser REAL contra el archivo REAL de Marcos.
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
function ruta(nombre) {
  for (const p of [path.join(RAIZ, 'src', 'informe', nombre),
                   path.join(RAIZ, 'src', nombre), path.join(__dirname, nombre)]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No encuentro "${nombre}"`);
}

const vm = require('vm');
const XLSX = require('xlsx');

// Se extraen las funciones REALES del componente. Copiarlas a mano probaria
// una copia, que es justamente como se cuelan estos errores.
const SRC = fs.readFileSync(ruta('Selector.jsx'), 'utf8');
function fn(nombre) {
  const i = SRC.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`no encuentro function ${nombre} en Selector.jsx`);
  const fin = SRC.indexOf('\n}\n', i);
  return SRC.slice(i, fin + 3);
}
const sandbox = { console, Math, Object, Array, Number, String, JSON, Set, Map,
                  isFinite, isNaN, parseFloat, RegExp };
vm.createContext(sandbox);
// `filasAActivos` importa `resolverTicker` de universo.js, y el sandbox no
// resuelve imports. Se inyecta la funcion REAL, extraida del archivo real: una
// copia a mano probaria la copia, que es como se cuelan estos errores.
const SRC_UNI = fs.readFileSync(ruta('universo.js'), 'utf8');
vm.runInContext(
  SRC_UNI.slice(SRC_UNI.indexOf("const SUFIJO_BA"),
                SRC_UNI.indexOf('/**\n * Une las dos fuentes'))
    .replace(/^export /gm, ''),
  sandbox);
vm.runInContext(
  SRC.slice(SRC.indexOf('const ES_TICKER'), SRC.indexOf('async function leerExcel'))
  , sandbox);
const filasAActivos = vm.runInContext('filasAActivos', sandbox);
const aNumero = vm.runInContext('aNumero', sandbox);

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

// ── El archivo REAL que Marcos subio ───────────────────────────────────────
const ARCHIVO = path.join(__dirname, 'fixtures', 'cartera_ejemplo.xlsx');
const wb = XLSX.read(fs.readFileSync(ARCHIVO));
const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],
                                     { header: 1, defval: null });
const activos = filasAActivos(aoa.slice(1), aoa[0]);

console.log(`\nArchivo: ${path.basename(ARCHIVO)} · hoja "${wb.SheetNames[0]}"`);
console.log('  ticker  cantidad   precio   % del Excel');
for (const a of activos) {
  console.log(`  ${a.ticker.padEnd(6)} ${String(a.cantidad).padStart(8)} `
            + `${String(a.precioCompra).padStart(8)} ${String(a.pctExcel).padStart(11)}`);
}

// ── 1. LAS CANTIDADES ENTRAN ───────────────────────────────────────────────
console.log('\n1. Las tres columnas que se perdian');
chequear('lee los 7 activos', activos.length === 7, `${activos.length}`);
chequear('TODOS traen cantidad',
  activos.every(a => a.cantidad > 0),
  activos.filter(a => !(a.cantidad > 0)).map(a => a.ticker).join(','));
chequear('TODOS traen precio de compra',
  activos.every(a => a.precioCompra > 0));
chequear('TODOS traen % de posicion',
  activos.every(a => a.pctExcel > 0));
const amd = activos.find(a => a.ticker === 'AMD');
chequear('AMD: 48 nominales', amd.cantidad === 48, `${amd.cantidad}`);
chequear('AMD: precio 288.61', Math.abs(amd.precioCompra - 288.61) < 0.005,
  `${amd.precioCompra}`);

// ── 2. LA ESCALA DEL PORCENTAJE ────────────────────────────────────────────
// Excel guarda 0,216 para "21,6%". Leerlo tal cual haria creer que la posicion
// es el 0,2% de la cartera: los pesos saldrian ~100 veces mas chicos y NINGUNA
// alerta de sobrepeso se dispararia. Silencioso y total.
console.log('\n2. La escala del % (Excel guarda 0,216 para 21,6%)');
chequear('AMD: 0.216 se lee como 21.6%',
  Math.abs(amd.pctExcel - 21.6) < 0.05, `${amd.pctExcel}`);
const sumaPct = activos.reduce((a, x) => a + x.pctExcel, 0);
console.log(`     suma de los 7: ${sumaPct.toFixed(1)}% de la cartera del cliente`);
chequear('la suma queda en una escala creible (10-100%)',
  sumaPct > 10 && sumaPct <= 100.5, `${sumaPct}`);

// El mismo archivo escrito en la OTRA escala tiene que dar lo mismo.
const enteros = aoa.slice(1).map(f => f.map((c, i) => (i === 5 && typeof c === 'number')
  ? Math.round(c * 1000) / 10 : c));
const b = filasAActivos(enteros, aoa[0]);
chequear('escrito como 21.6 en vez de 0.216 da el MISMO resultado',
  Math.abs(b.find(x => x.ticker === 'AMD').pctExcel - amd.pctExcel) < 0.06,
  `${b.find(x => x.ticker === 'AMD').pctExcel} vs ${amd.pctExcel}`);

// ── 3. Numeros escritos como texto ─────────────────────────────────────────
console.log('\n3. Celdas formateadas como texto');
const casos = [
  ['1.234,56', 1234.56, 'miles con punto, decimal con coma (es-AR)'],
  ['1,234.56', 1234.56, 'miles con coma, decimal con punto (en-US)'],
  ['288,61',   288.61,  'una coma decimal'],
  ['US$ 288.61', 288.61, 'con simbolo de moneda'],
  ['1,500',    1500,    'una coma de miles'],
  ['48',       48,      'entero pelado'],
  ['',         null,    'vacio'],
  ['—',        null,    'un guion'],
];
for (const [entrada, esperado, why] of casos) {
  const r = aNumero(entrada);
  chequear(`"${entrada}" -> ${esperado} (${why})`,
    esperado == null ? r == null : Math.abs(r - esperado) < 0.005, `${r}`);
}

// ── 4. Sin las columnas, no se inventa nada ────────────────────────────────
console.log('\n4. Un Excel sin esas columnas sigue andando');
const soloTickers = filasAActivos([['AAPL'], ['MSFT']], ['Ticker']);
chequear('lee los tickers igual', soloTickers.length === 2);
chequear('y deja cantidad/precio/% en null, no en cero',
  soloTickers.every(a => a.cantidad == null && a.precioCompra == null
                      && a.pctExcel == null),
  JSON.stringify(soloTickers[0]));

// ── 5. Los encabezados aguantan que los toquen ─────────────────────────────
console.log('\n5. Encabezados con otra forma');
const variantes = [
  ['Ticker', 'CANTIDAD', 'PRECIO DE COMPRA', '% POSICIÓN'],
  ['Símbolo', 'Nominales', 'Precio de Costo', 'Peso en cartera'],
  ['Activo', 'cantidad', 'precio compra', '% posicion'],
];
for (const enc of variantes) {
  const r = filasAActivos([['AAPL', 10, 100, 25]], enc);
  chequear(`"${enc.join(' | ')}"`,
    r[0]?.cantidad === 10 && r[0]?.precioCompra === 100 && r[0]?.pctExcel === 25,
    JSON.stringify(r[0]));
}

// ── LOS CODIGOS DE BYMA (03/09/2026) ───────────────────────────────────────
// Un cliente argentino escribe "YPFD", no "YPF". Hasta ahora esa fila
// desaparecia del informe SIN error: el papel simplemente no existia.
console.log('\n8. El Excel con codigos de BYMA');
const ALIAS = { YPFD: 'YPF', PAMP: 'PAM', TGSU2: 'TGS', TECO2: 'TEO',
                CRES: 'CRESY', IRSA: 'IRS' };
const enc = ['Ticker', 'Cantidad', 'Precio de compra'];
const filasBYMA = [['YPFD', 100, 30], ['IRSA', 50, 12],
                   ['PAMP.BA', 200, 45], ['GGAL', 80, 55], ['AAPL', 10, 190]];
const conAlias = filasAActivos(filasBYMA, enc, ALIAS);
console.log('     ' + conAlias.map(a =>
  `${a.tickerOriginal || a.ticker}->${a.ticker}`).join(' · '));
chequear('YPFD se resuelve a YPF',
  conAlias.some(a => a.ticker === 'YPF' && a.tickerOriginal === 'YPFD'));
chequear('IRSA (local) se resuelve a IRS (el ADR)',
  conAlias.some(a => a.ticker === 'IRS' && a.tickerOriginal === 'IRSA'));
chequear('PAMP.BA tambien, con el sufijo de la plaza',
  conAlias.some(a => a.ticker === 'PAM' && a.tickerOriginal === 'PAMP.BA'));
chequear('GGAL queda igual: su codigo es el mismo en las dos plazas',
  conAlias.some(a => a.ticker === 'GGAL' && !a.tickerOriginal));
chequear('y un papel de EEUU no se toca',
  conAlias.some(a => a.ticker === 'AAPL' && !a.tickerOriginal));
chequear('no se pierde ninguna fila', conAlias.length === 5, `${conAlias.length}`);
chequear('las cantidades sobreviven a la traduccion',
  conAlias.find(a => a.ticker === 'YPF').cantidad === 100);

// Sin diccionario NO puede romper: es el comportamiento de antes.
const sinAlias = filasAActivos(filasBYMA, enc);
chequear('sin diccionario sigue andando, con el ticker tal cual',
  sinAlias.length === 5 && sinAlias.some(a => a.ticker === 'YPFD'));
chequear('pero el sufijo .BA se saca igual: nunca es parte del ticker',
  sinAlias.some(a => a.ticker === 'PAMP'),
  sinAlias.map(a => a.ticker).join(','));

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
