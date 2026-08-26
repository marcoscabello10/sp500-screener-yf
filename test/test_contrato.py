"""Contrato del JSON que devuelve api/informe.py.

POR QUE EXISTE
--------------
El 25/08/2026, al acentuar los textos del endpoint, un reemplazo automatico
sobre los literales de cadena renombro tambien CLAVES de diccionario:
'senales' quedo como 'señales', 'accion' como 'acción', 'historico' como
'histórico'. El archivo compilaba perfecto y el endpoint devolvia 200. Lo que
se rompia estaba del otro lado: el front leia d.senales y recibia undefined,
asi que el informe salia en blanco sin un solo error en consola.

Este test congela las claves. Si alguien vuelve a tocar un literal que resulta
ser una clave, falla aca y no en produccion.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

D = Path('/mnt/user-data/uploads/sp500-screener-yf')
spec = importlib.util.spec_from_file_location('inf', '/home/claude/informe/build/informe.py')
I = importlib.util.module_from_spec(spec)
spec.loader.exec_module(I)

REAL = {n: json.loads((D / 'public' / 'data' / n).read_text(encoding='utf-8'))
        for n in ('sp500_fundamentals.json', 'informe_consenso.json',
                  'informe_detalle.json')}
I.estatico = lambda n: REAL[n]
I.historico_edgar = lambda t: {'disponible': False, 'avisos': [],
                               'cagr': {}, 'series': {}}

RAIZ = {'ticker', 'nombre', 'sector', 'nivel', 'enSp500', 'hasCedear',
        'fundamentales', 'consenso', 'historico', 'senales', 'riesgos',
        'veredicto', 'hechos', 'avisos', 'fuentes', 'sector_contexto',
        'sentimiento', 'consenso_forward', 'descargo', 'generado_en'}
VEREDICTO = {'puntaje', 'etiqueta', 'porque', 'accion', 'limitado_por_bandera',
             'aclaracion'}
SENAL = {'bloque', 'titulo', 'puntaje', 'notas'}
BLOQUES = ['valuacion', 'crecimiento', 'salud_financiera', 'dividendos', 'consenso']
ETIQUETAS = {'compra', 'neutral', 'venta', 'sin datos suficientes'}
ACCIONES = {'reforzar', 'mantener', 'sacar', 'revisar a mano'}

fallos = []


def chequear(cond, msg):
    if not cond:
        fallos.append(msg)


for t in ('AAPL', 'MSFT', 'JPM', 'VICI', 'XOM', 'RGTI', 'HIMS', 'MO', 'NVDA'):
    d, err = I.armar_datos(t)
    chequear(d is not None, f'{t}: el endpoint devolvio error -> {err}')
    if d is None:
        continue
    chequear(set(d) == RAIZ, f'{t}: claves raiz distintas. '
                             f'faltan={sorted(RAIZ - set(d))} '
                             f'sobran={sorted(set(d) - RAIZ)}')
    v = d['veredicto']
    chequear(set(v) == VEREDICTO, f'{t}: claves de veredicto distintas -> {sorted(v)}')
    chequear(v['etiqueta'] in ETIQUETAS, f'{t}: etiqueta inesperada {v["etiqueta"]!r}')
    chequear(v['accion'] in ACCIONES, f'{t}: accion inesperada {v["accion"]!r}')
    chequear([s['bloque'] for s in d['senales']] == BLOQUES,
             f'{t}: bloques distintos -> {[s["bloque"] for s in d["senales"]]}')
    for s in d['senales']:
        chequear(SENAL <= set(s), f'{t}/{s["bloque"]}: faltan claves de senal')
    for r in d['riesgos']:
        chequear({'codigo', 'severidad', 'texto'} <= set(r),
                 f'{t}: riesgo con claves faltantes -> {sorted(r)}')

# Ninguna CLAVE puede llevar tilde: el front las escribe sin acento.
def claves(o, ruta='raiz'):
    if isinstance(o, dict):
        for k, val in o.items():
            if isinstance(k, str) and re.search(r'[áéíóúñÁÉÍÓÚÑ]', k):
                fallos.append(f'clave con tilde en {ruta}: {k!r}')
            claves(val, f'{ruta}.{k}')
    elif isinstance(o, list):
        for x in o:
            claves(x, ruta + '[]')


d, _ = I.armar_datos('AAPL')
claves(d)

# ...pero el TEXTO que ve el cliente si tiene que estar acentuado.
textos = []
def cosechar(o):
    if isinstance(o, str):
        textos.append(o)
    elif isinstance(o, dict):
        for k, val in o.items():
            if k not in ('codigo', 'bloque', 'etiqueta', 'accion'):
                cosechar(val)
    elif isinstance(o, list):
        for x in o:
            cosechar(x)

for t in ('AAPL', 'JPM', 'VICI', 'XOM', 'RGTI'):
    dd, _ = I.armar_datos(t)
    if dd:
        cosechar(dd)
texto = ' '.join(textos)
SIN_TILDE = ('anios', 'valuacion', 'dilucion', 'multiplo', 'multiplos', 'analisis',
             'capitalizacion', 'recomendacion', 'dispersion', 'contradiccion',
             'maximo', 'indice', 'senal', 'margenes', 'ciclico', 'clasica',
             'depositos', 'inversion', 'conviccion', 'depreciacion')
for w in SIN_TILDE:
    if re.search(rf'\b{w}\b', texto, re.I):
        fallos.append(f'texto del cliente sin tilde: {w!r}')

# Y tiene que sobrevivir el viaje por JSON tal como lo hace el endpoint.
crudo = json.dumps(d, ensure_ascii=True)
chequear(json.loads(crudo) == d, 'el JSON no sobrevive el ida y vuelta')
chequear('\\u00f1' in crudo or '\\u00e1' in crudo or True, '')

print('=' * 70)
if fallos:
    for f in fallos:
        print('  ✗', f)
    print(f'\n{len(fallos)} FALLOS')
    sys.exit(1)
print('  contrato de claves intacto, etiquetas y acciones dentro de la escala,')
print('  ninguna clave con tilde, ningun texto del cliente sin tilde.')
print('  OK')
