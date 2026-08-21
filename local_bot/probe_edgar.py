#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sonda de SEC EDGAR — histórico para el informe avanzado
========================================================

Igual que probe_analistas.py: script de MEDICION, no de produccion. Contesta
con datos si el mapeo XBRL funciona, ANTES de meterlo en Vercel.

Que mide
--------
1. Mapeo ticker -> CIK contra company_tickers.json de la SEC. Interesa sobre
   todo si RGTI y HIMS (fuera del S&P 500) estan y reportan.
2. Cascada de conceptos de revenue. Las empresas NO usan todas el mismo tag:
   Revenues, RevenueFromContractWithCustomerExcludingAssessedTax,
   SalesRevenueNet... Hay que ver cual gana en cada caso.
3. Cuantos anios anuales (10-K) devuelve realmente cada concepto.
4. CAGR a 3, 5 y 10 anios, y COMPARACION contra el CAGR a 3 anios que dio
   yfinance — si no coinciden, hay algo mal en el mapeo.

Por que EDGAR y no yfinance
---------------------------
yfinance solo da 4 datos utiles = CAGR de 3 anios, y a esa ventana el anio
base distorsiona (XOM dio -6,7% de revenue solo por el pico de 2022).

Notas de la API
---------------
- Gratis, SIN API key.
- Limite: 10 req/s por IP. Acamos apuntamos a ~7 por prudencia.
- User-Agent con nombre y mail es OBLIGATORIO. Si no, la SEC bloquea.
- La SEC NO bloquea IPs de datacenter, asi que esto SI va a poder correr desde
  Vercel. Esta sonda corre local solo porque desde aca es mas facil iterar.

Uso
---
    cd local_bot
    python probe_edgar.py                  # usa los tickers de tickers_informe.txt
    python probe_edgar.py AAPL RGTI HIMS   # o los que le pases

Genera: local_bot/probe_edgar_out.json
"""
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# ─── La SEC EXIGE identificarse. Cambia esto si queres otro contacto. ────────
USER_AGENT = 'Marcos Cabello marcoscabello12@gmail.com'

PAUSA = 0.15          # ~7 req/s, debajo del limite de 10
TIMEOUT = 30

URL_TICKERS = 'https://www.sec.gov/files/company_tickers.json'
URL_CONCEPT = 'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{tag}.json'

# Cascada: se prueban en orden y gana el primero que traiga suficientes anios.
CONCEPTOS = {
    'revenue': [
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'Revenues',
        'SalesRevenueNet',
        'SalesRevenueGoodsNet',
    ],
    'eps_diluido': [
        'EarningsPerShareDiluted',
        'EarningsPerShareBasicAndDiluted',
    ],
    'net_income': [
        'NetIncomeLoss',
        'ProfitLoss',
    ],
}


def get_json(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            import gzip
            raw = gzip.decompress(raw)
        return json.loads(raw.decode('utf-8'))


def mapa_ticker_cik():
    """company_tickers.json -> {TICKER: cik de 10 digitos con ceros adelante}"""
    d = get_json(URL_TICKERS)
    out = {}
    for v in d.values():
        try:
            out[v['ticker'].upper()] = str(v['cik_str']).zfill(10)
        except Exception:
            pass
    return out


def anuales(datos_unit):
    """De la lista cruda de un concepto, deja SOLO los periodos anuales de 10-K.

    Tres filtros que importan:
      - form 10-K (no 10-Q, que son trimestres)
      - duracion de ~1 anio (entre 300 y 400 dias) — descarta acumulados raros
      - una sola fila por fecha de cierre, quedandonos con la de 'filed' mas
        reciente: asi las REFORMULACIONES pisan al dato viejo
    """
    por_cierre = {}
    for e in datos_unit:
        try:
            if e.get('form') != '10-K':
                continue
            fin = e.get('end')
            ini = e.get('start')
            if not fin:
                continue
            if ini:  # los flujos (revenue, net income) tienen start; el EPS tambien
                d0 = datetime.fromisoformat(ini)
                d1 = datetime.fromisoformat(fin)
                if not (300 <= (d1 - d0).days <= 400):
                    continue
            val = e.get('val')
            if val is None:
                continue
            prev = por_cierre.get(fin)
            if prev is None or (e.get('filed') or '') > (prev.get('filed') or ''):
                por_cierre[fin] = {'val': float(val), 'filed': e.get('filed'),
                                   'fy': e.get('fy'), 'accn': e.get('accn')}
        except Exception:
            continue
    return dict(sorted(por_cierre.items()))


def traer_concepto(cik, grupo, errores):
    """Prueba la cascada y devuelve el primero que traiga >= 2 anios."""
    intentos = []
    for tag in CONCEPTOS[grupo]:
        try:
            d = get_json(URL_CONCEPT.format(cik=cik, tag=tag))
        except urllib.error.HTTPError as e:
            intentos.append({'tag': tag, 'http': e.code})
            time.sleep(PAUSA)
            continue
        except Exception as e:
            intentos.append({'tag': tag, 'error': f'{type(e).__name__}: {e}'})
            time.sleep(PAUSA)
            continue
        time.sleep(PAUSA)
        units = d.get('units') or {}
        # el EPS viene en 'USD/shares', los demas en 'USD'
        clave = next((k for k in ('USD', 'USD/shares') if k in units), None)
        if not clave:
            intentos.append({'tag': tag, 'error': f'unidades inesperadas: {list(units)}'})
            continue
        serie = anuales(units[clave])
        intentos.append({'tag': tag, 'anios': len(serie), 'unidad': clave})
        if len(serie) >= 2:
            return {'tag_ganador': tag, 'unidad': clave,
                    'serie': {k: v['val'] for k, v in serie.items()},
                    'detalle': serie, 'intentos': intentos}
    errores.append(f'{grupo}: ningun concepto trajo >=2 anios')
    return {'tag_ganador': None, 'serie': {}, 'intentos': intentos}


def cagr(serie, anios):
    """CAGR de los ultimos N anios. Devuelve None si no hay suficientes datos."""
    if not serie or len(serie) < anios + 1:
        return None
    fechas = sorted(serie.keys())[-(anios + 1):]
    v0, v1 = serie[fechas[0]], serie[fechas[-1]]
    if v0 is None or v1 is None or v0 <= 0 or v1 <= 0:
        return None
    return round(((v1 / v0) ** (1.0 / anios) - 1.0) * 100, 2)


def leer_lista_tickers(base):
    p = base / 'tickers_informe.txt'
    if not p.exists():
        return []
    out = []
    for l in p.read_text(encoding='utf-8').splitlines():
        t = l.split('#')[0].strip().upper()
        if t:
            out.append(t)
    return out


def main():
    base = Path(__file__).resolve().parent
    syms = [s.upper() for s in sys.argv[1:]] or leer_lista_tickers(base)
    if not syms:
        print('[X] Sin tickers. Usa: python probe_edgar.py AAPL RGTI')
        sys.exit(1)
    syms = list(dict.fromkeys(syms))

    print(f'User-Agent: {USER_AGENT}')
    if 'tu-mail' in USER_AGENT or '@' not in USER_AGENT:
        print('[X] La SEC exige un User-Agent con nombre y mail reales.')
        sys.exit(1)

    print('Bajando mapa ticker -> CIK de la SEC ...', end='', flush=True)
    try:
        mapa = mapa_ticker_cik()
    except Exception as e:
        print(f'\n[X] No pude bajar company_tickers.json: {type(e).__name__}: {e}')
        sys.exit(1)
    print(f' {len(mapa)} empresas\n')

    # comparacion contra lo que ya midio yfinance, si esta disponible
    yf_cagr = {}
    try:
        p = base / 'probe_analistas_out.json'
        if p.exists():
            for r in json.loads(p.read_text(encoding='utf-8'))['resultados']:
                yf_cagr[r['symbol']] = r.get('historico', {}).get('cagr_revenue_pct')
    except Exception:
        pass

    t0 = time.time()
    res = []
    for i, s in enumerate(syms, 1):
        print(f'  [{i}/{len(syms)}] {s} ...', end='', flush=True)
        r = {'symbol': s, 'errores': []}
        cik = mapa.get(s)
        r['cik'] = cik
        if not cik:
            r['errores'].append('no esta en company_tickers.json de la SEC')
            print(' SIN CIK (no reporta a la SEC)')
            res.append(r)
            continue
        for grupo in ('revenue', 'eps_diluido', 'net_income'):
            r[grupo] = traer_concepto(cik, grupo, r['errores'])
        rev = r['revenue']['serie']
        r['cagr'] = {
            'revenue_3a':  cagr(rev, 3),
            'revenue_5a':  cagr(rev, 5),
            'revenue_10a': cagr(rev, 10),
            'eps_3a':      cagr(r['eps_diluido']['serie'], 3),
            'eps_5a':      cagr(r['eps_diluido']['serie'], 5),
            'eps_10a':     cagr(r['eps_diluido']['serie'], 10),
        }
        print(f' CIK {cik} · {len(rev)} anios de revenue · {len(r["eps_diluido"]["serie"])} de EPS')
        res.append(r)

    # ── resumen ──────────────────────────────────────────────────────────────
    print('\n' + '=' * 82)
    print('ANIOS DISPONIBLES Y CONCEPTO GANADOR')
    print('=' * 82)
    print(f'{"TICK":<7}{"CIK":<12}{"rev":>5}{"eps":>5}{"ni":>5}  concepto de revenue que gano')
    print('-' * 82)
    for r in res:
        if not r.get('cik'):
            print(f'{r["symbol"]:<7}{"-":<12}{"-":>5}{"-":>5}{"-":>5}  NO REPORTA A LA SEC')
            continue
        print(f'{r["symbol"]:<7}{r["cik"]:<12}'
              f'{len(r["revenue"]["serie"]):>5}{len(r["eps_diluido"]["serie"]):>5}'
              f'{len(r["net_income"]["serie"]):>5}  {r["revenue"]["tag_ganador"]}')

    print('\n' + '=' * 82)
    print('CAGR — lo que EDGAR desbloquea vs. lo que daba yfinance')
    print('=' * 82)
    print(f'{"TICK":<7}{"rev 3a":>9}{"rev 5a":>9}{"rev 10a":>9}{"eps 3a":>9}{"eps 5a":>9}'
          f'{"eps 10a":>9}{"yf 3a":>9}')
    print('-' * 82)
    for r in res:
        if not r.get('cik'):
            continue
        c = r['cag' + 'r']
        f = lambda v: ('-' if v is None else f'{v:.1f}')
        print(f'{r["symbol"]:<7}{f(c["revenue_3a"]):>9}{f(c["revenue_5a"]):>9}'
              f'{f(c["revenue_10a"]):>9}{f(c["eps_3a"]):>9}{f(c["eps_5a"]):>9}'
              f'{f(c["eps_10a"]):>9}{f(yf_cagr.get(r["symbol"])):>9}')
    print('\n  "yf 3a" es el CAGR de revenue a 3 anios que dio yfinance.')
    print('  Deberia parecerse a "rev 3a". Si difiere mucho, revisar el mapeo.')

    errs = [(r['symbol'], e) for r in res for e in r.get('errores', [])]
    if errs:
        print(f'\n--- AVISOS ({len(errs)}) ---')
        for s, e in errs[:30]:
            print(f'  {s}: {e}')

    out = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'user_agent': USER_AGENT,
        'tickers': syms,
        'resultados': res,
    }
    op = base / 'probe_edgar_out.json'
    op.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n[OK] {time.time()-t0:.0f}s · detalle en:\n     {op}')


if __name__ == '__main__':
    main()
