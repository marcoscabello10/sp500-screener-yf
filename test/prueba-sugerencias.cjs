// Prueba de sugerencias.js despues de ponerlo al dia con F1.
//
// Importa el modulo REAL (no una copia) y lo corre sobre el snapshot de 504
// empresas. Verifica lo que cambio y, sobre todo, que siga coincidiendo con F1:
// el motivo de este cambio era justamente que los dos criterios divergian.
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


const FUND = JSON.parse(fs.readFileSync(DATA + 'sp500_fundamentals.json', 'utf8'));
const CONS = JSON.parse(fs.readFileSync(DATA + 'informe_consenso.json', 'utf8')).consenso;

// ── Cargar sugerencias.js (ESM) en un sandbox, sin build ────────────────────
function cargarESM(archivo) {
  let src = fs.readFileSync(ruta(archivo), 'utf8');
  const exportados = [];
  src = src.replace(/^export (function|const) (\w+)/gm, (_, kind, name) => {
    exportados.push(name); return `${kind} ${name}`;
  });
  const sandbox = { console, Math, Object, Array, Number, Set, Map, JSON, isNaN };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return vm.runInContext(`({${exportados.join(',')}})`, sandbox);
}
const S = cargarESM('sugerencias.js');

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

// El snapshot tal como lo deja el bot parcheado (roe/de anulados si el
// patrimonio es negativo, mas ndEbitda).
const STOCKS = FUND.stocks.filter(s => s.sector).map(s => {
  const c = CONS[s.symbol] || {};
  const neg = s.pb != null && s.pb < 0;
  let nde = null;
  if (c.netDebt > 0 && c.ebitda > 0) nde = Math.round(c.netDebt / c.ebitda * 1000) / 1000;
  return { ...s, roe: neg ? null : s.roe, de: neg ? null : s.de, ndEbitda: nde };
});
const idx = Object.fromEntries(STOCKS.map(s => [s.symbol, s]));

console.log(`Snapshot: ${STOCKS.length} empresas\n`);
const scores = S.scoresPorSector(STOCKS);

// ── 1. La forma nueva ───────────────────────────────────────────────────────
console.log('1. scoresPorSector devuelve cobertura, no solo el numero');
const aapl = scores['AAPL'];
chequear('devuelve un objeto con score/nUsadas/nAplicables/reemplazos',
  aapl && typeof aapl === 'object' && 'score' in aapl && 'nUsadas' in aapl
       && 'nAplicables' in aapl && Array.isArray(aapl.reemplazos),
  JSON.stringify(aapl));
chequear('AAPL usa las 6 y sin reemplazos',
  aapl.nUsadas === 6 && aapl.reemplazos.length === 0,
  JSON.stringify(aapl));
chequear('todos los scores no nulos caen entre 0 y 100',
  Object.values(scores).every(v => v.score == null || (v.score >= 0 && v.score <= 100)));

// ── 2. El promedio es PONDERADO, no simple ──────────────────────────────────
console.log('\n2. El promedio es ponderado (era simple: ese era el bug)');
// Se recalcula a mano el de un papel con las 6 metricas y se compara.
const PESOS = { pe:0.20, pb:0.15, roe:0.22, de:0.13, evEbitda:0.15, netMargin:0.15 };
const MENOR = { pe:1, pb:1, de:1, evEbitda:1 };
function pctManual(valor, col, menor) {
  let v = col.filter(x => x != null && !isNaN(x));
  if (menor) { v = v.filter(x => x > 0); if (valor == null || valor <= 0) return null; }
  if (valor == null || v.length < 5) return null;
  const p = v.filter(x => x < valor).length / v.length * 100;
  return menor ? 100 - p : p;
}
const tech = STOCKS.filter(s => s.sector === 'Technology');
let mal = 0, simpleIgual = 0;
for (const s of tech) {
  if (scores[s.symbol].score == null || scores[s.symbol].reemplazos.length) continue;
  let suma = 0, pu = 0, ps = [];
  for (const k of Object.keys(PESOS)) {
    const p = pctManual(s[k], tech.map(x => x[k]), !!MENOR[k]);
    if (p == null) continue;
    suma += p * PESOS[k]; pu += PESOS[k]; ps.push(p);
  }
  const pond = Math.round((suma / pu) * 10) / 10;
  const simple = Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 10) / 10;
  if (Math.abs(pond - scores[s.symbol].score) > 0.11) mal++;
  if (Math.abs(pond - simple) < 0.05) simpleIgual++;
}
chequear('el score coincide con el ponderado recalculado a mano', mal === 0, `${mal} no coinciden`);
chequear('y el ponderado DIFIERE del simple (o sea que el cambio hace algo)',
  simpleIgual < tech.length * 0.5, `${simpleIgual} iguales de ${tech.length}`);

// ── 3. Los reemplazos entran ────────────────────────────────────────────────
console.log('\n3. Patrimonio negativo: se sustituye en vez de perder la metrica');
for (const t of ['MCD', 'BKNG', 'MO', 'PM']) {
  const v = scores[t];
  chequear(`${t} usa reemplazos (${(v.reemplazos || []).join(' ') || 'NINGUNO'})`,
    v.reemplazos.length >= 2, JSON.stringify(v));
  chequear(`${t} recupera cobertura (${v.nUsadas}/${v.nAplicables})`, v.nUsadas >= 5);
}
chequear('AAPL, que no lo necesita, NO usa ningun reemplazo',
  scores['AAPL'].reemplazos.length === 0);

// ── 4. Bancos: evEbitda no aplica ───────────────────────────────────────────
console.log('\n4. Financials: evEbitda no aplica, el denominador baja a 5');
chequear('JPM tiene 5 aplicables, no 6',
  scores['JPM'].nAplicables === 5, `${scores['JPM'].nAplicables}`);
chequear('AAPL sigue con 6', scores['AAPL'].nAplicables === 6);

// ── 5. El pool de candidatos ────────────────────────────────────────────────
console.log('\n5. candidatosRotacion');
const cart = ['AAPL', 'MSFT', 'KO', 'JPM', 'XOM'];
const cand = S.candidatosRotacion(STOCKS, scores, cart);
console.log(`   ${cand.length} candidatos (tope ${S.CANDIDATOS_POR_SECTOR} por sector)`);
const porSec = {};
for (const c of cand) (porSec[c.sector] ||= []).push(c.ticker);
for (const [sec, l] of Object.entries(porSec)) console.log(`     ${sec.padEnd(24)} ${l.join(' ')}`);

chequear('ningun candidato esta ya en la cartera',
  !cand.some(c => cart.includes(c.ticker)),
  cand.filter(c => cart.includes(c.ticker)).map(c => c.ticker).join(','));
chequear('ningun sector supera el tope',
  Object.values(porSec).every(l => l.length <= S.CANDIDATOS_POR_SECTOR),
  JSON.stringify(Object.fromEntries(Object.entries(porSec).map(([k, v]) => [k, v.length]))));
chequear('todos tienen CEDEAR', cand.every(c => idx[c.ticker].hasCedear));
chequear('todos traen puntaje y cobertura',
  cand.every(c => c.puntaje != null && /^\d+\/\d+$/.test(c.metricas)));
chequear('dentro de cada sector vienen de mayor a menor puntaje',
  Object.keys(porSec).every(sec => {
    const l = cand.filter(c => c.sector === sec).map(c => c.puntaje);
    return l.every((v, i) => i === 0 || l[i - 1] >= v);
  }));
// Determinismo: dos corridas identicas tienen que dar el mismo documento.
chequear('dos corridas dan exactamente lo mismo (hay desempate alfabetico)',
  JSON.stringify(S.candidatosRotacion(STOCKS, scores, cart)) === JSON.stringify(cand));

// Excluir ANTES de cortar: si el cliente tiene 3 del top 5 de un sector,
// igual tienen que quedar 5 candidatos reales de ese sector.
const techTop = cand.filter(c => c.sector === 'Technology').map(c => c.ticker);
const cand2 = S.candidatosRotacion(STOCKS, scores, [...cart, ...techTop.slice(0, 3)]);
const tech2 = cand2.filter(c => c.sector === 'Technology');
chequear('al excluir 3 de Technology siguen quedando 5 (se excluye ANTES de cortar)',
  tech2.length === 5, `${tech2.length}`);
chequear('y los 3 excluidos no reaparecen',
  !tech2.some(c => techTop.slice(0, 3).includes(c.ticker)));

// ── 6. sugerirReemplazos sigue andando con la forma nueva ───────────────────
console.log('\n6. sugerirReemplazos con la forma nueva de `scores`');
const r = S.sugerirReemplazos('XOM', STOCKS, scores, cart, [], 'Energy');
chequear('devuelve un reemplazo del mismo sector', r.mismoSector != null);
chequear('devuelve uno de otro sector', r.otroSector != null);
chequear('el puntaje es un NUMERO, no un objeto (era el riesgo del cambio)',
  typeof r.mismoSector.score === 'number', JSON.stringify(r.mismoSector.score));
chequear('y trae la cobertura del candidato',
  /^\d+\/\d+$/.test(r.mismoSector.metricas), r.mismoSector.metricas);
chequear('el del mismo sector es de Energy', r.mismoSector.sector === 'Energy');
chequear('el de otro sector NO es de Energy', r.otroSector.sector !== 'Energy');
console.log(`     XOM -> mismo sector: ${r.mismoSector.symbol} (${r.mismoSector.score}, ${r.mismoSector.metricas})`);
console.log(`            otro sector:  ${r.otroSector.symbol} (${r.otroSector.score}, ${r.otroSector.metricas}) [${r.otroSector.sector}]`);

// ── 7. Coste en tokens: por eso se recorta ──────────────────────────────────
console.log('\n7. Lo que se ahorra recortando por sector');
const todos = S.candidatosRotacion(STOCKS, scores, cart, 999);
const tok = n => Math.round(JSON.stringify(n).length / 4);
console.log(`   todos los CEDEAR: ${todos.length} papeles, ~${tok(todos)} tokens`);
console.log(`   top ${S.CANDIDATOS_POR_SECTOR} por sector: ${cand.length} papeles, ~${tok(cand)} tokens`);
console.log(`   ahorro por llamada: ~${tok(todos) - tok(cand)} tokens`);
chequear('el recorte ahorra al menos la mitad', tok(cand) < tok(todos) * 0.5);

console.log(`\n${'-'.repeat(62)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones` : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
