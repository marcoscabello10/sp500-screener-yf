#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sonda de los CEDEARs que volvieron vacios
=========================================

NO TOCA NINGUN ARCHIVO. Solo pregunta e imprime. Se puede correr las veces que
haga falta.

Por que existe
--------------
Ocho papeles volvieron sin nada de `.info`: BRFS, CAJ, CBD, EBR, ELP, ERJ,
LAAC, ORAN. Se reintentaron y volvieron igual, asi que **no es rate limit**.
Quedan tres explicaciones posibles y hay que distinguirlas antes de decidir:

  a) el ADR se deslisto del NYSE y ahora cotiza OTC con otro simbolo
     (a varios les paso entre 2023 y 2025);
  b) `.info` falla pero el papel opera igual — se ve en fast_info/history;
  c) el simbolo esta mal.

Esta sonda prueba las tres cosas por cada candidato: `.info`, `fast_info` e
`history(5d)`. Si hay precio en history pero .info viene vacio, es (b) y el
papel se puede rescatar. Si no hay precio en ningun lado, es (a) o (c) y hay
que buscar el simbolo nuevo.

Uso
---
    cd local_bot
    python probe_vacios.py                 # los 8 + sus alternativas conocidas
    python probe_vacios.py ERJ ERJ.SA      # los que le pases
"""
import sys
import time

try:
    import yfinance as yf
except ImportError:
    print('[X] Falta yfinance. Instalalo con: pip install "yfinance>=1.4.1"')
    sys.exit(1)

# Cada fila: el simbolo que fallo y los candidatos alternativos a probar.
# Los ADR que dejan el NYSE suelen reaparecer OTC con sufijo Y o F, y siempre
# queda la accion local, que es la fuente de verdad aunque cotice en otra moneda.
CANDIDATOS = {
    'BRFS': ['BRFS', 'BRFS3.SA'],                  # BRF SA
    'CAJ':  ['CAJ', 'CAJPY', 'CAJFY', '7751.T'],   # Canon
    'CBD':  ['CBD', 'CBDBY', 'PCAR3.SA'],          # Cia Brasileira de Distribuicao
    'EBR':  ['EBR', 'ELET3.SA'],                   # Eletrobras
    'ELP':  ['ELP', 'CPLE6.SA'],                   # Copel
    'ERJ':  ['ERJ', 'EMBR3.SA'],                   # Embraer
    'LAAC': ['LAAC', 'LAAC.TO'],                   # Lithium Americas (Argentina)
    'ORAN': ['ORAN', 'ORANY', 'ORA.PA'],           # Orange SA
}

CAMPOS = ('shortName', 'sector', 'currentPrice', 'regularMarketPrice',
          'marketCap', 'trailingPE', 'quoteType', 'currency', 'exchange')


def sondear(sym):
    """Devuelve (veredicto, detalle). Nunca lanza."""
    d = {'symbol': sym}

    # 1. .info
    try:
        info = yf.Ticker(sym).info or {}
    except Exception as e:
        info = {}
        d['info_error'] = f'{type(e).__name__}: {e}'
    d['info'] = {k: info.get(k) for k in CAMPOS if info.get(k) is not None}
    d['n_info'] = len(info)

    # 2. fast_info — otro endpoint, a veces responde cuando .info no
    try:
        fi = yf.Ticker(sym).fast_info
        d['fast_price'] = getattr(fi, 'last_price', None)
        d['fast_mcap'] = getattr(fi, 'market_cap', None)
        d['fast_currency'] = getattr(fi, 'currency', None)
    except Exception as e:
        d['fast_error'] = f'{type(e).__name__}: {e}'

    # 3. history — la prueba definitiva de si el papel opera
    try:
        h = yf.Ticker(sym).history(period='5d')
        d['dias_historia'] = 0 if h is None or h.empty else len(h)
        d['ultimo_cierre'] = None if not d['dias_historia'] else round(float(h['Close'].iloc[-1]), 4)
    except Exception as e:
        d['dias_historia'] = 0
        d['hist_error'] = f'{type(e).__name__}: {e}'

    opera = bool(d.get('fast_price') or d.get('dias_historia'))
    completo = bool(d['info'].get('sector') and
                    (d['info'].get('currentPrice') or d['info'].get('regularMarketPrice')))
    if completo:
        return 'SIRVE', d
    if opera:
        return 'OPERA_SIN_INFO', d
    return 'NO_OPERA', d


def main():
    args = [a.upper() for a in sys.argv[1:]]
    grupos = {a: [a] for a in args} if args else CANDIDATOS

    print(f'yfinance {yf.__version__}')
    print('Sonda de los que volvieron vacios. NO escribe ningun archivo.\n')

    ganadores, sin_suerte = {}, []
    for clave, cands in grupos.items():
        print(f'{clave}')
        elegido = None
        for sym in cands:
            veredicto, d = sondear(sym)
            campos = d['info']
            resumen = (f'{campos.get("shortName") or "?":28.28s} '
                       f'sector={str(campos.get("sector") or "—"):22.22s} '
                       f'precio={campos.get("currentPrice") or campos.get("regularMarketPrice") or "—"}')
            print(f'   {sym:10s} {veredicto:16s} .info={d["n_info"]:3d} campos  '
                  f'hist={d.get("dias_historia", 0)}d  fast={d.get("fast_price")}')
            if d['n_info'] > 3:
                print(f'              {resumen}')
            if veredicto == 'SIRVE' and elegido is None:
                elegido = sym
            time.sleep(0.6)
        if elegido:
            ganadores[clave] = elegido
            print(f'   -> USAR {elegido}\n')
        else:
            sin_suerte.append(clave)
            print('   -> ninguno sirve\n')

    print('=' * 60)
    if ganadores:
        print('REEMPLAZOS ENCONTRADOS (pasarselos a Claude para actualizar')
        print('cedears_informe.py, y despues bajarlos con fetch_informe.py):')
        for k, v in sorted(ganadores.items()):
            print(f'   {k:6s} -> {v}')
        print()
        print('   ' + ' '.join(sorted(ganadores.values())))
    if sin_suerte:
        print(f'\nSIN SOLUCION ({len(sin_suerte)}): {" ".join(sorted(sin_suerte))}')
        print('   Estos van a EXCLUIDOS con el motivo que corresponda.')


if __name__ == '__main__':
    main()
