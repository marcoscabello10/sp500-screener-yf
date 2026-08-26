#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
api/informe.py — Endpoint del INFORME AVANZADO
===============================================

Proyecto SEPARADO del screener. NO tocar api/data.py, que es del screener.

⚠️ REGLA DE GASTO (requisito explicito de Marcos)
--------------------------------------------------
    action=datos  -> EDGAR + reglas + percentiles + semaforos.  CERO LLM. US$0.
    action=tesis  -> UNICO que llama al modelo de lenguaje.

El informe se ve COMPLETO con action=datos. La prosa es un extra que se pide
aparte, con clic explicito. Si no hay API key configurada, action=datos sigue
funcionando igual y la tesis simplemente no se ofrece.

⚠️ REGLA DE ORO #4 DEL PROYECTO
--------------------------------
Yahoo bloquea IPs de datacenter. **Este archivo NUNCA llama a Yahoo.** Todo
dato de Yahoo entra por los snapshots que genera el bot local. La SEC si acepta
IPs de cloud, así que EDGAR se consulta en vivo desde acá.

Endpoints
---------
    GET /api/informe?action=datos&ticker=AAPL
    GET /api/informe?action=tesis&ticker=AAPL     (requiere API key)
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
import json
import os
import time
import urllib.request
import urllib.error

# ─────────────────────────────────────────────────────────────────────────────
# Configuracion
# ─────────────────────────────────────────────────────────────────────────────
SEC_USER_AGENT = os.environ.get('SEC_USER_AGENT',
                                'Marcos Cabello marcoscabello12@gmail.com')
URL_TICKERS = 'https://www.sec.gov/files/company_tickers.json'
URL_CONCEPT = 'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{tag}.json'
PAUSA_SEC = 0.15          # ~7 req/s, debajo del limite de 10 de la SEC
TIMEOUT = 20

CORTE_ANTICIPADO = 12

CONCEPTOS = {
    'revenue': ['RevenueFromContractWithCustomerExcludingAssessedTax',
                'RevenueFromContractWithCustomerIncludingAssessedTax',
                'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
    'eps_diluido': ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
    'net_income': ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic',
                   'ProfitLoss'],
    'gross_profit': ['GrossProfit'],
    'costo_ventas': ['CostOfRevenue', 'CostOfGoodsAndServicesSold',
                     'CostOfGoodsSold', 'CostOfServices'],
    'operating_income': ['OperatingIncomeLoss'],
    'acciones_diluidas': ['WeightedAverageNumberOfDilutedSharesOutstanding',
                          'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
                          'WeightedAverageNumberOfSharesOutstandingBasic'],
}

# ── Reglas por sector ────────────────────────────────────────────────────────
# Medido sobre los 504 reales: hay metricas que NO significan nada en ciertos
# sectores, y mostrarlas es peor que omitirlas.
SECTOR_OCULTAR = {
    # Un banco no tiene EBITDA con sentido (la deuda es su materia prima) y su
    # "caja" incluye depositos: GS aparecia con -259.000 millones de caja neta.
    'Financials': {'evEbitda', 'netDebt', 'netDebtToEbitda', 'currentRatio',
                   'quickRatio', 'grossMarginPct'},
}

SECTOR_NOTAS = {
    'Real Estate': {
        'pe': 'En REITs el P/E está inflado porque la depreciación aplasta la '
              'ganancia contable. El múltiplo correcto sería FFO, que no está '
              'en esta fuente. Mediana del sector: 33,4x.',
    },
    'Utilities': {
        'de': 'En Utilities la deuda alta es estructural, no una señal de '
              'alarma: la mediana del sector es 1,6 contra 0,6 en Technology. '
              'Por eso se compara contra el sector y no contra un umbral fijo.',
    },
    'Energy': {
        'pe': 'Energy es cíclico: un P/E bajo en el pico del ciclo es la trampa '
              'de valor clásica. Mirar el CAGR a 5 y 10 años, no a 3.',
    },
    'Financials': {
        'pb': 'En bancos el P/B y el ROE son los múltiplos que mandan, no el '
              'EV/EBITDA ni la deuda neta.',
    },
}

# Menor es mejor -> el percentil se invierte para que "alto" sea siempre bueno
MENOR_ES_MEJOR = {'pe', 'pb', 'evEbitda', 'de', 'priceToSales', 'forwardPE',
                  'trailingPegRatio', 'netDebtToEbitda'}

_cache_estatico = {}
_cache_cik = {}


# ─────────────────────────────────────────────────────────────────────────────
# Utilidades HTTP
# ─────────────────────────────────────────────────────────────────────────────
def _get_json(url, headers=None, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            import gzip
            raw = gzip.decompress(raw)
        return json.loads(raw.decode('utf-8'))


def _sec_json(url):
    return _get_json(url, {'User-Agent': SEC_USER_AGENT,
                           'Accept': 'application/json',
                           'Accept-Encoding': 'gzip, deflate'})


def base_publica():
    """URL del propio deploy. Solo se usa como Último recurso."""
    for var in ('VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL'):
        v = os.environ.get(var)
        if v:
            return v if v.startswith('http') else f'https://{v}'
    return ''


# Rutas donde pueden estar los JSON dentro del bundle de la funcion.
# vercel.json los incluye con includeFiles: "public/data/**".
RUTAS_DATOS = ('public/data', '../public/data', '/var/task/public/data',
               os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'public', 'data'))


def estatico(nombre):
    """Lee un JSON de public/data/.

    PRIMERO del disco de la propia función (via includeFiles en vercel.json) y
    solo si no esta, por HTTP contra el propio deploy.

    Por que en ese orden: pedirselo al propio deploy por HTTP falla si Vercel
    tiene Deployment Protection activa — la función recibe un 401 y todo el
    endpoint devuelve 500. Leer del disco no depende de la red ni de la
    autenticación, y además es mucho más rápido (informe_detalle.json pesa
    ~1,2 MB).

    Se cachea en memoria mientras viva la instancia: estos archivos los genera
    el bot local y cambian una vez por día como mucho."""
    if nombre in _cache_estatico:
        return _cache_estatico[nombre]

    errores = []
    for base in RUTAS_DATOS:
        try:
            ruta = os.path.join(base, nombre)
            if os.path.exists(ruta):
                with open(ruta, encoding='utf-8') as fh:
                    d = json.load(fh)
                _cache_estatico[nombre] = d
                return d
        except Exception as e:
            errores.append(f'{base}: {type(e).__name__}')

    base_url = base_publica()
    if base_url:
        try:
            d = _get_json(f'{base_url}/data/{nombre}')
            _cache_estatico[nombre] = d
            return d
        except Exception as e:
            errores.append(f'HTTP {base_url}: {type(e).__name__}: {e}')

    raise RuntimeError(
        f'No pude leer {nombre}. Probé: {"; ".join(errores) or "ninguna ruta"}. '
        f'Revisá que vercel.json incluya includeFiles para public/data.')


# ─────────────────────────────────────────────────────────────────────────────
# SEC EDGAR  (portado de local_bot/probe_edgar.py — mantener sincronizados)
# ─────────────────────────────────────────────────────────────────────────────
def cik_de(ticker):
    if not _cache_cik:
        d = _sec_json(URL_TICKERS)
        for v in d.values():
            try:
                _cache_cik[v['ticker'].upper()] = str(v['cik_str']).zfill(10)
            except Exception:
                pass
    return _cache_cik.get(ticker.upper())


def anuales(filas):
    """Solo períodos anuales de 10-K, con las reformulaciones pisando al dato
    viejo (se queda con la de 'filed' más reciente por fecha de cierre)."""
    por_cierre = {}
    for e in filas:
        try:
            if e.get('form') != '10-K':
                continue
            fin, ini, val = e.get('end'), e.get('start'), e.get('val')
            if not fin or val is None:
                continue
            if ini:
                d0 = datetime.fromisoformat(ini)
                d1 = datetime.fromisoformat(fin)
                if not (300 <= (d1 - d0).days <= 400):
                    continue
            prev = por_cierre.get(fin)
            if prev is None or (e.get('filed') or '') > (prev.get('filed') or ''):
                por_cierre[fin] = {'val': float(val), 'filed': e.get('filed')}
        except Exception:
            continue
    return dict(sorted(por_cierre.items()))


def traer_concepto(cik, grupo):
    """Elige el mejor tag de la cascada. La regla tiene DOS criterios y el
    orden importa:

      1. RECENCIA primero: solo compiten los tags cuya serie llega hasta el
         último ejercicio disponible (tolerancia de ~1 año).
      2. Entre esos, gana el que más años traiga.

    Por que en ese orden — los dos bugs reales que lo motivaron:
      - Solo "el primero con datos": CAT devolvia NetIncomeLoss con 4 años
        que terminaban en 2010.
      - Solo "el que más años trae": AAPL devolvia SalesRevenueNet con 11
        años... que terminaban en 2017, porque Apple dejo de usar ese tag.
        El CAGR se calculaba sobre datos de hace ocho años.
    """
    candidatos = []
    for tag in CONCEPTOS[grupo]:
        try:
            d = _sec_json(URL_CONCEPT.format(cik=cik, tag=tag))
        except Exception:
            time.sleep(PAUSA_SEC)
            continue
        time.sleep(PAUSA_SEC)
        units = d.get('units') or {}
        clave = next((k for k in ('USD', 'USD/shares', 'shares') if k in units), None)
        if not clave:
            continue
        serie = anuales(units[clave])
        if len(serie) >= 2:
            candidatos.append({'tag': tag,
                               'serie': {k: v['val'] for k, v in serie.items()},
                               'hasta': max(serie)})
    if not candidatos:
        return {'tag': None, 'serie': {}, 'hasta': None}
    tope = max(c['hasta'] for c in candidatos)
    vigentes = [c for c in candidatos if c['hasta'] >= _menos_un_anio(tope)]
    return max(vigentes, key=lambda c: len(c['serie']))


def _menos_un_anio(fecha_iso):
    """Tolerancia: un ejercicio fiscal puede cerrar unos días antes o después."""
    try:
        return f'{int(fecha_iso[:4]) - 1}{fecha_iso[4:]}'
    except Exception:
        return fecha_iso


def detectar_saltos(acciones, net_income):
    """Un SPLIT multiplica las acciones sin que la empresa emita nada.

    Hacen falta DOS evidencias juntas para corregir: factor redondo Y net
    income estable. Con una sola no alcanza — HIMS salto x5,28 (cerca de 5)
    pero fue su SPAC, no un split."""
    fechas = sorted(acciones)
    saltos = []
    for i in range(1, len(fechas)):
        fa, fb = fechas[i - 1], fechas[i]
        va, vb = acciones[fa], acciones[fb]
        if not va or not vb or va <= 0:
            continue
        ratio = vb / va
        if 0.67 < ratio < 1.5:
            continue
        na, nb = net_income.get(fa), net_income.get(fb)
        ni_estable = bool(na and nb and na != 0 and na * nb > 0
                          and 0.7 <= abs(nb / na) <= 1.4)
        factor = next((c for c in (2, 3, 4, 5, 7, 10, 15, 20,
                                   0.5, 1 / 3, 0.25, 0.2, 0.1)
                       if abs(ratio / c - 1) < 0.12), None)
        if ni_estable and factor:
            saltos.append({'fecha': fb, 'ratio': round(ratio, 3),
                           'tipo': 'split', 'factor': factor})
        else:
            saltos.append({'fecha': fb, 'ratio': round(ratio, 3),
                           'tipo': 'discontinuidad', 'factor': None})
    return saltos


def ajustar_por_splits(serie, saltos, invertir=False):
    """Lleva la serie a la base actual. Solo corrige los marcados como split."""
    porfecha = {s['fecha']: s for s in (saltos or []) if s['tipo'] == 'split'}
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
    if not serie or len(serie) < anios + 1:
        return None
    fechas = sorted(serie)[-(anios + 1):]
    v0, v1 = serie[fechas[0]], serie[fechas[-1]]
    if v0 is None or v1 is None or v0 <= 0 or v1 <= 0:
        return None
    return round(((v1 / v0) ** (1.0 / anios) - 1.0) * 100, 2)


def cagr_seguro(serie, anios, saltos):
    """Se niega a cruzar una discontinuidad sin resolver.

    Vale más un None que un número con el signo dado vuelta: el EPS de LRCX
    daba -26,5% sin corregir cuando en realidad crecia 16,4%."""
    if not serie or len(serie) < anios + 1:
        return None
    ventana = sorted(serie)[-(anios + 1):]
    for s in (saltos or []):
        if s['tipo'] != 'split' and ventana[0] < s['fecha'] <= ventana[-1]:
            return None
    return cagr(serie, anios)


def historico_edgar(ticker):
    """Todo el bloque histórico de un activo. Devuelve avisos en vez de romper
    cuando la empresa no reporta a la SEC."""
    out = {'disponible': False, 'avisos': []}
    cik = cik_de(ticker)
    if not cik:
        out['avisos'].append(
            f'{ticker} no figura en el registro de la SEC, así que no hay '
            f'histórico auditado. El resto del informe no se ve afectado.')
        return out
    out['cik'] = cik

    series = {g: traer_concepto(cik, g) for g in
              ('revenue', 'eps_diluido', 'net_income',
               'gross_profit', 'operating_income', 'acciones_diluidas')}
    rev = series['revenue']['serie']
    if not rev:
        out['avisos'].append('No se pudo identificar el concepto de ingresos '
                             'en los reportes de la SEC.')
        return out

    # Margen bruto derivado si la empresa no lo reporta (caso CAT)
    if not series['gross_profit']['serie']:
        costo = traer_concepto(cik, 'costo_ventas')
        derivado = {f: rev[f] - c for f, c in costo['serie'].items() if rev.get(f)}
        if derivado:
            series['gross_profit'] = {
                'tag': f'derivado: ingresos - {costo["tag"]}', 'serie': derivado}

    ni = series['net_income']['serie']
    acc_crudo = series['acciones_diluidas']['serie']
    saltos = detectar_saltos(acc_crudo, ni)
    acc = ajustar_por_splits(acc_crudo, saltos)
    eps = ajustar_por_splits(series['eps_diluido']['serie'], saltos, invertir=True)

    margenes = {}
    for nombre, s in (('bruto', series['gross_profit']['serie']),
                      ('operativo', series['operating_income']['serie']),
                      ('neto', ni)):
        m = {}
        for f, v in s.items():
            ventas = rev.get(f)
            if ventas:
                m[f] = round(v / ventas * 100, 2)
        margenes[nombre] = m

    out.update({
        'disponible': True,
        'anios_revenue': len(rev),
        'desde': sorted(rev)[0], 'hasta': sorted(rev)[-1],
        'series': {'revenue': rev, 'eps': eps, 'net_income': ni,
                   'acciones': acc, 'margenes': margenes},
        'saltos': saltos,
        'cagr': {
            'revenue_3a': cagr(rev, 3), 'revenue_5a': cagr(rev, 5),
            'revenue_10a': cagr(rev, 10),
            'eps_3a': cagr_seguro(eps, 3, saltos),
            'eps_5a': cagr_seguro(eps, 5, saltos),
            'eps_10a': cagr_seguro(eps, 10, saltos),
            'acciones_3a': cagr_seguro(acc, 3, saltos),
            'acciones_5a': cagr_seguro(acc, 5, saltos),
            'net_income_3a': cagr(ni, 3), 'net_income_5a': cagr(ni, 5),
        },
        'conceptos': {g: s['tag'] for g, s in series.items()},
    })
    for s in saltos:
        if s['tipo'] == 'split':
            out['avisos'].append(
                f"Split detectado en {s['fecha'][:7]} (factor {s['factor']:g}). "
                f"Las series de EPS y acciones están corregidas.")
        else:
            out['avisos'].append(
                f"Salto de {s['ratio']}x en las acciones en {s['fecha'][:7]} "
                f"que no se pudo confirmar como split (puede ser emisión, "
                f"fusion o salida a bolsa). Los CAGR que cruzan esa fecha "
                f"quedan sin calcular a proposito.")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Percentiles contra el sector
# ─────────────────────────────────────────────────────────────────────────────
def percentil(valor, valores, menor_es_mejor=False):
    """Posición dentro del sector, 0-100, donde 100 = mejor.

    Para los múltiplos donde "menor es mejor" se descartan los valores <= 0:
    un P/E o un forward P/E negativo NO significa barato, significa que la
    empresa pierde plata. Sin este filtro RGTI puntuaba 100/100 en valuación."""
    if menor_es_mejor:
        valores = [x for x in valores if x is not None and x > 0]
        if valor is not None and valor <= 0:
            return None
    v = sorted(x for x in valores if x is not None)
    if valor is None or len(v) < 5:
        return None
    debajo = sum(1 for x in v if x < valor)
    p = debajo / len(v) * 100
    return round(100 - p if menor_es_mejor else p, 1)


def mediana(valores):
    v = sorted(x for x in valores if x is not None)
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def contexto_sector(sector, fundamentales, consenso):
    """Junta todos los valores del sector para poder comparar contra el."""
    simbolos = [s['symbol'] for s in fundamentales if s.get('sector') == sector]
    porsym = {s['symbol']: s for s in fundamentales}
    campos = {}
    for c in ('pe', 'pb', 'evEbitda', 'de', 'roe', 'netMargin', 'roa',
              'revGrowth', 'priceToSales'):
        campos[c] = [porsym[s].get(c) for s in simbolos]
    for c in ('forwardPE', 'trailingPegRatio', 'grossMarginPct',
              'operatingMarginPct', 'fcfYieldPct', 'dividendYieldPct',
              'netDebtToEbitda', 'upsidePct', 'targetDispersionPct'):
        campos[c] = [(consenso.get(s) or {}).get(c) for s in simbolos]
    return {'n': len(simbolos), 'campos': campos}


# ─────────────────────────────────────────────────────────────────────────────
# Reglas: hechos, semaforos y veredicto
# ─────────────────────────────────────────────────────────────────────────────
RECOMENDACION_TEXTO = {
    'strong_buy': 'compra fuerte', 'buy': 'compra', 'hold': 'mantener',
    'sell': 'venta', 'strong_sell': 'venta fuerte',
}

# ─── La escala del veredicto ────────────────────────────────────────────────
# Tres posiciones y nada mas: COMPRA / NEUTRAL / VENTA. Antes habia cinco, y la
# quinta ("con reparos") no era una posicion: era un asterisco. Un informe que
# termina en un asterisco no le sirve a nadie que tenga que decidir si compra,
# si se queda o si sale.
#
# Lo que hacia "con reparos" ahora lo hacen dos cosas mas honestas:
#   1. la bandera roja RESTA puntos (PENALIZACION_GRAVE), asi que empuja sola
#      hacia neutral o venta;
#   2. si igual queda alto, TOPEA la etiqueta en neutral. Una empresa con una
#      bandera roja abierta no se recomienda comprar, por lindos que sean los
#      multiplos. Eso queda registrado en 'limitado_por_bandera' para que el
#      informe pueda decirlo con todas las letras en vez de insinuarlo.
#
# 'sin datos' no es una cuarta opinion: es la ausencia de opinion. Se distingue
# a proposito, porque callar y decir "neutral" no es lo mismo.
UMBRAL_COMPRA = 60.0
UMBRAL_VENTA = 40.0
PENALIZACION_GRAVE = 18.0

SIN_DATOS = 'sin datos suficientes'

# Los bloques viajan con su identificador SIN acento ('valuacion'), porque es la
# clave con la que los lee el front. El nombre que se imprime va aparte: si se
# deriva del identificador con un .replace(), al cliente le llega "valuacion"
# en un documento donde todo lo demas esta acentuado.
BLOQUE_TEXTO = {
    'valuacion':        'valuación',
    'crecimiento':      'crecimiento',
    'salud_financiera': 'salud financiera',
    'dividendos':       'dividendos',
    'consenso':         'consenso',
}

# Como se lee el mismo veredicto cuando el papel YA esta en la cartera. Es la
# misma decision mirada desde el otro lado: no es una escala nueva.
ACCION_CARTERA = {
    'compra':  'reforzar',
    'neutral': 'mantener',
    'venta':   'sacar',
    SIN_DATOS: 'revisar a mano',
}

ACLARACION_VEREDICTO = (
    'COMPRA / NEUTRAL / VENTA resume los bloques que se pudieron calcular y '
    'las banderas rojas. Es una lectura de fundamentales a la fecha del dato, '
    'no una recomendación personalizada: no conoce tu horizonte, tu impuesto '
    'ni cuanto pesa el papel en tu cartera.')


def veredicto_de(puntaje, graves):
    """(etiqueta, topeada_por_bandera). Unico lugar donde se decide la etiqueta:
    lo usan el informe individual y el de cartera, así no pueden divergir."""
    if puntaje is None:
        return SIN_DATOS, False
    if puntaje >= UMBRAL_COMPRA:
        return ('neutral', True) if graves else ('compra', False)
    if puntaje >= UMBRAL_VENTA:
        return 'neutral', False
    return 'venta', False


def recomendacion_legible(cons, detalle):
    """Yahoo manda el STRING 'none' en 32 papeles, y 29 de ellos SI tienen
    analistas y precio objetivo — solo falta el promedio agregado. En ese caso
    lo reconstruimos desde la distribución de recomendaciones."""
    clave = cons.get('recommendationKey')
    if clave and clave != 'none':
        return {'etiqueta': RECOMENDACION_TEXTO.get(clave, clave),
                'media': cons.get('recommendationMean'), 'origen': 'Yahoo Finance'}

    trend = ((detalle or {}).get('sentimiento') or {}).get('recommendations_trend')
    if isinstance(trend, dict):
        fila = trend.get('0') or next(iter(trend.values()), None)
        if isinstance(fila, dict):
            pesos = [('strongBuy', 1), ('buy', 2), ('hold', 3),
                     ('sell', 4), ('strongSell', 5)]
            total = sum(fila.get(k) or 0 for k, _ in pesos)
            if total:
                media = sum((fila.get(k) or 0) * p for k, p in pesos) / total
                etiqueta = ('compra fuerte' if media < 1.6 else 'compra' if media < 2.5
                            else 'mantener' if media < 3.5 else 'venta')
                return {'etiqueta': etiqueta, 'media': round(media, 2),
                        'origen': f'reconstruido desde {total} analistas'}
    return {'etiqueta': None, 'media': None, 'origen': None}


def evaluar(ticker, fund, cons, detalle, hist, sec):
    """Produce las señales. Cada una dice QUE pasa y POR QUE, para que el
    veredicto nunca sea una etiqueta suelta."""
    sector = fund.get('sector')
    ocultar = SECTOR_OCULTAR.get(sector, set())
    campos = sec['campos']
    senales, hechos = [], []

    def pct(campo, valor):
        if campo in ocultar:
            return None
        return percentil(valor, campos.get(campo) or [],
                         campo in MENOR_ES_MEJOR)

    # ── VALUACION ────────────────────────────────────────────────────────────
    pe, fpe = fund.get('pe'), cons.get('forwardPE')
    peg = cons.get('trailingPegRatio')
    p_pe, p_fpe = pct('pe', pe), pct('forwardPE', fpe)
    val_puntos, val_notas = [], []
    if pe is None:
        val_notas.append('Sin P/E: la empresa no tiene ganancias positivas, '
                         'así que el múltiplo no existe. Se mira ventas y caja.')
    if pe and fpe and fpe < pe * 0.75:
        val_notas.append(
            f'El P/E adelantado ({fpe:.1f}x) es muy inferior al actual '
            f'({pe:.1f}x): el mercado espera un salto de ganancias, así que '
            f'juzgarla por el múltiplo de hoy la hace parecer más cara de lo '
            f'que está.')
        hechos.append(f'P/E actual {pe:.1f}x vs adelantado {fpe:.1f}x')
    if peg is not None:
        val_puntos.append(70 if peg < 1 else 50 if peg < 2 else 25)
        val_notas.append(f'PEG {peg:.2f}' + (
            ' — barata contra su propio crecimiento.' if peg < 1
            else ' — razonable.' if peg < 2 else ' — cara incluso ajustando por crecimiento.'))
    for p in (p_fpe, p_pe):
        if p is not None:
            val_puntos.append(p)
    senales.append({'bloque': 'valuacion',
                    'titulo': BLOQUE_TEXTO['valuacion'],
                    'puntaje': round(sum(val_puntos) / len(val_puntos), 1) if val_puntos else None,
                    'notas': val_notas})

    # ── CRECIMIENTO ──────────────────────────────────────────────────────────
    cre_puntos, cre_notas = [], []
    c = (hist.get('cagr') or {}) if hist.get('disponible') else {}
    r3, r5, r10 = c.get('revenue_3a'), c.get('revenue_5a'), c.get('revenue_10a')
    if r5 is not None:
        cre_puntos.append(min(100, max(0, 50 + r5 * 2.5)))
        cre_notas.append(f'Ingresos: {r5:+.1f}% anual a 5 años' +
                         (f', {r3:+.1f}% a 3.' if r3 is not None else '.'))
        hechos.append(f'CAGR de ingresos 5a {r5:+.1f}%')
    if r10 is not None:
        cre_notas.append(f'A 10 años: {r10:+.1f}% anual.')
    if r3 is not None and r5 is not None and abs(r3 - r5) > 6:
        cre_notas.append(
            f'Ojo con la ventana: a 3 años da {r3:+.1f}% y a 5 {r5:+.1f}%'
            + (f' y a 10 {r10:+.1f}%' if r10 is not None else '')
            + '. La diferencia viene del año base, no del negocio.')
    # choque entre ventana anual y trimestral (caso RGTI)
    rev_tri = fund.get('revGrowth')
    if r3 is not None and rev_tri is not None and (r3 < 0 < rev_tri - 20 or rev_tri < 0 < r3 - 20):
        cre_notas.append(
            f'Contradicción: el CAGR anual da {r3:+.1f}% pero el crecimiento '
            f'del último trimestre contra el mismo del año anterior da '
            f'{rev_tri:+.1f}%. Las dos cifras son correctas y dicen cosas '
            f'opuestas — mirar las dos antes de concluir.')
        hechos.append(f'contradicción: CAGR anual {r3:+.1f}% vs trimestral {rev_tri:+.1f}%')

    # recompras vs dilucion
    a5, e5, n5 = c.get('acciones_5a'), c.get('eps_5a'), c.get('net_income_5a')
    if a5 is not None:
        if a5 < -1:
            cre_notas.append(
                f'Recompras: {abs(a5):.1f}% menos acciones por año.' +
                (f' Parte del crecimiento del EPS ({e5:+.1f}%) viene de ahi y no '
                 f'del negocio, que gana {n5:+.1f}%.' if (e5 is not None and n5 is not None
                                                          and e5 > n5 + 1.5) else ''))
            hechos.append(f'recompras {abs(a5):.1f}%/año')
        elif a5 > 3:
            cre_puntos.append(20)
            cre_notas.append(
                f'Dilución: {a5:+.1f}% más acciones por año.' +
                (f' Por eso el EPS crece {e5:+.1f}% aunque la empresa gane '
                 f'{n5:+.1f}%: tu porción se achica.' if (e5 is not None and n5 is not None)
                 else ''))
            hechos.append(f'dilución {a5:+.1f}%/año')
    senales.append({'bloque': 'crecimiento',
                    'titulo': BLOQUE_TEXTO['crecimiento'],
                    'puntaje': round(sum(cre_puntos) / len(cre_puntos), 1) if cre_puntos else None,
                    'notas': cre_notas})

    # ── SALUD FINANCIERA ─────────────────────────────────────────────────────
    sal_puntos, sal_notas = [], []
    if 'netDebt' in ocultar:
        sal_notas.append(
            'En bancos y aseguradoras la deuda neta y el EV/EBITDA no se '
            'muestran: los depósitos entran como caja y el número no significa '
            'nada. Se mira P/B y ROE.')
    else:
        nd, nde = cons.get('netDebt'), cons.get('netDebtToEbitda')
        if nd is not None and nd < 0:
            sal_notas.append(f'Caja neta positiva: tiene {abs(nd)/1e9:.1f} mil '
                             f'millones más en caja que en deuda.')
            sal_puntos.append(85)
        elif nde is not None:
            sal_puntos.append(85 if nde < 1 else 60 if nde < 3 else 25)
            sal_notas.append(f'Deuda neta sobre EBITDA: {nde:.1f}x' +
                             (' — cómoda.' if nde < 1 else ' — manejable.' if nde < 3
                              else ' — exigente.'))
        p = pct('netDebtToEbitda', nde)
        if p is not None:
            sal_puntos.append(p)
    fcf = cons.get('fcfYieldPct')
    if fcf is not None:
        sal_notas.append(f'Rendimiento del flujo libre: {fcf:.1f}% sobre la '
                         f'capitalización.')
        hechos.append(f'FCF yield {fcf:.1f}%')
        p = pct('fcfYieldPct', fcf)
        if p is not None:
            sal_puntos.append(p)
    mb = (hist.get('series') or {}).get('margenes', {}).get('bruto') if hist.get('disponible') else None
    if mb and len(mb) >= 4:
        ks = sorted(mb)
        delta = mb[ks[-1]] - mb[ks[0]]
        if abs(delta) > 3:
            sal_notas.append(
                f'Margen bruto {"en expansión" if delta > 0 else "en compresión"}: '
                f'de {mb[ks[0]]:.1f}% a {mb[ks[-1]]:.1f}% desde {ks[0][:4]}.')
            hechos.append(f'margen bruto {mb[ks[0]]:.1f}% -> {mb[ks[-1]]:.1f}%')
    senales.append({'bloque': 'salud_financiera',
                    'titulo': BLOQUE_TEXTO['salud_financiera'],
                    'puntaje': round(sum(sal_puntos) / len(sal_puntos), 1) if sal_puntos else None,
                    'notas': sal_notas})

    # ── DIVIDENDOS ───────────────────────────────────────────────────────────
    div_notas, div_puntos = [], []
    dy, payout = cons.get('dividendYieldPct'), cons.get('payoutRatioPct')
    if dy:
        div_notas.append(f'Rinde {dy:.2f}% en dividendos.')
        hechos.append(f'dividendo {dy:.2f}%')
        p = pct('dividendYieldPct', dy)
        if p is not None:
            div_puntos.append(p)
        if payout and payout > 80:
            div_notas.append(f'Reparte el {payout:.0f}% de sus ganancias: margen '
                             f'estrecho si el resultado cae.')
            div_puntos.append(30)
    else:
        div_notas.append('No paga dividendos.')
    senales.append({'bloque': 'dividendos',
                    'titulo': BLOQUE_TEXTO['dividendos'],
                    'puntaje': round(sum(div_puntos) / len(div_puntos), 1) if div_puntos else None,
                    'notas': div_notas})

    # ── CONSENSO ─────────────────────────────────────────────────────────────
    rec = recomendacion_legible(cons, detalle)
    con_notas, con_puntos = [], []
    n_an = cons.get('numberOfAnalystOpinions')
    ups, disp = cons.get('upsidePct'), cons.get('targetDispersionPct')
    if rec['etiqueta']:
        con_notas.append(f'Consenso: {rec["etiqueta"]}' +
                         (f' ({n_an} analistas).' if n_an else '.') +
                         (' Promedio reconstruido: la fuente no lo trae.'
                          if rec['origen'] and 'reconstruido' in rec['origen'] else ''))
    if ups is not None:
        con_notas.append(f'Precio objetivo medio {ups:+.1f}% respecto del actual.')
        hechos.append(f'upside {ups:+.1f}%')
        con_puntos.append(min(100, max(0, 50 + ups * 1.5)))
    if disp is not None:
        if disp > 90:
            con_notas.append(
                f'Dispersión del precio objetivo: {disp:.0f}%, muy por encima '
                f'de la mediana del mercado (40%). Eso no es convicción, es '
                f'desacuerdo profundo entre analistas.')
            con_puntos.append(35)
            hechos.append(f'dispersión alta {disp:.0f}%')
        elif disp == 0:
            con_notas.append('Todos los analistas con el mismo precio objetivo '
                             'exacto: más probable que sea dato desactualizado '
                             'que unanimidad real.')
    if n_an is not None and n_an < 5:
        con_notas.append(f'Solo {n_an} analistas cubren el papel: el consenso '
                         f'pesa poco.')
    senales.append({'bloque': 'consenso',
                    'titulo': BLOQUE_TEXTO['consenso'],
                    'puntaje': round(sum(con_puntos) / len(con_puntos), 1) if con_puntos else None,
                    'notas': con_notas, 'recomendacion': rec})

    # ── RIESGOS / BANDERAS ───────────────────────────────────────────────────
    riesgos = []
    # trampa de valor
    if p_pe is not None and p_pe > 65 and (r3 is not None and r3 < 0):
        riesgos.append({'codigo': 'trampa_valor', 'severidad': 'alta',
                        'texto': f'Barata contra su sector pero con ingresos '
                                 f'cayendo {r3:+.1f}% anual. Barato por algo: '
                                 f'revisar por que antes de comprar el descuento.'})
    if ups is not None and ups > 40 and (fund.get('roe') or 0) < 0:
        riesgos.append({'codigo': 'upside_sin_ganancias', 'severidad': 'alta',
                        'texto': f'Los analistas ven {ups:+.0f}% de recorrido pero '
                                 f'la empresa pierde plata (ROE {fund.get("roe"):.1f}%). '
                                 f'La tesis depende de que el futuro sea muy '
                                 f'distinto del presente.'})
    if a5 is not None and a5 > 10:
        riesgos.append({'codigo': 'dilucion_fuerte', 'severidad': 'alta',
                        'texto': f'Emite {a5:.0f}% más acciones por año. Aunque '
                                 f'el negocio crezca, tu porción se achica.'})
    beta = cons.get('beta')
    if beta and beta > 1.8:
        riesgos.append({'codigo': 'volatilidad', 'severidad': 'media',
                        'texto': f'Beta {beta:.2f}: se mueve mucho más que el '
                                 f'mercado en las dos direcciones.'})
    sf = cons.get('shortPercentOfFloat')
    if sf and sf > 0.10:
        riesgos.append({'codigo': 'short_alto', 'severidad': 'media',
                        'texto': f'{sf*100:.1f}% del capital flotante está vendido '
                                 f'en corto: hay una apuesta grande en contra.'})
    dmax = cons.get('desdeMaximo52wPct')
    if dmax is not None and dmax < -40:
        riesgos.append({'codigo': 'lejos_del_maximo', 'severidad': 'media',
                        'texto': f'Cotiza {abs(dmax):.0f}% por debajo de su máximo '
                                 f'de 52 semanas.'})
    for s in (hist.get('avisos') or []):
        if 'no se pudo confirmar' in s:
            riesgos.append({'codigo': 'serie_discontinua', 'severidad': 'baja',
                            'texto': s})

    # ── VEREDICTO ────────────────────────────────────────────────────────────
    puntajes = [s['puntaje'] for s in senales if s['puntaje'] is not None]
    global_ = round(sum(puntajes) / len(puntajes), 1) if puntajes else None
    graves = [r for r in riesgos if r['severidad'] == 'alta']
    # Las banderas rojas DESCUENTAN del puntaje, no solo cambian la etiqueta.
    if global_ is not None and graves:
        global_ = round(max(0.0, global_ - PENALIZACION_GRAVE * len(graves)), 1)

    etiqueta, cap = veredicto_de(global_, graves)
    porque = [f"{BLOQUE_TEXTO.get(s['bloque'], s['bloque'])}: {s['puntaje']:.0f}/100"
              for s in senales if s['puntaje'] is not None]
    if graves:
        porque.append(
            f'{len(graves)} bandera(s) roja(s): '
            + '; '.join(r['codigo'].replace('_', ' ') for r in graves))
    if cap:
        porque.append('con una bandera roja abierta no puede quedar en COMPRA, '
                      'por bueno que sea el puntaje')

    return {
        'senales': senales,
        'riesgos': riesgos,
        'veredicto': {'puntaje': global_, 'etiqueta': etiqueta, 'porque': porque,
                      'accion': ACCION_CARTERA.get(etiqueta),
                      'limitado_por_bandera': cap,
                      'aclaracion': ACLARACION_VEREDICTO},
        'hechos': hechos,
    }


def armar_datos(ticker):
    """action=datos — CERO llamadas al modelo de lenguaje."""
    ticker = ticker.upper().strip()
    fundamentales = estatico('sp500_fundamentals.json')
    consensos = estatico('informe_consenso.json')
    try:
        detalles = estatico('informe_detalle.json')
    except Exception:
        detalles = {'activos': {}, 'generated_at': None}

    porsym = {s['symbol']: s for s in fundamentales.get('stocks', [])}
    cons_all = consensos.get('consenso', {})
    det_all = detalles.get('activos', {})

    fund = porsym.get(ticker)
    detalle = det_all.get(ticker)

    # Un registro puede EXISTIR y estar hueco: Yahoo devuelve `.info` sin nada
    # y el bot lo guarda igual, con sector None y precio 0. Pasó con 8 ADR el
    # 25/08/2026. Tomarlo como dato bueno arma un informe con todos los bloques
    # en cero y un veredicto calculado sobre la nada — bastante peor que decir
    # "no tengo el dato". Se descarta acá, una sola vez, para que ni el informe
    # individual ni el de cartera puedan verlo.
    hueco = bool(detalle) and not detalle.get('sector') and not detalle.get('price')
    if hueco:
        detalle = None

    if fund is None and detalle is None:
        if hueco:
            return None, (
                f'{ticker} figura en informe_detalle.json pero el registro vino '
                f'vacio: la fuente no devolvio ni sector ni precio. No es un '
                f'informe reducido, es un dato que no existe. Corre '
                f'local_bot/probe_vacios.py {ticker} para ver si el papel opera '
                f'con otro simbolo.')
        return None, f'No tengo datos de {ticker}. Si no es del S&P 500, ' \
                     f'agregalo a local_bot/tickers_informe.txt y corre ' \
                     f'fetch_informe.py.'

    # Sin sector no hay informe posible: TODOS los puntajes son percentiles
    # contra las empresas del mismo sector, asi que sin sector todos los bloques
    # dan None y sale un documento en blanco con un veredicto de "sin datos" —
    # que no explica nada. Le pasa a los ETF, que no tienen sector por
    # definicion: SPY esta en el snapshot del screener porque es el indice de
    # referencia, y hasta ahora si alguien lo escribia en el buscador recibia
    # ese informe vacio.
    sector_final = (fund or {}).get('sector') or (detalle or {}).get('sector')
    if not sector_final:
        return None, (
            f'{ticker} no tiene sector asignado, así que no es una empresa '
            f'individual: casi seguro es un ETF o un índice. Todo el informe se '
            f'construye comparando contra las empresas del mismo sector, y sin '
            f'sector no hay contra que comparar. Para un ETF mira su composicion, '
            f'no sus múltiplos.')
    if fund is None:      # fuera del S&P 500: los datos vienen del detalle
        fund = {k: detalle.get(k) for k in
                ('symbol', 'name', 'sector', 'price', 'changePercent', 'marketCap',
                 'pe', 'pb', 'roe', 'de', 'evEbitda', 'netMargin', 'roa',
                 'revGrowth', 'priceToSales', 'hasCedear')}
    cons = (detalle or {}).get('consenso') or cons_all.get(ticker) or {}

    completo = detalle is not None
    hist = historico_edgar(ticker)
    sec = contexto_sector(fund.get('sector'), fundamentales.get('stocks', []), cons_all)
    ev = evaluar(ticker, fund, cons, detalle, hist, sec)

    avisos = list(hist.get('avisos') or [])
    if not completo:
        avisos.insert(0,
            f'Informe REDUCIDO: {ticker} no está en informe_detalle.json, así '
            f'que faltan el consenso a futuro y el sentimiento. Para el informe '
            f'completo agregalo a local_bot/tickers_informe.txt y corre '
            f'fetch_informe.py.')
    if sec['n'] < 25:
        avisos.append(f'El sector {fund.get("sector")} tiene solo {sec["n"]} '
                      f'empresas en el índice: los percentiles son ruidosos.')

    return {
        'ticker': ticker,
        'nombre': fund.get('name'),
        'sector': fund.get('sector'),
        'enSp500': ticker in porsym,
        'hasCedear': fund.get('hasCedear'),
        'nivel': 'completo' if completo else 'reducido',
        'generado_en': datetime.now(timezone.utc).isoformat(),
        'fuentes': {
            'fundamentales_y_consenso': {
                'origen': 'Yahoo Finance vía bot local',
                'fecha': consensos.get('generated_at') or fundamentales.get('generated_at'),
            },
            'consenso_a_futuro_y_sentimiento': {
                'origen': 'Yahoo Finance vía bot local',
                'fecha': detalles.get('generated_at') if completo else None,
            },
            'historico': {
                'origen': 'SEC EDGAR (reportes 10-K auditados)',
                'consultado_en_vivo': True,
                'anios': hist.get('anios_revenue'),
            },
        },
        'fundamentales': fund,
        'consenso': cons,
        'sector_contexto': {
            'n': sec['n'],
            'medianas': {k: mediana(v) for k, v in sec['campos'].items()},
            'ocultar': sorted(SECTOR_OCULTAR.get(fund.get('sector'), set())),
            'notas': SECTOR_NOTAS.get(fund.get('sector'), {}),
        },
        'historico': hist,
        'senales': ev['senales'],
        'riesgos': ev['riesgos'],
        'veredicto': ev['veredicto'],
        'hechos': ev['hechos'],
        'sentimiento': (detalle or {}).get('sentimiento'),
        'consenso_forward': (detalle or {}).get('consenso_forward'),
        'avisos': avisos,
        'descargo': 'Este informe es análisis automatizado sobre datos públicos '
                    'y NO constituye recomendación de inversión. Verifica las '
                    'cifras antes de operar.',
    }, None


def diagnostico():
    """Chequea una por una las dependencias del endpoint y devuelve 200 SIEMPRE.

    Existe para no adivinar: si algo falla en producción, esta URL dice
    exactamente que pieza es. No consume LLM ni cuesta nada."""
    out = {'ok': True, 'entorno': {}, 'archivos': {}, 'sec': {}}

    for v in ('VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL'):
        out['entorno'][v] = os.environ.get(v) or None
    out['entorno']['cwd'] = os.getcwd()
    out['entorno']['dir_del_archivo'] = os.path.dirname(os.path.abspath(__file__))
    out['entorno']['tiene_api_key'] = bool(os.environ.get('ANTHROPIC_API_KEY')
                                           or os.environ.get('OPENAI_API_KEY'))

    # que hay realmente en el disco de la funcion
    listados = {}
    for base in RUTAS_DATOS:
        try:
            listados[base] = sorted(os.listdir(base))[:10] if os.path.isdir(base) else None
        except Exception as e:
            listados[base] = f'{type(e).__name__}'
    out['entorno']['rutas_probadas'] = listados

    for nombre in ('sp500_fundamentals.json', 'informe_consenso.json',
                   'informe_detalle.json'):
        try:
            d = estatico(nombre)
            out['archivos'][nombre] = {
                'ok': True,
                'generado': d.get('generated_at'),
                'elementos': len(d.get('stocks') or d.get('consenso') or d.get('activos') or []),
            }
        except Exception as e:
            out['archivos'][nombre] = {'ok': False, 'error': f'{type(e).__name__}: {e}'}
            out['ok'] = False

    try:
        cik = cik_de('AAPL')
        out['sec'] = {'ok': bool(cik), 'cik_de_AAPL': cik,
                      'tickers_en_el_mapa': len(_cache_cik)}
        if not cik:
            out['ok'] = False
    except Exception as e:
        out['sec'] = {'ok': False, 'error': f'{type(e).__name__}: {e}'}
        out['ok'] = False

    return out


# ─────────────────────────────────────────────────────────────────────────────
# Handler
# ─────────────────────────────────────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):

    def _responder(self, codigo, cuerpo):
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        # Regla de oro #7: toda API dinamica necesita no-store explicito
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.end_headers()
        self.wfile.write(json.dumps(cuerpo, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        try:
            q = parse_qs(urlparse(self.path).query)
            accion = (q.get('action') or ['datos'])[0]
            ticker = (q.get('ticker') or [''])[0].strip().upper()

            if not ticker and accion != 'diag':
                return self._responder(400, {'error': 'Falta el parametro ticker.'})

            if accion == 'diag':
                return self._responder(200, diagnostico())

            if accion == 'datos':
                datos, err = armar_datos(ticker)
                if err:
                    return self._responder(404, {'error': err})
                return self._responder(200, datos)

            if accion == 'tesis':
                # Se implementa cuando exista la API key. action=datos no
                # depende de esto: el informe se ve completo igual.
                if not os.environ.get('ANTHROPIC_API_KEY') and not os.environ.get('OPENAI_API_KEY'):
                    return self._responder(501, {
                        'error': 'La redacción de la tesis todavía no está '
                                 'configurada. Falta cargar la API key en las '
                                 'variables de entorno de Vercel.',
                        'sin_costo': True})
                return self._responder(501, {'error': 'Pendiente de implementar.'})

            return self._responder(400, {'error': f'Accion desconocida: {acción}'})

        except Exception as e:
            import traceback
            return self._responder(500, {
                'error': f'{type(e).__name__}: {e}',
                'donde': traceback.format_exc().strip().splitlines()[-3:],
                'pista': 'Abrí /api/informe?action=diag para ver qué parte falla.',
            })

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.end_headers()
