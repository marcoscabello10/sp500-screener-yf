// Prueba del OPTIMIZADOR Y LA SELECCION de la fase de correlacion (F1/F4).
//
// Extrae las funciones REALES de src/App.jsx -- no copias -- y las corre sobre
// el snapshot real de precios. Si alguien las cambia en App.jsx, esta prueba
// prueba las nuevas.
//
// LO QUE CLAVA, Y POR QUE
//
//  1. EL POOL Y EL RESULTADO SON DOS COSAS DISTINTAS. Antes del 17/09 cada
//     modo decidia las dos a la vez y no se podia pedir "mirar 55, elegir 6".
//
//  2. 🔴 EL TOPE DE PESO SE CUMPLE DE VERDAD. `constrainedWeights` recortaba a
//     [minW,maxW] y DESPUES renormalizaba, asi que la renormalizacion deshacia
//     el recorte. Medido: con 6 activos el 96% de las 4.000 carteras se pasaba
//     del 20% y la que la pantalla marcaba como "Maximo Sharpe" tenia 20,2%.
//     Con 4 activos repartia 25% con el pie diciendo 20%.
//
//  3. 4 x 20% = 80%. Pedir 4 papeles con tope de 20% es una region VACIA: no
//     existe ninguna cartera que cumpla. Tiene que decirlo, no inventar una.
//
//  4. EL OPTIMO ES DETERMINISTA Y ES EL OPTIMO. Mismo input -> mismo output,
//     bit a bit. Y contra una busqueda aleatoria masiva, gana o empata: si
//     perdiera, no seria un optimizador.
//
// Correr:  node test/prueba-optimizador.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Todo se resuelve desde ESTE archivo. Una prueba con la ruta del contenedor
// de Claude clavada no corre en la maquina de Marcos, y eso ya paso dos veces.
const RAIZ = path.resolve(__dirname, '..');
const DATA = path.join(RAIZ, 'public', 'data') + path.sep;

// ⚠️ HAY DOS App.jsx EN ESTE REPO:
//   src/App.jsx          -> el SCREENER   (es el que prueba este archivo)
//   src/informe/App.jsx  -> el INFORME
const APP_SCREENER = path.join(RAIZ, 'src', 'App.jsx');
const SRC = fs.readFileSync(APP_SCREENER, 'utf8');

function bloque(desde, hasta) {
  const a = SRC.indexOf(desde);
  if (a < 0) throw new Error(`no encuentro en App.jsx: ${desde}`);
  const b = SRC.indexOf(hasta, a);
  if (b < 0) throw new Error(`no encuentro el fin de: ${desde}`);
  return SRC.slice(a, b + hasta.length);
}

const codigo = [
  bloque('const POOL_POR_SECTOR = {', '};'),
  bloque('const RESULTADO_MIN = ', ';'),
  bloque('const OPT_ITERACIONES = ', ';'),
  bloque('function poolPorSector', '\n}'),
  bloque('function elegirDelPool', '\n}'),
  bloque('function applySelectionMode', '\n}'),
  bloque('function pesosPosibles', '\n}'),
  bloque('function proyectarPesos', '\n}'),
  bloque('function constrainedWeights', '\n}'),
  bloque('function runMonteCarlo', '\n}'),
  bloque('function portStats', '\n}'),
  bloque('function _gradSharpe', '\n}'),
  bloque('function maximoSharpe', '\n}'),
  bloque('function minimaVarianza', '\n}'),
].join('\n\n');

const sandbox = { console, Math, Array, Object, Number, String, isFinite, Map, Set, JSON };
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox);
const A = vm.runInContext('({POOL_POR_SECTOR,RESULTADO_MIN,RESULTADO_MAX,RESULTADO_DEFECTO,'
  + 'poolPorSector,elegirDelPool,applySelectionMode,pesosPosibles,proyectarPesos,'
  + 'constrainedWeights,runMonteCarlo,portStats,maximoSharpe,minimaVarianza})', sandbox);

let ok = 0, fail = 0;
function chequear(nombre, cond, detalle) {
  if (cond) { ok++; console.log(`  ok    ${nombre}`); }
  else { fail++; console.log(`  FALLA ${nombre}${detalle ? ' -- ' + detalle : ''}`); }
}
const casi = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('='.repeat(74));
console.log('  1. EL POOL');
console.log('='.repeat(74));

// Un universo de juguete: 4 sectores x 7 papeles, con scores decrecientes.
const SECTORES = ['Technology', 'Financials', 'Energy', 'Healthcare'];
const JUGUETE = [];
SECTORES.forEach((sec, si) => {
  for (let k = 0; k < 7; k++) {
    JUGUETE.push({ symbol: `${sec.slice(0,2).toUpperCase()}${k}`, sector: sec, score: 100 - k * 5 - si });
  }
});

const p1 = A.poolPorSector(JUGUETE, 1, []);
chequear('pool 1-por-sector trae exactamente un papel por sector',
  p1.length === 4 && new Set(p1.map(i => JUGUETE[i].sector)).size === 4,
  `dio ${p1.length}`);
chequear('y es el de mejor score de cada uno',
  p1.every(i => JUGUETE[i].symbol.endsWith('0')),
  p1.map(i => JUGUETE[i].symbol).join(','));

const p5 = A.poolPorSector(JUGUETE, 5, []);
chequear('pool 5-por-sector trae cinco por sector',
  p5.length === 20 && SECTORES.every(s => p5.filter(i => JUGUETE[i].sector === s).length === 5),
  `dio ${p5.length}`);

const pEx = A.poolPorSector(JUGUETE, 5, ['Energy']);
chequear('un sector excluido no entra al pool',
  pEx.every(i => JUGUETE[i].sector !== 'Energy') && pEx.length === 15,
  `dio ${pEx.length}`);

// ── El desempate. Es la clase de cosa que no rompe nada y da distinto. ──────
// Los papeles que no llegan al minimo de metricas tienen score en null, y
// (score||0) los empata a todos en cero. Sin desempate explicito, cual entra al
// pool dependeria del orden en que vinieron del snapshot.
const EMPATE   = [
  { symbol: 'ZZZ', sector: 'Technology', score: null },
  { symbol: 'AAA', sector: 'Technology', score: null },
  { symbol: 'MMM', sector: 'Technology', score: null },
];
const EMPATE_R = [EMPATE[2], EMPATE[0], EMPATE[1]]; // el mismo conjunto, otro orden
const e1 = A.poolPorSector(EMPATE,   1, []).map(i => EMPATE[i].symbol);
const e2 = A.poolPorSector(EMPATE_R, 1, []).map(i => EMPATE_R[i].symbol);
chequear('con scores empatados el pool no depende del orden de entrada',
  e1[0] === e2[0] && e1[0] === 'AAA', `${e1[0]} vs ${e2[0]}`);

console.log();
console.log('='.repeat(74));
console.log('  2. ELEGIR N DEL POOL');
console.log('='.repeat(74));

// Correlacion de juguete: todo a 0,5 salvo dentro del mismo sector, a 0,95.
const corrJug = JUGUETE.map((a, i) => JUGUETE.map((b, j) =>
  i === j ? 1 : (a.sector === b.sector ? 0.95 : 0.5)));

const porPuntaje = A.elegirDelPool('puntaje', JUGUETE, corrJug, p1, 3, []);
chequear('criterio "puntaje" devuelve los 3 de mayor score del pool',
  porPuntaje.length === 3 &&
  porPuntaje.every(i => ['TE0', 'FI0', 'EN0'].includes(JUGUETE[i].symbol)),
  porPuntaje.map(i => JUGUETE[i].symbol).join(','));

// ── EL CASO QUE MOTIVA TODO EL CRITERIO ─────────────────────────────────────
// Un sector que barre el ranking. Es exactamente lo que pasa en la realidad
// cuando la tecnologia viene de un año bueno: "los 4 mejores" son 4 papeles
// que se mueven juntos, y la cartera parece diversificada porque son cuatro.
//
// En el JUGUETE de arriba esto NO se ve: los scores estan escalonados de forma
// que el mejor de cada sector queda arriba de todo igual, asi que los dos
// criterios coinciden. Hizo falta un caso donde puedan diferir.
const DOMINA = [];
SECTORES.forEach((sec, si) => {
  for (let k = 0; k < 7; k++) {
    // Technology entera por encima de todo lo demas.
    DOMINA.push({ symbol: `${sec.slice(0,2).toUpperCase()}${k}`, sector: sec,
                  score: si === 0 ? 100 - k : 80 - k });
  }
});
const corrDom = DOMINA.map((a, i) => DOMINA.map((b, j) =>
  i === j ? 1 : (a.sector === b.sector ? 0.95 : 0.2)));
const pDom     = A.poolPorSector(DOMINA, 5, []);
const porScore = A.elegirDelPool('puntaje', DOMINA, corrDom, pDom, 4, []);
const porCorr  = A.elegirDelPool('descorrelacion', DOMINA, corrDom, pDom, 4, []);
const secScore = new Set(porScore.map(i => DOMINA[i].sector)).size;
const secCorr  = new Set(porCorr.map(i => DOMINA[i].sector)).size;
chequear('cuando un sector barre el ranking, "puntaje" devuelve 4 del mismo sector',
  secScore === 1, `toco ${secScore} sectores: ${porScore.map(i=>DOMINA[i].symbol).join(',')}`);
chequear('y "descorrelacion" sobre el mismo pool reparte',
  secCorr > secScore,
  `descorrelacion toca ${secCorr} sectores (${porCorr.map(i=>DOMINA[i].symbol).join(',')}), puntaje ${secScore}`);
chequear('la mas correlacionada de la cartera baja al cambiar de criterio',
  (() => {
    const media = sel => {
      let s = 0, c = 0;
      for (let a = 0; a < sel.length; a++) for (let b = a+1; b < sel.length; b++) { s += corrDom[sel[a]][sel[b]]; c++; }
      return s / c;
    };
    return media(porCorr) < media(porScore);
  })());

const forzado = A.elegirDelPool('puntaje', JUGUETE, corrJug, p5, 2, ['Healthcare']);
chequear('un sector garantizado entra aunque su score no lo hubiera puesto',
  forzado.some(i => JUGUETE[i].sector === 'Healthcare'),
  forzado.map(i => JUGUETE[i].symbol + '/' + JUGUETE[i].sector).join(' '));

const pocos = A.elegirDelPool('puntaje', JUGUETE, corrJug, p1, 99, []);
chequear('pedir mas papeles que los del pool devuelve el pool entero, sin romper',
  pocos.length === 4, `dio ${pocos.length}`);

console.log();
console.log('='.repeat(74));
console.log('  3. applySelectionMode: el tamano y la submatriz');
console.log('='.repeat(74));

for (const [pedido, esperado] of [[1, A.RESULTADO_MIN], [6, 6], [99, A.RESULTADO_MAX], [0, A.RESULTADO_DEFECTO]]) {
  const r = A.applySelectionMode('full', pedido, 'puntaje', JUGUETE, corrJug, [], []);
  chequear(`pedir ${pedido} papeles da ${esperado} (rango ${A.RESULTADO_MIN}-${A.RESULTADO_MAX})`,
    r.stocks.length === esperado, `dio ${r.stocks.length}`);
}

// 🔴 LA SUBMATRIZ. Es el mismo error que costo el bug mas caro del Motor B:
// una matriz que se ve bien y esta pareada mal. Si `corr` del resultado no
// coincide celda por celda con la del universo, todo lo que se decida despues
// esta mirando correlaciones de otros papeles.
const rSub = A.applySelectionMode('full', 5, 'descorrelacion', JUGUETE, corrJug, [], []);
let submatrizOk = true;
for (let a = 0; a < rSub.idxs.length; a++) {
  for (let b = 0; b < rSub.idxs.length; b++) {
    if (rSub.corr[a][b] !== corrJug[rSub.idxs[a]][rSub.idxs[b]]) submatrizOk = false;
  }
}
chequear('la submatriz de correlacion del resultado esta alineada con la del universo',
  submatrizOk);
chequear('y los papeles del resultado son los de esos indices',
  rSub.stocks.every((s, k) => s.symbol === JUGUETE[rSub.idxs[k]].symbol));
chequear('el resultado informa cual era el pool, para poder decir en pantalla '
  + 'sobre cuantos se correlaciono',
  Array.isArray(rSub.pool) && rSub.pool.length === 20, `dijo ${rSub.pool && rSub.pool.length}`);
chequear('y el resultado es un subconjunto del pool, no papeles de afuera',
  rSub.idxs.every(i => rSub.pool.includes(i)));

const rExc = A.applySelectionMode('full', 6, 'puntaje', JUGUETE, corrJug, [], ['Technology']);
chequear('el sector excluido tampoco aparece en el resultado final',
  rExc.stocks.every(s => s.sector !== 'Technology'));

console.log();
console.log('='.repeat(74));
console.log('  4. 🔴 LOS TOPES DE PESO — el bug que existia');
console.log('='.repeat(74));

chequear('4 activos con maximo 20% es imposible y lo dice',
  A.pesosPosibles(4, 0.01, 0.20).ok === false);
chequear('y ademas dice cuanto haria falta',
  A.pesosPosibles(4, 0.01, 0.20).maxNecesario === 25,
  String(A.pesosPosibles(4, 0.01, 0.20).maxNecesario));
chequear('5 activos con maximo 20% si es posible (justo: 5 x 20 = 100)',
  A.pesosPosibles(5, 0.01, 0.20).ok === true);
chequear('un minimo que se pasa del 100% tambien se rechaza',
  A.pesosPosibles(10, 0.15, 0.50).ok === false);

// La proyeccion, sobre entradas arbitrarias incluidas las degeneradas.
let proyOk = true, peorSuma = 0, peorPeso = 0;
for (let n = 5; n <= 30; n += 5) {
  for (let k = 0; k < 400; k++) {
    const v = Array.from({ length: n }, () => Math.random() * (k % 7 === 0 ? 50 : 1) - (k % 5 === 0 ? 20 : 0));
    const w = A.proyectarPesos(v, 0.01, 0.20);
    if (!w) { proyOk = false; continue; }
    const s = w.reduce((a, b) => a + b, 0);
    peorSuma = Math.max(peorSuma, Math.abs(s - 1));
    peorPeso = Math.max(peorPeso, Math.max(...w));
    if (Math.min(...w) < 0.01 - 1e-9) proyOk = false;
  }
}
chequear('la proyeccion siempre suma 1', proyOk && peorSuma < 1e-9,
  `peor desvio ${peorSuma.toExponential(2)}`);
chequear('la proyeccion nunca se pasa del maximo', peorPeso <= 0.20 + 1e-9,
  `peor peso ${(peorPeso * 100).toFixed(3)}%`);

// ── LA REGRESION ────────────────────────────────────────────────────────────
// Esto es lo que fallaba. Con 6 activos, el 96% de las carteras sorteadas se
// pasaba del 20%. Si alguien vuelve a poner el recortar-renormalizar, esta
// comprobacion se prende fuego.
for (const n of [5, 6, 8, 12, 20]) {
  let peor = 0, minimo = 1;
  for (let k = 0; k < 2000; k++) {
    const w = A.constrainedWeights(n, 0.01, 0.20);
    peor = Math.max(peor, Math.max(...w));
    minimo = Math.min(minimo, Math.min(...w));
  }
  chequear(`${String(n).padStart(2)} activos: 2.000 carteras sorteadas respetan el 1%-20%`,
    peor <= 0.20 + 1e-9 && minimo >= 0.01 - 1e-9,
    `peor ${(peor * 100).toFixed(2)}% / menor ${(minimo * 100).toFixed(2)}%`);
}
chequear('con 4 activos y tope 20% la nube sale vacia en vez de inventar pesos',
  A.runMonteCarlo([0.1, 0.1, 0.1, 0.1], [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], 0.04, 50, 0.01, 0.20).length === 0);

console.log();
console.log('='.repeat(74));
console.log('  5. EL OPTIMO, SOBRE DATOS REALES');
console.log('='.repeat(74));

const HIST = JSON.parse(fs.readFileSync(DATA + 'historico_precios.json', 'utf8'));
const FUND = JSON.parse(fs.readFileSync(DATA + 'sp500_fundamentals.json', 'utf8')).stocks;

// Un universo real y reproducible: por sector, los de mayor capitalizacion con
// historia completa. Nada de azar en la eleccion del caso de prueba.
const conHist = new Set(Object.keys(HIST.series).filter(t => {
  const s = HIST.series[t];
  let n = 0; for (const x of s) if (x != null) n++;
  return n > 1500;
}));
const porSec = {};
for (const x of FUND) {
  if (!x.sector || !conHist.has(x.symbol)) continue;
  (porSec[x.sector] = porSec[x.sector] || []).push(x);
}
for (const k in porSec) porSec[k].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
const secOrd = Object.keys(porSec).sort();
function universo(n) {
  const o = [];
  for (let k = 0; k < 6; k++) for (const s of secOrd) if (porSec[s][k]) o.push(porSec[s][k].symbol);
  return o.slice(0, n);
}
// Retornos sobre un EJE DE FECHAS COMUN. Parearlos por posicion es el bug que
// costo el Motor B entero: XOM-CVX daba 0,037 en vez de 0,816.
function retornos(tks) {
  const f = HIST.fechas, idx = [];
  const hay = k => tks.every(t => HIST.series[t] && HIST.series[t][k] != null);
  for (let k = 1; k < f.length; k++) if (hay(k) && hay(k - 1)) idx.push(k);
  return tks.map(t => idx.map(k => HIST.series[t][k] / HIST.series[t][k - 1] - 1));
}
function covDe(R) {
  const n = R.length, T = R[0].length;
  const m = R.map(r => r.reduce((a, b) => a + b, 0) / T);
  return R.map((ri, i) => R.map((rj, j) => {
    let s = 0; for (let k = 0; k < T; k++) s += (ri[k] - m[i]) * (rj[k] - m[j]);
    return s / (T - 1);
  }));
}
const annDe = R => R.map(r => Math.pow(r.reduce((a, v) => a * (1 + v), 1), 252 / r.length) - 1);

const RF = 0.0425, MINW = 0.01, MAXW = 0.20;
for (const n of [6, 11, 20]) {
  const tks = universo(n), R = retornos(tks), cov = covDe(R), mu = annDe(R);

  // ── DETERMINISMO. Es el punto de toda la funcion. ────────────────────────
  const a = A.maximoSharpe(mu, cov, RF, MINW, MAXW);
  const b = A.maximoSharpe(mu, cov, RF, MINW, MAXW);
  const c = A.maximoSharpe(mu, cov, RF, MINW, MAXW);
  chequear(`${String(n).padStart(2)} activos: tres corridas dan pesos identicos, bit a bit`,
    a.every((x, i) => x === b[i] && x === c[i]));

  // ── RESPETA LOS TOPES ────────────────────────────────────────────────────
  const mv = A.minimaVarianza(cov, MINW, MAXW);
  chequear(`${String(n).padStart(2)} activos: el optimo respeta 1%-20% y suma 100%`,
    Math.max(...a) <= MAXW + 1e-9 && Math.min(...a) >= MINW - 1e-9 &&
    casi(a.reduce((x, y) => x + y, 0), 1, 1e-9) &&
    Math.max(...mv) <= MAXW + 1e-9 && casi(mv.reduce((x, y) => x + y, 0), 1, 1e-9),
    `max ${(Math.max(...a) * 100).toFixed(2)}%`);

  // ── ES EL OPTIMO: gana o empata contra una busqueda aleatoria masiva ─────
  // Si un sorteo de 30.000 carteras le ganara, no seria un optimizador.
  const sOpt = A.portStats(a, mu, cov, RF).sharpe;
  const vOpt = A.portStats(mv, mu, cov, RF).vol;
  let sAzar = -Infinity, vAzar = Infinity;
  for (let k = 0; k < 30000; k++) {
    const w = A.constrainedWeights(n, MINW, MAXW);
    const st = A.portStats(w, mu, cov, RF);
    if (st.sharpe > sAzar) sAzar = st.sharpe;
    if (st.vol < vAzar) vAzar = st.vol;
  }
  chequear(`${String(n).padStart(2)} activos: el maximo Sharpe gana o empata a 30.000 sorteos`,
    sOpt >= sAzar - 1e-6, `optimo ${sOpt.toFixed(4)} vs sorteo ${sAzar.toFixed(4)}`);
  chequear(`${String(n).padStart(2)} activos: la minima varianza gana o empata a 30.000 sorteos`,
    vOpt <= vAzar + 1e-6, `optimo ${vOpt.toFixed(4)} vs sorteo ${vAzar.toFixed(4)}`);

  // ── Y LE GANA AL EQUIPONDERADO, que es el piso de sentido comun ──────────
  const ew = new Array(n).fill(1 / n);
  chequear(`${String(n).padStart(2)} activos: la minima varianza es menos volatil que el equiponderado`,
    vOpt <= A.portStats(ew, mu, cov, RF).vol + 1e-9);
}

// El caso que el rediseno destapo, con datos reales: 4 papeles y tope 20%.
{
  const tks = universo(4), R = retornos(tks), cov = covDe(R), mu = annDe(R);
  chequear('4 papeles reales con tope 20%: el optimizador se niega en vez de mentir',
    A.maximoSharpe(mu, cov, RF, MINW, 0.20) === null &&
    A.minimaVarianza(cov, MINW, 0.20) === null);
  const w = A.maximoSharpe(mu, cov, RF, MINW, 0.25);
  chequear('4 papeles reales con tope 25%: ahi si resuelve, y respeta el tope',
    w != null && Math.max(...w) <= 0.25 + 1e-9 && casi(w.reduce((a, b) => a + b, 0), 1, 1e-9));
}

console.log();
console.log('='.repeat(74));
if (fail) {
  console.log(`  ${fail} FALLAS de ${ok + fail} comprobaciones`);
  process.exit(1);
}
console.log(`  ${ok} comprobaciones OK`);
console.log('  El pool y el resultado son independientes, los topes de peso se');
console.log('  cumplen de verdad, y el optimo es determinista y es el optimo.');
