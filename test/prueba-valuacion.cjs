// Prueba de la FASE D: el P/E contra su propia historia.
//
// LA PREGUNTA QUE ESTO CONTESTA, y que el resto del informe no podia:
// todo el puntaje del proyecto es un percentil DENTRO DEL SECTOR. Eso dice si
// un papel esta caro contra sus pares; no dice si esta caro para lo que EL
// suele valer. Y las dos respuestas se contradicen seguido: un papel puede ser
// el mas caro de su sector y estar en el punto mas barato de su historia.
//
// Se prueba con datos REALES del snapshot cuando estan, y con series armadas a
// mano para los casos que el snapshot no tiene (EPS negativo, pocos puntos).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');
const DATA = path.join(RAIZ, 'public', 'data');

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
  const sb = { console, Math, Object, Array, Number, Set, Map, JSON, Date,
               isFinite, isNaN, Promise };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return vm.runInContext(`({${ex.join(',')}})`, sb);
}

const V = cargar('valuacionHistorica.js');

let ok = 0, fail = 0;
const chequear = (n, c, d) => c
  ? (ok++, console.log(`  ok    ${n}`))
  : (fail++, console.log(`  FALLA ${n}${d ? ' -- ' + d : ''}`));

// ── 1. EL LAG: no se puede usar un balance antes de que se publique ───────
// Sin esto, el P/E historico saldria sistematicamente mas barato de lo que
// fue: se estaria mirando el pasado con informacion que ese dia nadie tenia.
console.log('1. El EPS se conoce despues del cierre, no el mismo dia');
const EPS = { '2022-12-31': 4.0, '2023-12-31': 5.0, '2024-12-31': 6.0 };
const conocidos = V.epsConocidoDesde(EPS);
console.log('     ' + conocidos.map(c => `${c.cierre}->${c.desde}`).join(' · '));
chequear('cada balance se aplica DESPUES de su cierre',
  conocidos.every(c => c.desde > c.cierre));
chequear(`el lag es de ${V.DIAS_DE_LAG} dias`,
  conocidos.every(c => {
    const d = (Date.parse(c.desde) - Date.parse(c.cierre)) / 86400000;
    return Math.abs(d - V.DIAS_DE_LAG) <= 1;
  }));
chequear('vienen ordenados por fecha de publicacion',
  conocidos.every((c, i) => i === 0 || conocidos[i - 1].desde <= c.desde));
chequear('un EPS null no genera entrada',
  V.epsConocidoDesde({ '2023-12-31': null, '2024-12-31': 6 }).length === 1);
chequear('sin EPS devuelve lista vacia, no explota',
  V.epsConocidoDesde(null).length === 0);

// ── 2. La serie de P/E ────────────────────────────────────────────────────
console.log('\n2. La serie: precio de cada dia / EPS conocido ese dia');
// Dos años de fechas, precio fijo en 60. Con EPS 4 y despues 5, el P/E tiene
// que saltar de 15 a 12 el dia que se publica el balance.
function fechasEntre(desde, hasta) {
  const out = [];
  for (let t = Date.parse(desde); t <= Date.parse(hasta); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const F = fechasEntre('2023-01-01', '2025-06-30');
const PRECIO = F.map(() => 60);
const s = V.seriePE(F, PRECIO, EPS);
console.log(`     ${s.length} puntos · primero ${s[0].fecha} P/E `
          + `${s[0].pe.toFixed(1)} · ultimo ${s[s.length - 1].fecha} P/E `
          + `${s[s.length - 1].pe.toFixed(1)}`);
chequear('arranca recien cuando hay un balance publicado',
  s[0].fecha > '2022-12-31');
chequear('con EPS 4 y precio 60, el P/E es 15', Math.abs(s[0].pe - 15) < 1e-9);
// La serie llega a junio de 2025, asi que el ultimo balance publicado es el de
// 2024 (EPS 6): 60/6 = 10. El de 2023 (EPS 5, P/E 12) queda en el medio.
chequear('y con el ultimo balance publicado (EPS 6) es 10',
  Math.abs(s[s.length - 1].pe - 10) < 1e-9, `${s[s.length - 1].pe}`);
chequear('el nivel intermedio existe y es 12 (EPS 5)',
  s.some(x => Math.abs(x.pe - 12) < 1e-9));
// El salto tiene que ocurrir UNA vez por balance, no gradualmente.
const distintos = new Set(s.map(x => Math.round(x.pe * 1000)));
chequear('hay exactamente tres niveles de P/E (uno por balance)',
  distintos.size === 3, `${distintos.size}`);

// ── 3. EPS <= 0 NO da un P/E ──────────────────────────────────────────────
// Es el mismo error que el P/B negativo, que ya costo un bug entero: un
// numero negativo no significa "barato", significa "no aplica".
console.log('\n3. Con ganancia negativa no hay P/E');
const conPerdida = V.seriePE(F, PRECIO, { '2022-12-31': -2.0 });
chequear('un EPS negativo no genera ningun punto',
  conPerdida.length === 0, `${conPerdida.length} puntos`);
chequear('y un EPS cero tampoco',
  V.seriePE(F, PRECIO, { '2022-12-31': 0 }).length === 0);
// Y un P/E absurdo (ganancia casi cero) tampoco entra: arrastra toda la escala.
const casiCero = V.seriePE(F, PRECIO, { '2022-12-31': 0.01 });
chequear(`un P/E arriba de ${V.PE_MAXIMO_UTIL} se descarta`,
  casiCero.length === 0, `${casiCero.length} puntos`);

// Los dias sin cotizar (null) se saltean, no se rellenan.
const conHuecos = PRECIO.map((p, i) => (i % 7 === 0 ? null : p));
chequear('los dias sin cotizar se saltean',
  V.seriePE(F, conHuecos, EPS).length < s.length);

// ── 4. El veredicto ───────────────────────────────────────────────────────
console.log('\n4. Donde cae el P/E de hoy');
// Precio que sube linealmente: el P/E de hoy tiene que quedar en el percentil
// mas alto de su propia historia.
const SUBE = F.map((_, i) => 40 + i * 0.05);
const caro = V.valuacionContraSuHistoria(F, SUBE, { '2022-12-31': 4.0 });
console.log(`     precio en alza -> P/E ${caro.pe_propio} · percentil `
          + `${caro.percentil} · "${caro.lectura}"`);
chequear('con el precio subiendo, queda en el percentil mas alto',
  caro.percentil >= 95, `${caro.percentil}`);
chequear('y la lectura lo dice sin jerga',
  caro.lectura.includes('mas cara') || caro.lectura.includes('más cara'),
  caro.lectura);
chequear('trae la mediana, los cuartiles y los extremos',
  caro.mediana != null && caro.p25 != null && caro.p75 != null
  && caro.minimo != null && caro.maximo != null);
chequear('el p25 es menor que el p75', caro.p25 < caro.p75);
chequear('y vs_mediana_pct es positivo', caro.vs_mediana_pct > 0);

const BAJA = F.map((_, i) => 100 - i * 0.05);
const barato = V.valuacionContraSuHistoria(F, BAJA, { '2022-12-31': 4.0 });
console.log(`     precio en baja -> P/E ${barato.pe_propio} · percentil `
          + `${barato.percentil} · "${barato.lectura}"`);
chequear('con el precio bajando, queda en el percentil mas bajo',
  barato.percentil <= 5, `${barato.percentil}`);
chequear('y vs_mediana_pct es negativo', barato.vs_mediana_pct < 0);

// ── LA SERIE QUE NO SE MOVIO ───────────────────────────────────────────────
// Un P/E constante tiene TODA la serie empatada con el valor de hoy. Contando
// solo los menores estrictos, eso daba percentil 0: "en la parte mas barata de
// su propia historia", cuando la verdad es que esta exactamente donde siempre
// estuvo. El numero salia igual y sonaba a senal.
const plano = V.valuacionContraSuHistoria(F, PRECIO, { '2022-12-31': 4.0 });
console.log(`     precio plano -> percentil ${plano.percentil} · `
          + `dispersion ${plano.ancho_relativo_pct}% · "${plano.lectura}"`);
chequear('con la serie empatada, el percentil es 50, no 0',
  plano.percentil === 50, `${plano.percentil}`);
chequear('se declara SIN dispersion', plano.hay_dispersion === false);
chequear('y la lectura dice que no se movio, no que este barata',
  plano.lectura.includes('casi no se movió'), plano.lectura);

// Y al reves: una serie con recorrido de verdad SI tiene lectura.
chequear('una serie con recorrido si tiene dispersion',
  caro.hay_dispersion === true, `${caro.ancho_relativo_pct}%`);

// ── 5. Los dos P/E son DISTINTOS, y se dice ───────────────────────────────
// El del informe es TTM (Yahoo); el de acá usa el EPS anual reportado. Si se
// mostraran como si fueran el mismo, uno de los dos parece un error.
console.log('\n5. El P/E propio y el TTM del informe conviven');
const conTTM = V.valuacionContraSuHistoria(F, PRECIO, { '2022-12-31': 4.0 }, 13.2);
chequear('el TTM del informe viaja aparte',
  conTTM.pe_ttm_informe === 13.2 && conTTM.pe_propio === 15);
chequear('la nota explica que NO son el mismo numero',
  conTTM.nota.includes('TTM'));
chequear('y que el percentil se calcula contra la serie propia',
  conTTM.percentil != null);

// ── 6. Sin datos suficientes NO se inventa nada ───────────────────────────
console.log('\n6. Cuando no alcanza');
const corto = fechasEntre('2024-06-01', '2024-08-01');
const pocos = V.valuacionContraSuHistoria(corto, corto.map(() => 60),
                                          { '2024-01-31': 4 });
console.log(`     ${pocos.n_puntos} puntos -> ${pocos.motivo}`);
chequear('con pocos puntos se declara no disponible',
  pocos.disponible === false);
chequear('y el motivo dice cuantos hay y cuantos hacen falta',
  pocos.motivo.includes(String(V.MINIMO_PUNTOS)));
chequear('sin EPS tampoco inventa',
  V.valuacionContraSuHistoria(F, PRECIO, {}).disponible === false);
chequear('ni sin precios',
  V.valuacionContraSuHistoria(F, null, EPS).disponible === false);

// ── 7. Sobre el snapshot REAL ─────────────────────────────────────────────
console.log('\n7. Sobre el snapshot real');
const pHist = path.join(DATA, 'historico_precios.json');
if (!fs.existsSync(pHist)) {
  console.log('     (no esta historico_precios.json: se saltea)');
} else {
  const H = JSON.parse(fs.readFileSync(pHist, 'utf8'));
  // Un EPS inventado pero con la forma real: lo que se prueba acá es que la
  // funcion aguante 1.677 fechas y los `null` de verdad, no el numero.
  const epsReal = { '2021-12-31': 5.0, '2022-12-31': 5.5, '2023-12-31': 6.0,
                    '2024-12-31': 6.5, '2025-12-31': 7.0 };
  let corridos = 0, disponibles = 0;
  for (const t of ['AAPL', 'MSFT', 'KO', 'JPM', 'XOM']) {
    if (!H.series[t]) continue;
    corridos++;
    const r = V.valuacionContraSuHistoria(H.fechas, H.series[t], epsReal);
    if (r.disponible) {
      disponibles++;
      console.log(`     ${t.padEnd(5)} P/E ${String(r.pe_propio).padStart(6)} · `
                + `mediana ${String(r.mediana).padStart(6)} · pct `
                + `${String(r.percentil).padStart(3)} · ${r.n_puntos} puntos`);
      chequear(`${t}: el percentil esta entre 0 y 100`,
        r.percentil >= 0 && r.percentil <= 100);
      chequear(`${t}: el minimo <= mediana <= maximo`,
        r.minimo <= r.mediana && r.mediana <= r.maximo);
      chequear(`${t}: los puntos del grafico estan adelgazados`,
        r.puntos.length <= 130, `${r.puntos.length}`);
    }
  }
  chequear('corrio sobre al menos 3 papeles reales', corridos >= 3, `${corridos}`);
  chequear('y todos dieron una serie usable', disponibles === corridos,
    `${disponibles}/${corridos}`);
}

console.log(`\n${'-'.repeat(64)}`);
console.log(fail === 0 ? `TODO BIEN -- ${ok} comprobaciones`
                       : `${fail} FALLAS de ${ok + fail}`);
process.exit(fail === 0 ? 0 : 1);
