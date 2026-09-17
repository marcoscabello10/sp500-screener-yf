#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LA INVARIANTE: EN VERCEL NO SE LLAMA A NADIE EN VIVO (17/09/2026)

Todo dato de mercado entra al proyecto por los bots de `local_bot/`, corriendo
en la PC de Marcos, y viaja al deploy como JSON commiteado. Las funciones de
`api/` sirven lo que ya esta en disco y hablan con Anthropic/OpenAI, nada mas.

POR QUE HACE FALTA UNA PRUEBA Y NO ALCANZA CON EL COMENTARIO
-----------------------------------------------------------
Esto no es una preferencia de estilo: es lo unico que mantiene el bundle de
Python de Vercel en kilobytes. Con yfinance adentro pesaba 227,64 MB, y arriba
de cierto tamaño Vercel mete un paso de "Optimizing Python bundle" que borra
archivos que su propio empaquetador busca despues:

    ENOENT: no such file or directory, lstat
    '.../site-packages/vercel_runtime/_vendor/werkzeug/wrappers/
     __pycache__/__init__.cpython-312.pyc'

Los dos deploys del 17/09 murieron asi, con el mismo error en archivos
DISTINTOS — una condicion de carrera adentro del builder de Vercel.

Un `import pandas` agregado sin pensar, seis meses despues, vuelve a romper el
deploy. Y el sintoma va a estar a tres capas de distancia de la causa: el build
de Vite compila perfecto y el error habla del bytecode de un paquete de Vercel.
Esta prueba corta eso en el momento en que se agrega la linea.

Correr:  python test/test_sin_llamadas_vivo.py
"""
import ast
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
fallos = []


def chequear(cond, msg):
    if not cond:
        fallos.append(msg)


print('=' * 74)

# ── 1. LAS FUNCIONES DE api/ USAN SOLO LA BIBLIOTECA ESTANDAR ───────────────
# Se lee el AST en vez de importar: importar ejecutaria el modulo, y ademas
# fallaria si la dependencia prohibida efectivamente no esta instalada — o sea
# que la prueba pasaria por la razon equivocada.
try:
    ESTANDAR = set(sys.stdlib_module_names)          # Python 3.10+
except AttributeError:                                # pragma: no cover
    print('  [X] hace falta Python 3.10 o mas nuevo para esta prueba')
    sys.exit(1)

api = sorted((RAIZ / 'api').glob('*.py'))
chequear(api, 'no encontre ninguna funcion en api/')

for f in api:
    arbol = ast.parse(f.read_text(encoding='utf-8'), filename=str(f))
    externos = set()
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Import):
            for n in nodo.names:
                externos.add(n.name.split('.')[0])
        elif isinstance(nodo, ast.ImportFrom):
            # `from . import x` no tiene modulo; es relativo y no instala nada
            if nodo.level == 0 and nodo.module:
                externos.add(nodo.module.split('.')[0])
    de_afuera = sorted(m for m in externos if m not in ESTANDAR)
    chequear(not de_afuera,
             f'api/{f.name} importa paquetes de afuera: {de_afuera}. '
             f'Eso vuelve a inflar el bundle de Vercel y a romper el deploy. '
             f'Si el dato se puede sacar del snapshot local, sacalo de ahi.')
    print(f'  api/{f.name:<14} -> {len(externos)} imports, todos de la '
          f'biblioteca estandar')

# ── 2. requirements.txt SIN DEPENDENCIAS ────────────────────────────────────
req = RAIZ / 'requirements.txt'
chequear(req.exists(), 'falta requirements.txt (Vercel lo espera, aunque este vacio)')
if req.exists():
    lineas = [l.strip() for l in req.read_text(encoding='utf-8').splitlines()]
    paquetes = [l for l in lineas if l and not l.startswith('#')]
    chequear(not paquetes,
             f'requirements.txt declara dependencias: {paquetes}. '
             f'Las dos funciones de api/ no necesitan ninguna, y cada una suma '
             f'al bundle que rompe el deploy.')
    print(f'  requirements.txt -> 0 dependencias ({len(lineas)} lineas, todas '
          f'comentario)')

# ── 3. EL FRONT NO PIDE NADA EN VIVO ────────────────────────────────────────
# El screener llegaba a `/api/data` por cuatro caminos distintos. Los cuatro se
# sacaron; esta comprobacion es la que impide que vuelva alguno.
app = RAIZ / 'src' / 'App.jsx'
chequear(app.exists(), 'no encuentro src/App.jsx')
if app.exists():
    src = app.read_text(encoding='utf-8')
    # Solo el CODIGO: los comentarios hablan de `/api/data` justamente para
    # explicar por que ya no se usa, y esta prueba no puede prohibir eso.
    codigo = re.sub(r'//[^\n]*', '', src)
    codigo = re.sub(r'/\*.*?\*/', '', codigo, flags=re.S)

    for patron, explica in (
        (r'["\'`]/api/data',      'una llamada a /api/data'),
        (r'\bhistFetch\s*\(',     'una llamada a histFetch()'),
        (r'\bconst\s+BASE\s*=',   'la constante BASE del proxy'),
        (r'action=quote',         'el action=quote del proxy'),
        (r'action=profile',       'el action=profile del proxy'),
        (r'action=ratios',        'el action=ratios del proxy'),
        (r'action=history',       'el action=history del proxy'),
    ):
        hallado = re.search(patron, codigo)
        chequear(not hallado,
                 f'src/App.jsx volvio a tener {explica}. El screener toma todo '
                 f'del snapshot local: si falta un papel, va a '
                 f'local_bot/tickers_informe.txt.')
    print('  src/App.jsx      -> ningun camino en vivo (4 sitios verificados)')

    # Y lo que SI tiene que estar: el aviso de los que quedan afuera. Sacar las
    # llamadas sin esto seria cambiar un problema por otro — el papel
    # desapareceria igual, solo que mas rapido.
    chequear('sinCobertura' in src,
             'src/App.jsx no tiene el aviso de papeles sin cobertura: sin el, '
             'un papel fuera del snapshot desaparece de la cartera del cliente '
             'sin que nadie lo diga')
    chequear('quedaron' in src and 'tickers_informe.txt' in src,
             'el aviso no explica como incorporar un papel que falta')
    print('  el aviso         -> presente, y dice como incorporar el papel')

# ── 4. LOS BOTS LOCALES NO SE TOCAN ─────────────────────────────────────────
# Es el error simetrico, y seria peor: si alguien "limpia" tambien este
# requirements, los bots dejan de poder bajar datos y el proyecto entero se
# queda sin fuente. Corren en la PC de Marcos, donde el tamaño no importa.
reqLocal = RAIZ / 'local_bot' / 'requirements.txt'
chequear(reqLocal.exists(), 'falta local_bot/requirements.txt')
if reqLocal.exists():
    txt = reqLocal.read_text(encoding='utf-8')
    chequear('yfinance' in txt,
             'local_bot/requirements.txt perdio yfinance. Ese archivo es de los '
             'bots LOCALES y no tiene nada que ver con el bundle de Vercel: sin '
             'yfinance no hay de donde sacar los datos.')
    print('  local_bot/requirements.txt -> intacto, con yfinance')

print('=' * 74)
if fallos:
    print(f'  {len(fallos)} FALLAS:')
    for f in fallos:
        print(f'    - {f}')
    sys.exit(1)
print('  Vercel no llama a nadie en vivo: las funciones usan solo la biblioteca')
print('  estandar, no hay dependencias que instalar, el front no tiene ningun')
print('  camino en vivo, y los que quedan afuera se nombran.')
print('  OK')
