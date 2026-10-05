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
//   5. que los numeros no cambien, sobre una ventana FIJA por fecha (ver el
//      bloque grande de la seccion 5: la version anterior usaba "los ultimos
//      N dias" y fallaba sola cada vez que el snapshot avanzaba)
//
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

// ⚠️ HAY DOS `App.jsx` EN ESTE REPO, Y SON DE PROYECTOS DISTINTOS:
//   src/App.jsx          -> el SCREENER   (es el que prueba este archivo)
//   src/informe/App.jsx  -> el INFORME
// Por eso acá NO se usa `ruta()`, que buscaría primero en src/informe/ y
// devolvería el equivocado sin decir nada. La separación entre los dos
// proyectos es la regla #1 del proyecto, y también vale para las pruebas.
const APP_SCREENER = path.join(RAIZ, 'src', 'App.jsx');


const SRC = fs.readFileSync(APP_SCREENER, 'utf8');
const SNAP = JSON.parse(fs.readFileSync(
  DATA + 'historico_precios.json', 'utf8'));

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
    // Los inventados se calculan a partir de cuantos hay: con 10 fijos sobre
    // 632 simbolos la cobertura daba 98%, o sea que este caso pasaba por
    // casualidad cuando la lista era corta y dejo de probar nada cuando crecio.
    // Ahora se piden los que hagan falta para quedar CLARAMENTE bajo el umbral.
    ['cobertura insuficiente',           () => { fetchRespuesta = { ok: true, json: async () => conFecha(1) }; }, SNAP.desde,
      [...simbolos, ...Array.from({ length: Math.ceil(simbolos.length * 0.4) },
                                  (_, i) => `XXX${i}`)]],
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
  console.log('\n5. Los numeros no se mueven: ventana FIJA por fecha');
  sandbox.fetch = async () => ({ ok: true, json: async () => conFecha(1) });
  API._reset();
  const rf = 0.04;   // calcRisk espera fraccion, no porcentaje
  const r5 = await API.snapshotHistorico(SNAP.desde, simbolos, anotar);
  const spyMap = API.buildSpyMap(r5.spyPrices);
  const spyAl = Object.keys(spyMap).sort().map(d => ({ s: spyMap[d], m: spyMap[d] }));

  // ─────────────────────────────────────────────────────────────────────────
  // ⚠️ LA VENTANA ES FIJA POR FECHA. NO ES "LOS ULTIMOS N DIAS".
  //
  // LA VERSION ANTERIOR DE ESTE BLOQUE ESTABA MAL, Y FALLO EL 05/10/2026 con
  // seis "errores" que no eran errores. Decia esto:
  //
  //   "Volatilidad y beta SI son estables (se miden sobre la misma ventana
  //    larga), asi que esas se siguen exigiendo con tolerancia fina."
  //
  // Es falso. La ventana era `.slice(-756)`: los ULTIMOS 756 dias del snapshot.
  // Cuando el snapshot avanzo de 1669 a 1698 fechas entraron 29 ruedas nuevas y
  // salieron 29 viejas, asi que la volatilidad y el beta se corrieron igual que
  // el retorno — solo mas despacio. El retorno es un cociente entre dos puntas y
  // 29 dias lo mueven mucho; la volatilidad es un promedio de cuadrados sobre
  // 756 dias y lo mueven poco. Pero lo mueven: 15,33 -> 15,26 con tolerancia de
  // 0,05. La prueba pedia precision sobre algo que se desplaza solo.
  //
  // SE VERIFICO QUE NO HABIA REGRESION, truncando el snapshot de hoy a las 1669
  // fechas del ancla:
  //
  //        ancla    truncado a 1669    hoy (1698)
  //   SPY 3Y vol   15,33     15,33            15,26
  //   JPM 3Y beta   0,86      0,86             0,87
  //   JPM 5Y vol   24,38     24,39            24,32
  //
  // Los numeros VUELVEN. El codigo hace lo mismo; lo que se movio es la ventana.
  //
  // EL ARREGLO. La ventana se define por una FECHA DE CORTE fija, no por el
  // final del snapshot. Mientras el snapshot contenga ese tramo, los numeros no
  // cambian nunca, por mas que Marcos corra los bots todos los dias. Lo unico
  // que los puede mover es:
  //   · un ajuste retroactivo por dividendos (chico: medido, <= 0,04 en
  //     volatilidad y <= 0,52 en retorno anualizado entre agosto y octubre), o
  //   · un cambio real en la matematica, que es justo lo que hay que cazar y
  //     que mueve los numeros MUCHO (el bug de la matriz desalineada llevo una
  //     correlacion de 0,816 a 0,037).
  // Las tolerancias se eligieron para que la primera pase y la segunda falle.
  // ─────────────────────────────────────────────────────────────────────────
  // ── QUE CAZA ESTE BLOQUE Y QUE NO (verificado inyectando bugs, 05/10/2026) ─
  //
  //   SI caza  · anualizar con 365 en vez de 252  -> 5 fallas
  //
  //   NO caza  · dividir la varianza por n en vez de n-1. Con 756 dias el
  //              efecto es 0,01 en volatilidad, y el piso de ruido de esta
  //              prueba es el ajuste por dividendos (medido: hasta 0,04). Esta
  //              DEBAJO del ruido: ninguna tolerancia puede separar las dos
  //              cosas acá. No se baja la tolerancia para "cazarlo" porque eso
  //              haria fallar la prueba por rutina, que es el problema que este
  //              bloque vino a arreglar.
  //
  //   NO caza  · parear los retornos por POSICION en vez de por FECHA (el bug
  //              mas caro del Motor B). Y no es ceguera: SPY y JPM cotizan
  //              TODOS los dias de la ventana —cero huecos— asi que para ellos
  //              las dos formas de parear dan lo mismo. Ese bug se caza donde
  //              corresponde, en `prueba-riesgo.cjs`, que usa papeles con
  //              huecos y tiene una regresion dedicada (verificado: inyectando
  //              el mis-pareo, prueba-riesgo da 2 fallas).
  //
  // La moraleja, por si alguien viene a "mejorar" las tolerancias: esta suite
  // prueba que la EXPANSION DEL SNAPSHOT entrega los numeros correctos, no que
  // la matematica de riesgo sea correcta. Eso ultimo es trabajo de prueba-riesgo.
  const ANCLA_HASTA = '2026-08-22';   // fecha de corte, FIJA
  const nAncla = SNAP.fechas.filter(f => f <= ANCLA_HASTA).length;

  // Si alguien regenera el snapshot con menos anios, la ventana de 1260 dias no
  // entra y mediriamos otra cosa en silencio. Se dice y se corta.
  const DIAS_MAX = 1260;
  if (nAncla < DIAS_MAX + 20) {
    chequear('la ventana del ancla entra en el snapshot', false,
      `hasta ${ANCLA_HASTA} hay ${nAncla} fechas y hacen falta ${DIAS_MAX}. `
      + `Si el snapshot se regenero con menos historia, hay que mover ANCLA_HASTA.`);
  } else {
    console.log(`     (ventana fija hasta ${ANCLA_HASTA}: ${nAncla} fechas, `
              + `ultima ${SNAP.fechas[nAncla - 1]}. El snapshot tiene `
              + `${SNAP.fechas.length} y sigue creciendo, pero esto no se mueve.)`);

    // Las series recortadas a la fecha de corte, con la misma forma que las
    // devuelve snapshotHistorico.
    const serieHasta = (sym) => {
      const out = [];
      for (let i = 0; i < nAncla; i++) {
        const c = SNAP.series[sym] ? SNAP.series[sym][i] : null;
        if (c != null) out.push({ date: SNAP.fechas[i], close: c });
      }
      return out;
    };
    const spyMapF = API.buildSpyMap(serieHasta('SPY'));
    const spyAlF = Object.keys(spyMapF).sort().map(d => ({ s: spyMapF[d], m: spyMapF[d] }));

    // Medidos sobre la ventana fija el 05/10/2026, con el codigo de App.jsx.
    const esperado = {
      'SPY 3Y': { d: 756,  ret: 21.82, vol: 15.34, beta: 1.00 },
      'SPY 5Y': { d: 1260, ret: 12.94, vol: 17.18, beta: 1.00 },
      'JPM 3Y': { d: 756,  ret: 35.73, vol: 23.00, beta: 0.87 },
      'JPM 5Y': { d: 1260, ret: 20.02, vol: 24.39, beta: 0.88 },
    };
    // Tolerancias dimensionadas al ajuste por dividendos, no al azar: ver arriba.
    const TOL_RET = 1.5, TOL_VOL = 0.15, TOL_BETA = 0.03;
    const cerca = (a, b, tol) => Math.abs(a - b) <= tol;
    const medido = {};

    for (const [nombre, e] of Object.entries(esperado)) {
      const [sym] = nombre.split(' ');
      const al = sym === 'SPY' ? spyAlF.slice(-e.d)
                               : API.alignedRet(serieHasta(sym), spyMapF).slice(-e.d);
      chequear(`${nombre}: la ventana trae los ${e.d} dias`, al.length === e.d,
        `trajo ${al.length}`);
      const m = API.calcRisk(al, rf);
      if (!m) { chequear(nombre, false, 'calcRisk devolvio null'); continue; }
      medido[nombre] = m;
      chequear(`${nombre} retorno ${m.annRet.toFixed(2)}% (ancla ${e.ret}, tol ${TOL_RET})`,
        cerca(m.annRet, e.ret, TOL_RET));
      chequear(`${nombre} volatilidad ${m.sVol.toFixed(2)}% (ancla ${e.vol}, tol ${TOL_VOL})`,
        cerca(m.sVol, e.vol, TOL_VOL));
      chequear(`${nombre} beta ${m.beta.toFixed(2)} (ancla ${e.beta}, tol ${TOL_BETA})`,
        cerca(m.beta, e.beta, TOL_BETA));
    }

    // ── LO QUE NO DEPENDE DE NINGUNA VENTANA ────────────────────────────────
    // Las anclas de arriba cazan "la matematica cambio". Estas cazan "la
    // matematica dice una barbaridad", y valen igual aunque el snapshot avance
    // diez anios. Son las que de verdad protegen.
    console.log('\n   invariantes (no dependen de la ventana)');
    const s3 = medido['SPY 3Y'], s5 = medido['SPY 5Y'];
    const j3 = medido['JPM 3Y'], j5 = medido['JPM 5Y'];
    if (s3 && j3 && s5 && j5) {
      chequear('el beta de SPY contra si mismo es exactamente 1',
        Math.abs(s3.beta - 1) < 1e-9 && Math.abs(s5.beta - 1) < 1e-9,
        `${s3.beta} / ${s5.beta}`);
      chequear('la volatilidad del indice cae en un rango creible (8% a 30%)',
        s3.sVol > 8 && s3.sVol < 30 && s5.sVol > 8 && s5.sVol < 30,
        `${s3.sVol.toFixed(2)} / ${s5.sVol.toFixed(2)}`);
      // Un banco suelto SIEMPRE es mas volatil que el indice: el indice es una
      // cartera de 500. Si esto se da vuelta, la cuenta esta mal.
      chequear('un papel suelto es mas volatil que el indice',
        j3.sVol > s3.sVol && j5.sVol > s5.sVol,
        `JPM ${j3.sVol.toFixed(2)} vs SPY ${s3.sVol.toFixed(2)}`);
      chequear('el beta de JPM es un numero de banco, no un absurdo (0,3 a 2,0)',
        j3.beta > 0.3 && j3.beta < 2 && j5.beta > 0.3 && j5.beta < 2,
        `${j3.beta.toFixed(2)} / ${j5.beta.toFixed(2)}`);
      // La ventana de 5 anios CONTIENE a la de 3: no pueden dar lo mismo salvo
      // casualidad, y si dan identico es que el slice no esta recortando.
      chequear('3Y y 5Y no dan el mismo numero (el recorte recorta)',
        Math.abs(s3.sVol - s5.sVol) > 0.01 && Math.abs(j3.sVol - j5.sVol) > 0.01);
    }
  }

  resumen();
}

function resumen() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(fail === 0 ? `TODO BIEN — ${ok} comprobaciones` : `${fail} FALLAS de ${ok + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('La prueba exploto:', e); process.exit(1); });
