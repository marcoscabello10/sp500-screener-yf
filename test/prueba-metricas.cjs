// Prueba del arreglo del patrimonio negativo (F1).
//
// Extrae metricaEfectiva/puntuarGrupo/FUND_METRICS/SECTOR_NO_APLICA y el `norm`
// REALES de App.jsx -- no copias -- y los corre sobre el snapshot real de 504
// empresas, simulando lo que va a producir el bot parcheado.
//
// Lo que verifica:
//   1. Un valor <= 0 en "menor es mejor" NO puntua (el bug original).
//   2. El reemplazo entra solo cuando la metrica propia no sirve.
//   3. Un ROA se compara contra ROAs, nunca contra ROEs (escalas distintas).
//   4. Los bancos: evEbitda y de dan "no aplica", no "falta el dato".
//   5. El score sigue siendo un promedio ponderado sobre lo que SI se uso.
//   6. Casos concretos: MCD, MAS, DVA, JPM.
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

// ⚠️ HAY DOS `App.jsx` EN ESTE REPO, Y SON DE PROYECTOS DISTINTOS:
//   src/App.jsx          -> el SCREENER   (es el que prueba este archivo)
//   src/informe/App.jsx  -> el INFORME
// Por eso acá NO se usa `ruta()`, que buscaría primero en src/informe/ y
// devolvería el equivocado sin decir nada. La separación entre los dos
// proyectos es la regla #1 del proyecto, y también vale para las pruebas.
const APP_SCREENER = path.join(RAIZ, 'src', 'App.jsx');

const vm = require('vm');


const SRC = fs.readFileSync(APP_SCREENER, 'utf8');

function bloque(desde, hasta) {
  const a = SRC.indexOf(desde);
  if (a < 0) throw new Error(`no encuentro: ${desde}`);
  const b = SRC.indexOf(hasta, a);
  if (b < 0) throw new Error(`no encuentro el fin: ${hasta}`);
  return SRC.slice(a, b + hasta.length);
}

const codigo = [
  bloque('const FUND_METRICS = [', '\n];'),
  bloque('const SECTOR_NO_APLICA = {', '\n};'),
  bloque('function metricaEfectiva', '\n}'),
  bloque('function puntuarGrupo', '\n}'),
  // el `norm` real de runP1
  bloque('      const norm=(vals,val,hb)=>{', '      };'),
].join('\n\n');

const sandbox = { console, Math, Array, Object, Number, isFinite, Map, Set, JSON };
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox);
const API = vm.runInContext(
  '({FUND_METRICS, SECTOR_NO_APLICA, metricaEfectiva, puntuarGrupo, norm})', sandbox);

let ok = 0, fail = 0;
function chequear(nombre, cond, detalle) {
  if (cond) { ok++; console.log(`  ok    ${nombre}`); }
  else { fail++; console.log(`  FALLA ${nombre}${detalle ? ' -- ' + detalle : ''}`); }
}

// ── El snapshot real, transformado como lo va a dejar el bot parcheado ──────
const FUND = JSON.parse(fs.readFileSync(
  DATA + 'sp500_fundamentals.json', 'utf8'));
const CONS = JSON.parse(fs.readFileSync(
  DATA + 'informe_consenso.json', 'utf8')).consenso;

function comoLoDejaElBot(s) {
  const c = CONS[s.symbol] || {};
  const patNeg = s.pb != null && s.pb < 0;
  let ndEbitda = null;
  const nd = c.netDebt, eb = c.ebitda;
  if (nd != null && eb != null && eb > 0 && nd > 0) ndEbitda = Math.round(nd / eb * 1000) / 1000;
  return { ...s,
    roe: patNeg ? null : s.roe,
    de:  patNeg ? null : s.de,
    ndEbitda, patrimonioNegativo: patNeg };
}
const STOCKS = FUND.stocks.filter(s => s.sector).map(comoLoDejaElBot);
const porSector = {};
for (const s of STOCKS) (porSector[s.sector] ||= []).push(s);
const idx = Object.fromEntries(STOCKS.map(s => [s.symbol, s]));

console.log(`Snapshot real: ${STOCKS.length} empresas con sector\n`);

// ── 1. Un valor <= 0 en "menor es mejor" no puntua ──────────────────────────
console.log('1. El bug original: un valor <= 0 en "menor es mejor"');
chequear('un P/B de -187 NO puntua (antes daba 1,0, el maximo)',
  API.norm([-187, 5, 10, 20], -187, false) === null);
chequear('el -187 tampoco ensucia el pool de los demas',
  API.norm([-187, 5, 10, 20], 5, false) === API.norm([5, 10, 20], 5, false));
chequear('el mas barato REAL sigue sacando 1,0',
  API.norm([5, 10, 20], 5, false) === 1);
chequear('un P/E de 0 tampoco puntua', API.norm([0, 5, 10], 0, false) === null);
chequear('en "mayor es mejor" un negativo SI puntua (un margen -5% es real)',
  API.norm([-5, 10, 20], -5, true) === 0);

// ── 2. El reemplazo entra solo cuando hace falta ────────────────────────────
console.log('\n2. El reemplazo entra solo cuando la propia no sirve');
const mRoe = API.FUND_METRICS.find(m => m.key === 'roe');
const mPb  = API.FUND_METRICS.find(m => m.key === 'pb');
const mDe  = API.FUND_METRICS.find(m => m.key === 'de');
const sano = { sector:'Technology', roe: 30, roa: 8, pb: 5, priceToSales: 3, de: 0.5, ndEbitda: 2 };
chequear('con ROE bueno usa ROE, no ROA',
  API.metricaEfectiva(sano, mRoe, 'Technology').campo === 'roe');
chequear('con P/B bueno usa P/B, no P/S',
  API.metricaEfectiva(sano, mPb, 'Technology').campo === 'pb');
const roto = { sector:'Technology', roe: null, roa: 8, pb: -20, priceToSales: 3, de: null, ndEbitda: 2 };
chequear('sin ROE cae a ROA y lo marca como alt',
  API.metricaEfectiva(roto, mRoe, 'Technology').campo === 'roa' &&
  API.metricaEfectiva(roto, mRoe, 'Technology').alt === true);
chequear('con P/B negativo cae a P/S',
  API.metricaEfectiva(roto, mPb, 'Technology').campo === 'priceToSales');
chequear('sin D/E cae a deuda neta/EBITDA',
  API.metricaEfectiva(roto, mDe, 'Technology').campo === 'ndEbitda');
const nada = { sector:'Technology', roe:null, roa:null, pb:-20, priceToSales:null, de:null, ndEbitda:null };
chequear('sin propia NI reemplazo devuelve campo null (no inventa)',
  API.metricaEfectiva(nada, mRoe, 'Technology').campo === null);

// ── 3. Un ROA no se compara contra ROEs ─────────────────────────────────────
console.log('\n3. Los pools no se mezclan (un ROA contra ROEs seria trampa)');
// grupo artificial: dos con ROE alto, uno solo con ROA. Si el ROA (8%) se
// comparara contra los ROEs (30% y 40%) saldria ultimo injustamente.
const g3 = [
  { symbol:'A', sector:'X', roe:30, roa:9,  netMargin:10, pe:10, pb:3, de:1, evEbitda:8 },
  { symbol:'B', sector:'X', roe:40, roa:11, netMargin:12, pe:12, pb:4, de:1, evEbitda:9 },
  { symbol:'C', sector:'X', roe:null, roa:10, netMargin:11, pe:11, pb:3.5, de:1, evEbitda:8.5 },
];
const r3 = API.puntuarGrupo(g3, 'X', API.norm);
const cC = r3.find(x => x.symbol === 'C');
chequear('C resuelve a ROA como reemplazo',
  API.metricaEfectiva(g3[2], mRoe, 'X').campo === 'roa');
// ⚠️ Este caso ANTES daba por bueno que C perdiera la metrica: el pool del
// reemplazo eran solo los que usan ROA, o sea uno, y norm devolvia null.
// Se descubrio probando sugerencias.js que eso esta MAL: el ROA existe para
// TODO el sector, no solo para los de patrimonio negativo. Ahora el pool es
// todo el sector, C puntua, y la cobertura no se pierde por ser el unico.
chequear('C SI puntua: su ROA se compara contra los ROA de todo el sector',
  cC.nUsed === 6, `nUsed=${cC.nUsed}`);
chequear('y lo marca como reemplazo', cC.usando.roe === 'roa', JSON.stringify(cC.usando));
// Lo que sigue prohibido: mezclar escalas. El ROA de C (10) NO se compara
// contra los ROE (30 y 40); si asi fuera, saldria ultimo.
chequear('el ROA de C no se compara contra los ROE (no sale ultimo por escala)',
  API.norm([9, 11, 10], 10, true) === 0.5, `${API.norm([9,11,10],10,true)}`);
chequear('B (ROA 11) le gana a C (ROA 10) dentro del pool de ROA',
  API.norm([9,11,10], 11, true) > API.norm([9,11,10], 10, true));

// ── 4. Bancos: "no aplica", distinto de "falta" ─────────────────────────────
console.log('\n4. Financials: no aplica != falta el dato');
const mEv = API.FUND_METRICS.find(m => m.key === 'evEbitda');
const jpm = idx['JPM'];
chequear('JPM: evEbitda marcado como noAplica',
  API.metricaEfectiva(jpm, mEv, 'Financials').noAplica === true);
// El D/E NO se oculta en Financials: el percentil es relativo al sector, asi
// que el D/E de un banco se compara contra el de otros bancos. Lo unico que se
// oculta es evEbitda, igual que SECTOR_OCULTAR en api/informe.py.
chequear('JPM: de NO se oculta (se compara contra otros bancos)',
  API.metricaEfectiva(jpm, mDe, 'Financials').noAplica === false);
chequear('JPM sin D/E propio NO cae a deuda neta/EBITDA (deuda neta negativa)',
  API.metricaEfectiva(jpm, mDe, 'Financials').campo === null);
const rFin = API.puntuarGrupo(porSector['Financials'], 'Financials', API.norm);
chequear('el denominador del badge baja a 5 en Financials (no 6)',
  rFin[0].nTotal === 5, `nTotal=${rFin[0].nTotal}`);
chequear('en Technology sigue siendo 6',
  API.puntuarGrupo(porSector['Technology'], 'Technology', API.norm)[0].nTotal === 6);

// ── 5. El score sigue siendo un promedio ponderado ──────────────────────────
console.log('\n5. El score es el promedio ponderado de lo que SI se uso');
const gTech = porSector['Technology'];
const rTech = API.puntuarGrupo(gTech, 'Technology', API.norm);
let malos = 0;
for (const r of rTech) {
  let sc = 0, tw = 0;
  const res = API.FUND_METRICS.map(m => ({ m, e: API.metricaEfectiva(r, m, 'Technology') }));
  for (const { m, e } of res) {
    if (e.campo == null) continue;
    // El pool es TODO el sector que tenga ese campo (ver el cambio del 28/08),
    // no solo los que lo usan como reemplazo.
    const vals = gTech.map(s => s[e.campo]);
    const n = API.norm(vals, e.valor, m.hb);
    if (n != null) { sc += n * m.w; tw += m.w; }
  }
  const esperado = tw > 0 ? (sc / tw) * 100 : 0;
  if (Math.abs(esperado - r.score) > 1e-9) malos++;
}
chequear('recalculado a mano, los 75 scores de Technology coinciden', malos === 0, `${malos} no coinciden`);
chequear('todos los scores caen entre 0 y 100',
  rTech.every(r => r.score >= 0 && r.score <= 100));

// ── 6. Los casos concretos ──────────────────────────────────────────────────
console.log('\n6. Los casos que reporto Marcos');
function fila(sym) {
  const s = idx[sym];
  const sec = s.sector;
  const out = {};
  for (const m of API.FUND_METRICS) {
    const e = API.metricaEfectiva(s, m, sec);
    out[m.key] = e.noAplica ? 'n/a' : e.campo == null ? '—'
      : `${e.valor.toFixed(2)}${e.alt ? ' (' + m.altLabel + ')' : ''}`;
  }
  return out;
}
for (const sym of ['MCD', 'BKNG', 'MO', 'PM', 'JPM', 'MAS', 'DVA']) {
  const f = fila(sym);
  console.log(`  ${sym.padEnd(5)} P/E ${f.pe.padStart(6)} | val ${f.pb.padStart(14)} | rent ${f.roe.padStart(14)} | deuda ${f.de.padStart(16)} | EV/EB ${f.evEbitda.padStart(7)}`);
}
chequear('MCD ya no muestra el P/B de -187 (usa P/S)',
  fila('MCD').pb.includes('P/S'));
chequear('MAS ya no tiene el ROE de 5862% (el bot lo anula por patrimonio negativo)',
  idx['MAS'].roe === null, `roe=${idx['MAS'].roe}`);
chequear('DVA ya no tiene el D/E de 12,42 fabricado por el abs()',
  idx['DVA'].de === null, `de=${idx['DVA'].de}`);
chequear('MCD recupera cobertura completa via reemplazos',
  API.puntuarGrupo(porSector['Consumer Discretionary'], 'Consumer Discretionary', API.norm)
     .find(x => x.symbol === 'MCD').nUsed === 6);

// ── Cobertura global ────────────────────────────────────────────────────────
console.log('\n7. Cobertura sobre las 504');
const conteo = {};
let conAlt = 0;
for (const [sec, g] of Object.entries(porSector)) {
  for (const r of API.puntuarGrupo(g, sec, API.norm)) {
    conteo[`${r.nUsed}/${r.nTotal}`] = (conteo[`${r.nUsed}/${r.nTotal}`] || 0) + 1;
    if (r.nAlt > 0) conAlt++;
  }
}
for (const k of Object.keys(conteo).sort()) console.log(`     ${k}: ${conteo[k]}`);
console.log(`     usan al menos un reemplazo: ${conAlt}`);
// FISV queda con 2 de 6 y aun asi puntua 99 -- ver el informe al respecto.
// Es un caso REAL que hay que decidir, no una falla del arreglo: se deja
// registrado para que la prueba avise si aparecen mas.
const pocas = Object.entries(conteo).filter(([k]) => +k.split('/')[0] <= 2);
chequear('a lo sumo UNA empresa con 2 metricas o menos (hoy: FISV)',
  pocas.reduce((a,[,v]) => a+v, 0) <= 1, JSON.stringify(pocas));

console.log(`\n${'-'.repeat(62)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones` : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
