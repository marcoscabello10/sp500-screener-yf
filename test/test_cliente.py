#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba de la SEGUNDA LLAMADA (action=tesis_cliente): el texto para el cliente.

Por que existe una llamada aparte, en una linea: pedirle al mismo turno que
decida en jerga y despues escriba en castellano llano daba siempre lo mismo —un
resumen del analisis con la jerga tapada—, y ademas el modo profundo se comia
los 60 segundos de Vercel.

Lo que se verifica aca, sin gastar un solo token:

  1. Que la segunda llamada NO pueda ocurrir sin la primera. Es lo unico que
     garantiza que el texto entregado corresponda a la decision tomada.
  2. Que use SIEMPRE el modelo rapido, aunque la decision se haya pedido en
     profundo: redactar no necesita el modelo caro, y esa es la mitad del
     ahorro de partirlo en dos.
  3. Que los dos bloques de reglas sean CACHES DISTINTOS y no se pisen.
  4. Que el recorte de la seccion 3 saque solo las lineas de "mantener" y
     nunca los parrafos ampliados.
  5. Que la validacion encuentre lo que un texto para cliente no puede tener:
     tickers, jerga, vinetas y promesas.
  6. Que elegir un proveedor no toque al otro, igual que en todo el proyecto.

Correr:  python test/test_cliente.py
"""
import importlib.util
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('inf', str(RAIZ / 'api' / 'informe.py'))
I = importlib.util.module_from_spec(spec)
spec.loader.exec_module(I)

LLAMADAS = []
RESPUESTA = {'texto': 'Estuve revisando la cartera y el resultado fue bueno.'}

DECISION = """## 1. Qué hacer
Recortar AAPL por toma de ganancia y llevar el excedente a KO.

## 2. Cómo está la cartera
Technology pesa 41% contra un tope de 35%.

## 3. Posición por posición
AAPL · 14,2% → 10,0% · aporta 31% del riesgo · RECORTAR · toma de ganancia · alta
Es la posición más grande y la que más riesgo aporta. El recorte no es una
opinión sobre la empresa.
KO · 6,1% → 8,0% · aporta 3% del riesgo · mantener · posición correcta · alta
MO · 5,0% → 5,0% · aporta 2% del riesgo · mantener · posición correcta · alta
PG · 4,8% → 4,8% · aporta 2% del riesgo · mantener · posición correcta · media

## 4. Rotaciones
Ninguna que valga la pena todavía."""

HECHOS = {
    'perfil': 'moderado',
    'nombres': {'AAPL': 'Apple', 'KO': 'Coca-Cola', 'MO': 'Altria',
                'PG': 'Procter & Gamble'},
    'volatilidad_antes_pct': 19.9,
    'volatilidad_despues_pct': 15.3,
    'pendiente': ['La cartera tiene 100% en acciones y para este perfil '
                  'corresponde hasta 70%.'],
}


def falso_post(url, headers, cuerpo, timeout=None):
    LLAMADAS.append({'url': url, 'headers': dict(headers), 'cuerpo': cuerpo,
                     'timeout': timeout})
    texto = RESPUESTA['texto']
    if 'anthropic' in url:
        if texto == '':
            return {'content': [], 'stop_reason': 'max_tokens',
                    'model': 'claude-haiku-4-5',
                    'usage': {'input_tokens': 1400, 'output_tokens': 900}}
        return {'content': [{'type': 'text', 'text': texto}],
                'usage': {'input_tokens': 1400, 'output_tokens': 480,
                          'cache_read_input_tokens': 660}}
    return {'choices': [{'message': {'content': texto}}],
            'usage': {'prompt_tokens': 1400, 'completion_tokens': 480,
                      'prompt_tokens_details': {'cached_tokens': 660}}}


I._post_json = falso_post

fallos = []


def chequear(cond, msg):
    if not cond:
        fallos.append(msg)


def limpiar(**env):
    LLAMADAS.clear()
    for k in ('ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
              'MODELO_ANTHROPIC', 'MODELO_OPENAI'):
        I.os.environ.pop(k, None)
    I.os.environ.update(env)


print('=' * 74)

# ── 1. Sin decision no hay texto, y no se llama a nadie ────────────────────
# Es LA regla de esta capa. Un texto para el cliente generado sin la decision
# seria una redaccion linda de algo que nadie decidio.
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
r, e = I.generar_tesis_cliente({'hechos': HECHOS}, 'anthropic')
chequear(r is None and not LLAMADAS,
         'sin el texto de la decision NO se puede llamar a nadie')
chequear(e and 'decision' in e.lower(), f'el error no explica que falta -> {e}')

limpiar(ANTHROPIC_API_KEY='sk-ant-x')
r, e = I.generar_tesis_cliente({'decision': '   '}, 'anthropic')
chequear(r is None and not LLAMADAS, 'una decision en blanco NO deberia gastar')

limpiar(ANTHROPIC_API_KEY='sk-ant-x')
r, e = I.generar_tesis_cliente(
    {'decision': 'x' * (I.MAX_CHARS_DECISION + 1)}, 'anthropic')
chequear(r is None and not LLAMADAS,
         'una decision gigante tiene que cortarse ANTES de pagarla')

limpiar()   # sin ninguna clave
r, e = I.generar_tesis_cliente({'decision': DECISION}, 'anthropic')
chequear(r is None and not LLAMADAS, 'sin clave no se llama a nadie')
print('  gasto controlado    -> sin decision, sin clave y decision gigante '
      'no llaman a nadie')

# ── 2. Un proveedor NO toca al otro ────────────────────────────────────────
# La regla que Marcos puso desde el principio: "si elijo openai no use tokens
# de anthropic o viceversa".
limpiar(OPENAI_API_KEY='sk-oa-x')
r, e = I.generar_tesis_cliente({'decision': DECISION, 'hechos': HECHOS},
                               'anthropic')
chequear(r is None and not LLAMADAS,
         'con clave de OpenAI cargada, pedir Anthropic NO puede llamar a nadie')
limpiar(OPENAI_API_KEY='sk-oa-x')
r, e = I.generar_tesis_cliente({'decision': DECISION, 'hechos': HECHOS},
                               'openai')
chequear(e is None and len(LLAMADAS) == 1 and 'openai' in LLAMADAS[0]['url'],
         f'la llamada a OpenAI no salio -> {e}')
print('  dos proveedores     -> elegir uno nunca toca al otro')

# ── 3. SIEMPRE el modelo rapido ────────────────────────────────────────────
# Es la mitad del ahorro de partir la llamada en dos. La otra mitad es no
# volver a pagar la decision cada vez que se reescribe el texto.
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
r, e = I.generar_tesis_cliente({'decision': DECISION, 'hechos': HECHOS},
                               'anthropic')
chequear(e is None, f'la llamada base deberia andar -> {e}')
chequear(r['modelo'] == I.MODELOS_CARTERA['rapido']['anthropic'],
         f'la segunda llamada no usa el modelo rapido: {r["modelo"]}')
rapido, profundo = (I.PRECIOS.get(I.MODELOS_CARTERA[m]['anthropic'])
                    for m in ('rapido', 'profundo'))
chequear(rapido[1] < profundo[1],
         'el modelo rapido tendria que ser mas barato: revisar PRECIOS')
print(f'  modelo              -> {r["modelo"]} siempre, aunque la decision '
      f'se haya pedido en profundo')

# ── 4. Dos caches distintos, que no se pisan ───────────────────────────────
# Si los dos prompts compartieran bloque, tocar el del cliente invalidaria el
# de la decision y viceversa: cada retoque de redaccion costaria una decision
# entera a precio de primera vez.
cuerpo = LLAMADAS[-1]['cuerpo']
chequear(isinstance(cuerpo.get('system'), list),
         'el system del cliente tiene que ser lista de bloques para cachearse')
chequear(cuerpo['system'][0].get('cache_control', {}).get('type') == 'ephemeral',
         'al prompt del cliente le falta cache_control: se paga entero siempre')
chequear(cuerpo['system'][0]['text'] == I.SISTEMA_CLIENTE,
         'el bloque cacheado no es el prompt del cliente')
chequear(I.SISTEMA_CLIENTE != I.SISTEMA_CARTERA,
         'los dos prompts son el mismo bloque: tocar uno invalida el otro')
chequear('ZZ' not in cuerpo['system'][0]['text'],
         'hay datos variables dentro del bloque cacheado')
# El pensamiento extendido, apagado tambien aca: el tope de salida es chico y
# ya nos costo dos llamadas cobradas sin una linea de texto.
chequear(cuerpo.get('thinking', {}).get('type') == 'disabled',
         'el pensamiento extendido no esta apagado: se come el tope de salida')
chequear(cuerpo['max_tokens'] == I.MAX_TOKENS_CLIENTE,
         'el tope de salida del texto del cliente no es el suyo')
print(f'  caches              -> dos bloques separados '
      f'({len(I.SISTEMA_CARTERA) // 4} + {len(I.SISTEMA_CLIENTE) // 4} tokens)')

# ── 5. La decision y los hechos VIAJAN, y viajan en el mensaje ─────────────
usuario = cuerpo['messages'][0]['content']
chequear('Recortar AAPL' in usuario, 'la decision no llego al modelo')
chequear('Coca-Cola' in usuario,
         'el diccionario de nombres no llego: el texto va a salir en tickers')
chequear('15.3' in usuario or '15,3' in usuario,
         'los numeros de volatilidad no llegaron')
chequear('acciones' in usuario,
         'lo que queda pendiente no llego: el texto va a decir que la cartera '
         'quedo adaptada al perfil cuando no lo esta')

# ── 6. El recorte de la seccion 3 ──────────────────────────────────────────
# Las lineas de "mantener" son la constancia de que se miro todo: valen para
# la decision y no valen nada para el cliente, que tiene prohibido hablar
# posicion por posicion.
recortada = I._recortar_decision(DECISION)
chequear('KO · 6,1%' not in recortada,
         'la linea de "mantener" de KO sigue viajando')
chequear('MO · 5,0%' not in recortada and 'PG · 4,8%' not in recortada,
         'quedaron lineas de "mantener"')
chequear('AAPL · 14,2%' in recortada,
         'SE BORRO UNA LINEA ACCIONABLE: el recorte se comio la decision')
chequear('El recorte no es una' in recortada,
         'se borro un parrafo ampliado, que es donde esta el porque')
chequear('## 4. Rotaciones' in recortada and 'Technology pesa 41%' in recortada,
         'el recorte toco secciones que no eran la 3')
ahorro = (len(DECISION) - len(recortada)) // 4
chequear(ahorro > 0, 'el recorte no ahorro nada')
# Y es conservador: sin los titulos, no toca nada.
chequear(I._recortar_decision('texto suelto sin secciones · mantener')
         == 'texto suelto sin secciones · mantener',
         'sin los titulos de seccion el recorte igual borro algo')
chequear(I._recortar_decision('') == '' and I._recortar_decision(None) is None,
         'el recorte no aguanta un texto vacio')
print(f'  recorte seccion 3   -> {ahorro} tokens menos, sin tocar lo accionable')

# ── 7. La validacion: lo que un texto para cliente NO puede tener ──────────
avisos = I.validar_respuesta_cliente(
    'Proponemos recortar Apple y reforzar Coca-Cola. La cartera queda en '
    '15,3% en vez de 19,9%, un recorrido menos brusco. Sigue teniendo mas '
    'acciones de las que corresponden al perfil.', HECHOS)
chequear(not avisos, f'un texto bien escrito no deberia tener avisos -> {avisos}')

av = I.validar_respuesta_cliente('Proponemos recortar AAPL y comprar KO. '
                                 'Sigue con mas acciones de las que van.', HECHOS)
chequear(any('AAPL' in a for a in av), f'no detecto los tickers -> {av}')

av = I.validar_respuesta_cliente('Apple tiene un beta de 1,3 y una correlación '
                                 'alta. Faltan acciones por resolver.', HECHOS)
chequear(any('beta' in a for a in av), f'no detecto la jerga -> {av}')

av = I.validar_respuesta_cliente('- Vender Apple\n- Comprar Coca-Cola', HECHOS)
chequear(any('vinetas' in a.lower() or 'viñetas' in a.lower() for a in av),
         f'no detecto las vinetas -> {av}')

av = I.validar_respuesta_cliente(
    'Con esto la cartera queda sin riesgo y protege la cartera de las caidas. '
    'Quedan acciones por definir.', HECHOS)
chequear(len([a for a in av if 'promesa' in a]) >= 2,
         f'no detecto las promesas -> {av}')

# Lo pendiente NO se puede callar. Es lo que un informe malo esconde.
av = I.validar_respuesta_cliente(
    'Proponemos recortar Apple. Con esto la cartera queda mejor equilibrada '
    'y en linea con lo que buscamos.', HECHOS)
chequear(any('pendiente' in a for a in av),
         f'no avisa que se callo lo que el plan NO resuelve -> {av}')

# Y sin pendiente, no puede inventar el aviso.
av = I.validar_respuesta_cliente('Proponemos recortar Apple y reforzar '
                                 'Coca-Cola.', {'nombres': {}})
chequear(not av, f'inventa avisos sobre un bloque de hechos vacio -> {av}')
print('  validacion          -> tickers, jerga, vinetas, promesas y lo que '
      'se callo')

# ── 8. El estimador de la segunda llamada ─────────────────────────────────
# Es el unico del proyecto que puede ser exacto: la decision YA esta escrita
# cuando se pregunta, asi que se mide en vez de adivinarse.
est = I.estimar_cliente(len(DECISION), 'anthropic')
chequear(est['modelo'] == I.MODELOS_CARTERA['rapido']['anthropic'],
         'el estimador no estima el modelo que se va a usar')
chequear(est['costo_estimado_usd'] > 0, 'el costo estimado no puede ser cero')
chequear(est['costo_primera_vez_usd'] > est['costo_estimado_usd'],
         'la primera vez tiene que costar mas: paga el prompt entero')
chequear(est['segundos_estimados'] < I.TIMEOUT_CARTERA,
         'el texto del cliente no entraria en el tiempo, y es el caso facil')
chequear(I.estimar_cliente(0, 'anthropic')['tokens_estimados']['entrada'] > 0,
         'con 0 caracteres el estimador da 0: no puede, esta el prompt fijo')
grande = I.estimar_cliente(20000, 'anthropic')['costo_estimado_usd']
chequear(grande > est['costo_estimado_usd'],
         'el costo no crece con el largo de la decision')

# ── LA COMPARACION QUE JUSTIFICA TODO ESTO ────────────────────────────────
# Contra la formula de ANTES de partir la llamada, que es la unica comparacion
# honesta: aquella llamada tambien escribia el texto del cliente.
#
#   antes (una llamada, profundo, 15 posiciones):
#       entrada 2270 + 141n = 4385 · salida 1150 + 55n = 1975
#   ahora (dos llamadas):
#       decision  entrada 1250 + 172n = 3830 · salida 700 + 55n = 1525
#       cliente   ~1.900 de entrada · 550 de salida, SIEMPRE en el rapido
PE_P, PS_P = I.PRECIOS[I.MODELOS_CARTERA['profundo']['anthropic']]
antes = round(4385 * PE_P / 1e6 + 1975 * PS_P / 1e6, 5)
decision = I.estimar_cartera(15, 'anthropic', 'profundo')['costo_estimado_usd']
cliente = I.estimar_cliente(len(DECISION), 'anthropic')['costo_estimado_usd']
dos = round(decision + cliente, 5)
chequear(dos < antes,
         f'partir la llamada en dos salio MAS CARO: {antes} -> {dos}')

# Y el ahorro grande no es ese: es reescribir el texto del cliente sin volver
# a pagar la decision. Es el texto que se entrega, o sea el que mas se itera.
tres_versiones_antes = round(antes * 3, 5)
tres_versiones_ahora = round(decision + cliente * 3, 5)
chequear(tres_versiones_ahora < tres_versiones_antes * 0.65,
         f'iterar el texto tres veces tendria que costar menos del 65%: '
         f'{tres_versiones_antes} -> {tres_versiones_ahora}')
print(f'  estimador           -> texto del cliente USD {cliente}')
print(f'  costo (15 pos)      -> antes USD {antes} · ahora USD {dos} '
      f'({round((dos - antes) / antes * 100)}%)')
print(f'  tres versiones      -> antes USD {tres_versiones_antes} · ahora '
      f'USD {tres_versiones_ahora} '
      f'({round((tres_versiones_ahora - tres_versiones_antes) / tres_versiones_antes * 100)}%)')

# ── 9. Una respuesta vacia NO puede decir que no se cobro ─────────────────
limpiar(ANTHROPIC_API_KEY='sk-ant-x')
RESPUESTA['texto'] = ''
r, e = I.generar_tesis_cliente({'decision': DECISION, 'hechos': HECHOS},
                               'anthropic')
chequear(r is None and e and 'se cobro' in e,
         f'una respuesta vacia tiene que decir que la llamada se cobro -> {e}')
RESPUESTA['texto'] = 'Estuve revisando la cartera y el resultado fue bueno.'
print('  respuesta sin texto -> el error no miente sobre el costo')

# ── 10. El endpoint acepta las dos acciones y ninguna mas ─────────────────
chequear('tesis_cliente' in I.__dict__['handler'].do_POST.__doc__,
         'el POST no documenta la accion nueva')
fuente = Path(RAIZ / 'api' / 'informe.py').read_text(encoding='utf-8')
chequear("POST_VALIDAS = ('tesis_cartera', 'tesis_cliente')" in fuente,
         'el POST no acepta las dos acciones')
chequear("'estimar_cliente'" in fuente,
         'falta el GET que estima el costo del segundo boton')
print('  endpoint            -> POST con dos acciones, GET que estima sin gastar')

print('=' * 74)
if fallos:
    print(f'  {len(fallos)} FALLAS:')
    for f in fallos:
        print(f'    - {f}')
    sys.exit(1)
print('  La segunda llamada no puede ocurrir sin la primera, usa siempre el')
print('  modelo rapido, cachea aparte, y la validacion encuentra tickers,')
print('  jerga, promesas y lo que el texto se callo.')
print('  OK')
