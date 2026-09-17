#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba del SNAPSHOT DEL INFORME (public/data/informe_detalle.json) y de la poda
que lo mantiene limpio (local_bot/fetch_informe.py).

POR QUE EXISTE ESTE ARCHIVO
---------------------------
`fetch_informe.py` ACUMULA: lo que entro una vez se queda para siempre aunque
nadie lo vuelva a pedir. Eso es deliberado y es util —no hay que rebajar 326
papeles cada vez— pero tiene un costado que no estaba cubierto: acumula tambien
los errores.

El 14/09/2026 se corrio

    python fetch_informe.py # --- cartera propia (F5) --- ...

y la shell paso las PALABRAS DEL COMENTARIO como tickers. Quedaron guardados
`#`, `AHORA`, `ENTRA` y `ECOGAS` con precio 0 y sin sector, mas `SI` (Shoulder
Innovations, una empresa real que nadie pidio). Viajaron tres dias adentro de
los 2,5 MB que se sirven a produccion sin que nadie los notara, porque no
rompen nada: solo estan.

Un archivo que crece solo necesita una prueba que mire QUE hay adentro, no solo
que el JSON parsee.

Correr:  python test/test_snapshot_informe.py
"""
import importlib.util
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / 'public' / 'data'

spec = importlib.util.spec_from_file_location(
    'fi', str(RAIZ / 'local_bot' / 'fetch_informe.py'))
FI = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(FI)
except Exception as e:                                   # pragma: no cover
    print(f'[X] no pude importar fetch_informe.py: {type(e).__name__}: {e}')
    print('    (probablemente falte yfinance: pip install -r local_bot/requirements.txt)')
    sys.exit(1)

fallos = []


def chequear(cond, msg):
    if not cond:
        fallos.append(msg)


print('=' * 74)

# ── 1. LA PODA, SOBRE CASOS ARMADOS ──────────────────────────────────────────
# Las tres condiciones tienen que darse JUNTAS. Cada una sola deja pasar cosas
# legitimas, y este bloque es el que lo demuestra.
casos = {
    # los cuatro reales del 14/09: Yahoo devolvio el simbolo como nombre
    '#':      {'name': '#',      'price': 0,    'sector': None},
    'AHORA':  {'name': 'AHORA',  'price': 0,    'sector': None},
    'ENTRA':  {'name': 'ENTRA',  'price': 0,    'sector': None},
    'ECOGAS': {'name': 'ECOGAS', 'price': 0,    'sector': None},
    # ── los que NO se pueden tocar ──
    # SPY no tiene sector (es un ETF) y es el benchmark de F2/F3/F4.
    'SPY':    {'name': 'State Street SPDR S&P 500 ETF T', 'price': 759.96, 'sector': None},
    # un papel real, con sector
    'AAPL':   {'name': 'Apple Inc.', 'price': 230.0, 'sector': 'Technology'},
    # sin sector y sin precio, PERO con nombre propio: Yahoo lo encontro
    'RARO':   {'name': 'Una Empresa Rara SA', 'price': 0, 'sector': None},
    # sin sector y con nombre = simbolo, PERO con precio: tampoco es fantasma
    'CONP':   {'name': 'CONP', 'price': 12.5, 'sector': None},
}
copia = dict(casos)
sacados = FI.sacar_fantasmas(copia)
chequear(sacados == ['#', 'AHORA', 'ECOGAS', 'ENTRA'],
         f'la poda no saco exactamente los cuatro fantasmas: {sacados}')
chequear('SPY' in copia,
         'la poda se llevo SPY: es un ETF sin sector, pero es el benchmark de '
         'F2/F3/F4 y sin el esas tres fases no tienen contra que comparar')
chequear('RARO' in copia,
         'la poda se llevo un papel sin sector y sin precio pero CON nombre '
         'propio: Yahoo lo encontro, no es un fantasma')
chequear('CONP' in copia,
         'la poda se llevo un papel con precio: tener precio ya prueba que el '
         'simbolo existe')
chequear('AAPL' in copia, 'la poda se llevo un papel normal')
chequear(FI.sacar_fantasmas({}) == [], 'la poda no aguanta un dict vacio')
chequear(not FI.es_fantasma('X', None), 'es_fantasma no aguanta un activo nulo')
print(f'  la poda             -> saca los 4 fantasmas, deja SPY y los 3 limites')

# ── 2. EL ARCHIVO QUE SE SIRVE ───────────────────────────────────────────────
p = DATA / 'informe_detalle.json'
if not p.exists():
    print(f'  [X] no encuentro {p}')
    print('      corre:  1-actualizar-datos.bat')
    sys.exit(1)

d = json.loads(p.read_text(encoding='utf-8'))
A = d.get('activos', {})

chequear(A, 'el snapshot no tiene activos')
chequear(d.get('count') == len(A),
         f'count dice {d.get("count")} y hay {len(A)} activos')

# LA REGRESION: ningun fantasma puede estar en el archivo que se sirve.
vivos = sorted(t for t, a in A.items() if FI.es_fantasma(t, a))
chequear(not vivos,
         f'hay {len(vivos)} entradas fantasma en el snapshot que se sirve a '
         f'produccion: {vivos}. Corre fetch_informe.py, que ahora las poda.')

# Y ninguno de los cinco concretos del 14/09.
for t in ('#', 'AHORA', 'ENTRA', 'ECOGAS', 'SI'):
    chequear(t not in A, f'{t!r} volvio a entrar al snapshot')
print(f'  el snapshot         -> {len(A)} activos, ningun fantasma')

# ── 3. EL DICCIONARIO DE CODIGOS LOCALES VIAJA EN EL DATO ───────────────────
# Sin esto, un Excel con "YPFD" o "IRSA" no encuentra el papel — en silencio,
# que es lo peor. Ya paso: la funcion existia y el dato no, porque el bot se
# habia corrido antes de que se agregara la linea.
al = d.get('alias_locales')
chequear(isinstance(al, dict) and al,
         'alias_locales no esta en el snapshot: un Excel con codigos de BYMA '
         'no va a encontrar el papel, y no va a dar error')
if isinstance(al, dict):
    for local, adr in (('IRSA', 'IRS'), ('YPFD', 'YPF'), ('PAMP', 'PAM'),
                       ('TGSU2', 'TGS'), ('TECO2', 'TEO'), ('CRES', 'CRESY')):
        chequear(al.get(local) == adr,
                 f'alias_locales[{local!r}] deberia ser {adr!r}, es {al.get(local)!r}')
    # Y el destino de cada alias tiene que existir en el snapshot, o el alias
    # resuelve a un papel que no esta.
    huerfanos = sorted(v for v in al.values() if v not in A)
    chequear(not huerfanos,
             f'estos alias apuntan a papeles que no estan en el snapshot: {huerfanos}')
print(f'  alias_locales       -> {len(al or {})} entradas, todas apuntan a un papel real')

# ── 4. LOS PAPELES QUE COSTO TRABAJO METER ──────────────────────────────────
# Si una corrida futura los pierde, que se entere esta prueba y no el cliente.
faltan = [t for t in (
    'ECOG', 'IRS', 'YPF', 'PAM', 'TGS', 'TEO', 'CRESY', 'GGAL', 'BMA', 'SUPV',
    'LOMA', 'EDN', 'CEPU', 'BBAR', 'TS', 'CAAP', 'VIST',      # Argentina
    'ITUB', 'NU',                                              # LATAM
    'GEV', 'DELL', 'SKHY', 'TLN', 'NTRA',                      # CEDEAR nuevos
) if t not in A]
chequear(not faltan, f'papeles que estaban y ya no estan: {faltan}')
print(f'  papeles clave       -> los 24 siguen adentro')

# ── 5. FRESCURA ─────────────────────────────────────────────────────────────
# No falla la suite: avisa. Que el snapshot este viejo es una decision de
# Marcos (correr o no el bot), no un error del codigo.
from datetime import datetime, timezone
edades = []
for t, a in A.items():
    try:
        f = datetime.fromisoformat(a['fetched_at'])
        if f.tzinfo is None:
            f = f.replace(tzinfo=timezone.utc)
        edades.append((datetime.now(timezone.utc) - f).days)
    except Exception:
        pass
if edades:
    edades.sort()
    viejos = sum(1 for e in edades if e > 7)
    print(f'  frescura            -> mediana {edades[len(edades)//2]} dias, '
          f'el mas viejo {edades[-1]}')
    if viejos:
        print(f'                         [aviso] {viejos} papeles con mas de 7 dias. '
              f'Corre: 1-actualizar-datos.bat')

print('=' * 74)
if fallos:
    print(f'  {len(fallos)} FALLAS:')
    for f in fallos:
        print(f'    - {f}')
    sys.exit(1)
print('  La poda saca solo lo que Yahoo nunca resolvio, el snapshot no tiene')
print('  fantasmas, los codigos de BYMA viajan en el dato y los papeles que')
print('  costo meter siguen adentro.')
print('  OK')
