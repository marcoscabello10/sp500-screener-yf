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

# Cascada de conceptos. Las empresas NO usan todas el mismo tag para lo mismo,
# y ADEMAS algunas cambian de tag con los anios.
#
# ⚠️ BUG CORREGIDO (encontrado el 21/08/2026 en la primera corrida):
# la version anterior devolvia el PRIMER concepto con >=2 anios. Para CAT eso
# daba NetIncomeLoss con 4 anios... que eran 2007, 2008, 2009 y 2010, porque
# CAT cambio de tag despues de 2010. Un informe de 2026 habria mostrado el
# net income de 2010 sin avisar — peor que no tener el dato.
#
# Ahora se prueban TODOS los candidatos, se descartan los OBSOLETOS (los que
# no llegan al ultimo ejercicio) y entre los vigentes gana el mas largo.
# Ya no hay corte anticipado: hay que ver todos para saber cual es el vigente.

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
        'NetIncomeLossAvailableToCommonStockholdersBasic',
        'ProfitLoss',
    ],
    # margen bruto y operativo historicos
    'gross_profit': [
        'GrossProfit',
    ],
    # Fallback: varias industriales (CAT es el caso testigo) NO reportan
    # GrossProfit como concepto propio en XBRL. Se deriva restando el costo de
    # ventas al revenue. Solo se pide si GrossProfit vino vacio.
    'costo_ventas': [
        'CostOfRevenue',
        'CostOfGoodsAndServicesSold',
        'CostOfGoodsSold',
        'CostOfServices',
    ],
    'operating_income': [
        'OperatingIncomeLoss',
    ],
    # acciones en circulacion: revela si el EPS crece por el negocio o por
    # recompras (y del otro lado, si te estan diluyendo)
    'acciones_diluidas': [
        'WeightedAverageNumberOfDilutedSharesOutstanding',
        'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
        'WeightedAverageNumberOfSharesOutstandingBasic',
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


def _menos_un_anio(fecha_iso):
    """Tolerancia: un ejercicio fiscal puede cerrar unos dias antes o despues."""
    try:
        return f'{int(fecha_iso[:4]) - 1}{fecha_iso[4:]}'
    except Exception:
        return fecha_iso


def traer_concepto(cik, grupo, errores):
    """Elige el mejor tag de la cascada. DOS criterios y el orden importa:

      1. RECENCIA primero: solo compiten los tags cuya serie llega hasta el
         ultimo ejercicio disponible (tolerancia de ~1 anio).
      2. Entre esos, gana el que mas anios traiga.

    Los dos bugs reales que motivaron cada criterio:
      - Solo "el primero con datos": CAT devolvia NetIncomeLoss con 4 anios
        que terminaban en 2010.
      - Solo "el que mas anios trae": AAPL devolvia SalesRevenueNet con 11
        anios que terminaban en 2017, porque Apple dejo de usar ese tag tras
        el cambio de norma contable. El CAGR salia de datos de hace 8 anios,
        y quedaba camuflado porque a 5 anios daba casi lo mismo por
        coincidencia.
    """
    intentos, candidatos = [], []
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
        clave = next((k for k in ('USD', 'USD/shares', 'shares') if k in units), None)
        if not clave:
            intentos.append({'tag': tag, 'error': f'unidades inesperadas: {list(units)}'})
            continue
        serie = anuales(units[clave])
        intentos.append({'tag': tag, 'anios': len(serie), 'unidad': clave,
                         'hasta': max(serie) if serie else None})
        if len(serie) >= 2:
            candidatos.append({'tag_ganador': tag, 'unidad': clave,
                               'serie': {k: v['val'] for k, v in serie.items()},
                               'detalle': serie, 'hasta': max(serie)})
    if not candidatos:
        errores.append(f'{grupo}: ningun concepto trajo >=2 anios')
        return {'tag_ganador': None, 'serie': {}, 'intentos': intentos}
    tope = max(c['hasta'] for c in candidatos)
    vigentes = [c for c in candidatos if c['hasta'] >= _menos_un_anio(tope)]
    descartados = [c['tag_ganador'] for c in candidatos if c not in vigentes]
    mejor = max(vigentes, key=lambda c: len(c['detalle']))
    mejor['intentos'] = intentos
    if descartados:
        mejor['descartados_por_obsoletos'] = descartados
    return mejor


def detectar_saltos(acciones, net_income):
    """Encuentra saltos bruscos en la serie de acciones y los clasifica.

    Por que importa: un SPLIT multiplica las acciones sin que la empresa emita
    nada. Si no se corrige, el CAGR miente feo. Caso real (LRCX, 21/08/2026):
    split 10 a 1 -> las acciones "crecen" 54%/anio y el EPS "cae" 26,5%/anio.
    Ninguna de las dos cosas paso.

    Como se distingue un split de una emision real:
        En un SPLIT el net income NO cambia — la misma torta se reparte entre
        mas porciones. Si las acciones saltan Y el net income tambien se movio
        fuerte, fue emision genuina (HIMS al salir a bolsa por SPAC en 2021,
        AMD al pagar Xilinx con acciones en 2022).

    Devuelve una lista de {fecha, ratio, tipo, factor}."""
    fechas = sorted(acciones)
    saltos = []
    for i in range(1, len(fechas)):
        f_ant, f_act = fechas[i - 1], fechas[i]
        v_ant, v_act = acciones[f_ant], acciones[f_act]
        if not v_ant or not v_act or v_ant <= 0:
            continue
        ratio = v_act / v_ant
        if 0.67 < ratio < 1.5:
            continue  # variacion normal, no es un evento

        ni_ant, ni_act = net_income.get(f_ant), net_income.get(f_act)
        ni_estable = False
        if ni_ant and ni_act and ni_ant != 0:
            # mismo signo y magnitud parecida = la torta no cambio
            ni_estable = (ni_ant * ni_act > 0) and (0.7 <= abs(ni_act / ni_ant) <= 1.4)

        # ¿el ratio se parece a un split de los que se usan en la practica?
        candidatos = [2, 3, 4, 5, 7, 10, 15, 20, 0.5, 1/3, 0.25, 0.2, 0.1]
        factor = next((c for c in candidatos if abs(ratio / c - 1) < 0.12), None)

        # SOLO se corrige con las dos evidencias a la vez: factor redondo Y
        # torta sin cambiar. Con una sola no alcanza:
        #   - HIMS salto x5,28 (cerca de 5) pero fue el SPAC, no un split.
        #   - RGTI salto x1,68 con perdidas parecidas, y es emision real.
        # Cuando hay salto pero no certeza, NO se inventa un ajuste: se marca
        # como discontinuidad y los CAGR que la cruzan quedan sin calcular.
        if ni_estable and factor:
            tipo, ajustar = 'split', factor
        else:
            tipo, ajustar = 'discontinuidad', None
        saltos.append({'fecha': f_act, 'ratio': round(ratio, 3), 'tipo': tipo,
                       'factor': ajustar, 'factor_sospechado': factor,
                       'ni_estable': ni_estable})
    return saltos


def cagr_seguro(serie, anios, saltos):
    """CAGR que se niega a cruzar una discontinuidad no resuelta.

    Vale mas un 'no se puede calcular' que un numero inventado: el EPS a 10
    anios de AAPL daba -2,1% sin corregir, cuando en realidad venia creciendo."""
    if not serie or len(serie) < anios + 1:
        return None
    ventana = sorted(serie.keys())[-(anios + 1):]
    desde, hasta = ventana[0], ventana[-1]
    for s in saltos or []:
        if s['tipo'] != 'split' and desde < s['fecha'] <= hasta:
            return None
    return cagr(serie, anios)


def ajustar_por_splits(serie, saltos, invertir=False):
    """Lleva toda la serie a la base ACTUAL (la del ultimo anio).

    Recorre de nuevo a viejo: cada vez que cruza un split de factor k hacia
    atras, multiplica los anios anteriores por k. Con invertir=True hace lo
    contrario, que es lo que necesita el EPS (si las acciones se multiplican
    por 10, el EPS historico se divide por 10)."""
    if not saltos:
        return dict(serie)
    porfecha = {s['fecha']: s for s in saltos if s['tipo'].startswith('split')}
    if not porfecha:
        return dict(serie)
    fechas = sorted(serie)
    out, acum = {}, 1.0
    for i in range(len(fechas) - 1, -1, -1):
        f = fechas[i]
        out[f] = serie[f] / acum if invertir else serie[f] * acum
        s = porfecha.get(f)
        if s and s.get('factor'):
            acum *= s['factor']
    return dict(sorted(out.items()))


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
        # costo_ventas solo se pide si GrossProfit no vino — es un fallback,
        # no un dato que necesitemos siempre
        for grupo in CONCEPTOS:
            if grupo == 'costo_ventas':
                continue
            r[grupo] = traer_concepto(cik, grupo, r['errores'])
        rev = r['revenue']['serie']

        if not r['gross_profit']['serie'] and rev:
            silencioso = []
            r['costo_ventas'] = traer_concepto(cik, 'costo_ventas', silencioso)
            derivado = {}
            for fecha, costo in r['costo_ventas']['serie'].items():
                ventas = rev.get(fecha)
                if ventas:
                    derivado[fecha] = ventas - costo
            if derivado:
                r['gross_profit'] = {
                    'tag_ganador': f'derivado: revenue - {r["costo_ventas"]["tag_ganador"]}',
                    'unidad': 'USD', 'serie': derivado, 'intentos': [],
                }
                # ya no es un error: lo resolvimos por otro camino
                r['errores'] = [e for e in r['errores'] if not e.startswith('gross_profit')]

        acc_crudo = r['acciones_diluidas']['serie']
        eps_crudo = r['eps_diluido']['serie']
        ni = r['net_income']['serie']

        # ── corregir splits ANTES de calcular cualquier CAGR ──
        r['saltos_accionarios'] = detectar_saltos(acc_crudo, ni)
        acc = ajustar_por_splits(acc_crudo, r['saltos_accionarios'])
        eps = ajustar_por_splits(eps_crudo, r['saltos_accionarios'], invertir=True)
        r['acciones_diluidas']['serie_ajustada'] = acc
        r['eps_diluido']['serie_ajustada'] = eps

        r['cagr'] = {
            'revenue_3a':  cagr(rev, 3),
            'revenue_5a':  cagr(rev, 5),
            'revenue_10a': cagr(rev, 10),
            # EPS y acciones: sobre la serie ajustada por splits, y ademas
            # devuelven None si la ventana cruza una discontinuidad sin resolver
            'eps_3a':      cagr_seguro(eps, 3, r['saltos_accionarios']),
            'eps_5a':      cagr_seguro(eps, 5, r['saltos_accionarios']),
            'eps_10a':     cagr_seguro(eps, 10, r['saltos_accionarios']),
            # negativo = recompras (menos acciones); positivo = dilucion
            'acciones_3a': cagr_seguro(acc, 3, r['saltos_accionarios']),
            'acciones_5a': cagr_seguro(acc, 5, r['saltos_accionarios']),
            # net income: inmune a splits, sirve de control cruzado
            'net_income_3a': cagr(ni, 3),
            'net_income_5a': cagr(ni, 5),
            # lo que habria dado SIN corregir, para poder auditar la diferencia
            '_eps_5a_sin_ajustar':      cagr(eps_crudo, 5),
            '_acciones_5a_sin_ajustar': cagr(acc_crudo, 5),
        }

        # margenes historicos: cuanto de cada dolar de venta queda
        # OJO: la variable de las ventas se llama 'ventas', NO 'base'.
        # 'base' es la carpeta del script y pisarla rompia el guardado del JSON
        # al final (bug real, 21/08/2026).
        r['margenes_historicos'] = {}
        for nombre, serie in (('bruto', r['gross_profit']['serie']),
                              ('operativo', r['operating_income']['serie']),
                              ('neto', r['net_income']['serie'])):
            m = {}
            for fecha, v in serie.items():
                ventas = rev.get(fecha)
                if ventas:
                    m[fecha] = round(v / ventas * 100, 2)
            r['margenes_historicos'][nombre] = m

        print(f' CIK {cik} · rev {len(rev)}a · eps {len(r["eps_diluido"]["serie"])}a '
              f'· acciones {len(acc)}a')
        res.append(r)

    # ── GUARDAR PRIMERO, IMPRIMIR DESPUES ────────────────────────────────────
    # Leccion del 21/08/2026: un bug en el bloque de resumen tiro abajo la
    # corrida DESPUES de haber bajado todos los datos, y se perdio todo el
    # trabajo. Los datos costaron tiempo y requests: se guardan apenas estan,
    # y el resumen es solo cosmetica que va despues.
    out = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'user_agent': USER_AGENT,
        'tickers': syms,
        'resultados': res,
    }
    op = base / 'probe_edgar_out.json'
    op.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n[OK] Datos guardados en {op}')

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

    print('\n' + '=' * 82)
    print('SPLITS Y EVENTOS DE CAPITAL DETECTADOS')
    print('=' * 82)
    hubo = False
    for r in res:
        for s in r.get('saltos_accionarios') or []:
            hubo = True
            print(f'  {r["symbol"]:<7}{s["fecha"]}  x{s["ratio"]:<8} {s["tipo"]}'
                  + (f' (factor {s["factor"]})' if s.get('factor') else ''))
    if not hubo:
        print('  ninguno')
    print('\n  split            -> las acciones se multiplican pero la torta es la misma.')
    print('                      Se CORRIGE: el CAGR de EPS y de acciones usa la serie ajustada.')
    print('  evento_de_capital -> emision real (SPAC, fusion pagada en acciones).')
    print('                      NO se corrige: la dilucion es de verdad.')

    print('\n' + '=' * 82)
    print('RECOMPRAS vs DILUCION — ¿el EPS crece por el negocio o por el denominador?')
    print('=' * 82)
    print(f'{"TICK":<7}{"acc 5a":>9}{"rev 5a":>9}{"eps 5a":>9}{"NI 5a":>9}   lectura')
    print('-' * 82)
    for r in res:
        if not r.get('cik'):
            continue
        c = r['cagr']
        a, rv, ep, nis = (c['acciones_5a'], c['revenue_5a'], c['eps_5a'],
                          c.get('net_income_5a'))
        if a is None:
            lectura = 'sin datos de acciones'
        elif a < -1:
            lectura = f'RECOMPRAS: {abs(a):.1f}%/anio menos acciones'
            if rv is not None and ep is not None and ep > rv + 2:
                lectura += ' -> parte del EPS viene de aca'
        elif a > 3:
            lectura = f'DILUCION: {a:.1f}%/anio mas acciones -> te licuan'
        else:
            lectura = 'acciones estables'
        f = lambda v: '-' if v is None else f'{v:.1f}'
        print(f'{r["symbol"]:<7}{f(a):>9}{f(rv):>9}{f(ep):>9}{f(nis):>9}   {lectura}')

    print('\n' + '=' * 82)
    print('AUDITORIA DEL AJUSTE POR SPLIT — sin corregir vs corregido (CAGR 5a)')
    print('=' * 82)
    print(f'{"TICK":<7}{"eps CRUDO":>12}{"eps ok":>10}{"acc CRUDO":>12}{"acc ok":>10}')
    print('-' * 82)
    for r in res:
        if not r.get('cik'):
            continue
        c = r['cagr']
        f = lambda v: '-' if v is None else f'{v:.1f}'
        marca = '  <-- el crudo mentia' if (
            c.get('_eps_5a_sin_ajustar') is not None and c.get('eps_5a') is not None
            and abs(c['_eps_5a_sin_ajustar'] - c['eps_5a']) > 5) else ''
        print(f'{r["symbol"]:<7}{f(c.get("_eps_5a_sin_ajustar")):>12}{f(c["eps_5a"]):>10}'
              f'{f(c.get("_acciones_5a_sin_ajustar")):>12}{f(c["acciones_5a"]):>10}{marca}')

    print('\n' + '=' * 82)
    print('MARGENES HISTORICOS (% sobre ventas) — primero vs ultimo anio')
    print('=' * 82)
    print(f'{"TICK":<7}{"bruto":>18}{"operativo":>18}{"neto":>18}')
    print('-' * 82)
    for r in res:
        if not r.get('cik'):
            continue
        celdas = []
        for n in ('bruto', 'operativo', 'neto'):
            m = r['margenes_historicos'].get(n) or {}
            if len(m) >= 2:
                ks = sorted(m)
                celdas.append(f'{m[ks[0]]:.1f} -> {m[ks[-1]]:.1f}')
            else:
                celdas.append('-')
        print(f'{r["symbol"]:<7}{celdas[0]:>18}{celdas[1]:>18}{celdas[2]:>18}')

    errs = [(r['symbol'], e) for r in res for e in r.get('errores', [])]
    if errs:
        print(f'\n--- AVISOS ({len(errs)}) ---')
        for s, e in errs[:30]:
            print(f'  {s}: {e}')

    print(f'\n[OK] {time.time()-t0:.0f}s · detalle en:\n     {op}')


if __name__ == '__main__':
    main()
