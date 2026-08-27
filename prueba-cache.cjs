// Fase A — el caché de histórico adelgazado.
//
// Simula localStorage CON CUOTA, que es lo que el bug necesitaba para
// manifestarse: con un localStorage infinito (como el de un test ingenuo) el
// caché "funcionaba" siempre y el problema era invisible.
let almacen = {}, cuotaBytes = 5_000_000, avisos = []
global.localStorage = {
  getItem: k => almacen[k] ?? null,
  removeItem: k => { delete almacen[k] },
  setItem: (k, v) => {
    const usado = Object.entries(almacen)
      .filter(([kk]) => kk !== k).reduce((a, [, vv]) => a + vv.length, 0)
    if (usado + v.length > cuotaBytes) {
      const e = new Error('exceeded the quota'); e.name = 'QuotaExceededError'; throw e
    }
    almacen[k] = v
  },
}
const warnReal = console.warn
// Se captura durante TODA la corrida: el aviso ocurre dentro de histCacheSave,
// no al importar. Restaurarlo antes de los tests era el error del harness.
console.warn = (...a) => { avisos.push(a.join(' ')) }

const M = require('./extraido-cache.cjs')

let f = 0
const check = (c, m) => { if (!c) { console.log('  ✗ ' + m); f++ } }

// Genera histórico con la forma EXACTA que devuelve api/data.py (7 campos)
function serie(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const c = 100 + Math.sin(i / 9) * 12
    out.push({ date: `20${20 + Math.floor(i / 252)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
               close: +c.toFixed(4), adjClose: +c.toFixed(4), open: +(c - .4).toFixed(4),
               high: +(c + .6).toFixed(4), low: +(c - .9).toFixed(4),
               volume: 30_000_000 + i })
  }
  return out
}
const hist = n => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`SYM${i}`, serie(6 * 252)]))

console.log('='.repeat(70))
console.log('PESO DEL CACHÉ, antes y después\n')
for (const n of [20, 40, 80, 150]) {
  const h = hist(n)
  const gordo = JSON.stringify({ hist: h, spyPrices: serie(1512), from: '2020-01-01', timestamp: 1 }).length
  const flaco = JSON.stringify({ hist: M.adelgazarHist(h), spyPrices: serie(1512).map(d => ({ date: d.date, close: d.close })), from: '2020-01-01', timestamp: 1 }).length
  const entraba = gordo <= cuotaBytes, entra = flaco <= cuotaBytes
  console.log(`  ${String(n).padStart(3)} símbolos: ${(gordo/1e6).toFixed(1).padStart(5)} MB ${entraba ? '(entraba)' : '(NO ENTRABA)'}` +
              `  ->  ${(flaco/1e6).toFixed(1).padStart(4)} MB ${entra ? '(entra)' : '(NO ENTRA)'}`)
  if (n <= 80) check(entra, `${n} símbolos deberían entrar después de adelgazar`)
}

console.log('\nCOMPORTAMIENTO\n')
// 1. guarda y recupera
almacen = {}; avisos = []
const h40 = hist(40)
const ok = M.histCacheSave(h40, serie(1512), '2020-01-01', 40)
check(ok === true, 'con 40 símbolos ahora tiene que guardar')
const leido = M.histCacheLoad('2020-01-01')
check(leido != null, 'y tiene que poder leerse de vuelta')
check(Object.keys(leido.hist).length === 40, 'con los 40 símbolos')
console.log(`  guarda 40 símbolos y los recupera: ${leido ? 'sí' : 'NO'}`)

// 2. los cálculos siguen funcionando sobre lo adelgazado
const ret = M.toDailyRet(leido.hist.SYM0)
check(ret.length === 6 * 252 - 1, `toDailyRet debería dar ${6*252-1} retornos, dio ${ret.length}`)
check(ret.every(r => Number.isFinite(r.r) && r.date), 'todos los retornos tienen que ser números con fecha')
const gordoRet = M.toDailyRet(h40.SYM0)
check(JSON.stringify(ret) === JSON.stringify(gordoRet),
      'los retornos del caché flaco tienen que ser IDÉNTICOS a los del gordo')
console.log(`  los retornos salen idénticos al histórico completo: sí (${ret.length} puntos)`)

// 3. lo que se tiró no se usa
const dia = leido.hist.SYM0[0]
check(Object.keys(dia).sort().join(',') === 'close,date', `cada día debería tener solo date+close, tiene: ${Object.keys(dia)}`)
console.log(`  cada día guarda: ${Object.keys(dia).join(', ')}`)

// 4. si NO entra, ahora avisa en vez de callarse
almacen = {}; avisos = []; cuotaBytes = 1_000_000
const ok2 = M.histCacheSave(hist(60), serie(1512), '2020-01-01', 60)
check(ok2 === false, 'si no entra tiene que devolver false')
check(avisos.some(a => a.includes('No se pudo guardar')), 'y tiene que avisar por consola')
check(!almacen['sp500_hist_prices_v1'], 'y no dejar un caché a medias')
console.log(`  cuando no entra: devuelve false y avisa -> "${(avisos[0]||'').slice(0, 62)}..."`)
cuotaBytes = 5_000_000

// 5. no cachear incompleto sigue igual
almacen = {}; avisos = []
const ok3 = M.histCacheSave(hist(5), serie(100), '2020-01-01', 40)
check(ok3 === false, 'un histórico incompleto no se cachea')
check(!almacen['sp500_hist_prices_v1'], 'y no queda guardado')
console.log('  histórico incompleto: sigue sin cachearse')

// 6. caché vencido y período insuficiente
almacen = {}
M.histCacheSave(hist(10), serie(1512), '2021-01-01', 10)
check(M.histCacheLoad('2019-01-01') === null, 'un caché que arranca en 2021 no sirve si piden desde 2019')
check(M.histCacheLoad('2022-01-01') != null, 'pero sí si piden desde 2022')
const viejo = JSON.parse(almacen['sp500_hist_prices_v1'])
viejo.timestamp = Date.now() - 9 * 86400000
almacen['sp500_hist_prices_v1'] = JSON.stringify(viejo)
check(M.histCacheLoad('2022-01-01') === null, 'un caché de 9 días tiene que estar vencido')
console.log('  vencimiento y cobertura del período: sin cambios')

// 7. entradas raras
almacen = {}
for (const raro of [{}, { A: null }, { A: 'x' }, { A: [] }]) {
  try { M.adelgazarHist(raro) } catch (e) { console.log(`  ✗ adelgazarHist explota con ${JSON.stringify(raro)}`); f++ }
}
console.log('  entradas raras: no explota')

console.warn = warnReal
console.log('\n' + '='.repeat(70))
console.log(f ? `${f} FALLOS` : 'FASE A OK — el caché ahora entra, avisa si no, y los números no cambian')
process.exit(f ? 1 : 0)
