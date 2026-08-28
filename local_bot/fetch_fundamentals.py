#!/usr/bin/env python3
"""
Bot local de fundamentales — S&P 500 Screener
================================================

Corre desde tu PC (no desde Vercel) para evitar el bloqueo de IP que
Yahoo Finance aplica a proveedores cloud (Vercel, AWS, etc.). Tu IP
residencial no tiene ese problema, así que yfinance funciona normal acá.

Qué hace:
  1. Trae la lista de constituyentes del S&P 500 desde Wikipedia
  2. Para cada símbolo (+ SPY), trae quote + los 9 ratios fundamentales
     en 1 sola llamada .info (no hace falta el truco de session= que
     usamos en Vercel — tu IP no está bloqueada)
  3. Guarda todo en public/data/sp500_fundamentals.json

Cómo correrlo:
    cd local_bot
    pip install yfinance
    python fetch_fundamentals.py

Después:
    git add public/data/sp500_fundamentals.json
    git commit -m "chore: actualizar snapshot de fundamentales"
    git push

Recomendación: correrlo 1 vez por día (o cuando quieras refrescar
precios/ratios) — no hace falta más seguido, los fundamentales
(P/E, ROE, etc.) no cambian intradía.

Requisitos: Python 3.9+, yfinance (`pip install yfinance`)
"""
import json
import logging
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

_yf_logger = logging.getLogger('yfinance')

try:
    import yfinance as yf
except ImportError:
    print("❌ Falta yfinance. Instalalo con: pip install yfinance")
    sys.exit(1)

SECTOR_MAP = {
    # Inglés canónico directo
    "Information Technology": "Technology", "Health Care": "Healthcare",
    "Financials": "Financials", "Consumer Discretionary": "Consumer Discretionary",
    "Communication Services": "Communication Services", "Industrials": "Industrials",
    "Consumer Staples": "Consumer Staples", "Energy": "Energy",
    "Utilities": "Utilities", "Real Estate": "Real Estate", "Materials": "Materials",
    # Español (Wikipedia puede devolver versión traducida)
    "Tecnología de la información": "Technology", "Tecnología": "Technology",
    "Atención sanitaria": "Healthcare", "Salud": "Healthcare",
    "Finanzas": "Financials", "Servicios financieros": "Financials",
    "Consumo discrecional": "Consumer Discretionary",
    "Servicios de comunicación": "Communication Services",
    "Industriales": "Industrials", "Consumo básico": "Consumer Staples",
    "Energía": "Energy", "Servicios públicos": "Utilities",
    "Inmobiliario": "Real Estate", "Bienes raíces": "Real Estate",
    "Materiales": "Materials",
    # Subsectores Wikipedia EN → GICS (109 entradas)
    "Application Software": "Technology", "Systems Software": "Technology",
    "IT Consulting & Other Services": "Technology",
    "Internet Services & Infrastructure": "Technology",
    "Technology Hardware, Storage & Peripherals": "Technology",
    "Semiconductors": "Technology", "Semiconductor Materials & Equipment": "Technology",
    "Electronic Components": "Technology", "Electrical Components & Equipment": "Technology",
    "Technology Distributors": "Technology",
    "Data Processing & Outsourced Services": "Technology",
    "Transaction & Payment Processing Services": "Technology",
    "Health Care Equipment": "Healthcare", "Health Care Supplies": "Healthcare",
    "Health Care Distributors": "Healthcare", "Biotechnology": "Healthcare",
    "Pharmaceuticals": "Healthcare", "Life Sciences Tools & Services": "Healthcare",
    "Managed Health Care": "Healthcare", "Health Care Services": "Healthcare",
    "Health Care Technology": "Healthcare",
    "Diversified Banks": "Financials", "Regional Banks": "Financials",
    "Asset Management & Custody Banks": "Financials",
    "Investment Banking & Brokerage": "Financials", "Consumer Finance": "Financials",
    "Multi-line Insurance": "Financials", "Property & Casualty Insurance": "Financials",
    "Life & Health Insurance": "Financials", "Insurance Brokers": "Financials",
    "Financial Exchanges & Data": "Financials", "Mortgage REITs": "Financials",
    "Diversified Financial Services": "Financials",
    "Automotive Retail": "Consumer Discretionary",
    "Automotive Parts & Equipment": "Consumer Discretionary",
    "Hotels, Resorts & Cruise Lines": "Consumer Discretionary",
    "Broadline Retail": "Consumer Discretionary",
    "Specialty Retail": "Consumer Discretionary",
    "Restaurants": "Consumer Discretionary", "Leisure Products": "Consumer Discretionary",
    "Household Durables": "Consumer Discretionary",
    "Textiles, Apparel & Luxury Goods": "Consumer Discretionary",
    "Distributors": "Consumer Discretionary",
    "Internet & Direct Marketing Retail": "Consumer Discretionary",
    "Interactive Media & Services": "Communication Services",
    "Integrated Telecommunication Services": "Communication Services",
    "Wireless Telecommunication Services": "Communication Services",
    "Cable & Satellite": "Communication Services",
    "Communications Equipment": "Communication Services",
    "Publishing": "Communication Services", "Movies & Entertainment": "Communication Services",
    "Advertising": "Communication Services",
    "Aerospace & Defense": "Industrials", "Industrial Conglomerates": "Industrials",
    "Building Products": "Industrials",
    "Construction Machinery & Heavy Transportation Equipment": "Industrials",
    "Human Resource & Employment Services": "Industrials",
    "Air Freight & Logistics": "Industrials", "Railroads": "Industrials",
    "Trucking": "Industrials", "Research & Consulting Services": "Industrials",
    "Environmental & Facilities Services": "Industrials",
    "Office Services & Supplies": "Industrials", "Airlines": "Industrials",
    "Diversified Support Services": "Industrials", "Industrial Gases": "Materials",
    "Packaged Foods & Meats": "Consumer Staples", "Food Retail": "Consumer Staples",
    "Hypermarkets & Super Centers": "Consumer Staples", "Drug Retail": "Consumer Staples",
    "Household Products": "Consumer Staples", "Personal Care Products": "Consumer Staples",
    "Tobacco": "Consumer Staples", "Brewers": "Consumer Staples",
    "Distillers & Vintners": "Consumer Staples",
    "Agricultural Products & Services": "Consumer Staples",
    "Integrated Oil & Gas": "Energy",
    "Oil & Gas Exploration & Production": "Energy",
    "Oil & Gas Equipment & Services": "Energy",
    "Oil & Gas Refining & Marketing": "Energy",
    "Independent Power Producers & Energy Traders": "Energy",
    "Coal & Consumable Fuels": "Energy",
    "Electric Utilities": "Utilities", "Multi-Utilities": "Utilities",
    "Gas Utilities": "Utilities", "Water Utilities": "Utilities",
    "Renewable Electricity": "Utilities",
    "Office REITs": "Real Estate", "Retail REITs": "Real Estate",
    "Residential REITs": "Real Estate", "Multi-Family Residential REITs": "Real Estate",
    "Industrial REITs": "Real Estate", "Diversified REITs": "Real Estate",
    "Real Estate Services": "Real Estate",
    "Real Estate Management & Development": "Real Estate",
    "Telecom Tower REITs": "Real Estate", "Data Center REITs": "Real Estate",
    "Hotel & Resort REITs": "Real Estate",
    "Specialty Chemicals": "Materials", "Commodity Chemicals": "Materials",
    "Fertilizers & Agricultural Chemicals": "Materials",
    "Diversified Metals & Mining": "Materials", "Steel": "Materials",
    "Paper & Forest Products": "Materials",
    "Paper & Plastic Packaging Products & Materials": "Materials",
    "Metal, Glass & Plastic Containers": "Materials",
    "Aluminum": "Materials", "Gold": "Materials",
    "Construction Materials": "Materials",
    "Analog Devices": "Technology",  # empresa mal parseada como sector
    # Subsectores adicionales detectados en producción
    "Soft Drinks & Non-alcoholic Beverages": "Consumer Staples",
    "Consumer Staples Merchandise Retail": "Consumer Staples",
    "Home Improvement Retail": "Consumer Discretionary",
    "Apparel Retail": "Consumer Discretionary",
    "Apparel, Accessories & Luxury Goods": "Consumer Discretionary",
    "Other Specialty Retail": "Consumer Discretionary",
    "Footwear": "Consumer Discretionary",
    "Homefurnishing Retail": "Consumer Discretionary",
    "Specialized Consumer Services": "Consumer Discretionary",
    "Internet & Direct Marketing Retail": "Consumer Discretionary",
    "Computer & Electronics Retail": "Consumer Discretionary",
    "Casinos & Gaming": "Consumer Discretionary",
    "Automobile Manufacturers": "Consumer Discretionary",
    "Passenger Airlines": "Industrials",
    "Rail Transportation": "Industrials",
    "Cargo Ground Transportation": "Industrials",
    "Passenger Ground Transportation": "Industrials",
    "Trading Companies & Distributors": "Industrials",
    "Construction & Engineering": "Industrials",
    "Industrial Machinery & Supplies & Components": "Industrials",
    "Electronic Manufacturing Services": "Industrials",
    "Electronic Equipment & Instruments": "Industrials",
    "Heavy Electrical Equipment": "Industrials",
    "Agricultural & Farm Machinery": "Industrials",
    "Food Distributors": "Consumer Staples",
    "Homebuilding": "Consumer Discretionary",
    "IT Consulting & Other Services": "Technology",
    "Interactive Home Entertainment": "Communication Services",
    "Broadcasting": "Communication Services",
    "Movies & Entertainment": "Communication Services",
    "Self-Storage REITs": "Real Estate",
    "Single-Family Residential REITs": "Real Estate",
    "Other Specialized REITs": "Real Estate",
    "Timber REITs": "Real Estate",
    "Health Care REITs": "Real Estate",
    "Health Care Facilities": "Healthcare",
    "Copper": "Materials",
    "Consumer Electronics": "Consumer Discretionary",
    "Multi-Sector Holdings": "Financials",
    "Reinsurance": "Financials",
    "Life & Health Insurance": "Financials",
    "Oil & Gas Storage & Transportation": "Energy",
    "Oil & Gas Refining & Marketing": "Energy",
    "Independent Power Producers & Energy Traders": "Energy",
    "Research & Consulting Services": "Industrials",
}

# ── Sinónimos español (Wikipedia a veces devuelve la versión traducida) ─────
SECTOR_MAP.update({
    "Tecnología de la información": "Technology", "Tecnología": "Technology",
    "Atención sanitaria": "Healthcare", "Salud": "Healthcare",
    "Finanzas": "Financials", "Servicios financieros": "Financials",
    "Consumo discrecional": "Consumer Discretionary",
    "Servicios de comunicación": "Communication Services",
    "Industriales": "Industrials", "Consumo básico": "Consumer Staples",
    "Energía": "Energy", "Servicios públicos": "Utilities",
    "Inmobiliario": "Real Estate", "Bienes raíces": "Real Estate",
    "Materiales": "Materials",
})


# ─────────────────────────────────────────────────────────────────────────────
# INFORME AVANZADO — captura de consenso de analistas
# ─────────────────────────────────────────────────────────────────────────────
# Esto pertenece al proyecto "informe avanzado", que es SEPARADO del screener.
# Vive acá por una sola razón: estos campos ya vienen dentro de la MISMA
# llamada .info que el screener hace igual, asi que capturarlos cuesta
# 0 llamadas extra y 0 tiempo extra.
#
# GARANTIAS DE NO-INTERFERENCIA con el screener:
#   1. Se escribe a un archivo APARTE (informe_consenso.json). El snapshot del
#      screener (sp500_fundamentals.json) no cambia ni un byte de estructura.
#   2. La captura esta envuelta en try/except que se traga TODO: si Yahoo
#      cambia un campo, el screener sigue andando igual.
#   3. La escritura del archivo del informe ocurre DESPUES de guardar el
#      snapshot del screener, tambien en try/except.
# ─────────────────────────────────────────────────────────────────────────────

CONSENSO_FIELDS = (
    # ── consenso de analistas ──
    'recommendationKey',        # 'strong_buy' / 'buy' / 'hold' / 'sell' / 'none'
    'recommendationMean',       # 1.0 = strong buy ... 5.0 = strong sell
    'numberOfAnalystOpinions',  # cuantos analistas cubren el papel
    'targetMeanPrice', 'targetMedianPrice', 'targetHighPrice', 'targetLowPrice',
    'currentPrice', 'trailingEps', 'forwardEps', 'earningsGrowth', 'revenueGrowth',
    # ── dividendos ──
    'dividendRate', 'dividendYield', 'payoutRatio', 'fiveYearAvgDividendYield',
    'trailingAnnualDividendRate', 'trailingAnnualDividendYield', 'lastDividendValue',
    # ── caja, deuda y flujo libre ──
    'freeCashflow', 'operatingCashflow', 'totalCash', 'totalCashPerShare',
    'totalDebt', 'currentRatio', 'quickRatio', 'ebitda', 'totalRevenue',
    # ── valuacion forward y margenes ──
    'forwardPE', 'trailingPegRatio', 'pegRatio', 'enterpriseValue', 'bookValue',
    'grossMargins', 'operatingMargins', 'ebitdaMargins',
    # ── riesgo de mercado ──
    'beta', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'fiftyTwoWeekChange',
    '52WeekChange', 'SandP52WeekChange', 'shortRatio', 'shortPercentOfFloat',
    'sharesShort', 'sharesOutstanding', 'floatShares', 'averageVolume',
)

_consenso_acc = {}


def _derivados(fila, info):
    """Metricas calculadas. Cada una en su propio try: si una falla, las otras
    se guardan igual."""
    px = fila.get('currentPrice') or info.get('regularMarketPrice')

    # upside implicito del precio objetivo medio
    try:
        tgt = fila.get('targetMeanPrice')
        fila['upsidePct'] = round((tgt / px - 1) * 100, 2) if px and tgt else None
    except Exception:
        fila['upsidePct'] = None

    # dispersion del precio objetivo: (max - min) / promedio.
    # Mediana observada en el S&P 500: ~40%. Por encima de eso no hay consenso,
    # hay desacuerdo. Un 0,0% exacto suele delatar dato viejo, no unanimidad.
    try:
        hi, lo, me = (fila.get('targetHighPrice'), fila.get('targetLowPrice'),
                      fila.get('targetMeanPrice'))
        fila['targetDispersionPct'] = round((hi - lo) / me * 100, 1) if (hi and lo and me) else None
    except Exception:
        fila['targetDispersionPct'] = None

    # dividend yield en % — SIEMPRE calculado desde dividendRate/precio.
    # yfinance cambio la escala de 'dividendYield' entre versiones (fraccion vs
    # porcentaje), asi que no confiamos en ese campo: guardamos el crudo como
    # referencia pero el que usa el informe es este.
    try:
        rate = fila.get('dividendRate') or fila.get('trailingAnnualDividendRate')
        fila['dividendYieldPct'] = round(rate / px * 100, 2) if (rate and px) else None
    except Exception:
        fila['dividendYieldPct'] = None

    # FCF yield: cuanto flujo libre genera por cada peso de capitalizacion.
    # Mas honesto que el P/E porque no se puede maquillar con contabilidad.
    try:
        fcf, mc = fila.get('freeCashflow'), info.get('marketCap')
        fila['fcfYieldPct'] = round(fcf / mc * 100, 2) if (fcf and mc) else None
    except Exception:
        fila['fcfYieldPct'] = None

    # deuda neta = deuda total - caja. Una empresa con mas caja que deuda
    # (negativo) esta en otra categoria de riesgo.
    try:
        td, tc = fila.get('totalDebt'), fila.get('totalCash')
        fila['netDebt'] = (td - tc) if (td is not None and tc is not None) else None
        eb = fila.get('ebitda')
        fila['netDebtToEbitda'] = (round(fila['netDebt'] / eb, 2)
                                   if (fila.get('netDebt') is not None and eb and eb > 0) else None)
    except Exception:
        fila['netDebt'] = fila['netDebtToEbitda'] = None

    # que tan lejos esta del maximo de 52 semanas
    try:
        hi = fila.get('fiftyTwoWeekHigh')
        fila['desdeMaximo52wPct'] = round((px / hi - 1) * 100, 1) if (px and hi) else None
    except Exception:
        fila['desdeMaximo52wPct'] = None

    # margenes a % (yfinance los da como fraccion)
    for k, destino in (('grossMargins', 'grossMarginPct'),
                       ('operatingMargins', 'operatingMarginPct'),
                       ('ebitdaMargins', 'ebitdaMarginPct'),
                       ('payoutRatio', 'payoutRatioPct')):
        try:
            v = fila.get(k)
            fila[destino] = round(v * 100, 2) if v is not None else None
        except Exception:
            fila[destino] = None


def _capturar_consenso(sym, info):
    """Guarda los campos del informe en el acumulador.

    Blindado a proposito: cualquier excepcion se traga en silencio. Este
    codigo NO puede hacer fallar la corrida del screener bajo ninguna
    circunstancia."""
    try:
        fila = {}
        for k in CONSENSO_FIELDS:
            try:
                fila[k] = info.get(k)
            except Exception:
                fila[k] = None
        try:
            _derivados(fila, info)
        except Exception:
            pass
        _consenso_acc[sym] = fila
    except Exception:
        pass  # nunca propagar: el screener tiene prioridad


def _guardar_consenso(data_dir, generated_at):
    """Escribe informe_consenso.json. Se llama DESPUES de guardar el snapshot
    del screener, asi que si falla, el screener ya quedo a salvo."""
    try:
        path = data_dir / 'informe_consenso.json'
        payload = {
            'generated_at': generated_at,
            'source': 'fetch_fundamentals.py (.info — 0 llamadas extra)',
            'count': len(_consenso_acc),
            'consenso': _consenso_acc,
        }
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        con_target = sum(1 for v in _consenso_acc.values() if v.get('targetMeanPrice'))
        print(f'\n[informe] consenso de {len(_consenso_acc)} simbolos '
              f'({con_target} con precio objetivo) guardado en')
        print(f'          {path}')
        return True
    except Exception as e:
        print(f'\n[informe] AVISO: no se pudo escribir informe_consenso.json '
              f'({type(e).__name__}: {e})')
        print('          El snapshot del screener YA quedo guardado y no se ve afectado.')
        return False


def fetch_sp500_list():
    """Mismo scraping que action=sp500 en api/data.py — mantener sincronizado
    si alguna vez se actualiza la lógica ahí."""
    url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode('utf-8')
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
    constituents = []
    for row in rows[1:]:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        if len(cells) >= 4:
            sym = re.sub(r'<[^>]+>', '', cells[0]).strip().replace('.', '-')
            name = re.sub(r'<[^>]+>', '', cells[1]).strip()
            sector_raw = re.sub(r'<[^>]+>', '', cells[3]).strip()
            sector_raw = (sector_raw.replace('&amp;', '&').replace('&lt;', '<')
                          .replace('&gt;', '>').replace('&nbsp;', ' ').strip())
            sector = SECTOR_MAP.get(sector_raw, sector_raw)
            if sym and 1 <= len(sym) <= 5 and sector:
                constituents.append({'symbol': sym, 'name': name, 'sector': sector})
    return constituents


def _check_cedear_live(sym):
    """Verifica si existe CEDEAR de este ticker en BYMA. Yahoo Finance usa
    la convención TICKER.BA para instrumentos de la Bolsa de Buenos Aires —
    si {sym}.BA tiene precio válido, el CEDEAR existe y cotiza. Usa fast_info
    (más liviano que .info) porque solo necesitamos saber si tiene precio.

    Los mensajes "$XXX.BA: possibly delisted" que imprime yfinance acá NO son
    un error: SON la respuesta "este papel no tiene CEDEAR". Yahoo no tiene un
    endpoint de "¿existe este símbolo?", así que la única forma de preguntarlo
    es pedirlo y ver si contesta. Por eso silenciamos el logger de yfinance
    SOLO durante esta llamada, y lo restauramos enseguida."""
    nivel = _yf_logger.level
    _yf_logger.setLevel(logging.CRITICAL)
    try:
        fi = yf.Ticker(f'{sym}.BA').fast_info
        price = getattr(fi, 'last_price', None)
        return bool(price and price > 0)
    except Exception:
        return False
    finally:
        _yf_logger.setLevel(nivel)


# ─────────────────────────────────────────────────────────────────────────────
# CACHÉ DE CEDEAR — la parte cara de la corrida
# ─────────────────────────────────────────────────────────────────────────────
# Medido el 21/08/2026: la corrida completa tardaba 28,4 min. La causa es que
# por cada símbolo SIN CEDEAR (unos 350 de 504), yfinance intenta traer
# historial dos veces (period=1y y period=5d) y encima reintenta.
#
# La lista de CEDEARs de BYMA cambia unas pocas veces al año, no todos los
# días. Cachear el resultado 30 días baja la corrida a ~8 min y NO viola la
# regla de oro #11 ("preferir verificación en vivo sobre listas estáticas"):
# se sigue verificando en vivo contra Yahoo, solo que no se repite a diario.
#
# El caché es local del bot. NO va a git — agregá a .gitignore:
#     local_bot/.cedear_cache.json
# ─────────────────────────────────────────────────────────────────────────────

CEDEAR_CACHE_DIAS = 30
_cedear_cache = {}
_cedear_stats = {'cache': 0, 'live': 0}


def _cedear_cache_path():
    return Path(__file__).resolve().parent / '.cedear_cache.json'


def cargar_cedear_cache():
    """Lee el caché. Si no existe o está corrupto, arranca vacío (peor caso:
    la corrida tarda lo mismo que antes, nunca falla)."""
    global _cedear_cache
    try:
        p = _cedear_cache_path()
        if not p.exists():
            _cedear_cache = {}
            return
        d = json.loads(p.read_text(encoding='utf-8'))
        _cedear_cache = d.get('entries', {}) if isinstance(d, dict) else {}
        vigentes = sum(1 for s in _cedear_cache if _cedear_vigente(s))
        print(f'   Caché de CEDEAR: {vigentes}/{len(_cedear_cache)} entradas vigentes '
              f'(vencen a los {CEDEAR_CACHE_DIAS} días)')
    except Exception as e:
        print(f'   Caché de CEDEAR ilegible ({type(e).__name__}), lo ignoro y verifico todo')
        _cedear_cache = {}


def _cedear_vigente(sym):
    """¿La entrada de este símbolo sigue dentro de los 30 días?"""
    try:
        e = _cedear_cache.get(sym)
        if not e or 'hasCedear' not in e:
            return False
        vista = datetime.fromisoformat(e['checked_at'])
        if vista.tzinfo is None:
            vista = vista.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - vista).days < CEDEAR_CACHE_DIAS
    except Exception:
        return False


def check_cedear(sym):
    """Mismo contrato que antes (devuelve bool), ahora con caché delante.
    fetch_one no cambia: sigue llamando check_cedear(sym) igual que siempre."""
    try:
        if _cedear_vigente(sym):
            _cedear_stats['cache'] += 1
            return bool(_cedear_cache[sym]['hasCedear'])
    except Exception:
        pass  # ante cualquier duda, verificamos en vivo
    res = _check_cedear_live(sym)
    _cedear_stats['live'] += 1
    try:
        _cedear_cache[sym] = {
            'hasCedear': res,
            'checked_at': datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        pass  # que no se guarde en caché no es motivo para romper nada
    return res


def guardar_cedear_cache():
    """Guarda el caché. Si falla, avisa y sigue — no afecta al snapshot."""
    try:
        p = _cedear_cache_path()
        p.write_text(json.dumps(
            {'version': 1, 'dias': CEDEAR_CACHE_DIAS, 'entries': _cedear_cache},
            ensure_ascii=False), encoding='utf-8')
        print(f'   CEDEAR: {_cedear_stats["cache"]} desde caché · '
              f'{_cedear_stats["live"]} verificados en vivo · '
              f'{len(_cedear_cache)} guardados')
    except Exception as e:
        print(f'   AVISO: no se pudo guardar el caché de CEDEAR '
              f'({type(e).__name__}: {e}) — la próxima corrida verifica todo de nuevo')


def fetch_one(sym, sector=None):
    """Trae quote + los 9 ratios fundamentales en 1 sola llamada .info.
    A diferencia de Vercel, acá NO hace falta pasar session= con headers
    de browser — tu IP residencial no está bloqueada por Yahoo."""
    try:
        info = yf.Ticker(sym).info
        _capturar_consenso(sym, info)  # informe avanzado — 0 llamadas extra, no puede fallar
        price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
        prev  = info.get('previousClose') or info.get('regularMarketPreviousClose') or price
        pct   = round((price - prev) / prev * 100, 4) if prev else 0
        de    = info.get('debtToEquity')
        roe   = info.get('returnOnEquity')
        margin= info.get('profitMargins')
        roa   = info.get('returnOnAssets')
        rev_g = info.get('revenueGrowth')
        pb    = info.get('priceToBook')

        # ── PATRIMONIO NETO NEGATIVO (28/08/2026) ────────────────────────────
        # 33 empresas del S&P lo tienen -- MCD, BKNG, MAR, MO, PM, SBUX, ABBV
        # y 26 mas -- por decadas de recompras y dividendos con deuda.
        # P/B, ROE y D/E dependen los tres del patrimonio, asi que con el
        # equity abajo de cero los tres dejan de significar algo.
        #
        # Lo peligroso no es que falten: es que la fuente A VECES manda un
        # numero igual, y un numero absurdo puntua MEJOR que un hueco:
        #     MAS  -> ROE 5862%   (ingreso sobre un equity casi cero)
        #     IT   -> ROE  113%
        #     DVA  -> ROE 88%  y D/E 12,42
        # El ROE es "mayor es mejor" y pesa 22%: MAS se llevaba el maximo del
        # sector con un numero que no existe. Por eso se anulan a proposito:
        # un hueco es honesto, un 5862% es una mentira que gana el ranking.
        patrimonio_negativo = pb is not None and pb < 0

        # Reemplazo del D/E cuando no hay patrimonio contra que medirlo. Es el
        # estandar de la industria: cuanta deuda neta hay por cada dolar de
        # EBITDA. NO aplica a bancos -- su "caja" incluye depositos, asi que la
        # deuda neta da negativa (JPM: -183.000 millones) y el cociente no
        # significa nada. Por eso se exige nd > 0.
        td, tc, eb = info.get('totalDebt'), info.get('totalCash'), info.get('ebitda')
        nd_ebitda = None
        if td is not None and tc is not None and eb is not None and eb > 0:
            nd = td - tc
            if nd > 0:
                nd_ebitda = round(nd / eb, 3)

        has_cedear = check_cedear(sym)
        return {
            'symbol':       sym,
            'name':         info.get('shortName') or sym,
            'sector':       sector,
            'price':        price,
            'changePercent':pct,
            'marketCap':    info.get('marketCap') or 0,
            'pe':           info.get('trailingPE'),
            # El P/B se deja CRUDO (negativo incluido): el screener ya descarta
            # los <= 0 al puntuar, igual que api/informe.py::percentil(), y
            # conservarlo permite detectar el patrimonio negativo aguas abajo.
            'pb':           pb,
            'roe':          None if (patrimonio_negativo or roe is None) else roe * 100,
            # Antes decia abs(de / 100). El abs() convertia un D/E negativo
            # (patrimonio negativo) en uno positivo de aspecto normal: DVA
            # aparecia con 12,42, que se puntuaba como deuda altisima cuando en
            # realidad es un numero que no existe. Sin abs, y anulado si el
            # patrimonio es negativo.
            'de':           None if (patrimonio_negativo or de is None) else de / 100,
            'ndEbitda':     nd_ebitda,
            'patrimonioNegativo': patrimonio_negativo,
            'evEbitda':     info.get('enterpriseToEbitda'),
            'netMargin':    margin * 100 if margin is not None else None,
            'roa':          roa * 100 if roa is not None else None,
            'revGrowth':    rev_g * 100 if rev_g is not None else None,
            'priceToSales': info.get('priceToSalesTrailing12Months'),
            'hasCedear':    has_cedear,
        }
    except Exception as e:
        print(f'  ⚠️  {sym}: {type(e).__name__}: {e}')
        return None


def main():
    print('📡 Trayendo lista S&P 500 desde Wikipedia...')
    constituents = fetch_sp500_list()
    print(f'   {len(constituents)} empresas encontradas.')
    cargar_cedear_cache()
    print()

    if len(constituents) < 400:
        print('⚠️  Advertencia: se esperaban ~503 empresas, se encontraron '
              f'{len(constituents)}. Wikipedia pudo haber cambiado de formato.')

    # SPY no es parte de la lista de constituyentes (es el ETF benchmark)
    targets = [{'symbol': 'SPY', 'name': 'SPDR S&P 500 ETF', 'sector': None}] + constituents

    results = []
    failed = []
    total = len(targets)
    t0 = time.time()
    for i, c in enumerate(targets, 1):
        data = fetch_one(c['symbol'], sector=c['sector'])
        if data:
            results.append(data)
        else:
            failed.append(c['symbol'])
        if i % 25 == 0 or i == total:
            elapsed = time.time() - t0
            remaining = elapsed / i * (total - i)
            print(f'   {i}/{total} procesados · {elapsed:.0f}s transcurridos · '
                  f'~{remaining:.0f}s restantes')
        time.sleep(0.15)  # prudencia, aunque el home IP no esté bloqueado

    out = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'count':        len(results),
        'failed_count': len(failed),
        'stocks':       results,
    }

    out_path = Path(__file__).resolve().parent.parent / 'public' / 'data' / 'sp500_fundamentals.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')

    guardar_cedear_cache()

    print(f'\n✅ Listo: {len(results)}/{total} empresas guardadas en')
    print(f'   {out_path}')
    if failed:
        print(f'   ({len(failed)} fallaron: {", ".join(failed[:20])}'
              f'{"..." if len(failed) > 20 else ""})')

    # Informe avanzado (proyecto aparte) — archivo propio, ya guardamos el del screener
    ok_informe = _guardar_consenso(out_path.parent, out['generated_at'])

    print('\nAhora corré:')
    print('   git add public/data/sp500_fundamentals.json')
    if ok_informe:
        print('   git add public/data/informe_consenso.json')
    print('   git commit -m "chore: actualizar snapshot de fundamentales"')
    print('   git push')


if __name__ == '__main__':
    main()
