// Prueba del BLOQUE DE HECHOS que recibe la segunda llamada.
//
// QUE ES ESTO (02/09/2026)
// El texto para el cliente dejo de ser la seccion 5 de la primera llamada y
// paso a ser una llamada aparte. Esa llamada recibe la decision ya escrita
// —en tickers, con jerga— y este bloque, que es lo unico que le permite:
//
//   · nombrar empresas sin inventarlas   (`nombres`)
//   · dar el numero de volatilidad       (los dos, o ninguno)
//   · empezar por lo bueno con un dato   (retorno contra el indice)
//   · NO decir que la cartera quedo adaptada al perfil cuando no lo esta
//     (`pendiente`)
//
// Lo que se comprueba aca es que ninguno de esos cuatro se pierda, y —tan
// importante como eso— que ninguno se INVENTE cuando el dato no existe.
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

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

// El payload tal como sale de `armarDatosTesis`, con todo puesto.
function datos(extra = {}) {
  return Object.assign({
    perfil: 'Moderado', objetivo: 'Equilibrado', horizonte: 'Medio',
    cartera: {
      valor_total_usd: 48200, cobertura_analizada_pct: 100, es_parcial: false,
      renta_variable_pct: 100, tope_renta_variable_pct: 70, resto: [],
    },
    posiciones: [
      { ticker: 'AAPL', nombre: 'Apple', peso_pct: 30, ganancia_pct: 34.1 },
      { ticker: 'KO', nombre: 'Coca-Cola', peso_pct: 12, ganancia_pct: 4.0 },
      { ticker: 'AMD', nombre: 'Advanced Micro Devices', peso_pct: 18,
        ganancia_pct: -8.2 },
    ],
    riesgo: {
      volatilidad_cartera_pct: 24.6, cobertura_del_calculo_pct: 100,
      topes_insuficientes: false,
      benchmark: { simbolo: 'SPY', retorno_cartera_pct: 61.2,
                   retorno_benchmark_pct: 44.8 },
    },
    plan: {
      volatilidad_actual_pct: 24.6, volatilidad_si_se_ejecuta_pct: 19.2,
      menu_por_sector: [{ ticker: 'MO', nombre: 'Altria', sector: 'Consumer Staples' }],
      entradas_nuevas: [{ ticker: 'PG', nombre: 'Procter & Gamble' }],
      movimientos: [],
    },
  }, extra);
}

// ── 1. Los nombres: lo unico que evita que el texto salga en tickers ──────
console.log('1. El diccionario de nombres');
const h = C.hechosParaElCliente(datos());
chequear('estan las posiciones', h.nombres.AAPL === 'Apple'
  && h.nombres.KO === 'Coca-Cola');
chequear('esta el menu de rotacion', h.nombres.MO === 'Altria');
chequear('estan las entradas nuevas', h.nombres.PG === 'Procter & Gamble');
console.log(`     ${Object.keys(h.nombres).length} nombres: `
          + `${Object.keys(h.nombres).join(' ')}`);
// Sin esto, el prompt le prohibe nombrar la empresa y el parrafo 3 queda en
// "reduciriamos una posicion tecnologica", que no le sirve a nadie.
chequear('un papel sin nombre NO inventa una entrada',
  !('ZZZ' in C.hechosParaElCliente(datos({
    posiciones: [{ ticker: 'ZZZ', peso_pct: 5 }],
  })).nombres));

// ── 2. Los dos numeros de volatilidad, o ninguno ─────────────────────────
console.log('\n2. La volatilidad viaja de a dos');
chequear('con plan completo van los dos',
  h.volatilidad_antes_pct === 24.6 && h.volatilidad_despues_pct === 19.2);
const sinPlan = C.hechosParaElCliente(datos({ plan: null }));
chequear('sin plan no va ninguno',
  sinPlan.volatilidad_antes_pct === undefined
  && sinPlan.volatilidad_despues_pct === undefined);
// Uno solo no se puede comparar, y el parrafo 5 es una comparacion.
const medio = C.hechosParaElCliente(datos({
  plan: { volatilidad_actual_pct: 24.6, volatilidad_si_se_ejecuta_pct: null },
}));
chequear('con uno solo tampoco va ninguno',
  medio.volatilidad_antes_pct === undefined,
  JSON.stringify({ a: medio.volatilidad_antes_pct,
                   b: medio.volatilidad_despues_pct }));

// ── 3. Empezar por lo bueno, pero con un dato atras ──────────────────────
console.log('\n3. Lo bueno es medido, no un elogio de relleno');
chequear('el retorno contra el indice viaja',
  h.retorno_3_anios_pct === 61.2 && h.retorno_indice_3_anios_pct === 44.8);
chequear('cuantas posiciones estan en ganancia',
  h.posiciones_en_ganancia === 2 && h.posiciones_totales === 3);
const sinBench = C.hechosParaElCliente(datos({
  riesgo: { cobertura_del_calculo_pct: 100 },
}));
chequear('sin benchmark no se inventa un retorno',
  sinBench.retorno_3_anios_pct === undefined);
const todasEnPerdida = C.hechosParaElCliente(datos({
  posiciones: [{ ticker: 'AMD', nombre: 'AMD', ganancia_pct: -8.2 }],
}));
chequear('si ninguna esta en ganancia, el campo no aparece',
  todasEnPerdida.posiciones_en_ganancia === undefined);

// ── 4. LO QUE EL PLAN NO ARREGLA ─────────────────────────────────────────
// Es la parte que un informe malo esconde, y la razon principal por la que
// este bloque existe.
console.log('\n4. Lo pendiente');
console.log(`     ${h.pendiente.length} pendiente(s):`);
h.pendiente.forEach(p => console.log(`       · ${p}`));
chequear('100% en acciones con tope 70% se marca',
  h.pendiente.some(p => p.includes('100%') && p.includes('70%')));
chequear('y se explica que NO se arregla moviendo acciones',
  h.pendiente.some(p => p.toLowerCase().includes('renta fija')));
chequear('esta redactado en lenguaje de cliente, sin jerga',
  !h.pendiente.join(' ').toLowerCase().match(
    /beta|correlaci|percentil|volatilidad hist|tope de sector/));

const dentro = C.hechosParaElCliente(datos({
  cartera: { renta_variable_pct: 65, tope_renta_variable_pct: 70,
             cobertura_analizada_pct: 100 },
}));
chequear('una cartera dentro del tope NO tiene ese pendiente',
  !(dentro.pendiente || []).some(p => p.includes('renta fija')));

const topes = C.hechosParaElCliente(datos({
  riesgo: { topes_insuficientes: true, cobertura_del_calculo_pct: 100 },
}));
chequear('si los topes no se pueden cumplir con lo que hay, se dice',
  topes.pendiente.some(p => p.includes('incorporar')));

const parcialCalculo = C.hechosParaElCliente(datos({
  riesgo: { cobertura_del_calculo_pct: 62.5 },
}));
chequear('si la volatilidad cubre solo una parte, se dice',
  parcialCalculo.pendiente.some(p => p.includes('62.5')
                                  || p.includes('62,5')),
  JSON.stringify(parcialCalculo.pendiente));

// ── 5. La cartera parcial ────────────────────────────────────────────────
console.log('\n5. Cuando la cartera analizada es un pedazo');
const parcial = C.hechosParaElCliente(datos({
  cartera: { es_parcial: true, cobertura_analizada_pct: 71.4,
             renta_variable_pct: 100, tope_renta_variable_pct: 70 },
}));
chequear('se marca y viaja la cobertura',
  parcial.cartera_parcial === true && parcial.cobertura_pct === 71.4);
chequear('una cartera completa no lleva la marca',
  h.cartera_parcial === undefined);

// ── 6. Es CHICO: se paga en cada texto que se pida ───────────────────────
console.log('\n6. El peso del bloque');
const bytes = JSON.stringify(h).length;
console.log(`     ${bytes} caracteres = ~${Math.round(bytes / 3.6)} tokens`);
chequear('entra en menos de 250 tokens', bytes / 3.6 < 250, `${bytes} chars`);

// ── 7. Bordes ────────────────────────────────────────────────────────────
console.log('\n7. Bordes');
chequear('sin datos devuelve null', C.hechosParaElCliente(null) === null);
const vacio = C.hechosParaElCliente({});
chequear('un objeto vacio no explota y no inventa nada',
  vacio && Object.keys(vacio.nombres).length === 0
  && vacio.pendiente === undefined && vacio.volatilidad_antes_pct === undefined);

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
