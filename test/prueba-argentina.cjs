// Prueba del RIESGO PAIS y de los papeles QUE COTIZAN EN PESOS.
//
// Son dos cosas distintas que entraron el mismo dia (02/09/2026) y que tienen
// el mismo enemigo: un numero que parece del mismo tipo que los otros y no lo
// es.
//
// 1. EL TOPE DE RIESGO PAIS
//    Los ADR argentinos estan repartidos entre seis sectores. Cada uno entra
//    comodo en su tope de posicion y ninguno satura su sector, asi que una
//    cartera puede quedar 40% argentina sin que ninguna regla se queje. Pero
//    no son quince apuestas: son una. Se resuelve con el MISMO mecanismo de
//    topes de GRUPO que ya existia para sector e industria.
//
// 2. LOS QUE COTIZAN EN PESOS
//    Sus multiplos se pueden mostrar (P/E y ROE son cocientes: la moneda se
//    cancela) pero su market cap no compara y —lo que decide— su serie de tres
//    años incluye la devaluacion. Si entraran a la matriz, el Motor B leeria
//    esa devaluacion como volatilidad de la empresa y como correlacion entre
//    dos papeles que solo comparten moneda. Y la leeria ALTA, que es lo que
//    parece prudente, que es lo peor que puede pasar con un numero equivocado.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');

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
const U = cargar('universo.js');

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

// Un informe con la forma que devuelve `action=datos`.
function inf(t, nombre, sector, extra = {}) {
  return Object.assign({
    ticker: t, nombre, sector, industry: null,
    veredicto: { puntaje: 65, etiqueta: 'neutral', accion: 'mantener' },
    riesgos: [],
    senales: [{ bloque: 'valuacion', titulo: 'V', puntaje: 40, notas: ['x'] }],
    fundamentales: { marketCap: 5e9, pe: 8, roe: 15 },
    consenso: { beta: 1.3, upsidePct: 12 },
  }, extra);
}
function armar(informes, valores, perfil = 'moderado') {
  const pos = {};
  informes.forEach((i, k) => {
    pos[i.ticker] = { cantidad: 100, precioCompra: 10,
                      valorActual: valores[k], gananciaPct: 5 };
  });
  return C.analizarCartera(informes, pos, perfil, 'equilibrado', 'medio',
                           { modo: 'monto', rentaFija: 0, efectivo: 0 });
}

const ARG = x => ({ riesgo_pais: 'argentina', ...x });

// ── 1. EL CASO QUE JUSTIFICA TODO: seis sectores, una sola apuesta ────────
console.log('1. Cinco ADR argentinos en cinco sectores distintos');
const CARTERA_ARG = [
  inf('GGAL', 'Grupo Galicia',   'Financials',             ARG({})),
  inf('YPF',  'YPF',             'Energy',                 ARG({})),
  inf('PAM',  'Pampa Energia',   'Utilities',              ARG({})),
  inf('TEO',  'Telecom',         'Communication Services', ARG({})),
  inf('LOMA', 'Loma Negra',      'Materials',              ARG({})),
  inf('AAPL', 'Apple',           'Technology'),
  inf('KO',   'Coca-Cola',       'Consumer Staples'),
];
// 5 x 12% = 60% argentino, y NINGUN sector pasa de 12%.
const montos = [1200, 1200, 1200, 1200, 1200, 2000, 2000];
const cart = armar(CARTERA_ARG, montos);
const excedeAlgunSector = cart.sectores.some(s => s.excede);
console.log(`     sectores que exceden: ${cart.sectores.filter(s => s.excede).length}`);
console.log(`     riesgo argentino: ${cart.argentina.pct}% (tope ${cart.argentina.tope}%)`);
chequear('ningun sector excede su tope: por sector esta todo "bien"',
  !excedeAlgunSector);
chequear('y sin embargo el 60% de la cartera es riesgo argentino',
  Math.abs(cart.argentina.pct - 60) < 0.11, `${cart.argentina.pct}`);
chequear('el grupo marca el exceso, que es lo que ningun sector podia marcar',
  cart.argentina.excede === true);
chequear('nombra los cinco papeles', cart.argentina.n === 5
  && cart.argentina.tickers.includes('GGAL') && cart.argentina.tickers.includes('LOMA'));
chequear('y dice cuanto sobra en plata',
  cart.argentina.excesoUSD > 0, `${cart.argentina.excesoUSD}`);

// ── 2. El tope depende del perfil ─────────────────────────────────────────
console.log('\n2. El techo cambia con el perfil');
const cons = armar(CARTERA_ARG, montos, 'conservador');
const agre = armar(CARTERA_ARG, montos, 'agresivo');
console.log(`     conservador ${cons.argentina.tope}% · moderado `
          + `${cart.argentina.tope}% · agresivo ${agre.argentina.tope}%`);
chequear('crece con el perfil',
  cons.argentina.tope < cart.argentina.tope
  && cart.argentina.tope < agre.argentina.tope);
chequear('con 60% los tres perfiles marcan exceso',
  cons.argentina.excede && cart.argentina.excede && agre.argentina.excede);

// ── 3. Una cartera SIN nada argentino no inventa el bloque ────────────────
console.log('\n3. Sin papeles argentinos');
const sinArg = armar([
  inf('AAPL', 'Apple', 'Technology'),
  inf('KO', 'Coca-Cola', 'Consumer Staples'),
], [5000, 5000]);
chequear('el bloque no existe, no viene en cero',
  sinArg.argentina === null, JSON.stringify(sinArg.argentina));

// ── 4. El denominador, otra vez ───────────────────────────────────────────
// Es el mismo error que ya se cazo dos veces: sin montos, el porcentaje es un
// CONTEO de papeles, y un conteo leido como exposicion es una alarma falsa.
console.log('\n4. Sin montos cargados esto es un CONTEO');
const sinMontos = C.analizarCartera(CARTERA_ARG, {}, 'moderado', 'equilibrado',
                                    'medio', null);
console.log(`     denominador: ${sinMontos.argentina.denominador} · `
          + `pct ${sinMontos.argentina.pct}`);
chequear('el denominador lo dice',
  sinMontos.argentina.denominador === 'cantidad de posiciones');
chequear('y NO se marca exceso por un conteo',
  sinMontos.argentina.excede === false);
chequear('tampoco se inventa un exceso en dolares',
  sinMontos.argentina.excesoUSD === null);

// ── 5. Un papel argentino de mas no arrastra a los que no lo son ──────────
console.log('\n5. El grupo agarra a los que corresponde y a nadie mas');
chequear('Apple no esta en el grupo', !cart.argentina.tickers.includes('AAPL'));
chequear('Coca-Cola tampoco', !cart.argentina.tickers.includes('KO'));
const marcados = cart.activos.filter(a => a.riesgoPais === 'argentina');
chequear('la marca viaja en cada posicion, no solo en el resumen',
  marcados.length === 5, `${marcados.length}`);

// ── 6. LOS QUE COTIZAN EN PESOS ───────────────────────────────────────────
console.log('\n6. Los papeles en pesos: se muestran, no se comparan');
const CON_MERVAL = [
  inf('AAPL', 'Apple', 'Technology'),
  inf('KO', 'Coca-Cola', 'Consumer Staples'),
  inf('ALUA', 'Aluar', 'Materials', { solo_medible: true, moneda: 'ARS' }),
];
const cm = armar(CON_MERVAL, [4000, 3000, 3000]);
const alua = cm.activos.find(a => a.ticker === 'ALUA');
chequear('la marca llega a la posicion', alua.soloMedible === true);
chequear('y la moneda tambien', alua.moneda === 'ARS');
chequear('SI cuenta para el peso: es plata del cliente',
  Math.abs(alua.peso - 30) < 0.11, `${alua.peso}`);
const mat = cm.sectores.find(s => s.sector === 'Materials');
chequear('y SI suma a la concentracion de su sector',
  mat && Math.abs(mat.pct - 30) < 0.11, JSON.stringify(mat));
chequear('los otros no se marcan',
  cm.activos.filter(a => a.soloMedible).length === 1);

// ── 7. El universo los separa del pool de percentiles ─────────────────────
console.log('\n7. universo.js: fuera del pool y fuera de los candidatos');
const stocks = [
  { symbol: 'AAPL', sector: 'Technology', hasCedear: true, pe: 30, marketCap: 3e12 },
  { symbol: 'NEM', sector: 'Materials', hasCedear: true, pe: 15, marketCap: 5e10 },
];
const activos = {
  BBD:  { name: 'Bradesco', sector: 'Financials', hasCedear: true, pe: 7 },
  ALUA: { name: 'Aluar', sector: 'Materials', soloMedible: true, moneda: 'ARS',
          pe: 9, marketCap: 1.2e12 },
  TXAR: { name: 'Ternium Argentina', sector: 'Materials', soloMedible: true,
          moneda: 'ARS', pe: 6 },
};
const un = U.armarUniverso(stocks, activos);
console.log(`     todos ${un.todos.length} · operables ${un.operables.length} · `
          + `solo medibles ${un.resumen.soloMedibles}`);
chequear('NO entran al pool de percentiles',
  !un.todos.some(s => s.symbol === 'ALUA' || s.symbol === 'TXAR'),
  un.todos.map(s => s.symbol).join(','));
chequear('NO pueden ser candidatos',
  !un.operables.some(s => s.symbol === 'ALUA'),
  un.operables.map(s => s.symbol).join(','));
chequear('SI se pueden encontrar por simbolo: una cartera que los tiene se '
       + 'tiene que poder analizar',
  !!un.porSymbol.ALUA && un.porSymbol.ALUA.sector === 'Materials');
chequear('y quedan marcados',
  un.porSymbol.ALUA.soloMedible === true && un.porSymbol.ALUA.moneda === 'ARS');
chequear('el resumen los cuenta aparte', un.resumen.soloMedibles === 2);
chequear('los normales de afuera del indice siguen entrando',
  un.todos.some(s => s.symbol === 'BBD')
  && un.operables.some(s => s.symbol === 'BBD'));
// Y el market cap en pesos (1,2 billones) no puede estar en el pool: si
// estuviera, correria el percentil de tamaño de todo Materials.
const materials = un.todos.filter(s => s.sector === 'Materials');
chequear('ningun market cap en pesos quedo en el pool de Materials',
  materials.every(s => (s.marketCap || 0) < 1e11),
  materials.map(s => `${s.symbol}:${s.marketCap}`).join(','));

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
