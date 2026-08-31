// Prueba de la CONCENTRACION POR INDUSTRIA.
//
// LA PREGUNTA QUE ORIGINA ESTE ARCHIVO (Marcos, 31/08):
//   "Si tengo WFC que esta en el S&P y otro banco que esta como CEDEAR pero no
//    en el S&P, ¿no nos marca que ambos suman para la misma concentracion?"
//
// La respuesta tiene dos mitades y las dos se comprueban aca:
//   1. Por SECTOR ya los sumaba, y siempre lo hizo. El peso sale del `sector`
//      de cada POSICION de la cartera, no del universo del screener.
//   2. Por INDUSTRIA no existia. "Financials 80%" puede ser cuatro bancos o
//      tres bancos y una aseguradora, y la tabla los dibujaba identicos.
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const DATA = path.join(RAIZ, 'public', 'data') + path.sep;

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

function cargar(archivo) {
  let src = fs.readFileSync(ruta(archivo), 'utf8');
  const ex = [];
  src = src.replace(/^export (async function|function|const|let) (\w+)/gm,
    (_, k, n) => { ex.push(n); return `${k} ${n}`; });
  src = src.replace(/^import .*$/gm, '');
  const sb = { console, Math, Object, Array, Number, Set, Map, JSON,
               isFinite, isNaN, Promise };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return vm.runInContext(`({${ex.join(',')}})`, sb);
}

const C = cargar('cartera.js');

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

function inf(t, nombre, sector, industry) {
  return {
    ticker: t, nombre, sector, industry,
    veredicto: { puntaje: 65, etiqueta: 'neutral', accion: 'mantener' },
    riesgos: [],
    senales: [{ bloque: 'valuacion', titulo: 'V', puntaje: 40, notas: ['x'] }],
    fundamentales: { marketCap: 200e9, pe: 12, roe: 14 },
    consenso: { beta: 1.1, upsidePct: 6 },
  };
}
function armar(informes, valores) {
  const pos = {};
  informes.forEach((i, k) => {
    pos[i.ticker] = { cantidad: 100, precioCompra: 10,
                      valorActual: valores[k], gananciaPct: 5 };
  });
  return C.analizarCartera(informes, pos, 'moderado', 'equilibrado', 'medio',
                           { modo: 'monto', rentaFija: 0, efectivo: 0 });
}

// ── 1. La mitad que YA funcionaba: el sector suma las dos fuentes ─────────
console.log('1. El sector ya sumaba papeles del S&P con CEDEAR de afuera');
// WFC esta en el S&P. BBD y BBVA solo existen como CEDEAR fuera del indice.
const BANCOS = [
  inf('WFC',  'Wells Fargo',     'Financials', 'Banks - Diversified'),
  inf('BBD',  'Banco Bradesco',  'Financials', 'Banks - Regional'),
  inf('BBVA', 'BBVA',            'Financials', 'Banks - Diversified'),
  inf('KO',   'Coca-Cola',       'Consumer Staples', 'Beverages - Non-Alcoholic'),
];
const cart = armar(BANCOS, [9000, 6000, 5000, 5000]);
const fin = cart.sectores.find(s => s.sector === 'Financials');
console.log(`     Financials: ${fin.pct}% con ${fin.n} papeles (tope ${fin.tope}%)`);
chequear('WFC + BBD + BBVA suman en el mismo sector',
  fin.n === 3 && Math.abs(fin.pct - 80) < 0.11, `${fin.pct}% / ${fin.n}`);
chequear('y el exceso se marca', fin.excede === true);
chequear('el denominador dice que es plata, no conteo',
  fin.denominador === 'valor de la cartera');

// ── 2. Lo que NO existia: el nivel fino ──────────────────────────────────
console.log('\n2. La industria separa lo que el sector junta');
const ind = C.concentracionPorIndustria(cart);
chequear('el analisis es confiable (todas traen industria)', ind.confiable);
chequear('la cobertura es 100%', ind.cobertura_pct === 100, `${ind.cobertura_pct}`);
for (const g of ind.industrias) {
  console.log(`     ${g.industry.padEnd(28)} ${String(g.pct).padStart(5)}%  `
            + `${g.tickers.join(' ')}`);
}
const diver = ind.concentradas.find(g => g.industry === 'Banks - Diversified');
chequear('WFC + BBVA quedan juntos en Banks - Diversified',
  diver && diver.n === 2 && diver.tickers.includes('WFC')
  && diver.tickers.includes('BBVA'), JSON.stringify(diver));
chequear('y su peso es la suma de los dos (36 + 20 = 56)',
  Math.abs(diver.pct - 56) < 0.11, `${diver.pct}`);
chequear('BBD queda aparte: es Regional, no Diversified',
  !diver.tickers.includes('BBD'));
chequear('una industria con un solo papel NO se marca como concentracion',
  !ind.concentradas.some(g => g.n < 2),
  ind.concentradas.map(g => `${g.industry}:${g.n}`).join(','));

// ── 3. El caso que justifica todo: mismo sector, lecturas opuestas ────────
console.log('\n3. Dos carteras con el MISMO sector al 80% y distinto riesgo');
const CUATRO_BANCOS = [
  inf('WFC',  'Wells Fargo',    'Financials', 'Banks - Diversified'),
  inf('JPM',  'JP Morgan',      'Financials', 'Banks - Diversified'),
  inf('BAC',  'Bank of America','Financials', 'Banks - Diversified'),
  inf('C',    'Citigroup',      'Financials', 'Banks - Diversified'),
  inf('KO',   'Coca-Cola',      'Consumer Staples', 'Beverages - Non-Alcoholic'),
];
const REPARTIDA = [
  inf('WFC',  'Wells Fargo',    'Financials', 'Banks - Diversified'),
  inf('AIG',  'AIG',            'Financials', 'Insurance - Diversified'),
  inf('BLK',  'BlackRock',      'Financials', 'Asset Management'),
  inf('CME',  'CME Group',      'Financials', 'Financial Data & Exchanges'),
  inf('KO',   'Coca-Cola',      'Consumer Staples', 'Beverages - Non-Alcoholic'),
];
const montos = [5000, 5000, 5000, 5000, 5000];
const a = C.concentracionPorIndustria(armar(CUATRO_BANCOS, montos));
const b = C.concentracionPorIndustria(armar(REPARTIDA, montos));
const secA = armar(CUATRO_BANCOS, montos).sectores
  .find(s => s.sector === 'Financials');
const secB = armar(REPARTIDA, montos).sectores
  .find(s => s.sector === 'Financials');
console.log(`     cuatro bancos  -> Financials ${secA.pct}% · `
          + `industrias concentradas: ${a.concentradas.length}`);
console.log(`     una de c/u     -> Financials ${secB.pct}% · `
          + `industrias concentradas: ${b.concentradas.length}`);
chequear('las dos carteras tienen el MISMO peso por sector',
  secA.pct === secB.pct, `${secA.pct} vs ${secB.pct}`);
chequear('pero solo la de cuatro bancos marca concentracion por industria',
  a.concentradas.length === 1 && b.concentradas.length === 0);
chequear('y nombra los cuatro tickers',
  a.concentradas[0].tickers.length === 4);

// ── 4. Sin el dato NO se inventa, y se dice ──────────────────────────────
console.log('\n4. Cuando falta la industria');
// Los 130 CEDEAR de afuera del indice llegan sin `industry` hasta que se
// vuelva a correr fetch_informe.py. Media cartera sin el dato NO puede
// dibujarse como si estuviera repartida.
const MITAD = [
  inf('WFC',  'Wells Fargo',    'Financials', 'Banks - Diversified'),
  inf('JPM',  'JP Morgan',      'Financials', 'Banks - Diversified'),
  inf('BBD',  'Bradesco',       'Financials', null),
  inf('BBVA', 'BBVA',           'Financials', null),
  inf('ING',  'ING',            'Financials', null),
];
const m = C.concentracionPorIndustria(armar(MITAD, montos));
console.log(`     cobertura ${m.cobertura_pct}% · sin dato: ${m.sin_dato.join(', ')}`);
chequear('con 3 de 5 sin industria, el analisis NO se declara confiable',
  m.confiable === false, `cobertura ${m.cobertura_pct}%`);
chequear('los que no tienen el dato se nombran, no se esconden',
  m.sin_dato.length === 3 && m.sin_dato.includes('BBD'));
chequear('los que si lo tienen igual se agrupan bien',
  m.industrias.find(g => g.industry === 'Banks - Diversified').n === 2);

// ── 5. El denominador, otra vez ──────────────────────────────────────────
console.log('\n5. Sin montos cargados esto es un CONTEO, no plata');
const sinMontos = C.analizarCartera(CUATRO_BANCOS, {}, 'moderado',
  'equilibrado', 'medio', null);
const sm = C.concentracionPorIndustria(sinMontos);
chequear('el denominador lo dice',
  sm.industrias.every(g => g.denominador === 'cantidad de posiciones'),
  JSON.stringify(sm.industrias.map(g => g.denominador)));
chequear('y NADA se marca como concentracion por conteo',
  sm.concentradas.length === 0,
  JSON.stringify(sm.concentradas.map(g => g.industry)));

// ── 6. Casos borde ───────────────────────────────────────────────────────
console.log('\n6. Bordes');
chequear('sin cartera devuelve null', C.concentracionPorIndustria(null) === null);
const vacia = C.concentracionPorIndustria({ activos: [], hayPesos: false });
chequear('cartera vacia no explota',
  vacia && vacia.industrias.length === 0 && vacia.confiable === false);

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
