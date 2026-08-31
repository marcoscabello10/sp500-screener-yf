// Prueba del UNIVERSO OPERABLE (universo.js).
//
// LO QUE IMPORTA ACA: que unir dos fuentes no invente ni pierda nada.
//
// Una fusion mal hecha no da error: da una lista con 130 papeles cuyo P/S se
// llama `priceSales` en vez de `priceToSales`, y esos 130 puntuan mas bajo para
// siempre sin una sola linea en la consola. Por eso las comprobaciones de acá
// son sobre los NOMBRES de los campos y sobre el conteo, no sobre el resultado.
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

const U = cargar('universo.js');
const S = cargar('sugerencias.js');

const FUND = JSON.parse(fs.readFileSync(DATA + 'sp500_fundamentals.json', 'utf8'));
const DET = JSON.parse(fs.readFileSync(DATA + 'informe_detalle.json', 'utf8'));

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

const u = U.armarUniverso(FUND.stocks, DET.activos);
const r = u.resumen;
console.log(`\nUniverso: ${r.total} papeles (${r.delScreener} del screener + `
          + `${r.deAfuera} del detalle) · ${r.operables} operables\n`);

// ── 1. No se pierde ni se duplica nadie ───────────────────────────────────
console.log('1. La union no pierde ni duplica');
const syms = u.todos.map(s => s.symbol);
chequear('no hay simbolos repetidos',
  new Set(syms).size === syms.length,
  `${syms.length} filas, ${new Set(syms).size} unicos`);
chequear('estan TODAS las del screener',
  FUND.stocks.every(s => u.porSymbol[s.symbol]));
const fuera = Object.keys(DET.activos)
  .filter(k => !FUND.stocks.some(s => s.symbol === k) && DET.activos[k].sector);
chequear(`estan los ${fuera.length} del detalle que no son del indice`,
  fuera.every(k => u.porSymbol[k]));
chequear('los operables son un subconjunto del total',
  u.operables.every(s => u.porSymbol[s.symbol]));
chequear('todo operable tiene CEDEAR y sector',
  u.operables.every(s => s.hasCedear && s.sector));

// ── 2. El screener manda sobre sus propios papeles ────────────────────────
console.log('\n2. Quien gana cuando un simbolo esta en las dos fuentes');
const enAmbas = FUND.stocks.filter(s => DET.activos[s.symbol]).map(s => s.symbol);
console.log(`     ${enAmbas.length} simbolos estan en las dos`);
let difs = 0;
for (const sym of enAmbas) {
  const orig = FUND.stocks.find(s => s.symbol === sym);
  const fus = u.porSymbol[sym];
  for (const campo of ['pe', 'pb', 'roe', 'de', 'evEbitda', 'netMargin', 'sector']) {
    if (orig[campo] !== fus[campo]) difs++;
  }
}
chequear('ningun numero del screener fue pisado por el detalle', difs === 0,
  `${difs} campos distintos`);
chequear('la fuente queda marcada',
  u.porSymbol.AAPL.fuente === 'screener'
  && (u.porSymbol[fuera[0]] || {}).fuente === 'detalle');

// ── 3. Los campos se llaman IGUAL en las dos fuentes ──────────────────────
// Este es el bloque que justifica el archivo. Un campo con otro nombre no
// rompe: puntua mas bajo, calladito, para siempre.
console.log('\n3. Los nombres de campo coinciden (el error que no avisa)');
const CAMPOS = ['symbol', 'name', 'sector', 'pe', 'pb', 'roe', 'de', 'evEbitda',
                'netMargin', 'roa', 'priceToSales', 'ndEbitda', 'marketCap',
                'hasCedear'];
const unoDeAfuera = u.porSymbol[fuera[0]];
for (const c of CAMPOS) {
  chequear(`"${c}" existe en los dos lados`,
    c in u.porSymbol.AAPL && c in unoDeAfuera);
}

// ── 4. Las reglas de datos se respetan ────────────────────────────────────
console.log('\n4. Patrimonio negativo y DN/EBITDA');
const negs = u.todos.filter(s => s.pb != null && s.pb < 0);
chequear(`los ${negs.length} con patrimonio negativo no traen ROE ni D/E`,
  negs.every(s => s.roe == null && s.de == null),
  negs.filter(s => s.roe != null || s.de != null).map(s => s.symbol).join(','));
chequear('y quedan marcados con patrimonioNegativo',
  negs.every(s => s.patrimonioNegativo === true));
// ⚠️ Acá la primera version de esta prueba exigia "mas de 80" y fallaba con 64.
// El codigo estaba BIEN y la expectativa mal: de los 130 de afuera, 30 tienen
// CAJA neta (netDebt <= 0) y 21 tienen EBITDA negativo. En los dos casos el
// numero no significa nada y null es la respuesta correcta, no un agujero.
// Un umbral inventado convierte un acierto en una falla; la regla, no.
const deAfueraTodos = u.todos.filter(s => s.fuente === 'detalle');
let deberian = 0, malos = [];
for (const s of deAfueraTodos) {
  const c = (DET.activos[s.symbol] || {}).consenso || {};
  const corresponde = c.netDebt > 0 && c.ebitda > 0;
  if (corresponde) deberian++;
  if (corresponde !== (s.ndEbitda != null)) malos.push(s.symbol);
}
chequear(`DN/EBITDA esta calculado exactamente donde corresponde `
       + `(${deberian} de ${deAfueraTodos.length})`,
  malos.length === 0, malos.slice(0, 8).join(','));
chequear('con caja neta o EBITDA negativo el campo queda en null, no en cero',
  deAfueraTodos.every(s => s.ndEbitda == null || s.ndEbitda > 0));

// ── 5. Lo que esto cambia de verdad: los candidatos ───────────────────────
console.log('\n5. El efecto medible: cuantos candidatos aparecen');
const enCartera = ['AAPL', 'MSFT', 'KO', 'JPM', 'XOM'];
const scoresViejo = S.scoresPorSector(FUND.stocks);
const candViejo = S.candidatosRotacion(FUND.stocks, scoresViejo, enCartera);
const scoresNuevo = S.scoresPorSector(u.todos);
const candNuevo = S.candidatosRotacion(u.operables, scoresNuevo, enCartera);
const viejos = new Set(candViejo.map(c => c.ticker));
const nuevos = candNuevo.filter(c => !viejos.has(c.ticker));
console.log(`     ${candViejo.length} candidatos antes -> ${candNuevo.length} `
          + `ahora, ${nuevos.length} nuevos`);
chequear('aparecen candidatos que antes no podian existir',
  nuevos.length >= 15, `solo ${nuevos.length}`);
chequear('todos los candidatos se pueden comprar como CEDEAR',
  candNuevo.every(c => u.porSymbol[c.ticker]?.hasCedear));
chequear('ninguno de los de la cartera se ofrece como candidato',
  candNuevo.every(c => !enCartera.includes(c.ticker)));
// Reproducibilidad: dos corridas con los mismos datos, el mismo documento.
const otra = S.candidatosRotacion(u.operables, S.scoresPorSector(u.todos), enCartera);
chequear('dos corridas dan exactamente la misma lista',
  JSON.stringify(otra) === JSON.stringify(candNuevo));

// ── 6. Ampliar el pool no rompe los puntajes que ya existian ──────────────
console.log('\n6. Cuanto se mueven los puntajes del S&P al ampliar el pool');
const movs = [];
for (const s of FUND.stocks) {
  const a = scoresViejo[s.symbol]?.score, b = scoresNuevo[s.symbol]?.score;
  if (a != null && b != null) movs.push(Math.abs(b - a));
}
movs.sort((x, y) => x - y);
const med = movs[Math.floor(movs.length / 2)];
const p90 = movs[Math.floor(movs.length * 0.9)];
console.log(`     mediana ${med.toFixed(1)} pts · p90 ${p90.toFixed(1)} pts · `
          + `maximo ${movs[movs.length - 1].toFixed(1)} pts`);
// El pool crece de 504 a 634 con empresas REALMENTE comparables (mineras en
// Materials, bancos europeos en Financials), asi que algo tiene que moverse:
// un cambio de CERO significaria que los papeles nuevos no entraron al pool.
chequear('los puntajes SE mueven (si no, los nuevos no entraron al pool)',
  med > 0, `mediana ${med}`);
chequear('pero el movimiento tipico es chico (< 2 pts)', med < 2, `${med}`);
chequear('y el p90 se mantiene razonable (< 5 pts)', p90 < 5, `${p90}`);

// ── 7. Degradado: sin detalle, todo sigue andando ─────────────────────────
console.log('\n7. Si informe_detalle.json no esta');
const solo = U.armarUniverso(FUND.stocks, null);
chequear('sin detalle no rompe', solo.todos.length === FUND.stocks.length);
chequear('y los operables son los del screener con CEDEAR',
  solo.operables.length > 100 && solo.operables.every(s => s.hasCedear),
  `${solo.operables.length}`);
chequear('sin nada devuelve vacio, no explota',
  U.armarUniverso(null, null).todos.length === 0);

// ── 8. Los sectores sin alternativa se nombran ────────────────────────────
console.log('\n8. Donde NO hay de donde elegir');
console.log(`     sectores sin alternativa: `
          + `${r.sectoresSinAlternativa.join(', ') || '(ninguno)'}`);
for (const s of r.sectores) {
  console.log(`       ${s.sector.padEnd(24)} ${String(s.n).padStart(3)}`
            + (s.suficiente ? '' : '   <- menos de 3'));
}
chequear('los sectores del resumen suman los operables',
  r.sectores.reduce((a, s) => a + s.n, 0) === r.operables);
chequear('un sector con menos de 3 operables queda marcado',
  r.sectores.every(s => s.suficiente === (s.n >= U.MIN_PARA_ROTAR)));

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
