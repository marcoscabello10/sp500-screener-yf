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
    GET /api/informe?action=datos&ticker=AAPL                    CERO costo
    GET /api/informe?action=proveedores                          CERO costo
    GET /api/informe?action=tesis&ticker=AAPL&proveedor=anthropic  <- gasta
    GET /api/informe?action=tesis&ticker=AAPL&proveedor=openai     <- gasta

El parametro `proveedor` es obligatorio y no tiene valor por defecto: sin el no
se llama a ningun modelo. Y no hay fallback entre proveedores — si elegis uno y
su clave no esta, falla diciendo eso, no gasta en el otro.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
import json
import os
import re
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

# Debajo de este rendimiento, el dividendo no es parte de la tesis de inversión
# y por lo tanto no puntúa. Ver el comentario largo en el bloque DIVIDENDOS: sin
# este umbral, pagar poco puntuaba peor que no pagar nada.
UMBRAL_DIVIDENDO_RELEVANTE = 1.0

# ─── Cuánto pesa cada bloque en el veredicto ────────────────────────────────
#
# Hasta el 26/08/2026 los cinco bloques promediaban parejo. Marcos notó que el
# dividendo pesaba demasiado en empresas con buenos fundamentales, y medido
# sobre las 503 tenía razón: **30 empresas cambiaban de veredicto solo por el
# dividendo**. Once llegaban a COMPRA empujadas por él (ITW, TROW, VZ, MDT), y
# diecinueve dejaban de serlo por pagar poco:
#
#     EQT  74,3 sin dividendos  ->  57,9 con el bloque puesto  (bloque 9/100)
#     PCG  68,8                 ->  53,3                       (bloque 7/100)
#     KO                        ->  37,5 = VENTA               (bloque 19/100)
#
# Coca-Cola marcada VENTA por repartir poco *para Consumer Staples* muestra el
# problema de fondo: el percentil de dividendo mide "paga más que sus pares",
# que es una POLÍTICA DE REPARTO, no una medida de la calidad del negocio. Una
# empresa que no reparte no es peor: es distinta.
#
# Por eso el dividendo pesa la mitad que los bloques que sí miden el negocio.
# No cero: un dividendo sostenido en el tiempo es evidencia real de generación
# de caja y de disciplina. Pero no puede valer lo mismo que la valuación.
#
# Y esto NO le quita importancia al dividendo para quien la busca: el objetivo
# de la cartera (cartera.js) multiplica este peso por 2,5 en "renta" y por 0,25
# en "crecimiento". La preferencia del cliente se expresa ahí, que es donde
# corresponde, y no metida dentro del puntaje de la empresa.
#
# Efecto medido con peso 0,5: cambian 22 de 503 (4,4%). Es una corrección
# quirúrgica, no una barajada de nuevo.
PESO_BLOQUE = {
    'valuacion': 1.0,
    'crecimiento': 1.0,
    'salud_financiera': 1.0,
    'consenso': 1.0,
    'dividendos': 0.5,
}

NOTA_PESO_DIVIDENDO = (
    'El dividendo pesa la mitad que los demás bloques: repartir o reinvertir es '
    'una decisión de política, no una medida de qué tan bueno es el negocio. Si '
    'buscás renta, el objetivo de la cartera le devuelve el peso completo.')

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
                    'peso': PESO_BLOQUE['valuacion'],
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
                    'peso': PESO_BLOQUE['crecimiento'],
                    'puntaje': round(sum(cre_puntos) / len(cre_puntos), 1) if cre_puntos else None,
                    'notas': cre_notas})

    # ── SALUD FINANCIERA ─────────────────────────────────────────────────────
    sal_puntos, sal_notas = [], []
    # ⚠️ nd/nde se inicializan ACA, afuera del if/else de abajo. En Financials
    # se toma la rama que NO las define (los depositos entran como caja y el
    # numero no significa nada), asi que sin esto quedaban sin ligar y
    # cualquier lectura posterior tiraba UnboundLocalError. Mismo patron que
    # `delta`, que {accion} en el f-string y que `r.status` en App.jsx.
    nd = nde = None
    if 'netDebt' in ocultar:
        sal_notas.append(
            'En bancos y aseguradoras la deuda neta y el EV/EBITDA no se '
            'muestran: los depósitos entran como caja y el número no significa '
            'nada. Se mira P/B y ROE.')
    else:
        nd, nde = cons.get('netDebt'), cons.get('netDebtToEbitda')
        # (nd y nde se inicializan arriba en None: en Financials esta rama no
        #  corre y cualquier lectura posterior reventaria.)
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
    # ⚠️ `delta` se inicializa ACA, afuera del if. Antes solo existia adentro,
    # y cuando `mb` venia vacio —que es SIEMPRE en Financials, porque
    # grossMarginPct esta en SECTOR_OCULTAR— cualquier lectura posterior
    # reventaba con UnboundLocalError. Es el mismo patron que {accion} en el
    # f-string y que `r.status` en App.jsx: un nombre que no existe en la rama
    # que casi nunca se mira.
    delta = None
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
                    'peso': PESO_BLOQUE['salud_financiera'],
                    'puntaje': round(sum(sal_puntos) / len(sal_puntos), 1) if sal_puntos else None,
                    'notas': sal_notas})

    # ── DIVIDENDOS ───────────────────────────────────────────────────────────
    #
    # ⚠️ Acá había un incentivo al revés y costó verlo. El bloque solo puntuaba
    # si `dy` era distinto de cero; si la empresa no pagaba nada, quedaba en
    # None y no entraba al promedio. Resultado medido sobre datos reales:
    #
    #     AMZN  paga 0%      -> bloque None -> global 63,5
    #     GOOGL paga 0,26%   -> bloque 0/100 -> global 47,1
    #
    # O sea: empezar a pagar un dividendo simbólico te hundía el puntaje, y no
    # pagar nada te lo dejaba intacto. Dos empresas parecidas separadas por 16
    # puntos a causa de un dividendo que a ninguno de los dos accionistas le
    # cambia la vida.
    #
    # La regla ahora es una sola y sin escalón: el bloque puntúa solo cuando el
    # dividendo es parte de la tesis. Debajo de UMBRAL_DIVIDENDO_RELEVANTE el
    # dato se informa pero no puntúa — igual que cuando no paga nada.
    div_notas, div_puntos = [], []
    dy, payout = cons.get('dividendYieldPct'), cons.get('payoutRatioPct')
    if dy and dy >= UMBRAL_DIVIDENDO_RELEVANTE:
        div_notas.append(f'Rinde {dy:.2f}% en dividendos.')
        hechos.append(f'dividendo {dy:.2f}%')
        p = pct('dividendYieldPct', dy)
        if p is not None:
            div_puntos.append(p)
        if payout and payout > 80:
            div_notas.append(f'Reparte el {payout:.0f}% de sus ganancias: margen '
                             f'estrecho si el resultado cae.')
            div_puntos.append(30)
    elif dy:
        div_notas.append(
            f'Rinde {dy:.2f}% en dividendos: por debajo del '
            f'{UMBRAL_DIVIDENDO_RELEVANTE:.0f}% el dividendo no mueve la tesis, '
            f'así que se informa pero no puntúa. Esta empresa se juzga por lo '
            f'que hace con la plata que retiene, no por lo que reparte.')
    else:
        div_notas.append(
            'No paga dividendos. No es una falta: en una empresa en crecimiento '
            'reinvertir suele rendir más que repartir. El bloque no puntúa.')
    senales.append({'bloque': 'dividendos',
                    'titulo': BLOQUE_TEXTO['dividendos'],
                    'peso': PESO_BLOQUE['dividendos'],
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
                    'peso': PESO_BLOQUE['consenso'],
                    'puntaje': round(sum(con_puntos) / len(con_puntos), 1) if con_puntos else None,
                    'notas': con_notas, 'recomendacion': rec})

    # ── RIESGOS / BANDERAS ───────────────────────────────────────────────────
    riesgos = []
    # trampa de valor
    if p_pe is not None and p_pe > 65 and (r3 is not None and r3 < 0):
        # Antes esto decia "revisar por que antes de comprar el descuento" y
        # ahi terminaba: mandaba a revisar sin decir QUE. Ahora arma la lista
        # de chequeos y, donde el dato ya esta bajado, la CONTESTA. Un aviso
        # que solo dice "fijate" traslada el trabajo al lector.
        revisar = []

        # 1. El mercado ya sabe? Un forward P/E MAS ALTO que el actual
        #    significa que los analistas esperan que la ganancia CAIGA. Es el
        #    indicio mas directo de que el descuento no es una oportunidad.
        if pe and fpe:
            if fpe > pe * 1.05:
                revisar.append(f'El mercado ya espera que empeore: el P/E a '
                               f'futuro ({fpe:.1f}x) es MAYOR que el actual '
                               f'({pe:.1f}x), o sea que se proyecta menos '
                               f'ganancia, no mas.')
            elif fpe < pe * 0.9:
                revisar.append(f'A favor: el P/E a futuro ({fpe:.1f}x) es menor '
                               f'que el actual ({pe:.1f}x), asi que se espera '
                               f'que la ganancia se recupere.')

        # 2. Caen los ingresos pero sube el EPS? Entonces lo esta sosteniendo
        #    la recompra de acciones, no el negocio — y eso tiene un limite.
        if e5 is not None and n5 is not None and e5 > 0 and n5 < 0:
            extra = f' con {abs(a5):.1f}% anual de recompra' if a5 else ''
            revisar.append(f'El EPS sube {e5:+.1f}% anual pero la ganancia total '
                           f'cae {n5:+.1f}%{extra}: lo sostiene la recompra de '
                           f'acciones, no el negocio. Eso tiene limite.')

        # 3. El dividendo aguanta? Es LA pregunta si el papel se compro por
        #    la renta y los ingresos estan cayendo.
        if payout is not None and dy is not None:
            if payout > 80:
                revisar.append(f'El dividendo esta en riesgo: paga {payout:.0f}% '
                               f'de la ganancia para rendir {dy:.1f}%. Con los '
                               f'ingresos cayendo, ese reparto no tiene margen.')
            elif payout > 0:
                revisar.append(f'El dividendo por ahora aguanta: reparte '
                               f'{payout:.0f}% de la ganancia para rendir '
                               f'{dy:.1f}%.')

        # 4. Cuanto tiempo da la deuda antes de que aprete.
        if nde is not None and nde > 3:
            revisar.append(f'La deuda no da mucho tiempo: {nde:.1f}x EBITDA. '
                           f'Con ingresos en baja, ese multiplo sube solo.')

        # 5. Se defiende el margen o esta cediendo precio?
        if delta is not None:
            if delta < -2:
                revisar.append(f'Ademas esta cediendo precio: el margen bruto '
                               f'bajo {delta:.1f} puntos en el periodo.')
            elif delta > 2:
                revisar.append(f'A favor: sostiene el margen bruto '
                               f'({delta:+.1f} puntos), asi que vende menos '
                               f'pero no mas barato.')

        # 6. Es caida de todo el sector o solo de esta empresa? Sin el dato
        #    del sector no se puede contestar, pero SI hay que preguntarlo.
        revisar.append('Queda por mirar a mano si la caida es de la empresa o '
                       'de todo su sector: no es lo mismo perder contra los '
                       'competidores que acompanar un ciclo.')

        riesgos.append({'codigo': 'trampa_valor', 'severidad': 'alta',
                        'texto': f'Barata contra su sector pero con ingresos '
                                 f'cayendo {r3:+.1f}% anual. Barato por algo: '
                                 f'esto es lo que hay que revisar antes de '
                                 f'comprar el descuento.',
                        'revisar': revisar})
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
    # Promedio PONDERADO (ver PESO_BLOQUE). Antes era un promedio simple y eso
    # le daba al dividendo el mismo peso que a la valuación.
    con_dato = [(s['puntaje'], PESO_BLOQUE.get(s['bloque'], 1.0))
                for s in senales if s['puntaje'] is not None]
    total_peso = sum(w for _, w in con_dato)
    global_ = (round(sum(v * w for v, w in con_dato) / total_peso, 1)
               if total_peso else None)
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
    if any(s['bloque'] == 'dividendos' and s['puntaje'] is not None for s in senales):
        porque.append('el bloque de dividendos pesa la mitad')

    return {
        'senales': senales,
        'riesgos': riesgos,
        'veredicto': {'puntaje': global_, 'etiqueta': etiqueta, 'porque': porque,
                      'accion': ACCION_CARTERA.get(etiqueta),
                      'limitado_por_bandera': cap,
                      'aclaracion': ACLARACION_VEREDICTO},
        'hechos': hechos,
    }


# ─────────────────────────────────────────────────────────────────────────────
# LA TESIS — el ÚNICO lugar de todo el proyecto que gasta plata
#
# Regla que define el diseño de este bloque, pedida por Marcos:
#
#     "solo al generar la parte del informe que requiera y no todo o por todo,
#      que no va a gastar solo por gastar por correr algo que no requiera su
#      uso, solo cuándo lo requiera"
#
# Cómo se cumple, concretamente:
#   · No se llama al modelo en `action=datos`. El informe se ve COMPLETO sin
#     gastar un centavo.
#   · Se llama solo con `action=tesis`, que el front dispara con clic explícito.
#   · Un clic = una llamada. No hay reintentos que puedan cobrar dos veces.
#   · El front cachea la tesis: releer el informe no vuelve a cobrar.
#   · Tope duro de tokens de salida, así una respuesta desbocada no puede
#     costar 50 veces lo previsto.
#
# Y la regla de los DOS PROVEEDORES, que también pidió Marcos:
#
#     "dos clicks diferentes, solo que gaste si selecciono uno, si elijo openai
#      no use tokens de anthropic o viceversa"
#
# Por eso NO HAY FALLBACK ENTRE PROVEEDORES. Si elegís OpenAI y su clave no
# está, el endpoint devuelve un error diciendo eso — no se cae a Anthropic para
# "salvar" la respuesta. Un fallback silencioso sería exactamente gastar en un
# proveedor que no elegiste.
# ─────────────────────────────────────────────────────────────────────────────

# Tope duro de salida. Estaba en 900 y la PRIMERA llamada real a Anthropic
# (MSFT, 28/08/2026) volvio sin texto habiendo cobrado igual: con los modelos
# que razonan antes de responder, el presupuesto se puede consumir entero en el
# bloque de razonamiento y no queda nada para el texto.
#
# Subir el tope NO sube el costo por si solo -- se paga lo que el modelo
# escribe, no lo que se le permite escribir. Lo unico que hace es que no se
# corte antes de empezar.
MAX_TOKENS_TESIS = 2000
TIMEOUT_LLM = 45

# Precios por millón de tokens, para estimar el costo de cada tesis y
# devolverlo en la respuesta. Si Anthropic u OpenAI cambian la lista, esto
# queda viejo: es una ESTIMACIÓN para que Marcos vea el orden de magnitud, no
# una factura. La factura real está en la consola de cada proveedor.
PRECIOS = {
    'claude-sonnet-5':  (2.00, 10.00),
    'claude-haiku-4-5': (1.00,  5.00),
    'claude-opus-5':    (5.00, 25.00),
    'gpt-5.6-luna':     (0.20,  1.20),
    'gpt-5.6-terra':    (2.00, 12.00),
}

PROVEEDORES = {
    'anthropic': {
        'nombre': 'Anthropic',
        'env_clave': 'ANTHROPIC_API_KEY',
        'env_modelo': 'MODELO_ANTHROPIC',
        'modelo_default': 'claude-sonnet-5',
        'url': 'https://api.anthropic.com/v1/messages',
    },
    'openai': {
        'nombre': 'OpenAI',
        'env_clave': 'OPENAI_API_KEY',
        'env_modelo': 'MODELO_OPENAI',
        'modelo_default': 'gpt-5.6-luna',
        'url': 'https://api.openai.com/v1/chat/completions',
    },
}

SISTEMA = """Sos un analista de inversiones que redacta para un cliente minorista argentino.

REGLAS QUE NO SE NEGOCIAN:
1. NO inventes ni un solo numero. Usa exclusivamente las cifras del JSON que te
   paso. Si un dato no esta, decilo: "no tengo ese dato". Jamas lo estimes.
2. NO redondees hacia un numero mas lindo ni cambies un signo.
3. El consenso de analistas es de ANALISTAS, nunca lo escribas como si fuera
   proyeccion de la empresa.
4. Si hay banderas rojas, tienen que aparecer en el texto. No las suavices.
5. Escribi en castellano rioplatense neutro, sin "tu" ni "usted". Sin emojis.
   Sin vinetas: prosa corrida.
6. Nada de formulas de relleno tipo "es importante destacar" o "en conclusion".
7. No prometas rendimientos ni des ordenes de compra. Sos una lectura de
   fundamentales, no un asesor que conoce al cliente.

FORMATO: tres parrafos, maximo 200 palabras en total.
  Parrafo 1: que hace la empresa y de donde sale el veredicto.
  Parrafo 2: el argumento mas fuerte a favor, con la cifra que lo sostiene.
  Parrafo 3: que tendria que pasar para que la tesis falle. Si hay banderas
             rojas, este parrafo arranca por ahi."""


def _resumen_para_llm(d):
    """Lo MINIMO que el modelo necesita para juzgar.

    No se le mandan las series historicas crudas ni el sentimiento completo: son
    miles de tokens que el modelo no usa para escribir tres parrafos, y cada
    token de mas se paga. Medido: este resumen da ~450 tokens por activo contra
    ~4.000 del informe entero."""
    return {
        'ticker': d['ticker'], 'nombre': d['nombre'], 'sector': d['sector'],
        'veredicto': {k: d['veredicto'][k] for k in ('puntaje', 'etiqueta', 'porque')},
        'bloques': [{'nombre': s['titulo'], 'puntaje': s['puntaje'], 'notas': s['notas']}
                    for s in d['senales']],
        'banderas_rojas': [r['texto'] for r in d['riesgos'] if r['severidad'] == 'alta'],
        'otros_riesgos': [r['texto'] for r in d['riesgos'] if r['severidad'] != 'alta'],
        'hechos': d['hechos'],
        'multiplos': {k: d['fundamentales'].get(k) for k in
                      ('pe', 'pb', 'roe', 'de', 'evEbitda', 'netMargin', 'revGrowth')},
        'nota_del_sector': (d.get('sector_contexto') or {}).get('notas') or {},
    }


def _post_json(url, headers, cuerpo, timeout=TIMEOUT_LLM):
    datos = json.dumps(cuerpo).encode('utf-8')
    req = urllib.request.Request(url, data=datos, headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def _llamar_anthropic(clave, modelo, prompt):
    r = _post_json(PROVEEDORES['anthropic']['url'], {
        'x-api-key': clave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
    }, {
        'model': modelo,
        'max_tokens': MAX_TOKENS_TESIS,
        'system': SISTEMA,
        'messages': [{'role': 'user', 'content': prompt}],
    })
    bloques = r.get('content') or []
    texto = ''.join(b.get('text', '') for b in bloques if b.get('type') == 'text')
    u = r.get('usage') or {}
    # Si no vino texto hay que saber POR QUE sin gastar otra llamada a ciegas.
    # La version anterior devolvia solo "respondio vacio" y tiraba el
    # stop_reason, los tipos de bloque y el uso -- justo lo unico que explica
    # que paso. Es el mismo error que el `catch {}` vacio del cache: el dato
    # estaba y se descartaba.
    diag = None
    if not texto.strip():
        diag = {'stop_reason': r.get('stop_reason'),
                'tipos_de_bloque': [b.get('type') for b in bloques],
                'n_bloques': len(bloques),
                'modelo_que_respondio': r.get('model'),
                'tokens_salida': u.get('output_tokens')}
    return texto.strip(), u.get('input_tokens'), u.get('output_tokens'), diag


def _llamar_openai(clave, modelo, prompt):
    cabeceras = {'Authorization': f'Bearer {clave}',
                 'Content-Type': 'application/json'}
    base = {
        'model': modelo,
        'messages': [{'role': 'system', 'content': SISTEMA},
                     {'role': 'user', 'content': prompt}],
    }
    # Los modelos nuevos de OpenAI usan max_completion_tokens y rechazan
    # max_tokens; los viejos, al reves. Se prueba el nuevo y, si lo rechaza por
    # el nombre del parametro, se reintenta con el viejo. El reintento NO puede
    # cobrar dos veces: el primer intento muere en un 400 antes de generar nada.
    for campo in ('max_completion_tokens', 'max_tokens'):
        try:
            r = _post_json(PROVEEDORES['openai']['url'], cabeceras,
                           dict(base, **{campo: MAX_TOKENS_TESIS}))
            break
        except urllib.error.HTTPError as e:
            detalle = e.read().decode('utf-8', 'replace')
            if e.code == 400 and campo in detalle and campo == 'max_completion_tokens':
                continue
            raise RuntimeError(f'OpenAI {e.code}: {detalle[:300]}')
    else:
        raise RuntimeError('OpenAI rechazo el tope de tokens con los dos nombres.')

    ch = (r.get('choices') or [{}])[0]
    texto = ((ch.get('message') or {}).get('content') or '')
    diag = None
    if not texto.strip():
        diag = {'finish_reason': ch.get('finish_reason'),
                'modelo_que_respondio': r.get('model'),
                'claves_del_message': sorted((ch.get('message') or {}).keys())}
    u = r.get('usage') or {}
    return texto.strip(), u.get('prompt_tokens'), u.get('completion_tokens'), diag


def proveedores_disponibles():
    """Que proveedores tienen clave cargada. El front usa esto para mostrar un
    boton por proveedor: si no hay clave, no hay boton, y entonces no hay forma
    de gastar por accidente."""
    out = {}
    for k, p in PROVEEDORES.items():
        out[k] = {
            'nombre': p['nombre'],
            'disponible': bool(os.environ.get(p['env_clave'])),
            'modelo': os.environ.get(p['env_modelo'], p['modelo_default']),
        }
    return out


def generar_tesis(ticker, proveedor):
    """action=tesis. El UNICO camino del proyecto que consume tokens.

    Devuelve (resultado, error). Nunca cae de un proveedor al otro."""
    if proveedor not in PROVEEDORES:
        return None, (f'Proveedor desconocido: {proveedor!r}. '
                      f'Validos: {", ".join(PROVEEDORES)}.')
    p = PROVEEDORES[proveedor]
    clave = os.environ.get(p['env_clave'])
    if not clave:
        # Sin fallback a proposito: ver el comentario largo arriba.
        return None, (f'No hay clave de {p["nombre"]} configurada. Cargá '
                      f'{p["env_clave"]} en las variables de entorno de Vercel. '
                      f'No se usa el otro proveedor en su lugar: elegiste este.')

    datos, err = armar_datos(ticker)
    if err:
        return None, err

    modelo = os.environ.get(p['env_modelo'], p['modelo_default'])
    prompt = ('Escribi la tesis de inversion para este activo, siguiendo las '
              'reglas al pie de la letra. Datos:\n\n'
              + json.dumps(_resumen_para_llm(datos), ensure_ascii=False, indent=1))

    t0 = time.time()
    try:
        fn = _llamar_anthropic if proveedor == 'anthropic' else _llamar_openai
        texto, t_ent, t_sal, diag = fn(clave, modelo, prompt)
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode('utf-8', 'replace')[:300]
        return None, (f'{p["nombre"]} devolvio {e.code}. {cuerpo} '
                      + ('Revisá que la clave sea correcta y tenga credito.'
                         if e.code in (401, 403) else
                         'Estas yendo muy rapido: esperá unos segundos.'
                         if e.code == 429 else
                         f'Revisá que el modelo {modelo!r} exista para tu cuenta.'
                         if e.code == 404 else ''))
    except Exception as e:
        return None, f'No pude hablar con {p["nombre"]}: {type(e).__name__}: {e}'

    if not texto:
        # El mensaje tiene que traer el diagnostico: la llamada YA se cobro, asi
        # que repetirla a ciegas cuesta plata y no aporta nada nuevo.
        d = diag or {}
        motivo = ''
        if d.get('stop_reason') == 'max_tokens' or d.get('finish_reason') == 'length':
            motivo = (f' Se corto por el tope de salida ({MAX_TOKENS_TESIS} tokens): '
                      f'el modelo gasto el presupuesto antes de escribir texto. '
                      f'Subir MAX_TOKENS_TESIS.')
        elif d.get('tipos_de_bloque') and 'text' not in d['tipos_de_bloque']:
            motivo = (f' Devolvio bloques de tipo {d["tipos_de_bloque"]} y ninguno '
                      f'de texto.')
        return None, (f'{p["nombre"]} respondio sin texto. No se genero la tesis '
                      f'(la llamada igual se cobro).{motivo} '
                      f'Detalle: {json.dumps(d, ensure_ascii=False)}')

    pe, ps = PRECIOS.get(modelo, (None, None))
    costo = (round((t_ent or 0) * pe / 1e6 + (t_sal or 0) * ps / 1e6, 5)
             if pe is not None else None)
    return {
        'ticker': ticker,
        'texto': texto,
        'proveedor': proveedor,
        'proveedor_nombre': p['nombre'],
        'modelo': modelo,
        'tokens': {'entrada': t_ent, 'salida': t_sal},
        'costo_estimado_usd': costo,
        'costo_nota': ('Estimado con la lista de precios que tiene guardada el '
                       'endpoint. La cifra real esta en la consola de '
                       f'{p["nombre"]}.') if costo is not None else
                      (f'No tengo el precio de {modelo!r} en la tabla, asi que '
                       f'no puedo estimar el costo.'),
        'segundos': round(time.time() - t0, 1),
        'generado_en': datetime.now(timezone.utc).isoformat(),
        'descargo': datos.get('descargo'),
    }, None


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
                 'revGrowth', 'priceToSales', 'hasCedear', 'industry')}
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
        # El nivel fino. Un sector "Financials" al 80% puede ser tres bancos y
        # una aseguradora —diversificado— o cuatro bancos, que es una sola
        # apuesta con cuatro nombres. Sin este campo el informe no podia
        # distinguir los dos casos.
        # Puede venir vacio: los CEDEAR de afuera del indice no lo traen hasta
        # que se vuelva a correr `fetch_informe.py`. Vacio significa
        # "no sabemos", NO "no tiene", y el informe lo dice asi.
        'industry': fund.get('industry') or (detalle or {}).get('industry'),
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
# ═════════════════════════════════════════════════════════════════════════════
# TESIS DE CARTERA — el analisis del conjunto, no de un activo
# ═════════════════════════════════════════════════════════════════════════════
#
# Que la hace distinta de `action=tesis`
# --------------------------------------
# La tesis individual contesta "¿es buena esta empresa?". Esta contesta "¿que
# conviene hacer con ESTA cartera?", que es otra pregunta: una empresa excelente
# puede tener que recortarse porque pesa 20%, y una mediocre puede quedarse
# porque es lo unico que diversifica.
#
# EL PRINCIPIO QUE ORDENA TODO
# ----------------------------
# El codigo decide los NUMEROS. El modelo explica, prioriza y redacta.
#
# `analizarCartera()` ya calcula pesos, topes, excesos en dolares, estado y
# accion de cada posicion, y esos numeros YA se le muestran al usuario en una
# tabla. Si el modelo los recalculara, produciria numeros distintos a los de la
# tabla que esta arriba en la misma pagina: el cliente veria "recortar USD
# 4.200" en un lado y "reducir a 8%" en el otro. Dos fuentes de verdad es el
# peor resultado posible.
#
# Por eso el prompt le PROHIBE recalcular, y por eso hay una validacion en
# codigo despues (`validar_respuesta_cartera`): pedirle a un modelo que valide
# su propia aritmetica es una pregunta retorica, siempre contesta que si.
#
# POR QUE ES POST Y NO GET
# ------------------------
# El bloque de datos son ~2.000 tokens de JSON armados en el navegador. No entra
# en una query string, y aunque entrara, quedaria en los logs del servidor.

# ── Tope de salida ───────────────────────────────────────────────────────────
# La tesis individual usa 2000 y alcanza. Esta NO: tiene cinco secciones y una
# de ellas es posicion por posicion, asi que crece con la cartera.
#
# ⚠️ EL TOPE NO ES EL PROBLEMA — EL TIEMPO SI
# Subir el tope no cuesta plata (se paga lo escrito, no lo permitido), pero cada
# token escrito TARDA. Con la seccion 3 en prosa (~120 tokens por posicion) el
# calculo daba:
#
#     posiciones   salida necesaria   + razonamiento   segundos @60 tok/s
#          5             1.650             ~1.500            52s
#         10             2.250             ~1.500            62s  ← NO ENTRA
#         15             2.850             ~1.500            72s  ← NO ENTRA
#
# O sea que ni 10 posiciones entraban en los 60s de Vercel. Por eso la seccion 3
# pasa a UNA LINEA por posicion (~50 tokens) y solo se amplia lo que tiene una
# accion distinta de "mantener". No es una concesion: quince parrafos que dicen
# "posicion correcta, sin cambios" tampoco le servian a nadie.
#
# Presupuesto con el formato nuevo (15 posiciones):
#     1. Que hacer                ~250
#     2. Como esta la cartera     ~250
#     3. Posicion por posicion    ~50 x N  (detalle solo en las accionables)
#     4. Rotaciones               ~300
#     5. Para el cliente          ~250
#                                 ────────
#     total 15 posiciones        ~1.800  ->  ~55s en Sonnet, ~22s en Haiku
# ⚠️ RESTRICCION DURA: `vercel.json` le da 60 segundos a api/informe.py. Una
# respuesta de ~4.000 tokens tarda 50-80s segun el modelo, asi que una cartera
# grande PUEDE pasarse. El timeout propio se pone en 55 para que la funcion
# devuelva un error legible en vez de que Vercel la mate a los 60 y el usuario
# vea un 504 despues de haber pagado la llamada.
TIMEOUT_CARTERA = 55

# ⚠️ Este tope es SOLO texto desde el 31/08: el pensamiento extendido esta
# apagado explicitamente (ver `_llamar_cartera`). Antes competia con el, y por
# eso 3.440 tokens no alcanzaban para una sola linea con 7 posiciones.
#
# Las lineas de la seccion 3 crecieron: ahora llevan monto y acciones enteras.
MAX_TOKENS_CARTERA_BASE = 2600
MAX_TOKENS_CARTERA_POR_POSICION = 140
MAX_TOKENS_CARTERA_TOPE = 8000

# Mas de esto no entra en un documento que alguien vaya a leer, y el costo
# empieza a crecer sin que mejore la decision.
MAX_POSICIONES_CARTERA = 40


def max_tokens_cartera(n_posiciones):
    return min(MAX_TOKENS_CARTERA_TOPE,
               MAX_TOKENS_CARTERA_BASE
               + MAX_TOKENS_CARTERA_POR_POSICION * max(0, int(n_posiciones or 0)))


# Los cinco motivos de recorte. Se nombran distinto A PROPOSITO: solo el ultimo
# es sobre la empresa. Mezclarlos es el error mas caro de un informe de cartera,
# porque "vendimos porque subio" y "vendimos porque se rompio la tesis" son dos
# conversaciones completamente distintas con el cliente.
MOTIVOS_RECORTE = ('toma de ganancia', 'rebalanceo', 'reduccion de riesgo',
                   'rotacion', 'tesis rota')

# ── El bloque de reglas ──────────────────────────────────────────────────────
# ESTATICO a proposito: no cambia entre carteras, asi que va con cache_control
# y a partir de la segunda llamada se paga a 0,1x. Es lo que hace viable correr
# esto seguido. Cualquier dato variable va en el mensaje del usuario, NUNCA aca:
# una sola palabra distinta invalida el cache entero.
SISTEMA_CARTERA = """\
ROL
Sos un estratega de carteras. Tu trabajo NO es analizar empresas sueltas: eso ya
está hecho y te llega calculado. Tu trabajo es decidir qué conviene hacer con
ESTA cartera, en este orden y con estos motivos.

PRINCIPIO CENTRAL
Puntaje fundamental ≠ acción de cartera.
Cada activo se mira dos veces:
  1. Como empresa (¿es buena?).
  2. Como posición en ESTA cartera (¿cuánto debe pesar acá?).
Una empresa excelente puede tener que recortarse. Una mediocre puede quedarse.

LOS NÚMEROS YA ESTÁN CALCULADOS — NO LOS REHAGAS
Recibís pesos actuales, topes, excesos en dólares, estado de cada posición y la
acción sugerida. Todo eso viene del sistema y ya se le muestra al usuario en una
tabla, en la misma página que va a leer tu texto.
  · NO recalcules pesos ni topes.
  · NO inventes porcentajes que no te dieron.
  · NO contradigas un número que recibiste.
Si creés que un número está mal, DECILO explícitamente en vez de corregirlo por
tu cuenta.
Tu aporte es el POR QUÉ, el ORDEN y la REDACCIÓN.

LA CARTERA NO SUMA 100% EN ACCIONES
Puede tener renta fija, efectivo y acciones locales. Los pesos que recibís son
sobre la cartera COMPLETA. No asumas que las acciones son el total.

EL RIESGO DEL CONJUNTO — ESTO ES LO QUE HACE QUE SEA UNA CARTERA
Cuando venga el bloque `riesgo`, cada posición trae además:
  · `aporte_al_riesgo_pct` — qué porcentaje del riesgo TOTAL aporta.
  · `correlacion_media_con_la_cartera` — si diversifica o repite lo que ya hay.
  · `peso_objetivo_pct` — cuánto debería pesar por PARIDAD DE RIESGO, ya
    acotado por los topes del perfil.
  · `limitado_por_tope` — si el objetivo lo fijó el tope y no el riesgo.

Y los candidatos traen `delta_volatilidad_cartera`: cuánto sube o BAJA la
volatilidad de la cartera si entran.

Reglas sobre esto, y son las más importantes del análisis:

  · La diferencia entre peso y aporte al riesgo es EL dato. Una posición que
    pesa 30% y aporta 60% del riesgo está diciendo algo que su peso no dice.
    Nombralo cuando pase.
  · Todo recorte tiene que decir A DÓNDE va la plata Y CUÁNTO MEJORA, usando el
    `delta_volatilidad_cartera` que te dan. "Conviene diversificar" sin el
    número no sirve.
  · Para elegir dónde poner plata mandan la correlación y el delta de
    volatilidad, NO el puntaje fundamental. Un candidato con mejor puntaje pero
    que correlaciona con lo que ya sobra empeora la cartera.
  · Si `limitado_por_tope` es verdadero, decilo así: el objetivo no salió del
    riesgo sino del límite del perfil. Son dos explicaciones distintas.
  · Si viene `topes_insuficientes`, es un hallazgo de primer orden y va en la
    sección 1: la cartera no puede cumplir sus propios topes con la cantidad de
    posiciones que tiene.
  · `cobertura_del_calculo_pct` menor a 100 significa que la volatilidad es la
    del pedazo con datos, NO la de la cartera. Aclaralo.
  · Si `riesgo.disponible` es falso, NO inventes nada de esto: decí que el
    análisis de riesgo no está disponible y hacé el resto.

EL BLOQUE `plan` — LA ARITMÉTICA YA ESTÁ HECHA, Y YA ESTÁ IMPRESA
Cuando venga `plan`, trae los movimientos ya calculados: de qué peso a qué peso,
cuántos puntos porcentuales, cuántos dólares y cuántas ACCIONES ENTERAS. Esos
mismos números están en una tabla, en la misma página que va a leer el usuario.
  · Usá ESOS montos, tal cual. No los recalcules ni los redondees distinto: si
    el texto dice un monto y la tabla dice otro, las dos cifras pierden valor.
  · `mejora_puntos` es cuánto baja la volatilidad si se ejecuta TODO el plan.
    Es el número que dice si vale la pena. Si es menor a 0,5 puntos, la
    recomendación honesta es que no hay urgencia — decilo, no fabriques
    entusiasmo.
  · Las posiciones que no están en `movimientos` quedan como están porque el
    desvío es menor al umbral, no porque falten datos.
  · Tu trabajo sobre el plan es el ORDEN (qué primero, qué puede esperar) y el
    PORQUÉ. La cuenta no.

CONTRA QUÉ SE COMPARA — EL BENCHMARK
Cuando venga `riesgo.benchmark`, trae cómo le fue a ESTA cartera contra el
índice (SPY) en la misma ventana: retorno, volatilidad, beta, correlación y
retorno sobre volatilidad de los dos.
  · Es la comparación que contesta la pregunta que el cliente hace igual:
    ¿esto rinde más que comprar el índice y quedarse quieto?
  · `retorno_sobre_volatilidad` es lo que hay que mirar, NO el retorno solo.
    Rendir más tomando el doble de riesgo no es rendir más.
  · `beta_vs_benchmark` mayor a 1 = amplifica al índice; menor a 1 = amortigua.
  · ⚠️ Es retorno HISTÓRICO de la ventana, NO una proyección. Decilo cada vez
    que lo menciones. Que haya rendido 24% no significa que vaya a rendir 24%.

LAS DOS OPCIONES SE PRESENTAN JUNTAS, Y DESPUÉS SE ELIGE
La sección 1 tiene que mostrar las dos y recomendar una, no elegir en silencio:

  **A · Rebalanceo interno** — mover plata de la posición que sobra a las otras
  que ya están. Sale de `plan.movimientos`.
  ⚠️ Un movimiento con `refuerzo_en_sector_al_tope: true` NO se puede
  recomendar: su sector ya toca el techo después del ajuste, así que agrandarlo
  ahí no diversifica nada — es mover plata de un bolsillo al otro del mismo
  pantalón. Si TODOS los refuerzos están marcados así, la opción A no existe y
  hay que decirlo con esas palabras.

  **B · Rotar afuera** — `plan.menu_por_sector` trae una opción por sector, los
  tres mejores. Cada una ya pasó el filtro de que baja el riesgo de forma
  medible, y entre las que pasan está la de mejor puntaje del screener.

FORMATO DEL MENÚ, en la sección 4
Una línea por sector, con el motivo. Así:

  · **Consumo defensivo — MO (puntaje 80, 6/6 métricas):** beta 0,50 contra los
    2,5 de la posición que se recorta, y se mueve al revés que la cartera
    (correlación −0,13). Bajaría la volatilidad 6,7 puntos más que repartir
    entre lo que ya hay.

El "porque" tiene que salir de los datos que te doy —puntaje, métricas, beta,
correlación, mejora— y no de generalidades sobre el sector. "Es un sector
defensivo" no explica nada; "beta 0,50 y correlación −0,13 con esta cartera" sí.
No son excluyentes: se puede tomar una, dos o repartir entre las tres.

⚠️ EL PLAN NO ES LA ÚNICA OPCIÓN — `plan.entradas_nuevas`
Esto es lo más importante de esta sección y es contraintuitivo.

`plan.movimientos` reparte el recorte SOLO entre las posiciones que ya están en
la cartera: es lo único que la paridad de riesgo sabe hacer. Por eso cuando
recorta la posición más grande, sus compras son siempre papeles que el cliente
YA tiene.

`plan.entradas_nuevas` trae la comparación que falta, medida con la misma
matriz: qué pasaría si esa plata fuera a un papel que NO está en la cartera.
Cada una dice con cuánto entraría, en qué volatilidad queda la cartera y
`mejor_que_el_plan_en_puntos`.

  · Si `mejor_que_el_plan_en_puntos` es grande —más de 2 puntos—, recomendar
    "comprar más de lo que ya tenés" es la peor de las dos opciones y hay que
    decirlo. Ejemplo medido: el plan dejaba la cartera en 26,3% agrandando las
    posiciones existentes; poniendo la misma plata en un papel de otro sector
    quedaba en 19,6%.
  · La sección 1 tiene que ELEGIR, no listar las dos. Si la entrada nueva gana
    por más de 2 puntos, el plan pasa a ser: recortar lo que sobra y ABRIR esa
    posición, en vez de reforzar lo existente.
  · Se puede repartir entre las dos o tres mejores en vez de poner todo en una.
    El peso que figura es el máximo que permite el tope del perfil.
  · Si la lista viene vacía o las mejoras son chicas, el plan tal cual está es
    la respuesta correcta — decilo y seguí.

POR QUÉ SE RECORTA ALGO QUE ESTABA BIEN — `riesgo.grupos_limitantes`
El peso objetivo respeta TRES topes: el de la posición, el del sector y el de
la industria. Cuando un sector o una industria excede, TODOS sus papeles se
achican aunque ninguno exceda su tope individual.
  · Eso hay que EXPLICARLO, porque es contraintuitivo: el cliente ve que le
    recortás un banco que estaba perfecto. La frase correcta es "no es por este
    papel, es porque el sector pesa X% y el máximo es Y%".
  · `grupos_limitantes` te da el grupo, su peso actual, su objetivo y sus
    tickers. Cada posición trae además `limitado_por_grupo`.
  · El reparto DENTRO del grupo no es parejo a propósito: se recorta más al que
    más riesgo aporta. Si te preguntan "¿por qué a este más que a aquel?", la
    respuesta es el `aporte_al_riesgo_pct`, no el puntaje fundamental.
  · Distinguí SIEMPRE `limitado_por_tope` (el papel pesa de más por sí mismo)
    de `limitado_por_grupo` (el papel está bien, el grupo no). Son dos motivos
    de recorte distintos y el segundo NO es una crítica a la empresa.

CONCENTRACIÓN POR INDUSTRIA — EL NIVEL QUE EL SECTOR NO MUESTRA
`industrias.concentradas` lista las industrias donde hay DOS O MÁS posiciones
pesando juntas 15% o más.
  · "Financials 80%" puede ser tres bancos y una aseguradora, o cuatro bancos.
    Son cosas distintas y la tabla de sectores las dibuja igual. Cuando venga
    una industria concentrada, nombrala con sus tickers.
  · Es OTRA lectura que los pares correlacionados, y ninguna reemplaza a la
    otra: la industria mira la ETIQUETA, la correlación mira el
    COMPORTAMIENTO. Dos bancos de países distintos comparten industria y
    pueden correlacionar poco; dos papeles de industrias distintas pueden
    moverse como uno solo.
  · Si `industrias.disponible` es falso, NO opines de industrias: significa que
    falta el dato en la mayoría de las posiciones, y hay que decir eso, no
    quedarse callado —el silencio se lee como "no hay concentración".

PARES QUE SON UNA SOLA APUESTA
`riesgo.pares_que_son_una_apuesta` lista los pares con correlación ≥ 0,70, con
su `peso_combinado_pct`.
  · Dos papeles que se mueven juntos NO son dos posiciones: son una del tamaño
    de las dos. Compará ese peso combinado contra el tope, no cada uno por
    separado.
  · Si `mismo_sector` es falso es MÁS grave, no menos: la tabla de sectores no
    lo muestra y el cliente cree que diversificó.
  · Si la lista viene vacía, decilo en una línea — es una buena noticia y hoy
    nadie se la dice.

EL RETORNO ESPERADO ES DÉBIL Y HAY QUE TRATARLO ASÍ
El único retorno esperado disponible es el precio objetivo de los analistas a
12 meses. Es un predictor pobre. Usalo como contexto, nunca como el motivo
principal de una decisión, y cuando lo menciones aclarás que es consenso de
analistas y no una proyección propia.

LA COVARIANZA ES HISTÓRICA
Mira 3 años para atrás. Las correlaciones cambian, y suelen subir justo en las
caídas — que es cuando la diversificación haría falta. El escenario de estrés
que te dan es el complemento, no un adorno.

DOS NIVELES DE DETALLE — NO LOS CONFUNDAS CON DATOS FALTANTES
Las posiciones que no requieren ninguna decisión vienen con `en_orden: true` y
menos campos, a propósito: ya se verificó que están bien y mandar su ficha
completa sería gastar en lo que no hay que decidir.
  · A esas las nombrás en su línea de la sección 3 y seguís. NO digas que les
    faltan datos: no les falta nada, no hacía falta mandarlo.
  · Las que vienen con `en_orden: false` traen todo, porque hay algo que
    resolver. Ahí va el análisis.

DATOS FALTANTES
Cada activo trae `metricas_usadas` (ej. "4/6") y qué reemplazos se usaron
(P/S en vez de P/B, ROA en vez de ROE, Deuda Neta/EBITDA en vez de D/E) porque
la empresa tiene patrimonio neto negativo y esos múltiplos no aplican.
  · Si un activo tiene menos de 4 métricas, NOMBRALO y bajá la confianza.
  · Nunca completes un dato que no está. "No hay dato" es una respuesta válida.
  · Si no te alcanza para opinar de una posición, decilo. Es preferible a
    inventar una tesis.

REGLAS DE DECISIÓN
  · No recomiendes vender solo porque el precio subió.
  · No recomiendes mantener solo porque el precio bajó.
  · No recomiendes comprar solo porque el precio objetivo de los analistas está
    alto.
  · Un dividendo bajo NO es señal de malos fundamentals. El peso del dividendo
    depende del sector y del objetivo declarado del cliente. Tratalo como parte
    de la asignación de capital, no como una nota aparte.
  · Distinguí SIEMPRE, y nombralos con estas palabras exactas, los cinco motivos
    de recorte:
      - toma de ganancia   (subió y ahora pesa de más; la empresa está BIEN)
      - rebalanceo         (se desalineó del objetivo)
      - reduccion de riesgo (concentración, beta, correlación)
      - rotacion           (hay algo que le sirve más a esta cartera)
      - tesis rota         (la empresa cambió; es el ÚNICO sobre la empresa)
  · Todo recorte tiene que decir A DÓNDE va la plata.
  · Toda incorporación tiene que MEJORAR la cartera, no simplemente tener mejor
    puntaje. Un activo con puntaje 80 que duplica un sector que ya está al tope
    empeora la cartera.
  · No cambies una concentración por otra.
  · Cada operación va también en CANTIDAD ENTERA DE ACCIONES, no solo en
    dólares: no se pueden vender fracciones. Si al redondear a acciones enteras
    el ajuste da cero, decí "el desvío es menor a una acción, no hay nada que
    operar" en vez de proponer un monto que no se puede ejecutar.

ELEGIR UN CANDIDATO — MIRÁ EL RIESGO, NO SOLO EL PUNTAJE
Cada candidato trae `beta`, `defensivo` (beta < 0,9) y `sector_nuevo`.
  · Si la cartera hay que hacerla MENOS volátil —lo dice `plan.mejora_puntos` y
    la comparación contra el índice—, el candidato correcto es uno DEFENSIVO,
    aunque otro tenga mejor puntaje fundamental. Un papel con puntaje 82 y beta
    2,1 no baja el riesgo de nadie.
  · `sector_nuevo: true` significa que el cliente NO tiene nada de ese sector.
    Eso diversifica por definición y es lo más barato que se puede hacer por el
    riesgo del conjunto. Priorizalo cuando el problema sea la concentración.
  · NO propongas reforzar lo que ya está en el sector que sobra. Si Technology
    excede, la respuesta no puede ser otra tecnológica por más buena que sea.
  · Cuando recomiendes un defensivo sobre uno de mejor puntaje, DECILO con esas
    palabras: "tiene menos puntaje pero beta 0,4 contra 2,5, y lo que hay que
    arreglar acá es el riesgo".

ROTACIÓN
Cuando recortes algo, el reemplazo tiene que aportar al menos una de estas, y
tenés que decir CUÁL:
  mejor calidad · mejor valuación · mejor crecimiento · menos riesgo ·
  diversificación de sector · diversificación de factor
Elegí el que MEJOR LE SIRVE A ESTA CARTERA, no la mejor empresa en abstracto.
Los candidatos que recibís son los únicos disponibles: no propongas tickers que
no estén en esa lista.

CONFIANZA
Asigná confianza por cobertura de datos, no por lo convencido que estés:
  alta  = 6/6 métricas, sin reemplazos, con histórico
  media = 4-5 métricas, o con reemplazos, o sin histórico
  baja  = menos de 4 métricas, o sin cobertura de analistas

SALIDA — exactamente cinco secciones, en este orden, con estos títulos:

## 1. Qué hacer
Lo primero que hay que ejecutar y en qué orden. Máximo 5 acciones. Si no hay
nada urgente, decilo en una línea.
Cada acción, cuando haya datos de riesgo, dice A DÓNDE va la plata y CUÁNTO
baja la volatilidad. Sin el número, es una opinión.

Cerrá esta sección con una línea que empiece con «Esto estaría mal si…»: qué
tendría que pasar para que este plan sea la decisión equivocada. Una o dos
condiciones concretas y observables (un dato que cambie, un supuesto que se
caiga), no advertencias genéricas sobre la volatilidad del mercado.

## 2. Cómo está la cartera
Concentración, clases, encaje con el objetivo y el horizonte declarados, y qué
pasa en el escenario de estrés que te dan.
Y dónde está concentrado el RIESGO, que casi nunca coincide con dónde está
concentrado el dinero. Si la volatilidad actual y la del objetivo difieren,
decí las dos.
Va también la comparación contra el índice y, si los hay, los pares que son una
sola apuesta con su peso combinado.

## 3. Posición por posición
UNA LÍNEA por posición, en este formato exacto y sin párrafos:

  TICKER · peso% → objetivo% · aporta X% del riesgo · ACCIÓN · motivo · confianza

(si no hay datos de riesgo, se omiten el objetivo y el aporte, no se inventan)
(si la posición está en `plan.movimientos`, agregá el monto y las acciones tal
como vienen ahí: es lo único que hace la línea ejecutable)

Ampliá a dos o tres líneas SOLO las que tengan una acción distinta de
"mantener". Las que están en orden se despachan en su línea y listo: repetir
"posición correcta, sin cambios" quince veces no le sirve a nadie y hace que el
informe no entre en el tiempo que tiene para generarse.

## 4. Rotaciones
Acá va el menú por sector con el formato de arriba: una línea por sector, con el
número que la justifica. Si `menu_por_sector` viene vacío, decí que ninguna
alternativa mejora la cartera de forma medible y que conviene el rebalanceo
interno — no fuerces una rotación para llenar la sección.

## 5. Para el cliente
La misma conclusión en lenguaje llano, sin jerga y sin juzgar decisiones
pasadas. Qué conviene hacer y por qué, en pocas frases. Esta sección se imprime
y se le entrega al cliente: no pongas acá razonamiento interno ni comentarios
sobre cómo se compró.

IDIOMA Y TONO
Español rioplatense, directo, sin adornos. Nada de "es importante destacar" ni
"cabe mencionar". Si algo es una duda, se dice como duda.
Esto es un insumo de análisis para que decida una persona, no una recomendación
de inversión cerrada. No prometas rendimientos."""


# Campos de una posicion que NO cambian ninguna decision y por lo tanto no se
# mandan. Medido: sacarlos baja el bloque de posiciones un ~15%.
#   precio_compra  -> ya viene `ganancia_pct`, que es lo que importa
#   brecha_objetivo-> es la resta de dos numeros que ya van
_POS_FUERA = ('precio_compra', 'brecha_objetivo', 'cantidad', 'valor_actual')

# Los candidatos son lo que MAS pesa del payload despues de las posiciones:
# medido, 49 candidatos son 1.318 tokens = el 45% del bloque de datos, y eso se
# paga en CADA llamada.
#
# Pero no hacen falta todos. La rotacion sirve para dos cosas:
#   - reemplazar lo que se recorta  -> hacen falta candidatos de ESE sector
#   - poner la plata en otro lado   -> hacen falta de sectores que NO esten al tope
# Un candidato de un sector que ya excede su tope no se puede recomendar: seria
# cambiar una concentracion por otra, que es justo lo que el prompt prohibe.
# El cupo depende de PARA QUE sirve ese sector, no es uno solo para todos.
# Al dejar entrar los sectores ausentes, el payload paso de 10 a 39 candidatos
# (+980 tokens por llamada). La variedad de SECTORES es lo que importa —es lo
# que permite diversificar—; tener cuatro opciones dentro de cada uno no agrega
# ninguna decision, solo peso.
CANDIDATOS_POR_SECTOR_ENVIADOS = 3      # sectores de donde sale plata
CANDIDATOS_SECTOR_AL_TOPE = 2           # solo pueden ser reemplazo de si mismos
CANDIDATOS_SECTOR_NUEVO = 2             # alcanzan dos para elegir


def _filtrar_candidatos(candidatos, posiciones, sectores):
    """Deja solo los candidatos que podrian llegar a recomendarse."""
    if not candidatos:
        return []
    saliendo = {p.get('sector') for p in posiciones
                if p.get('estado') in ('sobre', 'critico')
                or p.get('accion_calculada') in ('sacar', 'recortar')}
    en_cartera = {s.get('sector') for s in (sectores or []) if s.get('sector')}
    al_tope = {s.get('sector') for s in (sectores or []) if s.get('excede')}

    # ⚠️ EL BUG QUE ESTA FUNCION TENIA, Y ERA GRAVE (31/08/2026)
    #
    # Antes: `utiles = saliendo | con_lugar`, y los dos conjuntos se armaban a
    # partir de `sectores`, que son LOS SECTORES QUE YA ESTAN EN LA CARTERA. Un
    # sector donde el cliente no tiene nada no estaba en ninguno de los dos, asi
    # que se filtraba ENTERO.
    #
    # Medido sobre la cartera real de Marcos (AMD, CAT, MSFT, LRCX, AAPL, RGTI,
    # HIMS): de 51 candidatos pasaban 10, y desaparecian OCHO SECTORES completos
    # —Consumer Staples con MO y PG, Communication Services con GOOGL, Consumer
    # Discretionary con MCD, Energy, Financials, Materials, Utilities—.
    #
    # O sea: el filtro estaba construido para elegir DENTRO de lo que ya tenes,
    # y por construccion impedia diversificar. Marcos lo noto de la unica forma
    # en que se podia notar, leyendo la salida: "me dice que siga sumando
    # tecnologia y no me da opciones mas defensivas".
    #
    # Un sector donde NO hay nada es el MEJOR destino posible para diversificar,
    # no el peor. Ahora entra con cupo completo.
    ausentes = {c.get('sector') for c in candidatos
                if c.get('sector') and c.get('sector') not in en_cartera}
    con_lugar = {s.get('sector') for s in (sectores or []) if not s.get('excede')}
    utiles = saliendo | con_lugar | ausentes
    if not utiles:                       # cartera sin nada que tocar
        utiles = {c.get('sector') for c in candidatos}

    por_sector, out = {}, []
    for c in candidatos:
        sec = c.get('sector')
        if sec not in utiles:
            continue
        # Un sector que ya excede solo puede aportar REEMPLAZO de si mismo, no
        # destino de plata nueva: entra igual pero con menos cupo.
        cupo = (CANDIDATOS_SECTOR_AL_TOPE if sec in al_tope
                else CANDIDATOS_SECTOR_NUEVO if sec in ausentes
                else CANDIDATOS_POR_SECTOR_ENVIADOS)
        if por_sector.get(sec, 0) >= cupo:
            continue
        por_sector[sec] = por_sector.get(sec, 0) + 1
        # Sin `nombre`: para elegir un reemplazo alcanza el ticker y el sector,
        # y los nombres largos son puro peso.
        fila = {'ticker': c.get('ticker'), 'sector': sec,
                'puntaje': c.get('puntaje'),
                'metricas': c.get('metricas')}
        # ⚠️ ESTOS TRES CAMPOS SON EL MOTOR B DE LA ROTACION. Estuvieron
        # ausentes hasta el 31/08/2026 porque esta funcion reconstruia el
        # candidato a mano con cuatro claves. El prompt pedia elegir por
        # correlacion y delta de volatilidad, y esos numeros no llegaban:
        # al modelo solo le quedaba el puntaje fundamental, que es justo el
        # criterio que la auditoria midio como el peor de cuatro.
        for k in ('volatilidad_pct', 'correlacion_media_con_la_cartera',
                  'delta_volatilidad_cartera', 'beta', 'defensivo',
                  'sector_nuevo'):
            if c.get(k) is not None:
                fila[k] = c[k]
        out.append(fila)

    # Primero los que MAS bajan la volatilidad de esta cartera. Los que no se
    # pudieron medir van al final, no adelante: no se premia la falta de dato.
    # Primero los que MAS bajan la volatilidad de esta cartera. Los que no se
    # pudieron medir van despues, y entre ellos los de menor beta primero: es
    # el mejor sustituto disponible del delta cuando no hay historico.
    out.sort(key=lambda x: (x.get('delta_volatilidad_cartera') is None,
                            x.get('delta_volatilidad_cartera')
                            if x.get('delta_volatilidad_cartera') is not None
                            else (x.get('beta') if x.get('beta') is not None
                                  else 99)))
    return out


def _resumen_cartera(c):
    """El bloque de datos, achicado a lo que el modelo necesita.

    Se manda SOLO lo que cambia una decision. Cada campo de mas se paga en cada
    llamada, y ademas le da al modelo mas superficie para contradecirse."""
    pos = [{k: v for k, v in (p or {}).items() if k not in _POS_FUERA}
           for p in (c.get('posiciones') or [])[:MAX_POSICIONES_CARTERA]]
    sectores = c.get('sectores') or []
    return {
        'perfil': c.get('perfil'),
        'objetivo': c.get('objetivo'),
        'horizonte': c.get('horizonte'),
        'cartera': c.get('cartera') or {},
        'topes': c.get('topes') or {},
        'estres': c.get('estres') or {},
        'sectores': sectores,
        'posiciones': pos,
        'candidatos': _filtrar_candidatos(c.get('candidatos') or [], pos, sectores),
        # ⚠️ `riesgo` y `plan` son whitelist: esta funcion arma el payload clave
        # por clave, asi que una clave que no se nombra ACA no llega nunca, sin
        # error y sin aviso. `riesgo` faltaba: la volatilidad de la cartera, la
        # cobertura del calculo y `topes_insuficientes` se calculaban en el
        # navegador y se tiraban a la basura antes de la llamada.
        'riesgo': c.get('riesgo') or {'disponible': False},
        # Otra clave que se perderia en silencio si no se nombra aca.
        'industrias': c.get('industrias'),
        # El plan son ~200 tokens y es lo unico ejecutable del payload.
        'plan': c.get('plan'),
    }


# La tesis de cartera acepta DOS modelos, y el default es el rapido.
#
# Por que: en esta llamada el modelo NO decide numeros —los recibe calculados—
# sino que explica, ordena y redacta. Para eso el modelo chico alcanza, y la
# diferencia no es menor:
#
#              precio in/out      velocidad aprox   15 posiciones
#   rapido     1,00 / 5,00 USD/M      ~150 tok/s        ~22s   ~USD 0,011
#   profundo   2,00 / 10,00           ~60 tok/s         ~55s   ~USD 0,022
#
# O sea: la mitad de precio y bien adentro de los 60s de Vercel. `profundo`
# queda disponible para cuando la cartera sea rara y valga la pena.
MODELOS_CARTERA = {
    'rapido':   {'anthropic': 'claude-haiku-4-5', 'openai': 'gpt-5.6-luna'},
    'profundo': {'anthropic': 'claude-sonnet-5',  'openai': 'gpt-5.6-terra'},
}
MODO_CARTERA_POR_DEFECTO = 'rapido'


def modelo_cartera(proveedor, modo):
    """El modelo a usar. Una variable de entorno lo pisa, igual que en la tesis
    individual, para poder cambiarlo sin tocar codigo."""
    forzado = os.environ.get(PROVEEDORES[proveedor]['env_modelo'] + '_CARTERA')
    if forzado:
        return forzado
    tabla = MODELOS_CARTERA.get(modo) or MODELOS_CARTERA[MODO_CARTERA_POR_DEFECTO]
    return tabla[proveedor]


def estimar_cartera(n_posiciones, proveedor='anthropic', modo=None):
    """Cuanto va a costar y tardar ANTES de gastar. NO llama a nadie.

    Existe para que el boton pueda decir el numero antes de que lo aprieten: la
    regla del proyecto es gastar solo cuando se lo pide, y para pedirlo con
    criterio hay que saber cuanto sale."""
    modo = modo or MODO_CARTERA_POR_DEFECTO
    modelo = modelo_cartera(proveedor, modo)
    n = max(0, int(n_posiciones or 0))
    # ⚠️ ESTA FORMULA SE CALIBRA CONTRA PAYLOADS REALES, Y SE CALIBRA HACIA
    # ARRIBA A PROPOSITO.
    #
    # La version anterior (120 + 85n + 35·candidatos) quedo vieja el 31/08 al
    # agregarse el bloque `plan`, el bloque `riesgo` y los tres campos de riesgo
    # de cada candidato: subestimaba la entrada entre 23% y 41%. Un estimador
    # que miente para abajo es peor que no tenerlo — el boton existe para que
    # Marcos decida si gasta, y para eso el numero tiene que ser el techo, no
    # una ilusion.
    #
    # Medido el 31/08 sobre `_resumen_cartera()` con carteras reales de 3, 5,
    # 10, 15, 20 y 25 posiciones. La recta queda por ENCIMA de las seis.
    #
    #   base                 :   955 · 1.520 · 2.374 · 2.913 · 3.602 · 4.275
    #   + benchmark y pares   : 1.050 · 1.616 · 2.469 · 3.031 · 3.720 · 4.422
    #   + industrias          : 1.082 · 1.651 · 2.512 · 3.083 · 3.781 · 4.492
    #   + sectores ausentes   : 1.759 · 2.167 · 2.884 · 3.455 · 4.020 · 4.730
    #   + menu por sector     : 2.262 · 2.713 · 3.316 · 3.907 · 4.452 · 5.170
    #
    # ⚠️ EL ULTIMO CAMBIO TAMBIEN CAMBIO LA FORMA DE LA CURVA, no solo su
    # altura. Al dejar entrar los sectores ausentes, una cartera CHICA tiene
    # MAS sectores ausentes y por lo tanto MAS candidatos: el bloque quedo casi
    # constante (~1.000-1.140 tokens) en vez de crecer con las posiciones. Por
    # eso la ordenada subio de 880 a 1.620 y la pendiente bajo.
    #
    # ⚠️ ESTA RECTA SE QUEDÓ CORTA DOS VECES EN UN DÍA. Primero `benchmark`
    # (82 tokens) y `pares_que_son_una_apuesta` (24); despues `industrias` (48).
    # Cada bloque nuevo son 30-80 tokens y la recta anterior iba con 1-3% de
    # margen, o sea que CUALQUIER agregado la volvia mentirosa.
    #
    # Por eso ahora va con ~5% de holgura en el punto mas ajustado en vez de
    # pegada a la medicion: un estimador que se pasa un poco es util, uno que
    # se queda corto no sirve para decidir si gastar. Y aun asi, al tocar el
    # payload hay que VOLVER A MEDIR y actualizar tambien el `MEDIDO` de
    # `test_tesis_cartera.py` — la guarda no avisa sola: sus numeros viejos son
    # mas bajos que la realidad nueva, asi que sigue pasando en verde.
    entrada = 2270 + 141 * n
    # La salida crecio un poco: la seccion 1 cierra con los invalidation points
    # y las lineas de la seccion 3 llevan monto y acciones.
    salida = 1150 + 55 * n
    pe, ps = PRECIOS.get(modelo, (None, None))
    costo = (round(entrada * pe / 1e6 + salida * ps / 1e6, 4)
             if pe is not None else None)
    # La primera llamada paga las reglas completas; de ahi en mas salen del
    # cache a 0,1x.
    # ⚠️ El tamano se MIDE, no se escribe a mano. Estuvo clavado en 1249 mientras
    # el prompt crecia a casi el doble, asi que el "costo la primera vez" que
    # veia Marcos era la mitad del real. Un numero hardcodeado sobre algo que se
    # edita seguido se desactualiza sin que nadie se entere.
    tokens_reglas = len(SISTEMA_CARTERA) // 4
    costo_primera = (round(costo + tokens_reglas * pe / 1e6, 4)
                     if costo is not None else None)
    velocidad = 150 if 'haiku' in modelo or 'luna' in modelo else 60
    return {
        'modo': modo, 'modelo': modelo, 'n_posiciones': n,
        'tokens_estimados': {'entrada': entrada, 'salida': salida,
                             'reglas_cacheadas': len(SISTEMA_CARTERA) // 4},
        'costo_estimado_usd': costo,
        'costo_primera_vez_usd': costo_primera,
        'segundos_estimados': round((salida + 1500) / velocidad),
        'entra_en_el_limite': (salida + 1500) / velocidad < TIMEOUT_CARTERA,
    }


def _llamar_cartera(proveedor, clave, modelo, datos):
    """Una sola llamada, con el bloque de reglas cacheado."""
    n = len(datos.get('posiciones') or [])
    tope = max_tokens_cartera(n)
    usuario = ('Estos son los datos de la cartera. Todos los números ya están '
               'calculados; no los rehagas.\n\n'
               + json.dumps(datos, ensure_ascii=False, separators=(',', ':')))

    if proveedor == 'anthropic':
        # `system` como lista de bloques para poder marcar cache_control. El
        # bloque de reglas es identico en cada llamada, asi que a partir de la
        # segunda se lee del cache a 0,1x. Si algun dia se le mete algo variable
        # adentro, el cache deja de servir sin que nadie se entere.
        cuerpo = {
            'model': modelo,
            'max_tokens': tope,
            # ⚠️ EL PENSAMIENTO EXTENDIDO SE APAGA A PROPOSITO.
            #
            # 31/08/2026: el modo profundo con 7 posiciones devolvio ESTO:
            #   stop_reason: max_tokens · tipos_de_bloque: ["thinking"]
            #   tokens_salida: 3440 · tope_pedido: 3440
            # Los 3.440 tokens se fueron enteros en el bloque de pensamiento y
            # no quedo ni una linea de texto. La llamada se cobro igual.
            #
            # Es la SEGUNDA vez que pasa: el 28/08 la primera llamada real
            # fallo igual con 900 tokens. Entonces se subio el tope; ahora
            # queda claro que subir el tope no alcanza, porque el pensamiento
            # crece con el espacio que le des.
            #
            # Y aunque alcanzara, no entraria en el tiempo: el modo profundo ya
            # estaba en 58s para 15 posiciones contra un limite de 60, y los
            # tokens de pensamiento se generan a la misma velocidad que los de
            # texto. Pensar 3.000 tokens antes de escribir garantiza el 504.
            #
            # Que se pierde: poco, y es medible. Este prompt no le pide al
            # modelo que razone sobre numeros —los numeros llegan calculados—
            # sino que ORDENE y REDACTE. El modo profundo sigue valiendo por el
            # modelo, no por el pensamiento.
            'thinking': {'type': 'disabled'},
            'system': [{'type': 'text', 'text': SISTEMA_CARTERA,
                        'cache_control': {'type': 'ephemeral'}}],
            'messages': [{'role': 'user', 'content': usuario}],
        }
        cabeceras = {
            'x-api-key': clave,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        }
        try:
            r = _post_json(PROVEEDORES['anthropic']['url'], cabeceras, cuerpo,
                           timeout=TIMEOUT_CARTERA)
        except urllib.error.HTTPError as e:
            # Si un modelo no acepta el parametro, se reintenta sin el. Un 400
            # NO genera tokens, asi que este reintento no gasta: es el unico
            # caso en que reintentar no rompe la regla de costo del proyecto.
            if e.code != 400:
                raise
            detalle = e.read().decode('utf-8', 'replace')
            if 'thinking' not in detalle.lower():
                raise urllib.error.HTTPError(e.url, e.code, detalle, e.hdrs, None)
            cuerpo.pop('thinking', None)
            r = _post_json(PROVEEDORES['anthropic']['url'], cabeceras, cuerpo,
                           timeout=TIMEOUT_CARTERA)
        bloques = r.get('content') or []
        texto = ''.join(b.get('text', '') for b in bloques if b.get('type') == 'text')
        u = r.get('usage') or {}
        diag = None
        if not texto.strip():
            diag = {'stop_reason': r.get('stop_reason'),
                    'tipos_de_bloque': [b.get('type') for b in bloques],
                    'modelo_que_respondio': r.get('model'),
                    'tokens_salida': u.get('output_tokens'),
                    'tope_pedido': tope}
        return (texto.strip(), u.get('input_tokens'), u.get('output_tokens'),
                diag, u.get('cache_read_input_tokens'), tope)

    # OpenAI cachea solo, sin parametro. El prefijo estable es el `system`.
    cuerpo = {
        'model': modelo,
        'max_completion_tokens': tope,
        'messages': [{'role': 'system', 'content': SISTEMA_CARTERA},
                     {'role': 'user', 'content': usuario}],
    }
    r = _post_json(PROVEEDORES['openai']['url'],
                   {'Authorization': f'Bearer {clave}',
                    'Content-Type': 'application/json'},
                   cuerpo, timeout=TIMEOUT_CARTERA)
    ch = (r.get('choices') or [{}])[0]
    texto = ((ch.get('message') or {}).get('content') or '')
    u = r.get('usage') or {}
    diag = None
    if not texto.strip():
        diag = {'finish_reason': ch.get('finish_reason'),
                'modelo_que_respondio': r.get('model'),
                'tope_pedido': tope}
    cache = ((u.get('prompt_tokens_details') or {}).get('cached_tokens'))
    return (texto.strip(), u.get('prompt_tokens'), u.get('completion_tokens'),
            diag, cache, tope)


# Palabras en mayuscula que NO son tickers. Sin esto, el detector de tickers
# inventados marcaria media respuesta.
_NO_SON_TICKERS = {
    'ROE', 'ROA', 'PE', 'PB', 'PS', 'DE', 'EV', 'EBITDA', 'USD', 'ARS', 'IA',
    'CEDEAR', 'CEDEARS', 'ETF', 'ETFS', 'SPY', 'SP', 'NO', 'SI', 'Y', 'O', 'A',
    'EL', 'LA', 'DEL', 'CON', 'POR', 'QUE', 'SE', 'ES', 'UN', 'UNA', 'AL',
    'CAGR', 'FCF', 'DN', 'PIB', 'FED', 'IPC', 'SA', 'SRL', 'ADR', 'ADRS',
}


def validar_respuesta_cartera(texto, datos):
    """Comprueba EN CODIGO lo que el prompt original pedia "validar" preguntando.

    A un modelo no se le puede pedir que valide su propia aritmetica: contesta
    que si. Estos chequeos corren sobre el texto ya recibido.

    NO corrige la respuesta: devuelve avisos que se muestran al lado. Arreglar
    en silencio lo que el modelo hizo mal esconde que se equivoco, y entonces no
    hay forma de saber cuando confiar."""
    avisos = []
    conocidos = {p.get('ticker') for p in (datos.get('posiciones') or [])}
    candidatos = {c.get('ticker') for c in (datos.get('candidatos') or [])}
    validos = {t for t in (conocidos | candidatos) if t}

    # 1. Tickers que no existen ni en la cartera ni entre los candidatos.
    mencionados = set(re.findall(r'\b[A-Z][A-Z0-9]{1,4}(?:-[A-Z])?\b', texto or ''))
    inventados = sorted(mencionados - validos - _NO_SON_TICKERS)
    if inventados:
        avisos.append(f'Menciona tickers que no estan ni en la cartera ni entre '
                      f'los candidatos: {", ".join(inventados)}. Verificar a mano.')

    # 2. Posiciones que no aparecen en el texto.
    faltan = sorted(t for t in conocidos if t and t not in (texto or ''))
    if faltan:
        avisos.append(f'No menciona estas posiciones: {", ".join(faltan)}.')

    # 3. Las cinco secciones.
    for titulo in ('Qué hacer', 'Cómo está la cartera', 'Posición por posición',
                   'Rotaciones', 'Para el cliente'):
        if titulo.lower() not in (texto or '').lower():
            avisos.append(f'Falta la seccion "{titulo}".')

    # 4. Los motivos: que use los nombres acordados y no invente otros.
    #
    # ⚠️ Se sacan los TITULOS antes de buscar. La seccion se llama "Rotaciones"
    # y contiene la palabra "rotacion", asi que un texto que no usa ningun
    # motivo pasaba igual por el titulo. Un chequeo que siempre da verde es
    # peor que no tenerlo: da la sensacion de estar cubierto.
    cuerpo_sin_titulos = '\n'.join(
        l for l in (texto or '').split('\n') if not l.lstrip().startswith('#'))
    bajo = cuerpo_sin_titulos.lower()
    if not any(m in bajo for m in MOTIVOS_RECORTE) and any(
            p.get('estado') in ('sobre', 'critico') for p in (datos.get('posiciones') or [])):
        avisos.append('Hay posiciones que exceden su tope pero el texto no usa '
                      'ninguno de los cinco motivos de recorte acordados.')

    # 5. Que no haya contradicho un peso. Se buscan los porcentajes del texto y
    #    se comparan con los que se le dieron, por posicion.
    for p in (datos.get('posiciones') or []):
        t, peso = p.get('ticker'), p.get('peso_pct')
        if not t or peso is None or t not in (texto or ''):
            continue
        cerca = re.findall(rf'{re.escape(t)}[^.\n]{{0,120}}?(\d+[.,]?\d*)\s*%', texto)
        for c in cerca[:3]:
            try:
                v = float(c.replace(',', '.'))
            except ValueError:
                continue
            # Solo se marca si se parece a un peso y NO coincide con ninguno de
            # los numeros que se le dieron para ese papel.
            dados = [peso, p.get('tope_pct'), p.get('exceso_pct'),
                     p.get('ganancia_pct'), p.get('puntaje_fundamental')]
            if all(d is None or abs(v - d) > 0.6 for d in dados) and v <= 100:
                avisos.append(f'{t}: el texto dice {v}% y los numeros que se le '
                              f'dieron son peso {peso}% / tope {p.get("tope_pct")}%. '
                              f'Revisar.')
                break
    return avisos


def generar_tesis_cartera(cuerpo, proveedor, modo=None):
    """Devuelve (resultado, error). Es el UNICO camino que gasta ademas de
    `action=tesis`."""
    p = PROVEEDORES.get(proveedor)
    if not p:
        return None, (f'Proveedor {proveedor!r} desconocido. Los validos son: '
                      f'{", ".join(PROVEEDORES)}.')
    clave = os.environ.get(p['env_clave'])
    if not clave:
        return None, (f'No hay clave de {p["nombre"]} cargada ({p["env_clave"]}). '
                      f'No se llamo a nadie.')

    datos = _resumen_cartera(cuerpo or {})
    pos = datos.get('posiciones') or []
    if not pos:
        return None, ('La cartera llego sin posiciones. No se llamo a nadie.')

    modo = (modo or MODO_CARTERA_POR_DEFECTO).strip().lower()
    if modo not in MODELOS_CARTERA:
        return None, (f'Modo {modo!r} desconocido. Los validos son: '
                      f'{", ".join(MODELOS_CARTERA)}. No se llamo a nadie.')
    modelo = modelo_cartera(proveedor, modo)
    t0 = time.time()
    try:
        texto, t_ent, t_sal, diag, t_cache, tope = _llamar_cartera(
            proveedor, clave, modelo, datos)
    except urllib.error.HTTPError as e:
        detalle = e.read().decode('utf-8', 'replace')[:300]
        return None, f'{p["nombre"]} devolvio {e.code}. {detalle}'
    except Exception as e:
        return None, f'No pude hablar con {p["nombre"]}: {type(e).__name__}: {e}'

    if not texto:
        d = diag or {}
        extra = ''
        if d.get('stop_reason') == 'max_tokens' or d.get('finish_reason') == 'length':
            extra = (f' Se corto por el tope de salida ({tope} tokens) con '
                     f'{len(pos)} posiciones.')
        return None, (f'{p["nombre"]} respondio sin texto (la llamada igual se '
                      f'cobro).{extra} Detalle: {json.dumps(d, ensure_ascii=False)}')

    pe, ps = PRECIOS.get(modelo, (None, None))
    costo = (round((t_ent or 0) * pe / 1e6 + (t_sal or 0) * ps / 1e6, 5)
             if pe is not None else None)

    return {
        'texto': texto,
        'avisos': validar_respuesta_cartera(texto, datos),
        'proveedor': proveedor,
        'proveedor_nombre': p['nombre'],
        'modelo': modelo,
        'modo': modo,
        'n_posiciones': len(pos),
        'n_candidatos': len(datos.get('candidatos') or []),
        'tokens': {'entrada': t_ent, 'salida': t_sal, 'desde_cache': t_cache,
                   'tope_de_salida': tope},
        'costo_estimado_usd': costo,
        'segundos': round(time.time() - t0, 1),
    }, None


class handler(BaseHTTPRequestHandler):

    def _responder(self, codigo, cuerpo):
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        # Regla de oro #7: toda API dinamica necesita no-store explicito
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.end_headers()
        self.wfile.write(json.dumps(cuerpo, ensure_ascii=False).encode('utf-8'))

    def do_POST(self):
        """Solo `action=tesis_cartera`. Es POST porque el bloque de datos son
        ~2.000 tokens de JSON armados en el navegador: no entra en una query
        string, y aunque entrara quedaria en los logs del servidor."""
        try:
            q = parse_qs(urlparse(self.path).query)
            accion = (q.get('action') or [''])[0]
            if accion != 'tesis_cartera':
                return self._responder(400, {
                    'error': f'POST solo acepta action=tesis_cartera, no {accion!r}.',
                    'sin_costo': True})

            # El proveedor es OBLIGATORIO y explicito, igual que en la tesis
            # individual: sin default, para que sea imposible gastar en uno
            # creyendo que elegiste el otro.
            proveedor = (q.get('proveedor') or [''])[0].strip().lower()
            if not proveedor:
                return self._responder(400, {
                    'error': 'Falta el parametro proveedor (anthropic u openai). '
                             'Es obligatorio a proposito: sin el, no se llama a '
                             'ninguno.',
                    'sin_costo': True})

            largo = int(self.headers.get('Content-Length') or 0)
            if largo <= 0:
                return self._responder(400, {
                    'error': 'El POST llego sin cuerpo. No se llamo a nadie.',
                    'sin_costo': True})
            # Tope de tamano: sin esto un cuerpo gigante se manda igual al
            # modelo y se paga. 400 KB es holgado para 40 posiciones.
            if largo > 400000:
                return self._responder(413, {
                    'error': f'El cuerpo pesa {largo} bytes, demasiado. '
                             f'No se llamo a nadie.',
                    'sin_costo': True})
            try:
                cuerpo = json.loads(self.rfile.read(largo).decode('utf-8'))
            except Exception as e:
                return self._responder(400, {
                    'error': f'El cuerpo no es JSON valido: {type(e).__name__}. '
                             f'No se llamo a nadie.',
                    'sin_costo': True})

            modo = (q.get('modo') or [''])[0].strip().lower() or None
            res, err = generar_tesis_cartera(cuerpo, proveedor, modo)
            if err:
                # `sin_costo` solo si es seguro que no se llamo. Si el error
                # viene de la respuesta del modelo, la llamada YA se cobro y
                # decir lo contrario seria mentir.
                gasto = ('respondio' in err) or ('devolvio' in err)
                return self._responder(502 if gasto else 400,
                                       {'error': err, 'sin_costo': not gasto})
            return self._responder(200, res)

        except Exception as e:
            import traceback
            return self._responder(500, {
                'error': f'{type(e).__name__}: {e}',
                'traza': traceback.format_exc()[-600:]})

    def do_OPTIONS(self):
        # El POST desde el navegador dispara preflight.
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        try:
            q = parse_qs(urlparse(self.path).query)
            accion = (q.get('action') or ['datos'])[0]
            ticker = (q.get('ticker') or [''])[0].strip().upper()

            # Acciones que NO necesitan ticker. `proveedores` faltaba en esta
            # lista y devolvia 400 en produccion: el front preguntaba que claves
            # hay, recibia un error, y por lo tanto NO MOSTRABA NINGUN BOTON de
            # tesis aunque las claves estuvieran bien cargadas. Se encontro
            # consultando el endpoint real, no en los tests: los tests llaman a
            # generar_tesis() directo y nunca pasan por do_GET.
            SIN_TICKER = ('diag', 'proveedores', 'estimar_cartera')
            if not ticker and accion not in SIN_TICKER:
                return self._responder(400, {
                    'error': f'Falta el parametro ticker para action={accion}.'})

            if accion == 'diag':
                return self._responder(200, diagnostico())

            if accion == 'datos':
                datos, err = armar_datos(ticker)
                if err:
                    return self._responder(404, {'error': err})
                return self._responder(200, datos)

            # Que proveedores hay. NO gasta un solo token: solo mira si las
            # variables de entorno existen. El front lo usa para decidir que
            # botones mostrar.
            if accion == 'proveedores':
                return self._responder(200, {'proveedores': proveedores_disponibles()})

            # Cuanto sale la tesis de cartera ANTES de pedirla. NO gasta un solo
            # token: es aritmetica sobre la cantidad de posiciones. El boton lo
            # usa para mostrar el numero antes de que lo aprieten.
            if accion == 'estimar_cartera':
                try:
                    n_pos = int((q.get('posiciones') or ['0'])[0])
                except ValueError:
                    return self._responder(400, {
                        'error': 'posiciones tiene que ser un numero.'})
                prov = (q.get('proveedor') or ['anthropic'])[0].strip().lower()
                if prov not in PROVEEDORES:
                    return self._responder(400, {
                        'error': f'Proveedor {prov!r} desconocido.'})
                return self._responder(200, {
                    m: estimar_cartera(n_pos, prov, m) for m in MODELOS_CARTERA})

            if accion == 'tesis':
                # EL ÚNICO camino que consume tokens en todo el proyecto.
                # El proveedor es OBLIGATORIO y explicito: no hay default, para
                # que sea imposible gastar en uno creyendo que elegiste el otro.
                proveedor = (q.get('proveedor') or [''])[0].strip().lower()
                if not proveedor:
                    return self._responder(400, {
                        'error': 'Falta el parametro proveedor (anthropic u '
                                 'openai). Es obligatorio a proposito: sin el, '
                                 'no se llama a ninguno.',
                        'sin_costo': True})
                res, err = generar_tesis(ticker, proveedor)
                if err:
                    return self._responder(502 if res is None and 'devolvio' in err else 400,
                                           {'error': err, 'sin_costo': True})
                return self._responder(200, res)

            # ⚠️ Acá decía {acción} — el pase de acentos del 25/08 le puso tilde
            # a la variable dentro del f-string y la variable se llama `accion`.
            # Habría reventado con NameError, pero solo por esta rama, que es la
            # de "acción desconocida" y nunca se ejercitaba. El detector de
            # nombres no definidos lo encontró; los tests no, porque todos
            # pasaban acciones válidas.
            return self._responder(400, {'error': f'Accion desconocida: {accion}'})

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
