// Prueba de la tabla ACTUAL vs OBJETIVO (planDePesos).
//
// LO QUE IMPORTA ACA: que la tabla que se imprime y el monto que el modelo
// recibe sean EL MISMO numero. Si `planDePesos()` recalculara algo por su
// cuenta, el informe diria "vender US$ 4.200" en la tabla y la tesis diria
// otra cosa dos parrafos mas abajo, y las dos sonarian igual de seguras.
//
// Corre la cadena REAL entera: analizarCartera -> analizarRiesgo (contra el
// historico de precios de verdad) -> planDePesos -> armarDatosTesis.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA = '/mnt/user-data/uploads/sp500-screener-yf/public/data/';
const SNAP = JSON.parse(fs.readFileSync(DATA + 'historico_precios.json', 'utf8'));

function cargar(archivo, extra = {}) {
  let src = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
  const ex = [];
  src = src.replace(/^export (async function|function|const|let) (\w+)/gm,
    (_, k, n) => { ex.push(n); return `${k} ${n}`; });
  src = src.replace(/^import .*$/gm, '');
  const sandbox = {
    console, Math, Object, Array, Number, Set, Map, JSON, isFinite, isNaN,
    Promise, fetch: async () => ({ ok: true, json: async () => SNAP }), ...extra,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return vm.runInContext(`({${ex.join(',')}})`, sandbox);
}

const Rg = cargar('riesgo.js');
// cartera.js no importa riesgo.js: recibe el resultado ya calculado. Se lo
// pasamos igual que lo hace Cartera.jsx.
const C = cargar('cartera.js');

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

// ── La cartera de la auditoria: AAPL pesa 30% y aporta el 60% del riesgo ────
function informe(t, nombre, sector, puntaje, etiqueta) {
  return {
    ticker: t, nombre, sector,
    veredicto: { puntaje, etiqueta,
      accion: etiqueta === 'compra' ? 'reforzar'
            : etiqueta === 'venta' ? 'sacar' : 'mantener' },
    riesgos: [],
    senales: [{ bloque: 'valuacion', titulo: 'Valuación', puntaje: 40, notas: ['x'] }],
    // clasificar() necesita esto para no mandar todo a `especulativo` (tope
    // 4,8%), que fue lo que hizo que la primera medicion diera cero.
    fundamentales: { marketCap: 900e9, pe: 24, roe: 30 },
    consenso: { beta: 1.05, upsidePct: 8 },
  };
}
const INFORMES = [
  informe('AAPL', 'Apple Inc.', 'Technology', 72, 'neutral'),
  informe('MSFT', 'Microsoft', 'Technology', 78, 'compra'),
  informe('KO', 'Coca-Cola', 'Consumer Staples', 61, 'neutral'),
  informe('JPM', 'JP Morgan', 'Financials', 66, 'neutral'),
  informe('XOM', 'Exxon', 'Energy', 44, 'neutral'),
];
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

(async () => {

const riesgo = await Rg.analizarRiesgo(cart, []);
chequear('el Motor B esta disponible sobre el historico real', riesgo.disponible,
  riesgo.motivo);

const plan = C.planDePesos(cart, riesgo);
console.log(`\nCartera: ${cart.activos.length} posiciones, `
          + `valor de referencia US$ ${plan.valorReferencia}\n`);
console.log('  ticker   pesa  deberia     Δ        monto   acc   riesgo  corr   que hacer');
for (const f of plan.filas) {
  console.log(`  ${f.ticker.padEnd(6)} ${String(f.peso).padStart(5)}% `
    + `${String(f.objetivo).padStart(7)}% ${String(f.delta).padStart(6)}pp `
    + `${(f.montoUSD == null ? '—' : 'US$ ' + f.montoUSD).padStart(11)} `
    + `${String(f.acciones ?? '—').padStart(4)} `
    + `${String(f.aporteRiesgo).padStart(6)}% ${String(f.correlacion).padStart(6)}  `
    + f.movimiento);
}
console.log(`\n  volatilidad: ${plan.volActual}% -> ${plan.volObjetivo}% `
          + `(mejora ${plan.mejoraVol} pts)`);
console.log(`  vender US$ ${plan.venderUSD} / comprar US$ ${plan.comprarUSD}\n`);

// ── 1. Los numeros NO se recalculan: salen de donde ya estaban ─────────────
console.log('1. Una sola fuente de verdad');
for (const f of plan.filas) {
  const a = cart.porTicker[f.ticker];
  const p = riesgo.posiciones.find(x => x.ticker === f.ticker);
  chequear(`${f.ticker}: el peso es el de analizarCartera`, f.peso === a.peso,
    `${f.peso} vs ${a.peso}`);
  chequear(`${f.ticker}: el objetivo es el de riesgo.js`,
    f.objetivo === p.peso_objetivo_pct, `${f.objetivo} vs ${p.peso_objetivo_pct}`);
  chequear(`${f.ticker}: el aporte al riesgo es el de riesgo.js`,
    f.aporteRiesgo === p.aporte_al_riesgo_pct);
}

// ── 2. La aritmetica del ajuste ───────────────────────────────────────────
console.log('\n2. Δ, monto y acciones');
for (const f of plan.filas) {
  chequear(`${f.ticker}: Δ = objetivo − peso`,
    Math.abs(f.delta - (f.objetivo - f.peso)) < 0.051,
    `${f.delta} vs ${f.objetivo - f.peso}`);
  if (f.montoUSD != null) {
    const esperado = f.delta / 100 * plan.valorReferencia;
    chequear(`${f.ticker}: monto = Δ% del valor de la cartera`,
      Math.abs(f.montoUSD - esperado) <= 1, `${f.montoUSD} vs ${esperado}`);
  }
  if (f.acciones != null && f.precio) {
    // Acciones ENTERAS y truncadas: nunca mas plata de la decidida.
    chequear(`${f.ticker}: las acciones son enteras y no exceden el monto`,
      Number.isInteger(f.acciones)
      && Math.abs(f.acciones * f.precio) <= Math.abs(f.montoUSD) + 0.01,
      `${f.acciones} x ${f.precio} vs ${f.montoUSD}`);
  }
}

// El denominador. Este es EL error que este archivo existe para no cometer:
// si el monto se calculara sobre lo analizado (45.000) en vez de sobre la
// cartera completa (60.000), cada ajuste saldria un 33% chico.
chequear('el monto usa la cartera COMPLETA, no solo lo analizado',
  plan.valorReferencia === cart.valorTotalCartera
  && plan.valorReferencia > cart.valorTotal,
  `${plan.valorReferencia} / analizado ${cart.valorTotal}`);

// ── 3. El umbral ──────────────────────────────────────────────────────────
console.log('\n3. El umbral de 1 punto porcentual');
for (const f of plan.filas) {
  const deberiaMover = Math.abs(f.delta) >= C.UMBRAL_AJUSTE_PP;
  chequear(`${f.ticker}: ${deberiaMover ? 'mueve' : 'queda igual'} (Δ ${f.delta}pp)`,
    (f.movimiento !== 'mantener') === deberiaMover);
  if (f.movimiento !== 'mantener') {
    chequear(`${f.ticker}: el signo del movimiento coincide con el signo de Δ`,
      (f.delta > 0) === (f.movimiento === 'comprar'));
  }
}

// ── 4. Lo que la tabla tiene que DECIR y el informe viejo no decia ─────────
console.log('\n4. La lectura que faltaba');
const aapl = plan.filas.find(f => f.ticker === 'AAPL');
chequear('AAPL aporta mucho mas riesgo que su peso, y esta marcado',
  aapl.aporteRiesgo > aapl.peso * 1.5 && aapl.concentraRiesgo === true,
  `peso ${aapl.peso}% / riesgo ${aapl.aporteRiesgo}%`);
chequear('y el objetivo lo baja',
  aapl.objetivo < aapl.peso, `${aapl.objetivo} vs ${aapl.peso}`);
chequear('ejecutar el plan baja la volatilidad',
  plan.mejoraVol > 0, `${plan.mejoraVol} pts`);
chequear('las filas vienen ordenadas por tamano del ajuste',
  plan.filas.every((f, i) =>
    i === 0 || Math.abs(plan.filas[i - 1].delta) >= Math.abs(f.delta)));
chequear('la correlacion media viaja en cada fila',
  plan.filas.every(f => f.correlacion != null));

// ── 5. Sin Motor B, la seccion no se dibuja (no rompe el informe) ──────────
console.log('\n5. Degradado cuando no hay historico');
chequear('sin riesgo -> null (la seccion no se dibuja)',
  C.planDePesos(cart, null) === null);
chequear('con riesgo no disponible -> null',
  C.planDePesos(cart, { disponible: false, motivo: 'x' }) === null);
chequear('sin cartera -> null', C.planDePesos(null, riesgo) === null);

// ── 6. El puente al prompt: mismos numeros en la tabla y en el payload ─────
console.log('\n6. La tabla y el prompt dicen lo mismo');
const datos = C.armarDatosTesis(cart, C.stressTest(cart), [], {}, riesgo);
chequear('el payload trae el bloque `plan`', datos.plan != null);
chequear('la cantidad de movimientos coincide',
  datos.plan.movimientos.length === plan.nMovimientos,
  `${datos.plan.movimientos.length} vs ${plan.nMovimientos}`);
for (const m of datos.plan.movimientos) {
  const f = plan.filas.find(x => x.ticker === m.ticker);
  chequear(`${m.ticker}: el monto del prompt es el de la tabla`,
    m.monto_usd === f.montoUSD, `${m.monto_usd} vs ${f.montoUSD}`);
  chequear(`${m.ticker}: el destino del prompt es el de la tabla`,
    m.a_pct === f.objetivo);
}
chequear('solo viajan los movimientos, no las 5 posiciones',
  datos.plan.movimientos.length < plan.filas.length,
  `${datos.plan.movimientos.length} de ${plan.filas.length}`);
chequear('la mejora de volatilidad viaja al prompt',
  datos.plan.mejora_puntos === plan.mejoraVol);

// ── 7. Costo ──────────────────────────────────────────────────────────────
console.log('\n7. Lo que suma al payload');
const tok = Math.round(JSON.stringify(datos.plan).length / 4);
console.log(`     el bloque \`plan\` son ~${tok} tokens`);
chequear('el bloque plan es barato', tok < 300, `${tok} tokens`);

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);

})();
