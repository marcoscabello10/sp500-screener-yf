// Prueba del Motor B (riesgo.js).
//
// Corre el modulo REAL contra el historico de precios REAL, y compara los
// resultados con los numeros que se calcularon a mano en la auditoria. Si el
// modulo dice algo distinto de lo que dio la cuenta hecha aparte, uno de los
// dos esta mal y hay que saberlo antes de que salga en un informe.
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


const SNAP = JSON.parse(fs.readFileSync(DATA + 'historico_precios.json', 'utf8'));

// `riesgo.js` usa fetch para bajar el historico. Se le da uno falso que
// devuelve el archivo real: se prueba el modulo entero, no una parte.
function cargar(archivo) {
  let src = fs.readFileSync(ruta(archivo), 'utf8');
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

  // ── El benchmark y los pares (31/08/2026) ────────────────────────────────
  // Dos lecturas que salen de la MISMA matriz que ya se calculaba: no cuestan
  // una llamada nueva ni un token. SPY estaba en el snapshot desde el primer
  // dia sin compararse con nada.
  console.log('\n7. Contra el indice (SPY)');
  const b = r.benchmark;
  chequear('el benchmark se calcula', b != null);
  if (b) {
    console.log(`     cartera ${b.retorno_cartera_pct}% / vol ${b.volatilidad_cartera_pct}%`
              + `   vs   SPY ${b.retorno_benchmark_pct}% / vol ${b.volatilidad_benchmark_pct}%`);
    console.log(`     beta ${b.beta_vs_benchmark} · corr ${b.correlacion_vs_benchmark}`
              + ` · ret/vol ${b.retorno_sobre_volatilidad} vs ${b.retorno_sobre_volatilidad_benchmark}`);
    chequear('el exceso es la resta de los dos retornos',
      Math.abs(b.exceso_pct - (b.retorno_cartera_pct - b.retorno_benchmark_pct)) <= 0.11,
      `${b.exceso_pct}`);
    chequear('la volatilidad coincide con la que ya se reportaba aparte',
      b.volatilidad_cartera_pct === r.volatilidad_cartera_pct,
      `${b.volatilidad_cartera_pct} vs ${r.volatilidad_cartera_pct}`);
    // Una cartera de cinco grandes del S&P TIENE que correlacionar fuerte con
    // el indice. Si esto diera 0,2 habria un error de alineacion de fechas,
    // que es el bug clasico de este tipo de cuenta y no da ningun error.
    chequear('correlaciona fuerte con el indice (si no, las fechas no alinean)',
      b.correlacion_vs_benchmark > 0.6, `${b.correlacion_vs_benchmark}`);
    chequear('la beta es de un orden creible',
      b.beta_vs_benchmark > 0.3 && b.beta_vs_benchmark < 2.5,
      `${b.beta_vs_benchmark}`);
    chequear('la ventana es la misma que la del resto del analisis',
      b.ventana_dias === r.ventana_dias);
    chequear('el ret/vol es el cociente y nada mas',
      Math.abs(b.retorno_sobre_volatilidad
               - b.retorno_cartera_pct / b.volatilidad_cartera_pct) < 0.02);
  }

  console.log('\n8. Pares que son una sola apuesta');
  chequear('la lista existe siempre (vacia es una respuesta valida)',
    Array.isArray(r.pares_correlacionados));
  chequear('en esta cartera diversificada no hay ninguno',
    r.pares_correlacionados.length === 0,
    JSON.stringify(r.pares_correlacionados));

  // Una cartera armada A PROPOSITO con un par obvio: dos petroleras.
  const PETRO = { activos: [
    { ticker: 'XOM', peso: 12, topeClase: 12, sector: 'Energy' },
    { ticker: 'CVX', peso: 10, topeClase: 12, sector: 'Energy' },
    { ticker: 'KO',  peso: 10, topeClase: 12, sector: 'Consumer Staples' },
    { ticker: 'JPM', peso: 10, topeClase: 12, sector: 'Financials' },
  ] };
  const rp = await Rg.analizarRiesgo(PETRO, []);
  const par = rp.pares_correlacionados.find(
    p => (p.a === 'XOM' && p.b === 'CVX') || (p.a === 'CVX' && p.b === 'XOM'));
  chequear('XOM+CVX se detecta como una sola apuesta', par != null,
    JSON.stringify(rp.pares_correlacionados));
  if (par) {
    console.log(`     ${par.a}+${par.b} corr ${par.correlacion} `
              + `peso combinado ${par.peso_combinado_pct}%`);
    chequear('el peso combinado es la suma de los dos',
      Math.abs(par.peso_combinado_pct - 22) < 0.11, `${par.peso_combinado_pct}`);
    // ESTE es el punto de toda la seccion: ninguno de los dos excede el tope
    // de 12% por su cuenta, y juntos son 22%. La tabla de pesos no lo muestra.
    chequear('el combinado excede el tope aunque ninguno lo exceda solo',
      par.peso_combinado_pct > 12);
    chequear('se marca que son del mismo sector', par.mismo_sector === true);
    chequear('la correlacion supera el umbral declarado',
      par.correlacion >= Rg.CORR_PAR_ALTA);
  }
  chequear('los pares vienen ordenados por peso combinado',
    rp.pares_correlacionados.every((p, i) => i === 0
      || rp.pares_correlacionados[i - 1].peso_combinado_pct >= p.peso_combinado_pct));

  // ── 9. TOPES DE GRUPO (31/08/2026) ──────────────────────────────────────
  // La contradiccion que esto arregla: con cuatro bancos al 12,5% el informe
  // decia "Financials excede el 35%" y a la vez proponia un objetivo de 41,3%,
  // que tambien lo excede. El optimizador solo conocia el tope POR POSICION.
  console.log('\n9. Los topes de sector e industria entran al optimizador');

  const banco = (t, ind) => ({ ticker: t, peso: 12.5, topeClase: 20,
                               sector: 'Financials', industry: ind });
  const otro = (t, sec, ind, peso) => ({ ticker: t, peso, topeClase: 20,
                                         sector: sec, industry: ind });
  // `analizarRiesgo` lee el tope de `cart.sectores[0].tope`, igual que el
  // informe: si lo recalculara, la tabla y el objetivo podrian discrepar.
  const conTope = (activos, tope = 35) => ({ activos, sectores: [{ tope }] });

  const MIXTO = conTope([
    banco('WFC',  'Banks - Diversified'),
    banco('JPM',  'Banks - Diversified'),
    banco('BBD',  'Banks - Regional'),
    banco('BSBR', 'Banks - Regional'),
    otro('KO',   'Consumer Staples', 'Beverages', 16.7),
    otro('MSFT', 'Technology',       'Software',  16.7),
    otro('XOM',  'Energy',           'Oil & Gas', 16.6),
  ]);
  const rm = await Rg.analizarRiesgo(MIXTO, []);
  const BANCOS = ['WFC', 'JPM', 'BBD', 'BSBR'];
  const objBancos = rm.posiciones
    .filter(p => BANCOS.includes(p.ticker))
    .reduce((a, p) => a + p.peso_objetivo_pct, 0);
  console.log(`     Financials 50% -> ${Math.round(objBancos * 10) / 10}% (tope 35%)`);
  for (const p of rm.posiciones.filter(x => BANCOS.includes(x.ticker))) {
    console.log(`       ${p.ticker.padEnd(5)} 12.5% -> ${p.peso_objetivo_pct}%  `
              + `aporta ${p.aporte_al_riesgo_pct}% del riesgo`);
  }
  chequear('el objetivo del sector YA NO excede su propio tope',
    objBancos <= 35.1, `${objBancos}%`);
  chequear('y baja de verdad (no se queda en 50)', objBancos < 40, `${objBancos}`);
  chequear('el grupo limitante se nombra',
    rm.grupos_limitantes.some(g => g.tipo === 'sector' && g.nombre === 'Financials'),
    JSON.stringify(rm.grupos_limitantes));
  chequear('cada banco dice que lo limito el grupo, no su propio tope',
    rm.posiciones.filter(p => BANCOS.includes(p.ticker))
      .every(p => (p.limitado_por_grupo || []).includes('Financials')));
  // EL PUNTO DE TODO: se recorta MAS al que MAS riesgo aporta. Si el recorte
  // fuera parejo, la paridad de riesgo no habria servido de nada.
  const orden = rm.posiciones.filter(p => BANCOS.includes(p.ticker))
    .slice().sort((a, b) => b.aporte_al_riesgo_pct - a.aporte_al_riesgo_pct);
  chequear('el que mas riesgo aporta queda con el objetivo mas chico',
    orden[0].peso_objetivo_pct < orden[orden.length - 1].peso_objetivo_pct,
    `${orden[0].ticker} ${orden[0].peso_objetivo_pct}% vs `
    + `${orden[orden.length - 1].ticker} ${orden[orden.length - 1].peso_objetivo_pct}%`);
  // ⚠️ La primera version de esta prueba exigia que los objetivos sumaran 100%
  // y fallaba con 94,9%. El codigo estaba BIEN: en esta cartera de prueba los
  // topes por posicion son 20% y el de Financials 35%, asi que 3x20 + 35 = 95%
  // y el 5% restante NO TIENE DONDE IR. Lo importante no es que sume 100 —a
  // veces no se puede— sino que cuando no suma, el sistema lo DIGA.
  const sumaGrupos = rm.posiciones.reduce((a, p) => a + p.peso_objetivo_pct, 0);
  const cierra = Math.abs(sumaGrupos - 100) < 0.5;
  chequear('o los objetivos suman el 100%, o se declara el faltante',
    cierra || rm.topes_insuficientes != null,
    `suman ${sumaGrupos.toFixed(1)}% y topes_insuficientes es `
    + `${JSON.stringify(rm.topes_insuficientes)}`);
  if (!cierra) {
    console.log(`     (suman ${sumaGrupos.toFixed(1)}%: los topes no dejan lugar `
              + `al resto, y se informa)`);
    chequear('el faltante informado coincide con lo que falta',
      Math.abs(rm.topes_insuficientes.faltan_pct - (100 - sumaGrupos)) < 0.6,
      `dice ${rm.topes_insuficientes.faltan_pct}, faltan ${(100 - sumaGrupos).toFixed(1)}`);
    // Y el consejo tiene que ser el correcto: con los sectores llenos, sumar
    // otro papel del mismo sector no resuelve nada.
    chequear('avisa que el faltante es por los topes de grupo',
      rm.topes_insuficientes.por_grupo === true);
    chequear('y el consejo dice que hace falta OTRO sector',
      /OTRO sector/.test(rm.topes_insuficientes.nota),
      rm.topes_insuficientes.nota);
  }

  // Cuando TODOS son de la misma industria, aprieta la industria (mas fina).
  const MISMA = conTope([
    banco('WFC', 'Banks - Diversified'), banco('JPM', 'Banks - Diversified'),
    banco('BAC', 'Banks - Diversified'), banco('C',   'Banks - Diversified'),
    otro('KO',   'Consumer Staples', 'Beverages', 16.7),
    otro('MSFT', 'Technology',       'Software',  16.7),
    otro('XOM',  'Energy',           'Oil & Gas', 16.6),
  ]);
  const ri = await Rg.analizarRiesgo(MISMA, []);
  const objInd = ri.posiciones
    .filter(p => ['WFC', 'JPM', 'BAC', 'C'].includes(p.ticker))
    .reduce((a, p) => a + p.peso_objetivo_pct, 0);
  const topeInd = 35 * Rg.FACTOR_TOPE_INDUSTRIA;
  console.log(`     cuatro bancos de la MISMA industria -> `
            + `${Math.round(objInd * 10) / 10}% (tope industria ${topeInd}%)`);
  chequear('la industria aprieta mas que el sector cuando corresponde',
    objInd <= topeInd + 0.2, `${objInd} vs ${topeInd}`);
  chequear('y se nombra como grupo limitante de tipo industria',
    ri.grupos_limitantes.some(g => g.tipo === 'industria'));

  // Control: una cartera repartida NO puede disparar ningun grupo.
  const SANA = conTope([
    otro('AAPL', 'Technology',       'Consumer Electronics', 20),
    otro('JPM',  'Financials',       'Banks - Diversified',  20),
    otro('KO',   'Consumer Staples', 'Beverages',            20),
    otro('XOM',  'Energy',           'Oil & Gas',            20),
    otro('JNJ',  'Healthcare',       'Drug Manufacturers',   20),
  ]);
  const rs = await Rg.analizarRiesgo(SANA, []);
  chequear('una cartera repartida no dispara ningun grupo (sin falsos positivos)',
    rs.grupos_limitantes.length === 0,
    JSON.stringify(rs.grupos_limitantes));

  // Sin `industry` NO se agrupa a medias: limitaria a los que tienen el dato y
  // dejaria libres a los que no, que es peor que no agrupar.
  const SIN_IND = conTope([
    { ticker: 'WFC', peso: 12.5, topeClase: 20, sector: 'Financials',
      industry: 'Banks - Diversified' },
    { ticker: 'JPM', peso: 12.5, topeClase: 20, sector: 'Financials',
      industry: 'Banks - Diversified' },
    { ticker: 'BBD', peso: 12.5, topeClase: 20, sector: 'Financials',
      industry: null },
    { ticker: 'BSBR', peso: 12.5, topeClase: 20, sector: 'Financials',
      industry: null },
    otro('KO',   'Consumer Staples', 'Beverages', 16.7),
    otro('MSFT', 'Technology',       'Software',  16.7),
    otro('XOM',  'Energy',           'Oil & Gas', 16.6),
  ]);
  const rn = await Rg.analizarRiesgo(SIN_IND, []);
  chequear('con industrias incompletas NO se agrupa por industria',
    !rn.grupos_limitantes.some(g => g.tipo === 'industria'),
    JSON.stringify(rn.grupos_limitantes.map(g => g.tipo)));
  chequear('pero el tope de SECTOR se sigue aplicando igual',
    rn.grupos_limitantes.some(g => g.tipo === 'sector'));

  resumen();
}

function resumen() {
  console.log(`\n${'-'.repeat(66)}`);
  console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                         : `${fail} FALLAS de ${ok + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('La prueba exploto:', e); process.exit(1); });
