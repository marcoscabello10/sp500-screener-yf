#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bot del INFORME AVANZADO — datos por activo
============================================

Proyecto SEPARADO del screener. Este script es totalmente independiente:
no importa nada de fetch_fundamentals.py, asi que aunque tenga un bug no
puede afectar al screener. Lo unico que hace con archivos del screener es
LEER sp500_fundamentals.json (solo lectura) para saber que tickers ya estan
cubiertos. Nunca lo escribe.

Por que existe (dos problemas, una solucion)
---------------------------------------------
1. Tickers fuera del S&P 500. La cartera propia (F5) puede tener papeles
   como RGTI o HIMS que no estan entre las 503, asi que no aparecen en el
   snapshot del screener. Este bot les trae los fundamentales completos.

2. Consenso forward y sentimiento. earnings_estimate, revenue_estimate,
   upgrades_downgrades y eps_revisions SOLO salen de Yahoo, y Vercel no
   puede llamar a Yahoo (bloquea IPs de datacenter). Tienen que viajar en un
   snapshot. Traerlos para los 504 llevaria el bot del screener de ~4 a ~17
   minutos todos los dias — pero el informe se ofrece solo para los que
   pasaron el screening mas la cartera propia, o sea decenas. Aca se traen
   solo para esa lista corta.

Uso
---
    cd local_bot

    # opcion A: tickers por linea de comandos
    python fetch_informe.py AAPL MSFT RGTI HIMS

    # opcion B: sin argumentos, lee local_bot/tickers_informe.txt
    python fetch_informe.py

    # empezar de cero en vez de acumular sobre lo ya bajado
    python fetch_informe.py --reset AAPL MSFT

Por defecto ACUMULA: los tickers que ya estaban en el archivo de salida se
conservan y solo se reemplazan los que pediste ahora. Asi podes agregar
papeles de a poco sin volver a bajar todo.

Salida
------
    public/data/informe_detalle.json

Requisitos: yfinance >= 1.4.1 (los endpoints de analistas no existen en 0.2.x)
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print('[X] Falta yfinance. Instalalo con: pip install "yfinance>=1.4.1"')
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print('[X] Falta pandas. Instalalo con: pip install pandas')
    sys.exit(1)


# Yahoo usa nombres de sector propios; los normalizamos a los mismos que usa
# el screener para que el informe pueda compararse contra los percentiles por
# sector que F1 ya calcula.
SECTOR_YF_MAP = {
    'Technology': 'Technology',
    'Healthcare': 'Healthcare',
    'Financial Services': 'Financials',
    'Consumer Cyclical': 'Consumer Discretionary',
    'Consumer Defensive': 'Consumer Staples',
    'Communication Services': 'Communication Services',
    'Industrials': 'Industrials',
    'Energy': 'Energy',
    'Utilities': 'Utilities',
    'Real Estate': 'Real Estate',
    'Basic Materials': 'Materials',
}

CONSENSO_FIELDS = (
    'recommendationKey', 'recommendationMean', 'numberOfAnalystOpinions',
    'targetMeanPrice', 'targetMedianPrice', 'targetHighPrice', 'targetLowPrice',
    'currentPrice', 'trailingEps', 'forwardEps', 'earningsGrowth', 'revenueGrowth',
)

MAX_UPGRADES = 15  # cuantas revisiones de analistas guardamos por activo


# ─── helpers ────────────────────────────────────────────────────────────────

def jsonable(obj):
    """Convierte DataFrames / Series / Timestamps a algo serializable a JSON."""
    if obj is None:
        return None
    if isinstance(obj, pd.DataFrame):
        if obj.empty:
            return None
        df = obj.copy()
        df.index = [str(i) for i in df.index]
        df.columns = [str(c) for c in df.columns]
        return json.loads(df.to_json(orient='index', date_format='iso'))
    if isinstance(obj, pd.Series):
        return {str(k): (None if pd.isna(v) else v) for k, v in obj.items()}
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    try:
        json.dumps(obj)
        return obj
    except (TypeError, ValueError):
        return str(obj)


def safe(label, fn, errores):
    """Ejecuta fn() y anota el error en vez de abortar la corrida entera."""
    try:
        return jsonable(fn())
    except Exception as e:
        errores.append(f'{label}: {type(e).__name__}: {e}')
        return None


def leer_simbolos_sp500(data_dir):
    """Lee (SOLO LECTURA) el snapshot del screener para saber que tickers ya
    estan cubiertos ahi. Si no existe o esta roto, seguimos igual."""
    try:
        p = data_dir / 'sp500_fundamentals.json'
        if not p.exists():
            return {}
        d = json.loads(p.read_text(encoding='utf-8'))
        return {s['symbol']: s for s in d.get('stocks', []) if s.get('symbol')}
    except Exception as e:
        print(f'  [aviso] no se pudo leer sp500_fundamentals.json ({type(e).__name__}); '
              f'sigo sin esa referencia')
        return {}


def check_cedear(sym):
    """Existe CEDEAR en BYMA? Yahoo usa TICKER.BA para la bolsa de Buenos Aires."""
    try:
        fi = yf.Ticker(f'{sym}.BA').fast_info
        price = getattr(fi, 'last_price', None)
        return bool(price and price > 0)
    except Exception:
        return False


def leer_lista_tickers(base_dir):
    """Lee local_bot/tickers_informe.txt — uno por linea, # para comentarios."""
    p = base_dir / 'tickers_informe.txt'
    if not p.exists():
        return []
    out = []
    for linea in p.read_text(encoding='utf-8').splitlines():
        t = linea.split('#')[0].strip().upper()
        if t:
            out.append(t)
    return out


# ─── nucleo ─────────────────────────────────────────────────────────────────

def traer_activo(sym, sp500_map):
    """Trae todo lo que el informe necesita de un activo. Cada endpoint va por
    separado: si uno falla, los demas igual se guardan."""
    errores = []
    tk = yf.Ticker(sym)
    r = {'symbol': sym}

    # --- fundamentales (misma forma que el snapshot del screener) -----------
    info = {}
    try:
        info = tk.info or {}
    except Exception as e:
        errores.append(f'.info: {type(e).__name__}: {e}')

    en_sp500 = sym in sp500_map
    r['enSp500'] = en_sp500

    # sector: si esta en el snapshot del screener usamos ESE, para no mezclar
    # dos taxonomias distintas en el mismo informe
    if en_sp500 and sp500_map[sym].get('sector'):
        r['sector'] = sp500_map[sym]['sector']
    else:
        r['sector'] = SECTOR_YF_MAP.get(info.get('sector'), info.get('sector'))
    r['sectorYahoo'] = info.get('sector')

    try:
        price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
        prev = info.get('previousClose') or info.get('regularMarketPreviousClose') or price
        de = info.get('debtToEquity')
        roe = info.get('returnOnEquity')
        margin = info.get('profitMargins')
        roa = info.get('returnOnAssets')
        rev_g = info.get('revenueGrowth')
        r.update({
            'name':          info.get('shortName') or sym,
            'price':         price,
            'changePercent': round((price - prev) / prev * 100, 4) if prev else 0,
            'marketCap':     info.get('marketCap') or 0,
            'pe':            info.get('trailingPE'),
            'pb':            info.get('priceToBook'),
            'roe':           roe * 100 if roe is not None else None,
            'de':            abs(de / 100) if de is not None else None,
            'evEbitda':      info.get('enterpriseToEbitda'),
            'netMargin':     margin * 100 if margin is not None else None,
            'roa':           roa * 100 if roa is not None else None,
            'revGrowth':     rev_g * 100 if rev_g is not None else None,
            'priceToSales':  info.get('priceToSalesTrailing12Months'),
        })
    except Exception as e:
        errores.append(f'fundamentales: {type(e).__name__}: {e}')

    # CEDEAR: si ya lo sabemos por el snapshot del screener, no repetimos la llamada
    if en_sp500 and 'hasCedear' in sp500_map[sym]:
        r['hasCedear'] = sp500_map[sym]['hasCedear']
    else:
        r['hasCedear'] = check_cedear(sym)

    # --- consenso de analistas ----------------------------------------------
    consenso = {k: info.get(k) for k in CONSENSO_FIELDS}
    px, tgt = consenso.get('currentPrice'), consenso.get('targetMeanPrice')
    consenso['upsidePct'] = round((tgt / px - 1) * 100, 2) if px and tgt else None
    r['consenso'] = jsonable(consenso)

    # --- consenso forward (OJO: no es guidance de la empresa) ---------------
    r['consenso_forward'] = {
        '_nota': 'Consenso de ANALISTAS, no guidance de la empresa. '
                 'No redactar como "la empresa proyecta".',
        'earnings_estimate': safe('earnings_estimate', lambda: tk.earnings_estimate, errores),
        'revenue_estimate':  safe('revenue_estimate', lambda: tk.revenue_estimate, errores),
        'growth_estimates':  safe('growth_estimates', lambda: tk.growth_estimates, errores),
        'eps_trend':         safe('eps_trend', lambda: tk.eps_trend, errores),
    }

    # --- sentimiento ---------------------------------------------------------
    sent = {
        'recommendations_trend': safe('recommendations', lambda: tk.recommendations, errores),
        'eps_revisions':         safe('eps_revisions', lambda: tk.eps_revisions, errores),
    }
    try:
        ud = tk.upgrades_downgrades
        if isinstance(ud, pd.DataFrame) and not ud.empty:
            sent['upgrades_downgrades'] = jsonable(ud.head(MAX_UPGRADES))
            sent['upgrades_downgrades_total'] = int(len(ud))
        else:
            sent['upgrades_downgrades'] = None
            sent['upgrades_downgrades_total'] = 0
    except Exception as e:
        errores.append(f'upgrades_downgrades: {type(e).__name__}: {e}')
        sent['upgrades_downgrades'] = None
        sent['upgrades_downgrades_total'] = 0
    r['sentimiento'] = sent

    r['fetched_at'] = datetime.now(timezone.utc).isoformat()
    r['errores'] = errores
    return r


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    reset = '--reset' in flags

    base_dir = Path(__file__).resolve().parent
    data_dir = base_dir.parent / 'public' / 'data'
    out_path = data_dir / 'informe_detalle.json'

    symbols = [s.upper() for s in args] or leer_lista_tickers(base_dir)
    if not symbols:
        print('[X] No me diste tickers.\n')
        print('    python fetch_informe.py AAPL MSFT RGTI')
        print('    o crea local_bot/tickers_informe.txt con uno por linea.')
        sys.exit(1)

    # sin duplicados, conservando el orden en que los escribiste
    symbols = list(dict.fromkeys(symbols))

    print(f'yfinance {yf.__version__} | python {sys.version.split()[0]}')
    if not hasattr(yf.Ticker('AAPL'), 'earnings_estimate'):
        print('\n[X] Tu version de yfinance no tiene los endpoints de analistas.')
        print('    Actualiza con: pip install --upgrade "yfinance>=1.4.1"')
        sys.exit(1)

    sp500_map = leer_simbolos_sp500(data_dir)
    print(f'Referencia del screener: {len(sp500_map)} simbolos en sp500_fundamentals.json')
    print(f'Tickers a traer: {len(symbols)} -> {", ".join(symbols)}\n')

    # acumular sobre lo que ya habia, salvo --reset
    activos = {}
    if not reset and out_path.exists():
        try:
            activos = json.loads(out_path.read_text(encoding='utf-8')).get('activos', {})
            print(f'Acumulando sobre {len(activos)} activos ya guardados '
                  f'(usa --reset para empezar de cero)\n')
        except Exception as e:
            print(f'[aviso] no pude leer el archivo anterior ({type(e).__name__}), '
                  f'empiezo de cero\n')
            activos = {}

    t0 = time.time()
    fuera_sp500, con_errores = [], []
    for i, s in enumerate(symbols, 1):
        print(f'  [{i}/{len(symbols)}] {s} ...', end='', flush=True)
        try:
            r = traer_activo(s, sp500_map)
        except Exception as e:
            print(f' ERROR IRRECUPERABLE: {type(e).__name__}: {e}')
            con_errores.append(s)
            continue
        activos[s] = r
        if not r.get('enSp500'):
            fuera_sp500.append(s)
        if r.get('errores'):
            con_errores.append(s)
        marca = '' if r.get('enSp500') else '  (fuera del S&P 500)'
        print(f' ok{marca}  [{len(r.get("errores", []))} avisos]')
        time.sleep(0.3)

    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'yfinance': yf.__version__,
        'count': len(activos),
        'activos': activos,
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')

    print(f'\n[OK] {len(activos)} activos en total guardados en')
    print(f'     {out_path}')
    if fuera_sp500:
        print(f'     Fuera del S&P 500 (fundamentales traidos aca): {", ".join(fuera_sp500)}')
    if con_errores:
        print(f'     Con algun aviso: {", ".join(sorted(set(con_errores)))}')
        print('     (revisa el campo "errores" de cada activo en el JSON)')
    seg = time.time() - t0
    print(f'     {seg:.0f}s para {len(symbols)} tickers')
    print('\nAhora corre:')
    print('   git add public/data/informe_detalle.json')
    print('   git commit -m "chore: actualizar datos del informe avanzado"')
    print('   git push')


if __name__ == '__main__':
    main()
