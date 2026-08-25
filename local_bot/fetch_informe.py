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

    # opcion B (LA HABITUAL): todos los del S&P 500 que tienen CEDEAR.
    # Son ~151 de 504 y tardan ~7 minutos. Al cubrirlos, casi cualquier
    # informe que abras ya sale COMPLETO sin ningun paso manual.
    python fetch_informe.py --cedears

    # opcion B2: los ~137 CEDEAR que NO estan en el S&P 500 (ADR de Brasil,
    # Europa, China, mineras canadienses). SOLO PARA EL INFORME — el screener
    # no los usa ni se entera. Antes hay que correr validar_cedears.py.
    python fetch_informe.py --cedears-extra

    # los CEDEAR + los de afuera del indice que tengas en cartera
    python fetch_informe.py --cedears RGTI HIMS

    # todo el universo operable desde Argentina (~288 papeles, ~25 min)
    python fetch_informe.py --cedears --cedears-extra --dias 7

    # sin volver a bajar lo que ya esta fresco (ideal para correrlo seguido)
    python fetch_informe.py --cedears --dias 7

    # opcion C: sin argumentos, lee local_bot/tickers_informe.txt
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

# Mismo set que captura fetch_fundamentals.py, para que un ticker de afuera del
# S&P 500 tenga exactamente la misma forma que uno de adentro.
CONSENSO_FIELDS = (
    'recommendationKey', 'recommendationMean', 'numberOfAnalystOpinions',
    'targetMeanPrice', 'targetMedianPrice', 'targetHighPrice', 'targetLowPrice',
    'currentPrice', 'trailingEps', 'forwardEps', 'earningsGrowth', 'revenueGrowth',
    'dividendRate', 'dividendYield', 'payoutRatio', 'fiveYearAvgDividendYield',
    'trailingAnnualDividendRate', 'trailingAnnualDividendYield', 'lastDividendValue',
    'freeCashflow', 'operatingCashflow', 'totalCash', 'totalCashPerShare',
    'totalDebt', 'currentRatio', 'quickRatio', 'ebitda', 'totalRevenue',
    'forwardPE', 'trailingPegRatio', 'pegRatio', 'enterpriseValue', 'bookValue',
    'grossMargins', 'operatingMargins', 'ebitdaMargins',
    'beta', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'fiftyTwoWeekChange',
    '52WeekChange', 'SandP52WeekChange', 'shortRatio', 'shortPercentOfFloat',
    'sharesShort', 'sharesOutstanding', 'floatShares', 'averageVolume',
)


def derivados(fila, info):
    """Metricas calculadas. Identicas a las de fetch_fundamentals.py — si se
    cambia una, cambiar la otra."""
    px = fila.get('currentPrice') or info.get('regularMarketPrice')

    def poner(clave, fn):
        try:
            fila[clave] = fn()
        except Exception:
            fila[clave] = None

    poner('upsidePct', lambda: round((fila['targetMeanPrice'] / px - 1) * 100, 2)
          if (px and fila.get('targetMeanPrice')) else None)
    poner('targetDispersionPct', lambda: round(
        (fila['targetHighPrice'] - fila['targetLowPrice']) / fila['targetMeanPrice'] * 100, 1)
        if (fila.get('targetHighPrice') and fila.get('targetLowPrice')
            and fila.get('targetMeanPrice')) else None)
    # dividend yield SIEMPRE calculado: yfinance cambio la escala de
    # 'dividendYield' entre versiones (fraccion vs porcentaje)
    poner('dividendYieldPct', lambda: round(
        (fila.get('dividendRate') or fila.get('trailingAnnualDividendRate')) / px * 100, 2)
        if ((fila.get('dividendRate') or fila.get('trailingAnnualDividendRate')) and px) else None)
    poner('fcfYieldPct', lambda: round(fila['freeCashflow'] / info['marketCap'] * 100, 2)
          if (fila.get('freeCashflow') and info.get('marketCap')) else None)
    poner('netDebt', lambda: (fila['totalDebt'] - fila['totalCash'])
          if (fila.get('totalDebt') is not None and fila.get('totalCash') is not None) else None)
    poner('netDebtToEbitda', lambda: round(fila['netDebt'] / fila['ebitda'], 2)
          if (fila.get('netDebt') is not None and fila.get('ebitda')
              and fila['ebitda'] > 0) else None)
    poner('desdeMaximo52wPct', lambda: round((px / fila['fiftyTwoWeekHigh'] - 1) * 100, 1)
          if (px and fila.get('fiftyTwoWeekHigh')) else None)
    for k, destino in (('grossMargins', 'grossMarginPct'),
                       ('operatingMargins', 'operatingMarginPct'),
                       ('ebitdaMargins', 'ebitdaMarginPct'),
                       ('payoutRatio', 'payoutRatioPct')):
        poner(destino, lambda k=k: round(fila[k] * 100, 2) if fila.get(k) is not None else None)

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


def leer_cedears(data_dir):
    """Todos los tickers del S&P 500 que tienen CEDEAR, leidos del snapshot del
    screener (SOLO LECTURA).

    Por que este universo: son ~151 de 504 y es justo lo operable desde
    Argentina, asi que cubrir esos hace que casi cualquier informe que abras ya
    tenga el consenso a futuro y el sentimiento, sin ningun paso manual."""
    try:
        p = data_dir / 'sp500_fundamentals.json'
        if not p.exists():
            print('  [aviso] no encuentro sp500_fundamentals.json; '
                  'corre antes fetch_fundamentals.py')
            return []
        d = json.loads(p.read_text(encoding='utf-8'))
        return [s['symbol'] for s in d.get('stocks', [])
                if s.get('hasCedear') and s.get('symbol')]
    except Exception as e:
        print(f'  [aviso] no pude leer los CEDEAR ({type(e).__name__})')
        return []


def leer_cedears_extra(base_dir):
    """Los ~137 CEDEAR de fuera del S&P 500 (ADR brasileños, europeos, chinos,
    mineras canadienses...). SOLO PARA EL INFORME: el screener sigue trabajando
    con las 503 del indice y no se entera de que este archivo existe.

    Fuente: local_bot/cedears_ok.txt, que escribe validar_cedears.py con los
    simbolos que Yahoo efectivamente resuelve. Si todavia no lo corriste, caemos
    al primer candidato de cedears_informe.py y avisamos."""
    p = base_dir / 'cedears_ok.txt'
    if p.exists():
        out = [l.split('#')[0].strip().upper()
               for l in p.read_text(encoding='utf-8').splitlines()]
        out = [t for t in out if t]
        if out:
            print(f'  Universo extra: {len(out)} simbolos de cedears_ok.txt')
            return out
    try:
        sys.path.insert(0, str(base_dir))
        from cedears_informe import universo
        out = [v[0] for v in universo().values()]
        print(f'  [aviso] no encuentro cedears_ok.txt; uso los {len(out)} candidatos '
              f'de cedears_informe.py sin validar.')
        print('          Corre antes:  python validar_cedears.py')
        return out
    except Exception as e:
        print(f'  [aviso] no pude armar el universo extra ({type(e).__name__}: {e})')
        return []


def edad_dias(activo):
    """Hace cuantos dias se bajo este activo. None si no se sabe."""
    try:
        t = datetime.fromisoformat(activo['fetched_at'])
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() / 86400
    except Exception:
        return None


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

    # marketCap: Yahoo NO lo pone en .info para muchos ADR (Nokia, Ternium,
    # Sea, JD, ICICI...). Vuelve todo lo demas —precio, sector, P/E, ROE,
    # margenes, precio objetivo— y falta solo este campo. No es un problema de
    # conexion ni de rate limit: reintentar no lo trae, porque no esta ahi.
    # Si esta en fast_info, que es otro endpoint. Se resuelve ANTES de derivados()
    # porque de ahi sale fcfYieldPct, el unico calculo que depende del dato.
    if not info.get('marketCap'):
        try:
            mc = getattr(tk.fast_info, 'market_cap', None)
            if mc:
                info['marketCap'] = int(mc)
        except Exception as e:
            errores.append(f'fast_info.market_cap: {type(e).__name__}: {e}')

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

    # --- consenso de analistas + dividendos + caja + margenes + riesgo -------
    consenso = {k: info.get(k) for k in CONSENSO_FIELDS}
    try:
        derivados(consenso, info)
    except Exception as e:
        errores.append(f'derivados: {type(e).__name__}: {e}')
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
    crudos = sys.argv[1:]
    flags = {a for a in crudos if a.startswith('--')}
    reset = '--reset' in flags
    cedears = '--cedears' in flags
    cedears_extra = '--cedears-extra' in flags
    # --dias N: saltear los activos bajados hace menos de N dias
    dias_min = 0.0
    if '--dias' in crudos:
        try:
            dias_min = float(crudos[crudos.index('--dias') + 1])
        except Exception:
            print('[X] --dias necesita un numero. Ej: --dias 7')
            sys.exit(1)
    args = [a for i, a in enumerate(crudos)
            if not a.startswith('--')
            and not (i > 0 and crudos[i - 1] == '--dias')]

    base_dir = Path(__file__).resolve().parent
    data_dir = base_dir.parent / 'public' / 'data'
    out_path = data_dir / 'informe_detalle.json'

    symbols = [s.upper() for s in args]
    if cedears:
        symbols += leer_cedears(data_dir)
    if cedears_extra:
        symbols += leer_cedears_extra(base_dir)
    if not symbols:
        symbols = leer_lista_tickers(base_dir)
    if not symbols:
        print('[X] No me diste tickers.\n')
        print('    python fetch_informe.py --cedears     <- lo habitual')
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

    # --dias N: no volver a bajar lo que ya esta fresco. Util con --cedears,
    # que son ~151 tickers y no hace falta refrescarlos todos cada vez.
    if dias_min > 0:
        antes = len(symbols)
        symbols = [s for s in symbols
                   if not (activos.get(s) and (edad_dias(activos[s]) or 999) < dias_min)]
        salteados = antes - len(symbols)
        if salteados:
            print(f'Salteo {salteados} ya bajados hace menos de {dias_min:g} dias '
                  f'(--dias). Quedan {len(symbols)}.\n')
        if not symbols:
            print('Todo fresco, no hay nada que bajar.')
            return

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
