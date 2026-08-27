const HIST_CACHE_KEY = 'sp500_hist_prices_v1';

const HIST_CACHE_DAYS = 7;

function lsGet(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch { return null; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function adelgazarHist(hist) {
  const out = {};
  for (const [sym, serie] of Object.entries(hist || {})) {
    if (!Array.isArray(serie)) continue;
    out[sym] = serie.map(d => ({ date: d.date, close: d.close }));
  }
  return out;
}

function histCacheSave(hist, spyPrices, from, expectedCount) {
  // No cachear resultados incompletos — si faltó más del 15% de los símbolos
  // esperados, es mejor reintentar la próxima vez que guardar un caché roto
  // que se reutilizaría durante 7 días sin volver a pedir lo que falta.
  const gotCount = Object.keys(hist).length;
  if (expectedCount && gotCount < expectedCount * 0.85) {
    console.warn(`Histórico incompleto (${gotCount}/${expectedCount}) — no se cachea, para reintentar la próxima corrida.`);
    return false;
  }
  const payload = {
    hist: adelgazarHist(hist),
    spyPrices: (spyPrices || []).map(d => ({ date: d.date, close: d.close })),
    from, timestamp: Date.now(),
  };
  // Acá NO se usa lsSet: su `catch {}` vacío es justamente lo que escondía el
  // problema durante meses. Si el caché no entra, tiene que decirlo.
  try {
    localStorage.setItem(HIST_CACHE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    const mb = (JSON.stringify(payload).length / 1e6).toFixed(1);
    console.warn(`No se pudo guardar el caché de histórico (${mb} MB, ${gotCount} símbolos): ` +
                 `${e && e.name}. La próxima corrida va a volver a descargar. ` +
                 `Si se repite, achicá el período o la cantidad de activos.`);
    return false;
  }
}

function histCacheLoad(fromRequired) {
  const d = lsGet(HIST_CACHE_KEY);
  if (!d) return null;
  const ageDays = (Date.now() - d.timestamp) / 86400000;
  if (ageDays > HIST_CACHE_DAYS) return null;
  // Válido si el from cacheado cubre el período pedido
  if (d.from > fromRequired) return null;
  return d;
}

function toDailyRet(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++)
    if (prices[i-1].close > 0)
      out.push({ date: prices[i].date, r: (prices[i].close - prices[i-1].close) / prices[i-1].close });
  return out;
}

module.exports = { adelgazarHist, histCacheSave, histCacheLoad, toDailyRet,
                   HIST_CACHE_KEY, HIST_CACHE_DAYS };
