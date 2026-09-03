// Prueba de LA COMPUERTA DE DATOS (`suficienciaDeDatos`).
//
// POR QUE EXISTE
// La cobertura estaba repartida en cinco campos con cinco escalas distintas:
// las metricas por posicion, la cobertura del calculo de riesgo, la cobertura
// de la cartera, la de industria y el nivel del informe individual. Cinco
// numeros que habia que cruzar mentalmente para contestar la unica pregunta
// que importa —¿alcanza para decidir?— y que nadie cruzaba.
//
// El resultado era el peor posible: el informe salia COMPLETO, con su tabla y
// su prosa, sobre una cartera de la que sabiamos la mitad.
//
// LO QUE SE PRUEBA ACA, y sobre todo lo ultimo:
//   1. que el veredicto sea uno solo y dependa de umbrales nombrados;
//   2. que una cartera completa NO dispare avisos falsos;
//   3. que `no_se_puede_afirmar` diga FRASES, no porcentajes — es lo unico
//      accionable de todo esto. Un "87% de cobertura" no le dice nada a nadie.
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

function inf(t, sector, industry) {
  return {
    ticker: t, nombre: t, sector, industry,
    veredicto: { puntaje: 65, etiqueta: 'neutral', accion: 'mantener' },
    riesgos: [],
    senales: [{ bloque: 'valuacion', titulo: 'V', puntaje: 40, notas: ['x'] }],
    fundamentales: { marketCap: 200e9, pe: 12, roe: 14 },
    consenso: { beta: 1.1, upsidePct: 6 },
  };
}
function armar(informes, valores, otros) {
  const pos = {};
  informes.forEach((i, k) => {
    pos[i.ticker] = { cantidad: 100, precioCompra: 10,
                      valorActual: valores[k], gananciaPct: 5 };
  });
  return C.analizarCartera(informes, pos, 'moderado', 'equilibrado', 'medio',
                           otros || { modo: 'monto', rentaFija: 0, efectivo: 0 });
}

const BUENA = [
  inf('AAPL', 'Technology', 'Consumer Electronics'),
  inf('KO',   'Consumer Staples', 'Beverages'),
  inf('JPM',  'Financials', 'Banks - Diversified'),
  inf('XOM',  'Energy', 'Oil & Gas'),
];
const SCORES_OK = { AAPL: { score: 70, nUsadas: 6, nAplicables: 6 },
                    KO:   { score: 61, nUsadas: 6, nAplicables: 6 },
                    JPM:  { score: 58, nUsadas: 5, nAplicables: 5 },
                    XOM:  { score: 66, nUsadas: 6, nAplicables: 6 } };
const RIESGO_OK = { disponible: true, cobertura_pct: 100, sin_datos: [] };

// ── 1. Una cartera completa NO puede disparar avisos ──────────────────────
// Es la mitad del valor de esto. Una compuerta que se queja siempre se ignora
// siempre, y entonces no protege de nada.
console.log('1. Cartera completa: sin ruido');
const cartOK = armar(BUENA, [3000, 3000, 2000, 2000]);
const sOK = C.suficienciaDeDatos(cartOK, RIESGO_OK, SCORES_OK);
console.log(`     ${sOK.nivel} · ${sOK.resumen}`);
chequear('el nivel es completo', sOK.nivel === 'completo',
  JSON.stringify(sOK.faltantes));
chequear('se puede decidir', sOK.puede_decidir === true);
chequear('sin reservas', sOK.con_reservas === false);
chequear('y NADA prohibido de decir',
  sOK.no_se_puede_afirmar.length === 0,
  sOK.no_se_puede_afirmar.join(' | '));

// ── 2. Sin riesgo: el hueco mas grande que puede haber ────────────────────
console.log('\n2. Sin el Motor B');
const sinRiesgo = C.suficienciaDeDatos(cartOK, { disponible: false,
  motivo: 'no está el histórico de precios' }, SCORES_OK);
console.log(`     ${sinRiesgo.nivel} · ${sinRiesgo.faltantes.length} faltante(s)`);
sinRiesgo.no_se_puede_afirmar.forEach(f => console.log(`       ✗ ${f}`));
chequear('queda parcial, no completo', sinRiesgo.nivel === 'parcial');
chequear('pero se puede decidir igual: es lo que hay',
  sinRiesgo.puede_decidir === true);
chequear('marcado con reservas, porque el hueco es grande',
  sinRiesgo.con_reservas === true);
chequear('prohibe hablar de volatilidad',
  sinRiesgo.no_se_puede_afirmar.some(f => f.includes('volatilidad')));
chequear('y prohibe hablar de aporte al riesgo',
  sinRiesgo.no_se_puede_afirmar.some(f => f.includes('riesgo')));
chequear('el faltante dice el MOTIVO, no solo que falta',
  sinRiesgo.faltantes.some(f => (f.detalle || '').includes('histórico')));

// ── 3. El riesgo cubre solo una parte ─────────────────────────────────────
// Es el caso de una cartera con papeles del Merval o con algo recien listado.
console.log('\n3. El riesgo cubre una parte');
const parcialR = C.suficienciaDeDatos(cartOK,
  { disponible: true, cobertura_pct: 62.5,
    sin_datos: [{ ticker: 'ALUA', motivo: 'cotiza en pesos' },
                { ticker: 'GEV', puntos: 12 }] },
  SCORES_OK);
console.log(`     ${parcialR.nivel}`);
parcialR.no_se_puede_afirmar.forEach(f => console.log(`       ✗ ${f}`));
chequear('la frase prohibida trae el numero de cobertura',
  parcialR.no_se_puede_afirmar.some(f => f.includes('62.5')
                                      || f.includes('62,5')));
chequear('y el detalle nombra a los que quedaron afuera CON su motivo',
  parcialR.faltantes.some(f => (f.detalle || '').includes('ALUA')
                            && (f.detalle || '').includes('cotiza en pesos')),
  JSON.stringify(parcialR.faltantes.map(f => f.detalle)));

// ── 4. Cartera parcial: el caso que degrada todo ──────────────────────────
console.log('\n4. La cartera analizada es un pedazo');
// 40% de cobertura: el resto de la cartera del cliente no se ve.
const parcial = armar(BUENA, [1000, 1000, 1000, 1000],
                      { modo: 'monto', rentaFija: 6000, efectivo: 0 });
const sPar = C.suficienciaDeDatos(parcial, RIESGO_OK, SCORES_OK);
console.log(`     cobertura ${parcial.cobertura}% -> ${sPar.nivel}`);
chequear('con menos del 50% NO se puede decidir',
  parcial.cobertura < 50 ? sPar.puede_decidir === false : true,
  `cobertura ${parcial.cobertura}%`);
chequear('y el resumen lo dice en castellano',
  sPar.resumen.length > 20);

// ── 5. Posiciones sin puntaje ─────────────────────────────────────────────
// El caso FISV: score null porque Yahoo no trae los datos. Un null NO es un
// puntaje bajo, y la diferencia importa porque un null se lee como cero en
// cualquier promedio.
console.log('\n5. Posiciones sin puntaje publicable');
const sinScore = { AAPL: { score: null, nUsadas: 2, nAplicables: 6 },
                   KO:   { score: null, nUsadas: 1, nAplicables: 6 },
                   JPM:  { score: 58, nUsadas: 5, nAplicables: 5 },
                   XOM:  { score: 66, nUsadas: 6, nAplicables: 6 } };
const sSc = C.suficienciaDeDatos(cartOK, RIESGO_OK, sinScore);
console.log(`     ${sSc.nivel}`);
sSc.no_se_puede_afirmar.forEach(f => console.log(`       ✗ ${f}`));
chequear('los nombra uno por uno',
  sSc.faltantes.some(f => (f.detalle || '').includes('AAPL')
                       && (f.detalle || '').includes('KO')));
chequear('con la mitad sin puntaje, prohibe hablar de calidad promedio',
  sSc.no_se_puede_afirmar.some(f => f.includes('calidad')));
chequear('y lo marca como grave', sSc.con_reservas === true);
// ── SE MIDE POR PESO, NO POR CONTEO ────────────────────────────────────────
// Es la misma leccion que este proyecto aprendio dos veces con los sectores.
// Una posicion del 1% sin puntaje no invalida nada; una del 40% si. Contando
// papeles las dos pesan igual, y entonces un papel chico y raro apagaria el
// informe entero.
console.log('     (y ahora por PESO, no por conteo)');
const CHICO = [inf('AAPL', 'Technology', 'X'), inf('KO', 'Consumer Staples', 'Y'),
               inf('ZZZ', 'Materials', 'Z')];
const scChico = { AAPL: SCORES_OK.AAPL, KO: SCORES_OK.KO,
                  ZZZ: { score: null, nUsadas: 2, nAplicables: 6 } };
// ZZZ es 1 de 3 papeles (33% por conteo) pero solo el 2% de la plata.
const cartChico = armar(CHICO, [5000, 4800, 200]);
const sChico = C.suficienciaDeDatos(cartChico, RIESGO_OK, scChico);
console.log(`     ZZZ: 1 de 3 papeles pero ${cartChico.activos.find(a => a.ticker === 'ZZZ').peso}% de la plata`);
chequear('un papel chico sin puntaje se ANOTA',
  sChico.faltantes.some(f => f.que === 'puntaje fundamental'));
chequear('pero NO calla nada: seria una alarma falsa',
  sChico.no_se_puede_afirmar.length === 0,
  sChico.no_se_puede_afirmar.join('|'));
chequear('y no es grave', sChico.con_reservas === false);

// El mismo papel, ahora grande.
const cartGrande = armar(CHICO, [3000, 3000, 4000]);
const sGrande = C.suficienciaDeDatos(cartGrande, RIESGO_OK, scChico);
console.log(`     el mismo papel al ${cartGrande.activos.find(a => a.ticker === 'ZZZ').peso}%`);
chequear('el MISMO papel, pesando 40%, si calla la frase',
  sGrande.no_se_puede_afirmar.some(f => f.includes('calidad')),
  sGrande.no_se_puede_afirmar.join('|'));
chequear('el detalle dice cuanto pesan, no solo cuantos son',
  sGrande.faltantes.some(f => (f.detalle || '').includes('pesan el')));

// ── 6. Una sola posicion no es una cartera ────────────────────────────────
console.log('\n6. Bordes');
const unaSola = armar([BUENA[0]], [5000]);
const sUna = C.suficienciaDeDatos(unaSola, RIESGO_OK,
                                  { AAPL: SCORES_OK.AAPL });
chequear('con una posicion NO se puede decidir',
  sUna.puede_decidir === false && sUna.nivel === 'insuficiente');
chequear('y se prohibe hablar de diversificacion',
  sUna.no_se_puede_afirmar.some(f => f.includes('diversificación')));
chequear('sin cartera devuelve null', C.suficienciaDeDatos(null) === null);
const sSinNada = C.suficienciaDeDatos(cartOK);
chequear('sin riesgo ni scores no explota y marca los dos huecos',
  sSinNada && sSinNada.faltantes.length >= 2, JSON.stringify(sSinNada));

// ── 7. Los umbrales se pueden discutir de a uno ───────────────────────────
console.log('\n7. Los umbrales estan nombrados');
console.log(`     minimo ${C.MINIMO_POSICIONES} posiciones · `
          + `cobertura minima ${C.COBERTURA_MINIMA_PCT}% · `
          + `plena ${C.COBERTURA_PLENA_PCT}%`);
chequear('los tres son constantes exportadas, no numeros sueltos',
  C.MINIMO_POSICIONES === 2 && C.COBERTURA_MINIMA_PCT === 50
  && C.COBERTURA_PLENA_PCT === 95);
chequear('la plena es mas exigente que la minima',
  C.COBERTURA_PLENA_PCT > C.COBERTURA_MINIMA_PCT);

// ── 8. Lo que llega al modelo y al cliente ────────────────────────────────
console.log('\n8. Lo que viaja');
const datos = C.armarDatosTesis(cartOK, null, [], SCORES_OK, RIESGO_OK);
chequear('el bloque `datos` esta en el payload de la tesis', !!datos.datos);
chequear('y trae la lista de frases prohibidas, no los porcentajes',
  Array.isArray(datos.datos.no_se_puede_afirmar));
const bytes = JSON.stringify(datos.datos).length;
console.log(`     ${bytes} caracteres = ~${Math.round(bytes / 3.6)} tokens`);
chequear('pesa menos de 120 tokens', bytes / 3.6 < 120, `${bytes} chars`);

// Y el texto del cliente tiene que enterarse SOLO cuando no se puede decidir:
// un texto que arranca disculpandose por los datos cuando los datos estan bien
// es peor que no decir nada.
const hOK = C.hechosParaElCliente(datos);
chequear('con datos completos, el cliente no se entera de nada',
  hOK.datos_insuficientes === undefined);
const flojo = C.armarDatosTesis(unaSola, null, [], { AAPL: SCORES_OK.AAPL },
                                RIESGO_OK);
const hMal = C.hechosParaElCliente(flojo);
chequear('y cuando NO se puede decidir, si',
  hMal.datos_insuficientes === true, JSON.stringify(flojo.datos));

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
