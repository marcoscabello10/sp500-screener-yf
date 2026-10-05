// Prueba del COSTO DE ROTACION y del PISO DE MEJORA (23/09/2026).
//
// Extrae las funciones REALES de cartera.js -- no copias.
//
// LAS DOS COSAS QUE DEFIENDE
//
// 1. EL COSTO. Hasta hoy el plan no sabia que operar cuesta plata. Medido sobre
//    767 rebalanceos, un plan completo mueve la MEDIANA del 31% de la cartera:
//    a 1% por punta son 0,63% del total, porque cada punto que se mueve se
//    vende de un lado y se compra del otro. Contra una mejora de 4 puntos eso
//    es barato; contra 0,4 puntos es tirar plata para empeorar.
//
// 2. EL PISO. Se midio si el 0,5 que ya estaba en el prompt era el numero
//    correcto:
//
//      promesa      n    se cumplio   mejora REALIZADA
//      < 0,5      123      47%          -0,51 pts      <- sale al reves
//      0,5 a 1,5  139      81%          +1,19 pts
//      1,5 a 3    223      92%          +2,15 pts
//      3 a 6      168      99%          +4,45 pts
//      > 6        114      98%          +6,95 pts
//
//    Abajo de 0,5 es cara o cruca Y el promedio va para el lado equivocado. Por
//    eso el plan se BLOQUEA en vez de mostrarse con una nota al pie: un plan en
//    pantalla invita a ejecutarlo aunque el texto diga que no conviene.
//
// Correr:  node test/prueba-costo.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');

function cargar(archivo, exportar) {
  const src = fs.readFileSync(path.join(RAIZ, 'src', 'informe', archivo), 'utf8')
    .replace(/^export\s+/gm, '').replace(/^import[^\n]*\n/gm, '');
  const sb = { console, Math, Array, Object, Number, String, isFinite, Map, Set,
               JSON, Date, Infinity };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return vm.runInContext(`({${exportar.join(',')}})`, sb);
}

const C = cargar('cartera.js', [
  'planDePesos', 'armarDatosTesis', 'historialDeLaPromesa',
  'HISTORIAL_POR_PROMESA', 'MEJORA_MINIMA_PTS', 'COSTO_OPERAR_PCT_DEFECTO',
  'UMBRAL_AJUSTE_PP']);

let ok = 0, fail = 0;
function chequear(nombre, cond, detalle) {
  if (cond) { ok++; console.log(`  ok    ${nombre}`); }
  else { fail++; console.log(`  FALLA ${nombre}${detalle ? ' -- ' + detalle : ''}`); }
}

// Una cartera de 10.000 con dos posiciones que hay que rebalancear fuerte.
function armar({ volActual = 20, volObjetivo = 14 } = {}) {
  return {
    cart: {
      activos: [{ ticker: 'AAA', peso: 70, sector: 'Technology', valorActual: 7000, cantidad: 70 },
                { ticker: 'BBB', peso: 30, sector: 'Financials', valorActual: 3000, cantidad: 30 }],
      porTicker: {
        AAA: { peso: 70, sector: 'Technology', valorActual: 7000, cantidad: 70 },
        BBB: { peso: 30, sector: 'Financials', valorActual: 3000, cantidad: 30 },
      },
      sectores: [{ sector: 'Technology', excede: false, tope: 40 },
                 { sector: 'Financials', excede: false, tope: 40 }],
      valorTotalCartera: 10000, valorTotal: 10000,
    },
    riesgo: {
      disponible: true,
      volatilidad_cartera_pct: volActual,
      volatilidad_si_objetivo_pct: volObjetivo,
      sin_datos: [], candidatos: [],
      posiciones: [
        { ticker: 'AAA', volatilidad_pct: 30, aporte_al_riesgo_pct: 80,
          correlacion_media: 0.6, peso_objetivo_pct: 50, limitado_por_tope: false },
        { ticker: 'BBB', volatilidad_pct: 18, aporte_al_riesgo_pct: 20,
          correlacion_media: 0.4, peso_objetivo_pct: 50, limitado_por_tope: false }],
    },
  };
}

console.log('='.repeat(78));
console.log('  1. EL COSTO DE ROTAR');
console.log('='.repeat(78));

const { cart, riesgo } = armar();
const plan = C.planDePesos(cart, riesgo, 1.0);

// AAA baja de 70 a 50 y BBB sube de 30 a 50: se mueven 20 pp de un lado al
// otro. El turnover es 20, no 40 -- es la MITAD de la suma de los cambios.
chequear('el turnover es la mitad de la suma de los cambios, no la suma',
  plan.turnoverPct === 20, `dio ${plan.turnoverPct}`);

// Cada punta paga: 2.000 de venta + 2.000 de compra = 4.000 operados al 1% = 40.
chequear('el costo cobra las DOS puntas (vender y comprar)',
  plan.costoUSD === 40, `dio ${plan.costoUSD}`);
chequear('y eso es 0,4% de una cartera de 10.000',
  plan.costoPctCartera === 0.4, `dio ${plan.costoPctCartera}`);

// 0,4% de costo por 6 puntos de mejora.
chequear('el costo por punto de mejora se calcula bien',
  Math.abs(plan.costoPorPuntoPct - 0.4 / 6) < 0.01,
  `dio ${plan.costoPorPuntoPct}`);

const barato = C.planDePesos(cart, riesgo, 0.2);
chequear('bajar el costo por operacion baja el costo del plan, proporcional',
  barato.costoUSD === 8 && barato.costoPctCartera === 0.08,
  `${barato.costoUSD} / ${barato.costoPctCartera}`);
chequear('el turnover NO depende del costo: es cuanto se mueve, no cuanto cuesta',
  barato.turnoverPct === plan.turnoverPct);

const gratis = C.planDePesos(cart, riesgo, 0);
chequear('con costo 0 no se rompe y el costo da 0',
  gratis.costoUSD === 0 && gratis.costoPctCartera === 0);

chequear('el default es el caso CARO, no el barato',
  C.COSTO_OPERAR_PCT_DEFECTO >= 1.0,
  `es ${C.COSTO_OPERAR_PCT_DEFECTO}`);
// Errar por caro hace que el informe recomiende MENOS movimientos; errar por
// barato hace que recomiende de mas. La asimetria es la razon del default.

const sinArg = C.planDePesos(cart, riesgo);
chequear('sin argumento usa el default y no queda en null',
  sinArg.costoPct === C.COSTO_OPERAR_PCT_DEFECTO && sinArg.costoUSD > 0);

console.log();
console.log('='.repeat(78));
console.log('  2. 🔴 EL PISO DE MEJORA — el bloqueo');
console.log('='.repeat(78));

const flojo = armar({ volActual: 20, volObjetivo: 19.7 });   // mejora 0,3
const planFlojo = C.planDePesos(flojo.cart, flojo.riesgo, 1.0);
chequear('una mejora de 0,3 puntos bloquea el plan',
  planFlojo.bloqueado === true, `mejora ${planFlojo.mejoraVol}`);

const justo = armar({ volActual: 20, volObjetivo: 19.5 });   // mejora 0,5 exacta
chequear('una mejora de 0,5 exacta NO bloquea (el piso es "menor a")',
  C.planDePesos(justo.cart, justo.riesgo, 1.0).bloqueado === false);

chequear('una mejora de 6 puntos no bloquea nada',
  plan.bloqueado === false);

// Una cartera que EMPEORA con el plan tambien se bloquea.
const peor = armar({ volActual: 14, volObjetivo: 16 });      // mejora -2
chequear('un plan que EMPEORA la cartera tambien queda bloqueado',
  C.planDePesos(peor.cart, peor.riesgo, 1.0).bloqueado === true);

console.log();
console.log('='.repeat(78));
console.log('  3. EL HISTORIAL DE LA PROMESA');
console.log('='.repeat(78));

chequear('una promesa de 0,3 cae en el tramo que sale al reves',
  C.historialDeLaPromesa(0.3)?.se_cumplio_pct === 47
  && C.historialDeLaPromesa(0.3)?.mejora_real_pts < 0,
  JSON.stringify(C.historialDeLaPromesa(0.3)));
chequear('una promesa de 4 puntos cae en el tramo de 99%',
  C.historialDeLaPromesa(4)?.se_cumplio_pct === 99);
chequear('una promesa enorme no se sale de la tabla',
  C.historialDeLaPromesa(50)?.se_cumplio_pct != null);
chequear('sin promesa no se inventa un historial',
  C.historialDeLaPromesa(null) === null
  && C.historialDeLaPromesa(undefined) === null
  && C.historialDeLaPromesa(NaN) === null);

// ⚠️ La tabla tiene que ser MONOTONA en el porcentaje de cumplimiento salvo el
// ultimo tramo: si alguien la edita y la deja desordenada, el informe diria que
// una promesa mas grande se cumple menos, que es lo contrario de lo medido.
const pct = C.HISTORIAL_POR_PROMESA.map(x => x.se_cumplio_pct);
chequear('el cumplimiento crece con el tamaño de la promesa',
  pct[0] < pct[1] && pct[1] < pct[2] && pct[2] < pct[3],
  pct.join(' '));
chequear('solo el primer tramo tiene mejora realizada negativa',
  C.HISTORIAL_POR_PROMESA[0].mejora_real_pts < 0
  && C.HISTORIAL_POR_PROMESA.slice(1).every(x => x.mejora_real_pts > 0));
// Y el ratio retorno/riesgo NO mejora con el tamaño: ronda 55% en todos los
// tramos. Es la parte incomoda de la medicion y tiene que seguir estando.
const ratios = C.HISTORIAL_POR_PROMESA.map(x => x.ratio_mejora_pct);
chequear('el ratio retorno/riesgo NO crece con la promesa (ronda 55% siempre)',
  Math.max(...ratios) - Math.min(...ratios) < 15,
  ratios.join(' '));

console.log();
console.log('='.repeat(78));
console.log('  4. QUE LLEGUE AL PAYLOAD');
console.log('='.repeat(78));

const datos = C.armarDatosTesis(cart, null, [], {}, riesgo, 1.0);
const j = JSON.stringify(datos);
chequear('el costo viaja en el payload',
  /"costo_por_punto_de_mejora_pct"/.test(j) && /"mueve_pct_de_la_cartera"/.test(j));
chequear('el historial de la promesa viaja en el payload',
  /"historial_de_esta_promesa"/.test(j) && /"se_cumplio_pct"/.test(j));

const datosFlojo = C.armarDatosTesis(flojo.cart, null, [], {}, flojo.riesgo, 1.0);
chequear('cuando esta bloqueado, el payload lo dice',
  /"bloqueado_por_mejora_insuficiente":true/.test(JSON.stringify(datosFlojo)));
chequear('cuando NO esta bloqueado, esa clave no ensucia el payload',
  !/"bloqueado_por_mejora_insuficiente"/.test(j));

// El costo por cartera: dos llamadas con costos distintos tienen que dar
// payloads distintos, o el parametro no esta llegando.
const caro = JSON.stringify(C.armarDatosTesis(cart, null, [], {}, riesgo, 1.5));
const barat = JSON.stringify(C.armarDatosTesis(cart, null, [], {}, riesgo, 0.2));
chequear('el costo es configurable POR CARTERA y llega hasta el payload',
  caro !== barat);

console.log();
console.log('='.repeat(78));
if (fail) {
  console.log(`  ${fail} FALLAS de ${ok + fail} comprobaciones`);
  process.exit(1);
}
console.log(`  ${ok} comprobaciones OK`);
console.log('  El costo cobra las dos puntas y es configurable, el plan se bloquea');
console.log('  abajo del piso medido, y el historial de la promesa viaja al informe.');
