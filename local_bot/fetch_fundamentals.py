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
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

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


def fetch_one(sym, sector=None):
    """Trae quote + los 9 ratios fundamentales en 1 sola llamada .info.
    A diferencia de Vercel, acá NO hace falta pasar session= con headers
    de browser — tu IP residencial no está bloqueada por Yahoo."""
    try:
        info = yf.Ticker(sym).info
        price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
        prev  = info.get('previousClose') or info.get('regularMarketPreviousClose') or price
        pct   = round((price - prev) / prev * 100, 4) if prev else 0
        de    = info.get('debtToEquity')
        roe   = info.get('returnOnEquity')
        margin= info.get('profitMargins')
        roa   = info.get('returnOnAssets')
        rev_g = info.get('revenueGrowth')
        return {
            'symbol':       sym,
            'name':         info.get('shortName') or sym,
            'sector':       sector,
            'price':        price,
            'changePercent':pct,
            'marketCap':    info.get('marketCap') or 0,
            'pe':           info.get('trailingPE'),
            'pb':           info.get('priceToBook'),
            'roe':          roe * 100 if roe is not None else None,
            'de':           abs(de / 100) if de is not None else None,
            'evEbitda':     info.get('enterpriseToEbitda'),
            'netMargin':    margin * 100 if margin is not None else None,
            'roa':          roa * 100 if roa is not None else None,
            'revGrowth':    rev_g * 100 if rev_g is not None else None,
            'priceToSales': info.get('priceToSalesTrailing12Months'),
        }
    except Exception as e:
        print(f'  ⚠️  {sym}: {type(e).__name__}: {e}')
        return None


def main():
    print('📡 Trayendo lista S&P 500 desde Wikipedia...')
    constituents = fetch_sp500_list()
    print(f'   {len(constituents)} empresas encontradas.\n')

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

    print(f'\n✅ Listo: {len(results)}/{total} empresas guardadas en')
    print(f'   {out_path}')
    if failed:
        print(f'   ({len(failed)} fallaron: {", ".join(failed[:20])}'
              f'{"..." if len(failed) > 20 else ""})')
    print('\nAhora corré:')
    print('   git add public/data/sp500_fundamentals.json')
    print('   git commit -m "chore: actualizar snapshot de fundamentales"')
    print('   git push')


if __name__ == '__main__':
    main()
