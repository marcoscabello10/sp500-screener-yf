// Prueba del lector de snapshot de la fase B2.
//
// Extrae snapshotBajar/snapshotHistorico y calcRisk/toDailyRet/buildSpyMap/
// alignedRet de App.jsx SIN copiarlos a mano (copiarlos haria que la prueba
// verifique una copia y no el codigo que corre). Les da el snapshot REAL de la
// PC de Marcos y comprueba:
//
//   1. que expanda a la forma [{date, close}] ascendente que espera toDailyRet
//   2. que saltee los null en vez de rellenarlos
//   3. que recorte por `from`
//   4. que el interruptor se caiga a Twelve Data en cada motivo previsto
//   5. que los numeros que salen sean los ya comparados contra F2 el 27/08
//
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'App.jsx'), 'utf8');
const SNAP = JSON.parse(fs.readFileSync(
  '/mnt/user-data/uploads/sp500-screener-yf/public/data/historico_precios.json', 'utf8'));

// ── Extraer las funciones reales del archivo ────────────────────────────────
// Saca una funcion de nivel superior por nombre: desde `function NOMBRE` hasta
// la llave de cierre en columna 0. Asi la prueba corre el codigo REAL; copiarlo
// a mano verificaria una copia y no lo que se despliega.
function fn(nombre) {
  const re = new RegExp(`^(async )?function ${nombre}\\b`, 'm');
  const m = SRC.match(re);
  if (!m) throw new Error(`no encuentro function ${nombre} en App.jsx`);
  const a = m.index;
  const b = SRC.indexOf('\n}\n', a);
  if (b < 0) throw new Error(`no encuentro el cierre de ${nombre}`);
  return SRC.slice(a, b + 3);
}
// Idem para un `const NOMBRE = ...;` de una linea.
function konst(nombre) {
  const re = new RegExp(`^(let|const) ${nombre}\\b[^\\n]*`, 'm');
  const m = SRC.match(re);
  if (!m) throw new Error(`no encuentro ${nombre} en App.jsx`);
  return m[0];
}

const codigo = [
  konst('SNAP_URL'), konst('SNAP_MAX_DIAS'), konst('SNAP_MIN_COBERT'), konst('_snapMem'),
  fn('snapshotBajar'), fn('snapshotHistorico'),
  fn('toDailyRet'), fn('buildSpyMap'), fn('alignedRet'), fn('calcRisk'),
].join('\n\n');

let fetchRespuesta = { ok: true, json: async () => SNAP };
let fetchLlamadas = [];
const sandbox = {
  console,
  fetch: async (url, opts) => { fetchLlamadas.push({ url, opts }); return fetchRespuesta; },
  Date, Math, JSON, Array, Object, Number, isFinite, parseFloat,
};
const vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(codigo + '\n;({snapshotHistorico, snapshotBajar, toDailyRet, buildSpyMap, alignedRet, calcRisk, SNAP_MAX_DIAS, _reset: () => { _snapMem = null; }})',
  sandbox);
const API = vm.runInContext(
  '({snapshotHistorico, toDailyRet, buildSpyMap, alignedRet, calcRisk, SNAP_MAX_DIAS, _reset: () => { _snapMem = null; }})',
  sandbox);

// ── Utilidades de la prueba ─────────────────────────────────────────────────
let ok = 0, fail = 0;
function chequear(nombre, cond, detalle) {
  if (cond) { ok++; console.log(`  ok   ${nombre}`); }
  else { fail++; console.log(`  FALLA ${nombre}${detalle ? ' — ' + detalle : ''}`); }
}
const motivos = [];
const anotar = (m) => motivos.push(m);

// El snapshot real es de una fecha fija; si no se toca, con el correr de los
// dias la prueba empezaria a fallar por vencimiento y no por un error. Se le
// pone fecha de hoy para las pruebas que no son sobre el vencimiento.
function conFecha(dias) {
  return { ...SNAP, generated_at: new Date(Date.now() - dias * 86400000).toISOString() };
}

async function main() {
  const simbolos = Object.keys(SNAP.series).filter(s => s !== 'SPY');
  console.log(`Snapshot real: ${SNAP.n_simbolos} simbolos x ${SNAP.n_fechas} fechas, desde ${SNAP.desde}`);
  console.log(`Simbolos: ${simbolos.join(' ')}\n`);

  // ── 1. Camino feliz ───────────────────────────────────────────────────────
  console.log('1. Expansion del snapshot');
  fetchRespuesta = { ok: true, json: async () => conFecha(1) };
  API._reset();
  const r = await API.snapshotHistorico(SNAP.desde, simbolos, anotar);
  chequear('devuelve algo (no cae a Twelve Data)', r != null, motivos.join(' | '));
  if (!r) { resumen(); return; }

  chequear('trae SPY', Array.isArray(r.spyPrices) && r.spyPrices.length > 0);
  chequear('trae todos los simbolos pedidos',
    simbolos.every(s => Array.isArray(r.hist[s])),
    `faltan ${simbolos.filter(s => !r.hist[s]).join(',')}`);

  const spy = r.spyPrices;
  chequear('la forma es {date, close}',
    spy[0] && typeof spy[0].date === 'string' && typeof spy[0].close === 'number',
    JSON.stringify(spy[0]));
  chequear('las fechas van ASCENDENTES (toDailyRet lo exige)',
    spy[0].date < spy[spy.length - 1].date,
    `${spy[0].date} .. ${spy[spy.length-1].date}`);
  let desordenadas = 0;
  for (let i = 1; i < spy.length; i++) if (spy[i].date <= spy[i-1].date) desordenadas++;
  chequear('ninguna fecha fuera de orden', desordenadas === 0, `${desordenadas} fuera de orden`);
  chequear('ningun close null (los null se saltean, no se rellenan)',
    spy.every(d => d.close != null && isFinite(d.close)));

  // ── 2. Los null se saltean, no se rellenan ────────────────────────────────
  console.log('\n2. Manejo de null (dias en que el papel no cotizaba)');
  const conNulos = {
    ...conFecha(1),
    fechas: ['2020-01-02', '2020-01-03', '2020-01-06', '2020-01-07'],
    series: { SPY: [100, 101, 102, 103], NUEVA: [null, null, 50, 55] },
    desde: '2020-01-01',
  };
  fetchRespuesta = { ok: true, json: async () => conNulos };
  API._reset();
  const r2 = await API.snapshotHistorico('2020-01-01', ['NUEVA'], anotar);
  chequear('la serie con null queda con 2 puntos, no 4',
    r2 && r2.hist.NUEVA.length === 2, r2 ? `largo ${r2.hist.NUEVA.length}` : 'null');
  chequear('el primer punto es el primer dia que SI cotizo',
    r2 && r2.hist.NUEVA[0].date === '2020-01-06');
  const ret = API.toDailyRet(r2.hist.NUEVA);
  chequear('toDailyRet da 1 retorno, no 3 (rellenar habria dado retornos de 0%)',
    ret.length === 1, `${ret.length} retornos`);
  chequear('ese retorno es el real (50 -> 55 = +10%)',
    Math.abs(ret[0].r - 0.10) < 1e-9, `${ret[0].r}`);

  // ── 3. Recorte por `from` ─────────────────────────────────────────────────
  console.log('\n3. Recorte por el periodo pedido');
  fetchRespuesta = { ok: true, json: async () => conFecha(1) };
  API._reset();
  const r3 = await API.snapshotHistorico('2024-01-01', simbolos, anotar);
  chequear('no devuelve nada anterior al from pedido',
    r3 && r3.spyPrices.every(d => d.date >= '2024-01-01'),
    r3 ? r3.spyPrices[0].date : 'null');
  chequear('el recorte achica de verdad la serie',
    r3 && r3.spyPrices.length < spy.length,
    r3 ? `${r3.spyPrices.length} vs ${spy.length}` : '');

  // ── 4. El interruptor: cada motivo de caida a Twelve Data ─────────────────
  console.log('\n4. Interruptor — cae a la fuente vieja cuando corresponde');

  const casos = [
    ['archivo que no esta (404)',        () => { fetchRespuesta = { ok: false, json: async () => ({}) }; },      SNAP.desde, simbolos],
    ['fetch que explota',                () => { fetchRespuesta = null; },                                        SNAP.desde, simbolos],
    ['JSON sin la forma esperada',       () => { fetchRespuesta = { ok: true, json: async () => ({hola: 1}) }; }, SNAP.desde, simbolos],
    ['snapshot vencido (60 dias)',       () => { fetchRespuesta = { ok: true, json: async () => conFecha(60) }; },SNAP.desde, simbolos],
    ['snapshot sin generated_at',        () => { const s = {...conFecha(1)}; delete s.generated_at; fetchRespuesta = { ok: true, json: async () => s }; }, SNAP.desde, simbolos],
    ['snapshot sin SPY',                 () => { const s = {...conFecha(1), series: {...conFecha(1).series}}; delete s.series.SPY; fetchRespuesta = { ok: true, json: async () => s }; }, SNAP.desde, simbolos],
    ['pide mas historia de la que hay',  () => { fetchRespuesta = { ok: true, json: async () => conFecha(1) }; }, '2000-01-01', simbolos],
    ['cobertura insuficiente',           () => { fetchRespuesta = { ok: true, json: async () => conFecha(1) }; }, SNAP.desde, [...simbolos, 'XXXA','XXXB','XXXC','XXXD','XXXE','XXXF','XXXG','XXXH','XXXI','XXXJ']],
  ];

  for (const [nombre, preparar, from, syms] of casos) {
    preparar();
    if (fetchRespuesta === null) {
      sandbox.fetch = async () => { throw new Error('sin red'); };
    } else {
      sandbox.fetch = async (url, opts) => { fetchLlamadas.push({url, opts}); return fetchRespuesta; };
    }
    API._reset();
    motivos.length = 0;
    let res;
    try { res = await API.snapshotHistorico(from, syms, anotar); }
    catch (e) { res = `EXCEPCION: ${e.message}`; }
    chequear(`cae a Twelve Data: ${nombre}`, res === null,
      typeof res === 'string' ? res : (res ? 'uso el snapshot igual' : ''));
    chequear(`  ...y explica por que`, motivos.length === 1, motivos.join(' | '));
    if (motivos.length) console.log(`         motivo: "${motivos[0]}"`);
  }

  // ── 5. Los numeros ya comparados contra F2 ────────────────────────────────
  console.log('\n5. Los numeros salen como los comparados contra F2 el 27/08');
  sandbox.fetch = async () => ({ ok: true, json: async () => conFecha(1) });
  API._reset();
  const rf = 0.04;   // calcRisk espera fraccion, no porcentaje
  const r5 = await API.snapshotHistorico(SNAP.desde, simbolos, anotar);
  const spyMap = API.buildSpyMap(r5.spyPrices);
  const spyAl = Object.keys(spyMap).sort().map(d => ({ s: spyMap[d], m: spyMap[d] }));

  const esperado = {
    'SPY 3Y': { d: 756, ret: 22.26, vol: 15.33, beta: 1.00 },
    'SPY 5Y': { d: 1260, ret: 13.41, vol: 17.17, beta: 1.00 },
    'JPM 3Y': { d: 756, ret: 37.34, vol: 22.96, beta: 0.86 },
    'JPM 5Y': { d: 1260, ret: 21.13, vol: 24.38, beta: 0.88 },
  };
  for (const [nombre, e] of Object.entries(esperado)) {
    const [sym, ] = nombre.split(' ');
    const al = sym === 'SPY' ? spyAl.slice(-e.d)
                             : API.alignedRet(r5.hist[sym], spyMap).slice(-e.d);
    const m = API.calcRisk(al, rf);
    if (!m) { chequear(nombre, false, 'calcRisk devolvio null'); continue; }
    const cerca = (a, b, tol) => Math.abs(a - b) <= tol;
    chequear(`${nombre} retorno ${m.annRet.toFixed(2)}% (esperado ${e.ret})`, cerca(m.annRet, e.ret, 0.05));
    chequear(`${nombre} volatilidad ${m.sVol.toFixed(2)}% (esperado ${e.vol})`, cerca(m.sVol, e.vol, 0.05));
    chequear(`${nombre} beta ${m.beta.toFixed(2)} (esperado ${e.beta})`, cerca(m.beta, e.beta, 0.01));
  }

  resumen();
}

function resumen() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(fail === 0 ? `TODO BIEN — ${ok} comprobaciones` : `${fail} FALLAS de ${ok + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('La prueba exploto:', e); process.exit(1); });
