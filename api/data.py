from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import time
import requests
import yfinance as yf

def _make_session():
    """Session con headers de browser para evitar YFRateLimitError en IPs de datacenter."""
    s = requests.Session()
    s.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    })
    return s

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        # CRÍTICO: sin esto, Vercel/CDN/navegador puede cachear respuestas de
        # datos financieros dinámicos y servir precios/ratios viejos como si
        # fueran frescos — causó horas de diagnóstico confuso hoy.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.end_headers()
        params = parse_qs(urlparse(self.path).query)
        action = params.get('action', [''])[0]
        try:
            result = self._dispatch(action, params)
        except Exception as e:
            result = {'error': str(e)}
        self.wfile.write(json.dumps(result, default=str).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def _dispatch(self, action, params):

        # ── action=sp500 ──────────────────────────────────────────────────────
        if action == 'sp500':
            import urllib.request, re

            # Mapa completo: subsector Wikipedia → sector GICS (App.jsx SECTOR_COLORS)
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

            url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Accept-Language': 'en-US,en;q=0.9',  # forzar inglés
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode('utf-8')
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
            constituents = []
            for row in rows[1:]:
                cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
                if len(cells) >= 4:
                    sym    = re.sub(r'<[^>]+>', '', cells[0]).strip().replace('.', '-')
                    name   = re.sub(r'<[^>]+>', '', cells[1]).strip()
                    sector_raw = re.sub(r'<[^>]+>', '', cells[3]).strip()
                    # Decodificar entidades HTML (&amp; → &, etc.)
                    sector_raw = sector_raw.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ').strip()
                    # Normalizar sector — primero buscar en mapa, si no está dejarlo como está
                    sector = SECTOR_MAP.get(sector_raw, sector_raw)
                    if sym and 1 <= len(sym) <= 5 and sector:
                        constituents.append({'symbol': sym, 'name': name, 'sector': sector})
            return constituents

        # ── action=quote&symbols=AAPL,MSFT ─────────────────────────────────────
        # Fuente: Twelve Data — no rate-limita por IP de cloud (a diferencia de Yahoo)
        # Yahoo rate-limita cuando App.jsx hace 100+ requests seguidas desde Vercel
        # TWELVEDATA_API_KEY ya está configurada en Vercel env vars
        elif action == 'quote':
            # Estrategia: TODO dentro de UNA sola invocación de Vercel para minimizar
            # cuántas veces golpeamos a Yahoo. 1 warm-up (obtiene crumb+session) →
            # N sub-batches de 100 símbolos a Yahoo (misma sesión) → fallback acotado
            # por tiempo para los que falten. Sin Twelve Data — sin riesgo de costo.
            import time as _time
            t0 = _time.time()
            BUDGET = 26.0  # segundos — dejamos margen bajo los 30s de Vercel

            symbols_raw = params.get('symbols', [''])[0]
            symbols = [s.strip() for s in symbols_raw.split(',') if s.strip()]
            if not symbols:
                return []

            def _fb(sym):
                return {'symbol': sym, 'price': 0, 'marketCap': 0,
                        'pe': None, 'changesPercentage': 0, 'name': sym}

            def _parse_yh(q, sym):
                price = float(q.get('regularMarketPrice') or 0)
                prev  = float(q.get('regularMarketPreviousClose') or price)
                pct   = round((price - prev) / prev * 100, 4) if prev else 0
                return {
                    'symbol': sym, 'price': price,
                    'marketCap': q.get('marketCap') or 0,
                    'pe': q.get('trailingPE') or q.get('forwardPE') or None,
                    'changesPercentage': pct,
                    'name': q.get('shortName', sym),
                    'exchange': q.get('exchange', ''),
                }

            results_map = {}

            # Paso 1 — warm-up ÚNICO: .info confirmado funcional desde Vercel con
            # session= (browser headers). Inicializa el singleton YfData con crumb.
            crumb, yf_sess = None, None
            try:
                _ = yf.Ticker(symbols[0], session=_make_session()).info
                from yfinance.data import YfData
                _yfd    = YfData()          # singleton — misma instancia
                crumb   = _yfd._crumb       # atributo de INSTANCIA (no de clase)
                yf_sess = _yfd._session
            except Exception:
                pass

            # Paso 2 — sub-batches de 100 símbolos a Yahoo, TODOS con el mismo
            # crumb+session, dentro de esta misma invocación (no reinicia auth)
            if crumb and yf_sess:
                CH = 100
                for i in range(0, len(symbols), CH):
                    if _time.time() - t0 > BUDGET:
                        break
                    sub = symbols[i:i+CH]
                    try:
                        resp = yf_sess.get(
                            'https://query2.finance.yahoo.com/v7/finance/quote',
                            params={
                                'symbols':   ','.join(sub),
                                'crumb':     crumb,
                                'fields':    'regularMarketPrice,regularMarketPreviousClose,'
                                             'marketCap,trailingPE,forwardPE,shortName,exchange',
                                'formatted': 'false',
                                'lang': 'en-US', 'region': 'US',
                            },
                            timeout=10,
                        )
                        quotes = resp.json().get('quoteResponse', {}).get('result', [])
                        for q in quotes:
                            s = q.get('symbol', '')
                            if s:
                                results_map[s] = _parse_yh(q, s)
                    except Exception:
                        pass  # este sub-batch falló, seguimos con el resto

            # Paso 3 — fallback acotado por tiempo: .info individual solo para lo
            # que falte, hasta agotar el presupuesto de tiempo restante
            missing = [s for s in symbols if s not in results_map]
            for sym in missing:
                if _time.time() - t0 > BUDGET:
                    break
                try:
                    info  = yf.Ticker(sym, session=_make_session()).info
                    price = float(info.get('currentPrice') or info.get('regularMarketPrice') or 0)
                    prev  = float(info.get('previousClose') or info.get('regularMarketPreviousClose') or price)
                    pct   = round((price - prev) / prev * 100, 4) if prev else 0
                    results_map[sym] = {
                        'symbol': sym, 'price': price,
                        'marketCap': info.get('marketCap') or 0,
                        'pe': info.get('trailingPE') or info.get('forwardPE') or None,
                        'changesPercentage': pct,
                        'name': info.get('shortName', sym),
                    }
                except Exception:
                    pass

            return [results_map.get(sym, _fb(sym)) for sym in symbols]

        # ── action=ratios&symbol=AAPL ─────────────────────────────────────────
        elif action == 'ratios':
            # Acepta lista de símbolos (antes: 1 solo). Loop interno reutiliza el
            # crumb que yfinance cachea automáticamente (singleton) dentro de esta
            # misma invocación — evita renegociar auth con Yahoo por cada símbolo.
            import time as _time
            t0 = _time.time()
            BUDGET = 26.0

            sym_raw = params.get('symbol', [''])[0].strip()
            symbols = [s.strip() for s in sym_raw.split(',') if s.strip()]
            if not symbols:
                return [{}]

            def _empty(sym):
                return {'symbol': sym, 'peRatioTTM': None, 'priceToBookRatioTTM': None,
                        'returnOnEquityTTM': None, 'debtEquityRatioTTM': None,
                        'enterpriseValueMultipleTTM': None, 'netProfitMarginTTM': None,
                        'dividendYieldTTM': None, 'currentRatioTTM': None,
                        'returnOnAssetsTTM': None, 'revenueGrowthTTM': None,
                        'priceToSalesTTM': None}

            sess = _make_session()  # 1 sola sesión, reutilizada en todo el loop
            result = []
            for sym in symbols:
                if _time.time() - t0 > BUDGET:
                    result.append(_empty(sym))
                    continue
                try:
                    info = yf.Ticker(sym, session=sess).info
                    result.append({
                        'symbol':                       sym,
                        'peRatioTTM':                   info.get('trailingPE'),
                        'priceToBookRatioTTM':          info.get('priceToBook'),
                        'returnOnEquityTTM':            info.get('returnOnEquity'),
                        'debtEquityRatioTTM':           (info.get('debtToEquity') or 0) / 100 if info.get('debtToEquity') is not None else None,
                        'enterpriseValueMultipleTTM':   info.get('enterpriseToEbitda'),
                        'netProfitMarginTTM':           info.get('profitMargins'),
                        'dividendYieldTTM':             info.get('dividendYield'),
                        'currentRatioTTM':              info.get('currentRatio'),
                        'returnOnAssetsTTM':             info.get('returnOnAssets'),
                        'revenueGrowthTTM':              info.get('revenueGrowth'),
                        'priceToSalesTTM':               info.get('priceToSalesTrailing12Months'),
                    })
                except Exception:
                    result.append(_empty(sym))
            return result

        # ── action=profile&symbols=AAPL,MSFT ─────────────────────────────────
        elif action == 'profile':
            symbols_raw = params.get('symbols', [''])[0]
            symbols = [s.strip() for s in symbols_raw.split(',') if s.strip()]
            if not symbols:
                return []
            sess = _make_session()  # 1 sola sesión, reutilizada en todo el loop
            result = []
            for sym in symbols:
                try:
                    info = yf.Ticker(sym, session=sess).info
                    result.append({
                        'symbol':      sym,
                        'sector':      info.get('sector', 'Unknown'),
                        'companyName': info.get('shortName', sym),
                        'industry':    info.get('industry', ''),
                        'mktCap':      info.get('marketCap', 0),
                    })
                except Exception:
                    result.append({'symbol': sym, 'sector': 'Unknown', 'companyName': sym})
            return result

        # ── action=history&symbol=AAPL,MSFT&from=2019-01-01 ────────────────────
        # Fuente: Twelve Data (Yahoo y Stooq bloquean IPs de Vercel con bot protection)
        # Requiere env var TWELVEDATA_API_KEY (free tier: 800 créditos/día)
        elif action == 'history':
            import os

            api_key   = os.environ.get('TWELVEDATA_API_KEY', '')
            sym_raw   = params.get('symbol', [''])[0].strip()
            from_date = params.get('from',   ['2019-01-01'])[0]
            if not sym_raw:
                return {}
            if not api_key:
                return {'error': 'TWELVEDATA_API_KEY no configurada en variables de entorno de Vercel'}

            symbols = [s.strip() for s in sym_raw.split(',') if s.strip()]
            multi   = len(symbols) > 1

            # Una sola llamada para todos los símbolos del lote (hasta 5)
            url = 'https://api.twelvedata.com/time_series'
            req_params = {
                'symbol':     ','.join(symbols),
                'interval':   '1day',
                'start_date': from_date,
                'outputsize': 5000,
                'order':      'DESC',   # más nuevo primero, App.jsx hace .reverse()
                'apikey':     api_key,
                'format':     'JSON',
            }
            resp = _make_session().get(url, params=req_params, timeout=25)
            try:
                data = resp.json()
            except Exception:
                return {'error': f'TD respuesta no-JSON, status {resp.status_code}: {resp.text[:200]}'}

            # TD devuelve error como {"code": 429/401/..., "message": "..."} —
            # detectarlo explícitamente en vez de dejar que parse_td silencie todo a []
            if isinstance(data, dict) and 'code' in data and 'status' in data:
                err = f"TD error {data.get('code')}: {data.get('message')}"
                if multi:
                    return {sym: {'_error': err} for sym in symbols}
                return {'_error': err}

            def parse_td(values):
                result = []
                for v in (values or []):
                    try:
                        close = float(v.get('close') or 0)
                        if close > 0:
                            result.append({
                                'date':     v['datetime'][:10],
                                'close':    round(close, 4),
                                'adjClose': round(close, 4),
                                'open':     round(float(v.get('open',   close) or close), 4),
                                'high':     round(float(v.get('high',   close) or close), 4),
                                'low':      round(float(v.get('low',    close) or close), 4),
                                'volume':   int(float(v.get('volume', 0) or 0)),
                            })
                    except Exception:
                        pass
                return result  # ya viene DESC de la API

            if multi:
                # Respuesta multi: {"AAPL": {"values": [...]}, "MSFT": {"values": [...]}}
                # Un símbolo individual puede fallar aunque el resto funcione:
                # {"AAPL": {"code": 400, "message": "...", "status": "error"}}
                result = {}
                for sym in symbols:
                    entry = data.get(sym) or {}
                    if isinstance(entry, dict) and entry.get('status') == 'error':
                        result[sym] = {'_error': f"TD {entry.get('code')}: {entry.get('message')}"}
                    else:
                        result[sym] = parse_td(entry.get('values', []))
                return result
            else:
                # Respuesta single: {"values": [...], "meta": {...}}
                return parse_td(data.get('values', []))

        elif action == 'debug':
            import os
            syms = params.get('symbol', ['SPY'])[0]
            sym = [s.strip() for s in syms.split(',') if s.strip()][0]
            api_key = os.environ.get('TWELVEDATA_API_KEY', '')
            out = {'symbol': sym, 'twelvedata_key_set': bool(api_key), 'tests': {}}

            # Test 1: Twelve Data histórico
            if api_key:
                try:
                    url = 'https://api.twelvedata.com/time_series'
                    resp = _make_session().get(url, params={
                        'symbol': sym, 'interval': '1day',
                        'outputsize': 5, 'apikey': api_key,
                    }, timeout=15)
                    raw = resp.text[:800]
                    try:
                        data = resp.json()
                        vals = data.get('values', [])
                        out['tests']['twelvedata'] = {
                            'status':   resp.status_code,
                            'rows':     len(vals),
                            'sample':   vals[0] if vals else None,
                            'api_code': data.get('code'),
                            'api_msg':  data.get('message'),
                        }
                    except Exception:
                        out['tests']['twelvedata'] = {
                            'status':       resp.status_code,
                            'raw_response': raw,
                            'error':        'JSON parse failed — respuesta no es JSON válido',
                        }
                except Exception as e:
                    out['tests']['twelvedata'] = {'error': f'{type(e).__name__}: {e}'}
            else:
                out['tests']['twelvedata'] = {'error': 'TWELVEDATA_API_KEY no seteada en Vercel'}

            # Test 2: yfinance .info (F1/quote/ratios/profile)
            try:
                info = yf.Ticker(sym, session=_make_session()).info
                out['tests']['yf_info'] = {
                    'ok':    bool(info.get('currentPrice') or info.get('regularMarketPrice')),
                    'price': info.get('currentPrice') or info.get('regularMarketPrice'),
                }
            except Exception as e:
                out['tests']['yf_info'] = {'error': f'{type(e).__name__}: {e}'}

            return out

        else:
            return {'error': f'action desconocida: {action}'}
