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
        'Accept-Encoding': 'gzip, deflate, br',
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

        # ── action=quote&symbols=AAPL,MSFT ───────────────────────────────────
        elif action == 'quote':
            symbols_raw = params.get('symbols', [''])[0]
            symbols = [s.strip() for s in symbols_raw.split(',') if s.strip()]
            if not symbols:
                return []
            result = []
            for sym in symbols:
                try:
                    info = yf.Ticker(sym, session=_make_session()).info
                    price      = info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose') or 0
                    prev_close = info.get('previousClose') or info.get('regularMarketPreviousClose') or 0
                    change_pct = round(((price - prev_close) / prev_close * 100), 4) if prev_close else 0
                    result.append({
                        'symbol':            sym,
                        'price':             price,
                        'marketCap':         info.get('marketCap') or 0,
                        'pe':                info.get('trailingPE') or info.get('forwardPE') or None,
                        'changesPercentage': change_pct,
                        'name':              info.get('shortName', sym),
                        'exchange':          info.get('exchange', ''),
                    })
                except Exception:
                    result.append({'symbol': sym, 'price': 0, 'marketCap': 0,
                                   'pe': None, 'changesPercentage': 0, 'name': sym})
                time.sleep(0.3)
            return result

        # ── action=ratios&symbol=AAPL ─────────────────────────────────────────
        elif action == 'ratios':
            sym = params.get('symbol', [''])[0].strip()
            if not sym:
                return [{}]
            info = yf.Ticker(sym, session=_make_session()).info
            return [{
                'symbol':                       sym,
                'peRatioTTM':                   info.get('trailingPE'),
                'priceToBookRatioTTM':          info.get('priceToBook'),
                'returnOnEquityTTM':            info.get('returnOnEquity'),
                'debtEquityRatioTTM':           (info.get('debtToEquity') or 0) / 100 if info.get('debtToEquity') is not None else None,
                'enterpriseValueMultipleTTM':   info.get('enterpriseToEbitda'),
                'netProfitMarginTTM':           info.get('profitMargins'),
                'dividendYieldTTM':             info.get('dividendYield'),
                'currentRatioTTM':              info.get('currentRatio'),
            }]

        # ── action=profile&symbols=AAPL,MSFT ─────────────────────────────────
        elif action == 'profile':
            symbols_raw = params.get('symbols', [''])[0]
            symbols = [s.strip() for s in symbols_raw.split(',') if s.strip()]
            if not symbols:
                return []
            result = []
            for sym in symbols:
                try:
                    info = yf.Ticker(sym, session=_make_session()).info
                    result.append({
                        'symbol':      sym,
                        'sector':      info.get('sector', 'Unknown'),
                        'companyName': info.get('shortName', sym),
                        'industry':    info.get('industry', ''),
                        'mktCap':      info.get('marketCap', 0),
                    })
                except Exception:
                    result.append({'symbol': sym, 'sector': 'Unknown', 'companyName': sym})
                time.sleep(0.3)
            return result

        # ── action=history&symbol=AAPL,MSFT&from=2019-01-01 ────────────────────
        # Fetches individuales por símbolo (multi-ticker falla en Vercel)
        elif action == 'history':
            sym_raw   = params.get('symbol', [''])[0].strip()
            from_date = params.get('from',   ['2019-01-01'])[0]
            if not sym_raw:
                return {}

            symbols = [s.strip() for s in sym_raw.split(',') if s.strip()]
            multi   = len(symbols) > 1

            def fetch_one(sym):
                try:
                    sess = _make_session()
                    df = yf.Ticker(sym, session=sess).history(start=from_date, auto_adjust=True)
                    if df.empty:
                        return []
                    result = []
                    for date, row in df.iterrows():
                        try:
                            close = float(row['Close'])
                            if close > 0:
                                result.append({
                                    'date':     date.strftime('%Y-%m-%d'),
                                    'close':    round(close, 4),
                                    'adjClose': round(close, 4),
                                    'open':     round(float(row.get('Open',   close)), 4),
                                    'high':     round(float(row.get('High',   close)), 4),
                                    'low':      round(float(row.get('Low',    close)), 4),
                                    'volume':   int(row.get('Volume', 0)),
                                })
                        except Exception:
                            pass
                    return result[::-1]  # descendente: más nuevo primero
                except Exception:
                    return []

            if multi:
                return {sym: fetch_one(sym) for sym in symbols}
            else:
                return fetch_one(symbols[0])

        elif action == 'debug':
            syms = params.get('symbol', ['SPY'])[0]
            sym = [s.strip() for s in syms.split(',') if s.strip()][0]
            out = {'symbol': sym, 'session_headers': True, 'tests': {}}

            # Test 1: Ticker.history SIN session (método viejo)
            try:
                df1 = yf.Ticker(sym).history(start='2024-01-01', auto_adjust=True)
                out['tests']['history_no_session'] = {'empty': bool(df1.empty), 'shape': str(df1.shape)}
            except Exception as e:
                out['tests']['history_no_session'] = {'error': f'{type(e).__name__}: {e}'}
            time.sleep(0.5)

            # Test 2: Ticker.history CON session de browser (método nuevo)
            try:
                sess = _make_session()
                df2 = yf.Ticker(sym, session=sess).history(start='2024-01-01', auto_adjust=True)
                out['tests']['history_with_session'] = {'empty': bool(df2.empty), 'shape': str(df2.shape),
                    'rows': len(df2), 'first_date': str(df2.index[0].date()) if not df2.empty else None}
            except Exception as e:
                out['tests']['history_with_session'] = {'error': f'{type(e).__name__}: {e}'}
            time.sleep(0.5)

            # Test 3: Ticker.info CON session
            try:
                sess2 = _make_session()
                info = yf.Ticker(sym, session=sess2).info
                out['tests']['info_with_session'] = {
                    'ok': bool(info.get('currentPrice') or info.get('regularMarketPrice')),
                    'price': info.get('currentPrice') or info.get('regularMarketPrice'),
                }
            except Exception as e:
                out['tests']['info_with_session'] = {'error': f'{type(e).__name__}: {e}'}

            return out

        else:
            return {'error': f'action desconocida: {action}'}
