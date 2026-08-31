// Prueba del Motor B (riesgo.js).
//
// Corre el modulo REAL contra el historico de precios REAL, y compara los
// resultados con los numeros que se calcularon a mano en la auditoria. Si el
// modulo dice algo distinto de lo que dio la cuenta hecha aparte, uno de los
// dos esta mal y hay que saberlo antes de que salga en un informe.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA = '/mnt/user-data/uploads/sp500-screener-yf/public/data/';
const SNAP = JSON.parse(fs.readFileSync(DATA + 'historico_precios.json', 'utf8'));

// `riesgo.js` usa fetch para bajar el historico. Se le da uno falso que
// devuelve el archivo real: se prueba el modulo entero, no una parte.
function cargar(archivo) {
  let src = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
  const ex = [];
  src = src.replace(/^export (async function|function|const|let) (\w+)/gm,
    (_, k, n) => { ex.push(n); return `${k} ${n}`; });
  const sandbox = {
    console, Math, Object, Array, Number, Set, Map, JSON, isFinite, isNaN,
    Promise, fetch: async () => ({ ok: true, json: async () => SNAP }),
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return vm.runInContext(`({${ex.join(',')}})`, sandbox);
}
const Rg = cargar('riesgo.js');

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

// La misma cartera de la auditoria, con los mismos pesos.
const CART = {
  activos: [
    { ticker: 'AAPL', peso: 30.0, topeClase: 12, sector: 'Technology' },
    { ticker: 'MSFT', peso: 13.3, topeClase: 12, sector: 'Technology' },
    { ticker: 'JPM',  peso: 15.0, topeClase: 12, sector: 'Financials' },
    { ticker: 'KO',   peso: 10.0, topeClase: 12, sector: 'Consumer Staples' },
    { ticker: 'XOM',  peso: 6.7,  topeClase: 12, sector: 'Energy' },
  ],
};

// ── El calculo de control, hecho aparte y a mano ────────────────────────────
function retornos(sym, n) {
  const v = SNAP.series[sym].filter(x => x != null);
  const desde = Math.max(0, v.length - 1 - n);
  const s = v.slice(desde);
  const r = [];
  for (let i = 1; i < s.length; i++) r.push((s[i] - s[i - 1]) / s[i - 1]);
  return r;
}
const media = v => v.reduce((a, b) => a + b, 0) / v.length;
function cov(a, b) {
  const ma = media(a), mb = media(b);
  let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}

async function main() {
  const r = await Rg.analizarRiesgo(CART, []);
  chequear('devuelve resultado', r && r.disponible, JSON.stringify(r));
  if (!r?.disponible) { resumen(); return; }

  console.log(`\nVentana: ${r.ventana_dias} dias · volatilidad de la cartera: `
            + `${r.volatilidad_cartera_pct}%\n`);

  // ── 1. Contra el calculo de control ─────────────────────────────────────
  console.log('1. Los numeros coinciden con la cuenta hecha aparte');
  const T = CART.activos.map(a => a.ticker);
  const R = T.map(t => retornos(t, r.ventana_dias));
  const L = Math.min(...R.map(x => x.length));
  const RR = R.map(x => x.slice(-L));
  const total = CART.activos.reduce((a, x) => a + x.peso, 0);
  const w = CART.activos.map(a => a.peso / total);
  const varC = w.reduce((s, wi, i) =>
    s + w.reduce((s2, wj, j) => s2 + wi * wj * cov(RR[i], RR[j]), 0), 0);
  const volC = Math.sqrt(varC * 252) * 100;
  chequear(`volatilidad ${r.volatilidad_cartera_pct}% vs control ${volC.toFixed(1)}%`,
    Math.abs(r.volatilidad_cartera_pct - volC) < 0.15);

  for (let i = 0; i < T.length; i++) {
    const mrg = w.reduce((a, wj, j) => a + wj * cov(RR[i], RR[j]), 0);
    const c = w[i] * mrg / varC * 100;
    const p = r.posiciones.find(x => x.ticker === T[i]);
    chequear(`${T[i]}: aporte al riesgo ${p.aporte_al_riesgo_pct}% vs control `
           + `${c.toFixed(1)}%`, Math.abs(p.aporte_al_riesgo_pct - c) < 0.3);
  }

  // ── 2. El hallazgo de la auditoria tiene que reproducirse ───────────────
  console.log('\n2. El hallazgo que motivo todo esto');
  const aapl = r.posiciones.find(p => p.ticker === 'AAPL');
  chequear('AAPL aporta MUCHO mas riesgo que peso (30% del dinero)',
    aapl.aporte_al_riesgo_pct > 50, `${aapl.aporte_al_riesgo_pct}%`);
  console.log(`     AAPL: pesa 30,0% y aporta ${aapl.aporte_al_riesgo_pct}% del riesgo`);

  // ── 3. Los aportes al riesgo suman 100 ──────────────────────────────────
  console.log('\n3. Coherencia interna');
  const suma = r.posiciones.reduce((a, p) => a + (p.aporte_al_riesgo_pct || 0), 0);
  chequear('los aportes al riesgo suman 100%', Math.abs(suma - 100) < 0.6,
    `suman ${suma.toFixed(1)}`);
  chequear('ninguna correlacion media se va de [-1, 1]',
    r.posiciones.every(p => p.correlacion_media == null
      || (p.correlacion_media >= -1 && p.correlacion_media <= 1)));
  chequear('todas las volatilidades son positivas',
    r.posiciones.every(p => p.volatilidad_pct > 0));

  // ── 4. La paridad de riesgo ─────────────────────────────────────────────
  console.log('\n4. Peso objetivo por paridad de riesgo');
  console.log('       ' + 'peso'.padStart(6) + '  ' + 'objetivo'.padStart(8)
            + '   ' + 'aporte riesgo'.padStart(13) + '   ' + 'corr'.padStart(5));
  for (const p of r.posiciones) {
    const a = CART.activos.find(x => x.ticker === p.ticker);
    console.log(`${p.ticker.padEnd(6)} ${a.peso.toFixed(1).padStart(6)}% `
      + `${p.peso_objetivo_pct.toFixed(1).padStart(8)}%`
      + `${p.limitado_por_tope ? '*' : ' '} `
      + `${String(p.aporte_al_riesgo_pct).padStart(13)}% `
      + `${String(p.correlacion_media).padStart(6)}`);
  }
  const sumaObj = r.posiciones.reduce((a, p) => a + p.peso_objetivo_pct, 0);
  // ⚠️ Con 5 posiciones y un tope de 12%, el maximo asignable es 60% pero las
  // acciones son el 75%. NO se puede cumplir, y eso hay que DECIRLO en vez de
  // devolver unos pesos que no cierran.
  if (r.topes_insuficientes) {
    chequear('avisa que los topes no alcanzan, con el numero',
      r.topes_insuficientes.faltan_pct > 0 && r.topes_insuficientes.nota,
      JSON.stringify(r.topes_insuficientes));
    chequear('y el faltante coincide con lo que suman los objetivos',
      Math.abs((total - sumaObj) - r.topes_insuficientes.faltan_pct) < 0.6,
      `${(total - sumaObj).toFixed(1)} vs ${r.topes_insuficientes.faltan_pct}`);
    console.log(`     ${r.topes_insuficientes.nota}`);
  } else {
    chequear('los pesos objetivo suman lo mismo que las acciones hoy',
      Math.abs(sumaObj - total) < 0.6, `${sumaObj.toFixed(1)} vs ${total}`);
  }
  chequear('ningun objetivo supera su tope',
    r.posiciones.every(p => p.peso_objetivo_pct <= 12.05),
    JSON.stringify(r.posiciones.map(p => [p.ticker, p.peso_objetivo_pct])));
  chequear('AAPL, que aporta el 60% del riesgo, baja mucho',
    r.posiciones.find(p => p.ticker === 'AAPL').peso_objetivo_pct < 20);
  chequear('la volatilidad con el objetivo es MENOR que la actual',
    r.volatilidad_si_objetivo_pct < r.volatilidad_cartera_pct,
    `${r.volatilidad_si_objetivo_pct} vs ${r.volatilidad_cartera_pct}`);
  console.log(`     volatilidad: ${r.volatilidad_cartera_pct}% -> `
            + `${r.volatilidad_si_objetivo_pct}% con los pesos objetivo`);

  // ── 5. La simulacion antes/despues ──────────────────────────────────────
  console.log('\n5. Antes/despues: la pregunta que el informe no podia contestar');
  const opciones = {};
  for (const destino of ['KO', 'XOM', 'JPM', 'MSFT']) {
    const mov = { AAPL: 12.0 };
    mov[destino] = CART.activos.find(a => a.ticker === destino).peso + (30.0 - 12.0);
    const s = await Rg.simular(CART, mov);
    opciones[destino] = s.delta_pct;
    console.log(`     recortar AAPL a 12% y poner el resto en ${destino.padEnd(5)}`
      + ` -> ${s.volatilidad_antes_pct}% a ${s.volatilidad_despues_pct}% `
      + `(${s.delta_pct > 0 ? '+' : ''}${s.delta_pct})`);
  }
  chequear('KO es la mejor opcion (menor correlacion con AAPL)',
    opciones.KO === Math.min(...Object.values(opciones)),
    JSON.stringify(opciones));
  chequear('MSFT es la PEOR (es lo que el sistema elegia por puntaje)',
    opciones.MSFT === Math.max(...Object.values(opciones)),
    JSON.stringify(opciones));
  chequear('la diferencia entre la mejor y la peor es grande',
    Math.abs(opciones.KO - opciones.MSFT) > 2,
    `${opciones.KO} vs ${opciones.MSFT}`);

  // ── 6. Los candidatos se miden por lo que le aportan a ESTA cartera ──────
  console.log('\n6. Candidatos: ordenados por lo que le aportan a la cartera');
  const cands = ['NEM', 'PG', 'DUK', 'NVDA', 'CVX'].filter(t => SNAP.series[t])
    .map(t => ({ ticker: t, sector: 'x', puntaje: 70 }));
  const r2 = await Rg.analizarRiesgo(CART, cands);
  chequear('devuelve el aporte de cada candidato', r2.candidatos.length > 0);
  for (const c of r2.candidatos) {
    console.log(`     ${c.ticker.padEnd(6)} vol ${String(c.volatilidad).padStart(5)}% · `
      + `corr ${String(c.correlacion_media).padStart(5)} · `
      + `delta vol ${c.delta_volatilidad > 0 ? '+' : ''}${c.delta_volatilidad}`);
  }
  chequear('vienen ordenados del que MAS baja el riesgo al que menos',
    r2.candidatos.every((c, i) =>
      i === 0 || r2.candidatos[i - 1].delta_volatilidad <= c.delta_volatilidad));

  // ── 7. Los casos sin datos NO se inventan ───────────────────────────────
  console.log('\n7. Datos faltantes: se nombran, no se rellenan');
  const conFantasma = { activos: [...CART.activos,
    { ticker: 'NOEXISTE', peso: 5, topeClase: 12, sector: 'X' }] };
  const r3 = await Rg.analizarRiesgo(conFantasma, []);
  chequear('el papel sin histórico queda fuera y se nombra',
    r3.sin_datos.some(s => s.ticker === 'NOEXISTE'),
    JSON.stringify(r3.sin_datos));
  chequear('y NO aparece entre las posiciones con riesgo',
    !r3.posiciones.some(p => p.ticker === 'NOEXISTE'));
  chequear('la cobertura avisa que no es toda la cartera',
    r3.cobertura_pct < 100, `${r3.cobertura_pct}%`);
  console.log(`     cobertura del calculo: ${r3.cobertura_pct}% de las acciones`);

  const unaSola = { activos: [CART.activos[0]] };
  const r4 = await Rg.analizarRiesgo(unaSola, []);
  chequear('con una sola posicion NO calcula nada y explica por que',
    r4.disponible === false && r4.motivo, JSON.stringify(r4));

  resumen();
}

function resumen() {
  console.log(`\n${'-'.repeat(66)}`);
  console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                         : `${fail} FALLAS de ${ok + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('La prueba exploto:', e); process.exit(1); });
