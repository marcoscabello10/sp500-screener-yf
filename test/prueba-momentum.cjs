// Prueba del MOMENTUM como eje separado (23/09/2026).
//
// Extrae las funciones REALES de riesgo.js y cartera.js -- no copias -- y las
// corre sobre el snapshot real de precios.
//
// LO QUE ESTA PRUEBA DEFIENDE, Y POR QUE
//
// El momentum se agrego con una regla deliberadamente ANGOSTA, porque lo unico
// que la medicion banca es que el quintil 5 es mejor:
//
//     Q1 6,65%   Q2 6,43%   Q3 6,54%   Q4 7,25%   Q5 12,13%
//
// De ahi salen tres cosas que es facil "mejorar" despues y que serian un error:
//
//   1. Convertir el desempate en "gana el de mayor momentum". Eso cambiaria
//      CF (85,5, Q5) por NEM (82,0, Q5): resigna 3,5 puntos de puntaje y no
//      gana nada, porque los dos ya estan en Q5. Rotacion por rotacion.
//   2. Agregar una regla de "evitar Q1". No tiene sustento: Q1 rindio igual
//      que Q2 y Q3. Seria inventar una señal.
//   3. Sumar el momentum al puntaje. El puntaje es de la EMPRESA y el momentum
//      del PRECIO. Mezclarlos es el error que este proyecto ya corrigio dos
//      veces con otras metricas.
//
// Correr:  node test/prueba-momentum.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');
const DATA = path.join(RAIZ, 'public', 'data') + path.sep;

function ruta(nombre) {
  for (const p of [path.join(RAIZ, 'src', 'informe', nombre),
                   path.join(RAIZ, 'src', nombre)]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No encuentro "${nombre}". Se corre desde la raiz: node test/${path.basename(__filename)}`);
}

// El sandbox no entiende `import`/`export`, asi que se sacan igual que en las
// otras suites. Es la forma de probar el codigo REAL y no una copia.
function cargar(archivo, exportar) {
  const src = fs.readFileSync(ruta(archivo), 'utf8')
    .replace(/^export\s+/gm, '')
    .replace(/^import[^\n]*\n/gm, '');
  const sb = { console, Math, Array, Object, Number, String, isFinite, Map, Set,
               JSON, Date, fetch: undefined };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return vm.runInContext(`({${exportar.join(',')}})`, sb);
}

const R = cargar('riesgo.js', ['momentum12_1', 'momentumDelUniverso',
                               'MOM_DIAS', 'MOM_SALTO', 'MOM_MINIMO_DIAS']);
const C = cargar('cartera.js', ['ganaPorMomentum', 'TOLERANCIA_PUNTAJE_MOM',
                                'menuDeRotacion', 'UMBRAL_MENU_PTS']);

let ok = 0, fail = 0;
function chequear(nombre, cond, detalle) {
  if (cond) { ok++; console.log(`  ok    ${nombre}`); }
  else { fail++; console.log(`  FALLA ${nombre}${detalle ? ' -- ' + detalle : ''}`); }
}

console.log('='.repeat(76));
console.log('  1. EL CALCULO');
console.log('='.repeat(76));

// Una serie que sube 1% por dia durante 300 dias.
const sube = Array.from({ length: 300 }, (_, i) => 100 * Math.pow(1.01, i));
const m = R.momentum12_1(sube, 299);
// De t-252 a t-21 son 231 dias de 1% -> 1,01^231 - 1
const esperado = Math.pow(1.01, 231) - 1;
chequear('el momentum 12-1 saltea el ultimo mes',
  m != null && Math.abs(m - esperado) < 1e-9,
  `dio ${m}, esperaba ${esperado}`);

chequear('una serie corta no tiene momentum, devuelve null',
  R.momentum12_1(sube.slice(0, 100), 99) === null);
chequear('una serie que no es arreglo no rompe',
  R.momentum12_1(null, 10) === null && R.momentum12_1(undefined, 10) === null);

// ⚠️ EL CASO QUE IMPORTA: dos precios validos en los extremos pero con un pozo
// de nulos en el medio. Sin la guarda de MOM_MINIMO_DIAS esto devolveria un
// numero calculado sobre dos dias contiguos y lo llamaria "12 meses".
const conPozo = new Array(300).fill(null);
conPozo[280] = 100; conPozo[279] = 99;
chequear('dos precios sueltos con un pozo en el medio NO dan momentum',
  R.momentum12_1(conPozo, 299) === null);

console.log();
console.log('='.repeat(76));
console.log('  2. LOS QUINTILES, SOBRE EL SNAPSHOT REAL');
console.log('='.repeat(76));

const H = JSON.parse(fs.readFileSync(DATA + 'historico_precios.json', 'utf8'));
const tickers = Object.keys(H.series).slice(0, 40);
const mom = R.momentumDelUniverso(H, tickers, new Set());

const conQ = tickers.filter(t => mom[t] && mom[t].quintil != null);
chequear('la mayoria de los papeles pedidos tienen quintil',
  conQ.length > tickers.length * 0.7, `${conQ.length} de ${tickers.length}`);
chequear('los quintiles van de 1 a 5',
  conQ.every(t => mom[t].quintil >= 1 && mom[t].quintil <= 5));
chequear('el universo del corte son cientos de papeles, no los 40 pedidos',
  mom._universo > 300, `universo = ${mom._universo}`);

// ⚠️ EL QUINTIL SE MIDE CONTRA EL UNIVERSO, NO CONTRA LO PEDIDO.
// Si se midiera contra lo pedido, pedir 5 papeles daria uno en cada quintil
// por construccion y "Q5" no significaria nada.
const cinco = tickers.slice(0, 5);
const mom5 = R.momentumDelUniverso(H, cinco, new Set());
const q5 = cinco.filter(t => mom5[t] && mom5[t].quintil === 5).length;
chequear('pedir 5 papeles NO reparte uno por quintil: el corte es del universo',
  q5 !== 1 || cinco.some(t => mom5[t]?.quintil === mom[t]?.quintil),
  `${q5} en Q5 de 5 pedidos`);
for (const t of cinco) {
  if (mom[t]?.quintil != null && mom5[t]?.quintil != null) {
    chequear(`${t}: el quintil no cambia segun con quien se lo pida`,
      mom[t].quintil === mom5[t].quintil,
      `${mom[t].quintil} vs ${mom5[t].quintil}`);
  }
}

// Los que cotizan en pesos quedan afuera, con motivo. Su serie tiene la
// devaluacion adentro: "subio 300%" es la moneda, no la empresa.
const enPesos = new Set([tickers[0]]);
const momP = R.momentumDelUniverso(H, tickers.slice(0, 3), enPesos);
chequear('un papel en pesos no tiene momentum, y dice por que',
  momP[tickers[0]].quintil === null
  && momP[tickers[0]].momentum_pct === null
  && /pesos/.test(momP[tickers[0]].motivo || ''),
  JSON.stringify(momP[tickers[0]]));

console.log();
console.log('='.repeat(76));
console.log('  3. 🔴 EL DESEMPATE — las tres condiciones, juntas');
console.log('='.repeat(76));

const P = (puntaje, quintil) => ({ puntaje, momentum_quintil: quintil });

chequear('dispara: el alternativo esta en Q5, el lider no, y entra en tolerancia',
  C.ganaPorMomentum(P(80, 3), P(76, 5)) === true);

// EL CASO CF -> NEM. Los dos en Q5: el desempate no aporta y resignaria puntaje.
chequear('NO dispara si el lider YA esta en Q5 (el caso CF -> NEM)',
  C.ganaPorMomentum(P(85.5, 5), P(82, 5)) === false);

// EL CASO CHTR -> GOOGL. Q4 no es Q5: la ventaja medida no lo cubre.
chequear('NO dispara si el alternativo esta en Q4 (el caso CHTR -> GOOGL)',
  C.ganaPorMomentum(P(70.8, 1), P(65.8, 4)) === false);

chequear('NO dispara si la diferencia de puntaje supera la tolerancia',
  C.ganaPorMomentum(P(90, 2), P(90 - C.TOLERANCIA_PUNTAJE_MOM - 0.1, 5)) === false);
chequear('SI dispara justo en el borde de la tolerancia',
  C.ganaPorMomentum(P(90, 2), P(90 - C.TOLERANCIA_PUNTAJE_MOM, 5)) === true);

// No puede "desempatar" hacia arriba: si el alternativo puntua MAS, no es un
// desempate por momentum, es que el orden por puntaje estaba mal.
chequear('NO dispara si el alternativo puntua MAS que el lider',
  C.ganaPorMomentum(P(70, 2), P(80, 5)) === false);

chequear('sin quintil (dato faltante) no dispara',
  C.ganaPorMomentum(P(80, null), P(78, null)) === false
  && C.ganaPorMomentum(P(80, 2), P(78, null)) === false);
chequear('con argumentos nulos no rompe',
  C.ganaPorMomentum(null, P(1, 5)) === false
  && C.ganaPorMomentum(P(1, 1), null) === false);

console.log();
console.log('='.repeat(76));
console.log('  4. EL MENU COMPLETO');
console.log('='.repeat(76));

const cart = { sectores: [{ sector: 'Technology', excede: false, tope: 30 },
                          { sector: 'Energy', excede: false, tope: 30 },
                          { sector: 'Utilities', excede: true, tope: 20 }] };
const cand = (ticker, sector, puntaje, quintil, mejora) => ({
  ticker, sector, puntaje, momentum_quintil: quintil,
  mejora_vs_plan_pts: mejora, momentum_pct: quintil === 5 ? 60 : 5,
});
const riesgo = {
  disponible: true,
  candidatos: [
    // Technology: el lider puntua mas pero esta en Q3; hay uno en Q5 a 4 puntos
    cand('FSLR', 'Technology', 80.2, 3, 5.0),
    cand('MU',   'Technology', 76.0, 5, 4.0),
    // Energy: el lider YA esta en Q5 -> no se toca
    cand('APA',  'Energy', 81.0, 5, 3.0),
    cand('XOM',  'Energy', 79.0, 5, 3.5),
    // Utilities: el sector excede, no entra nadie
    cand('NEE',  'Utilities', 90.0, 5, 9.0),
  ],
};
const menu = C.menuDeRotacion(cart, riesgo);
const porSector = Object.fromEntries(menu.map(x => [x.sector, x]));

chequear('Technology: el desempate mueve el ganador a MU',
  porSector.Technology?.ticker === 'MU',
  porSector.Technology?.ticker);
chequear('y deja anotado a quien desplazo y cuanto costo',
  porSector.Technology?.desplazo_por_momentum?.ticker === 'FSLR'
  && Math.abs(porSector.Technology.desplazo_por_momentum.puntaje_resignado - 4.2) < 0.01,
  JSON.stringify(porSector.Technology?.desplazo_por_momentum));
chequear('Energy: el lider ya estaba en Q5, gana el de mejor puntaje sin tocar nada',
  porSector.Energy?.ticker === 'APA'
  && porSector.Energy?.desplazo_por_momentum === undefined,
  porSector.Energy?.ticker);
chequear('un sector que excede su tope no entra al menu, aunque tenga un Q5 de 90',
  !porSector.Utilities);

// La compuerta de riesgo manda SIEMPRE: un Q5 que no mejora la cartera de forma
// medible no se ofrece. El momentum no puede saltearla.
const riesgo2 = {
  disponible: true,
  candidatos: [
    cand('AAA', 'Technology', 80, 3, 5.0),
    cand('BBB', 'Technology', 78, 5, C.UMBRAL_MENU_PTS - 0.5),  // no pasa
  ],
};
const menu2 = C.menuDeRotacion(cart, riesgo2);
chequear('un Q5 que no pasa la compuerta de riesgo NO desplaza a nadie',
  menu2[0]?.ticker === 'AAA', menu2[0]?.ticker);

// Determinismo: dos corridas con los mismos datos, el mismo documento.
const a1 = JSON.stringify(C.menuDeRotacion(cart, riesgo));
const a2 = JSON.stringify(C.menuDeRotacion(cart, riesgo));
chequear('dos corridas con los mismos datos dan el mismo menu', a1 === a2);

console.log();
console.log('='.repeat(76));
console.log('  5. 🔴 QUE EL DATO LLEGUE AL PAYLOAD (el modo de falla de esta casa)');
console.log('='.repeat(76));
// Este proyecto ya perdio claves DOS veces por una whitelist que no las
// nombraba: se calculaban en el navegador y se tiraban antes de la llamada, sin
// error y sin aviso. Calcular el momentum y que no llegue seria exactamente el
// mismo bug, y de los que no se ven hasta que alguien lee un informe y nota que
// falta algo que creia que estaba.
const CT = cargar('cartera.js', ['armarDatosTesis']);
const cartE2E = {
  activos: [{ ticker: 'AAPL', peso: 40, sector: 'Technology', clase: 'core', valorActual: 4000 },
            { ticker: 'JPM', peso: 60, sector: 'Financials', clase: 'core', valorActual: 6000 }],
  porTicker: { AAPL: { peso: 40, sector: 'Technology' }, JPM: { peso: 60, sector: 'Financials' } },
  sectores: [{ sector: 'Technology', excede: false, tope: 30 },
             { sector: 'Financials', excede: false, tope: 30 }],
  valorTotalCartera: 10000, valorTotal: 10000,
};
const riesgoE2E = {
  disponible: true, ventana_dias: 756, sin_datos: [],
  posiciones: [
    { ticker: 'AAPL', volatilidad_pct: 28, aporte_al_riesgo_pct: 45, correlacion_media: 0.6,
      peso_objetivo_pct: 35, limitado_por_tope: false, momentum_pct: 31.4, momentum_quintil: 5 },
    { ticker: 'JPM', volatilidad_pct: 22, aporte_al_riesgo_pct: 55, correlacion_media: 0.5,
      peso_objetivo_pct: 65, limitado_por_tope: false, momentum_pct: 4.2, momentum_quintil: 2 }],
  candidatos: [cand('FSLR', 'Technology', 80.2, 3, 5.0), cand('MU', 'Technology', 76.0, 5, 4.0)],
};
const datos = CT.armarDatosTesis(cartE2E, null, [], {}, riesgoE2E);
const json = JSON.stringify(datos);
chequear('el momentum de la posicion sobrevive hasta el payload',
  /"momentum_quintil":5/.test(json) && /"momentum_pct":31.4/.test(json));
chequear('el menu del payload trae el ganador por momentum y a quien desplazo',
  /"desplazo_por_momentum"/.test(json) && /"ticker":"MU"/.test(json));

console.log();
console.log('='.repeat(76));
console.log('  6. LO QUE NO SE HIZO, Y TIENE QUE SEGUIR SIN HACERSE');
console.log('='.repeat(76));

// Si alguien agrega una regla de "evitar Q1", estas dos se prenden fuego.
chequear('estar en Q1 NO es motivo de nada: un lider en Q1 se queda',
  C.ganaPorMomentum(P(80, 1), P(78, 3)) === false
  && C.ganaPorMomentum(P(80, 1), P(78, 2)) === false);

// Si alguien convierte el desempate en "gana el de mayor momentum crudo".
chequear('el momentum CRUDO no decide: solo el quintil',
  C.ganaPorMomentum({ puntaje: 85, momentum_quintil: 5, momentum_pct: 10 },
                    { puntaje: 82, momentum_quintil: 5, momentum_pct: 490 }) === false);

const src = fs.readFileSync(ruta('cartera.js'), 'utf8');
chequear('el momentum no entra en el calculo del puntaje',
  !/puntaje[^\n]*momentum_pct|momentum_pct[^\n]*\+[^\n]*puntaje/.test(src),
  'aparece el momentum sumado al puntaje en cartera.js');

console.log();
console.log('='.repeat(76));
if (fail) {
  console.log(`  ${fail} FALLAS de ${ok + fail} comprobaciones`);
  process.exit(1);
}
console.log(`  ${ok} comprobaciones OK`);
console.log('  El quintil se mide contra el universo, el desempate exige las tres');
console.log('  condiciones juntas, y no hay ninguna regla sobre Q1.');
