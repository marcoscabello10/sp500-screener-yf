#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Validador del universo de CEDEARs del INFORME
=============================================

NO TOCA EL SCREENER. No lee ni escribe ningun archivo del screener. Lo unico
que hace es preguntarle a Yahoo, por cada CEDEAR de la lista, si el simbolo
existe y si trae los fundamentales que el informe necesita.

Por que un paso previo y no bajarlos directo
--------------------------------------------
De los 174 codigos de la lista, 37 ya sabemos que no entran (deslistados,
ETFs, duplicados). De los 137 que quedan, algunos son ADR OTC o GDR de
Londres: existen, pero puede que Yahoo no traiga P/E, ROE o margenes. Un papel
sin esos campos entra al informe con todos los bloques en blanco y queda peor
que no estar. Este script lo dice ANTES de bajar nada pesado.

Uso
---
    cd local_bot
    python validar_cedears.py              # valida los 137
    python validar_cedears.py --rapido     # solo precio/sector, sin fundamentals
    python validar_cedears.py AGRO TX WB   # valida simbolos sueltos

Salida
------
    local_bot/cedears_validacion.json   <- el detalle, por si hay que revisarlo
    local_bot/cedears_ok.txt            <- la lista final, lista para el bot

Tarda ~5 minutos. Es una vez, no todos los dias.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cedears_informe import universo, EXCLUIDOS  # noqa: E402

# Las seis metricas con las que el informe puntua. Si faltan mas de tres, el
# papel no puede compararse contra su sector y el informe sale vacio.
METRICAS = ('trailingPE', 'priceToBook', 'returnOnEquity', 'debtToEquity',
            'enterpriseToEbitda', 'profitMargins')

MIN_METRICAS = 3          # menos que esto -> el papel no puntua
MIN_MARKETCAP = 3e8       # 300 M USD: por debajo el CEDEAR casi no opera


def probar(sym):
    """Devuelve (ok, detalle). Nunca lanza: un simbolo roto no puede cortar
    la corrida de los otros 136."""
    d = {'symbol': sym}
    try:
        info = yf.Ticker(sym).info or {}
    except Exception as e:
        d['estado'] = 'ERROR'
        d['motivo'] = f'{type(e).__name__}: {e}'
        return False, d

    d['quoteType'] = info.get('quoteType')
    d['name'] = info.get('shortName') or info.get('longName')
    d['sector'] = info.get('sector')
    d['currency'] = info.get('currency')
    d['exchange'] = info.get('fullExchangeName') or info.get('exchange')
    d['price'] = info.get('currentPrice') or info.get('regularMarketPrice')
    d['marketCap'] = info.get('marketCap')
    d['analistas'] = info.get('numberOfAnalystOpinions')
    presentes = [m for m in METRICAS if info.get(m) is not None]
    d['metricas'] = presentes
    d['nMetricas'] = len(presentes)

    if not d['price']:
        d['estado'] = 'SIN_PRECIO'
        d['motivo'] = 'Yahoo no devuelve cotizacion: el simbolo no existe o dejo de operar'
        return False, d
    if d['quoteType'] and d['quoteType'] != 'EQUITY':
        d['estado'] = 'NO_ES_ACCION'
        d['motivo'] = f'quoteType={d["quoteType"]} (ETF, fondo o indice): no tiene fundamentals'
        return False, d
    if not d['sector']:
        d['estado'] = 'SIN_SECTOR'
        d['motivo'] = 'sin sector no se puede comparar contra pares; el informe queda en blanco'
        return False, d
    if d['nMetricas'] < MIN_METRICAS:
        d['estado'] = 'POCOS_FUNDAMENTALS'
        d['motivo'] = (f'solo {d["nMetricas"]} de {len(METRICAS)} metricas '
                       f'({", ".join(presentes) or "ninguna"})')
        return False, d

    d['estado'] = 'OK'
    avisos = []
    if not d['marketCap'] or d['marketCap'] < MIN_MARKETCAP:
        avisos.append('capitalizacion chica')
    if not d['analistas']:
        avisos.append('sin cobertura de analistas: no habra precio objetivo ni consenso')
    if d['currency'] and d['currency'] != 'USD':
        avisos.append(f'cotiza en {d["currency"]}: los multiplos igual son ratios, '
                      f'pero el precio no es comparable en pantalla')
    d['avisos'] = avisos
    return True, d


def main():
    args = [a.upper() for a in sys.argv[1:] if not a.startswith('--')]
    rapido = '--rapido' in sys.argv

    base = Path(__file__).resolve().parent
    if args:
        candidatos = {a: [a] for a in args}
    else:
        candidatos = universo()

    print(f'yfinance {yf.__version__}')
    print(f'A validar: {len(candidatos)} CEDEARs '
          f'({sum(len(v) for v in candidatos.values())} simbolos como maximo)')
    print(f'Ya excluidos de entrada: {len(EXCLUIDOS)}\n')

    resueltos, fallidos, detalle = {}, {}, {}
    t0 = time.time()
    for i, (clave, cands) in enumerate(sorted(candidatos.items()), 1):
        print(f'  [{i}/{len(candidatos)}] {clave:6s}', end=' ', flush=True)
        ultimo = None
        for sym in cands:
            ok, d = probar(sym)
            ultimo = d
            detalle.setdefault(clave, []).append(d)
            if ok:
                resueltos[clave] = sym
                extra = f'  ({", ".join(d["avisos"])})' if d.get('avisos') else ''
                print(f'-> {sym:8s} OK  {d["sector"] or "?":24s}{extra}')
                break
            time.sleep(0.25)
        else:
            fallidos[clave] = ultimo or {'estado': 'ERROR', 'motivo': 'sin respuesta'}
            print(f'-> {fallidos[clave].get("estado")}: {fallidos[clave].get("motivo")}')
        time.sleep(0.25)
        if rapido:
            continue

    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'yfinance': yf.__version__,
        'resueltos': resueltos,
        'fallidos': {k: {'estado': v.get('estado'), 'motivo': v.get('motivo')}
                     for k, v in fallidos.items()},
        'excluidos_de_entrada': EXCLUIDOS,
        'detalle': detalle,
    }
    (base / 'cedears_validacion.json').write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')
    (base / 'cedears_ok.txt').write_text(
        '\n'.join(sorted(set(resueltos.values()))) + '\n', encoding='utf-8')

    print(f'\n{"=" * 68}')
    print(f'  SIRVEN   : {len(resueltos)}')
    print(f'  NO SIRVEN: {len(fallidos)}')
    if fallidos:
        for k, v in sorted(fallidos.items()):
            print(f'     {k:6s} {v.get("estado"):18s} {v.get("motivo")}')
    sin_analistas = [k for k, v in detalle.items()
                     if k in resueltos and not v[-1].get('analistas')]
    if sin_analistas:
        print(f'\n  Sirven pero SIN analistas ({len(sin_analistas)}): no van a tener '
              f'precio objetivo ni consenso.\n     {" ".join(sorted(sin_analistas))}')
    print(f'\n  {time.time() - t0:.0f}s')
    print(f'\n  Escribi local_bot/cedears_ok.txt con los {len(set(resueltos.values()))} '
          f'simbolos que sirven.')
    print('  Siguiente paso:  python fetch_informe.py --cedears-extra --dias 7')


if __name__ == '__main__':
    main()
