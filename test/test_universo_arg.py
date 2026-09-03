#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba del UNIVERSO OPERABLE (local_bot/cedears_informe.py).

Este archivo es casi todo datos, y por eso mismo necesita prueba: los errores
que se cometen en una lista de tickers no son de logica, son de coherencia, y
no fallan — dan un resultado distinto en silencio. Los tres que ya pasaron:

  · un ticker en DIRECTOS y en EXCLUIDOS a la vez (BK, BNG);
  · un alias que apunta a un simbolo que no es clave del universo (TXR -> TX);
  · un papel que se descarta sin quedar anotado en ningun lado — que es lo
    que la cabecera del archivo promete que no pasa, y pasaba con 16.

Correr:  python test/test_universo_arg.py
"""
import importlib.util
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    'ced', str(RAIZ / 'local_bot' / 'cedears_informe.py'))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)

fallos = []


def chequear(cond, msg):
    if not cond:
        fallos.append(msg)


print('=' * 74)
u = C.universo()

# ── 1. Nadie adentro y afuera a la vez ────────────────────────────────────
choque = sorted(set(u) & set(C.EXCLUIDOS))
chequear(not choque, f'estos tickers entran Y estan excluidos: {choque}')

# Un papel "solo medible" no puede ser tambien un papel normal: seria la misma
# empresa dos veces, en dos monedas, compitiendo entre si por el mismo lugar.
choque2 = sorted(set(u) & set(C.SOLO_MEDIBLES))
chequear(not choque2, f'estos estan como normales Y como solo medibles: {choque2}')
print(f'  universo            -> {len(u)} entran · {len(C.EXCLUIDOS)} excluidos · '
      f'{len(C.SOLO_MEDIBLES)} solo medibles')

# ── 2. Los alias apuntan a algo que existe ────────────────────────────────
# Un alias roto no da error: da "no encontre el papel", que se lee como
# "el cliente escribio cualquier cosa".
huerfanos = sorted(v for v in C.ALIAS_LOCALES.values() if v not in u)
chequear(not huerfanos, f'alias que apuntan a la nada: {huerfanos}')
# Y ninguna clave de alias puede ser tambien un ticker real, o el alias
# secuestraria un papel legitimo.
secuestro = sorted(k for k in C.ALIAS_LOCALES if k in u)
chequear(not secuestro, f'estos alias pisan un ticker real: {secuestro}')
chequear(C.resolver_alias('ypfd') == 'YPF', 'resolver_alias no normaliza a mayusculas')
chequear(C.resolver_alias('AAPL') == 'AAPL', 'resolver_alias rompe lo que no es alias')
chequear(C.resolver_alias(None) == '', 'resolver_alias no aguanta None')

# ── EL SUFIJO DE LA PLAZA ────────────────────────────────────────────────
# Un Excel exportado del broker puede traer `YPFD.BA` en vez de `YPFD`. Si el
# sufijo se sacara DESPUES de buscar el alias, 'YPFD.BA' no encontraria nada y
# el papel se perderia — el sintoma exacto que este modulo evita.
chequear(C.resolver_alias('YPFD.BA') == 'YPF',
         'con el sufijo .BA el alias no resuelve')
chequear(C.resolver_alias('GGAL.BA') == 'GGAL',
         'un papel sin alias no pierde el sufijo .BA')
chequear(C.resolver_alias('ALUA.BA') == 'ALUA' and C.es_solo_medible('ALUA.BA'),
         'un solo-medible con sufijo no se reconoce')

# ── IRSA: EL CASO QUE MAS SE PRESTA A ERROR ──────────────────────────────
# El comentario de este archivo decia que IRSA usaba el mismo codigo en las dos
# plazas, y no: `IRSA` es el LOCAL, `IRS` es el ADR. El mapeo siempre estuvo
# bien; mentia el texto. Se clava acá para que no vuelva a pasar.
chequear(C.resolver_alias('IRSA') == 'IRS',
         'IRSA (codigo local) tiene que resolver al ADR IRS')
chequear('IRS' in u and 'IRSA' not in u,
         'IRSA no puede ser una clave del universo: la clave es el ADR, IRS')
for local, adr in (('YPFD', 'YPF'), ('PAMP', 'PAM'), ('TGSU2', 'TGS'),
                   ('TECO2', 'TEO'), ('CRES', 'CRESY')):
    chequear(C.resolver_alias(local) == adr,
             f'{local} (BYMA) no resuelve a {adr} (NYSE)')
    chequear(C.resolver_alias(f'{local}.BA') == adr,
             f'{local}.BA no resuelve a {adr}')
print(f'  alias locales       -> {len(C.ALIAS_LOCALES)}, todos apuntan a un papel real')

# ── 3. La lista curada de CEDEARs ─────────────────────────────────────────
# Solo puede AGREGAR certezas. Si dijera que no, taparia la sonda de Yahoo, que
# es la fuente para todo lo demas.
chequear(all(v is True or isinstance(v, str) for v in C.CEDEARS_CONFIRMADOS.values()),
         'un confirmado con valor falso: esta lista solo puede decir que SI')
chequear(all(bool(v) for v in C.CEDEARS_CONFIRMADOS.values()),
         'hay un confirmado sin fuente: sin fuente y fecha no se puede saber '
         'dentro de seis meses si sigue siendo cierto')
chequear(C.tiene_cedear_confirmado('GEV'), 'GE Vernova no esta confirmado')
chequear(not C.tiene_cedear_confirmado('AAPL'),
         'AAPL no deberia estar en la lista curada: la sonda ya lo resuelve')
# Los tres que ademas estan fuera del indice tienen que estar en el universo,
# porque a esos SI hay que bajarles los datos.
for t in C.CEDEARS_NUEVOS_2026:
    chequear(t in u, f'{t} esta confirmado como CEDEAR pero no entra al universo')
    chequear(t in C.CEDEARS_CONFIRMADOS, f'{t} entra pero no esta confirmado')
print(f'  CEDEARs confirmados -> {len(C.CEDEARS_CONFIRMADOS)}, todos con fuente y fecha')

# ── 4. El grupo Argentina ─────────────────────────────────────────────────
chequear(set(C.ADR_ARGENTINOS) <= C.ARGENTINA,
         'un ADR argentino quedo fuera del grupo de riesgo pais')
# Los casos de borde estan decididos y anotados arriba de ARGENTINA. Esta
# prueba los CLAVA: si alguien mueve uno, tiene que ser a proposito.
chequear('VIST' in C.ARGENTINA,
         'Vista quedo fuera: toda su produccion es Vaca Muerta')
chequear('CAAP' in C.ARGENTINA,
         'Corporacion America quedo fuera: Argentina es su mercado principal')
chequear('TX' not in C.ARGENTINA,
         'Ternium SA entro: es luxemburguesa y su operacion es mayormente Mexico')
chequear('MELI' not in C.ARGENTINA,
         'MercadoLibre entro: hoy su resultado es principalmente Brasil y Mexico')
# Todo el que este en el grupo tiene que existir en el universo, o el tope
# aplicaria sobre papeles que nadie puede tener.
fantasmas = sorted(t for t in C.ARGENTINA if t not in u)
chequear(not fantasmas, f'el grupo Argentina nombra papeles que no existen: {fantasmas}')
# Y los topes tienen que crecer con el perfil.
t = C.TOPE_ARGENTINA_POR_PERFIL
chequear(t['conservador'] < t['moderado'] < t['agresivo'],
         f'los topes de riesgo pais no crecen con el perfil: {t}')
print(f'  grupo Argentina     -> {len(C.ARGENTINA)} papeles · topes '
      f'{t["conservador"]}/{t["moderado"]}/{t["agresivo"]}%')

# ── 5. Los que faltaban, que era el punto de todo esto ────────────────────
# La lista de los 16 que se descartaban en silencio (anotada el 31/08).
for t in ('ITUB', 'NU', 'TS', 'GGAL', 'BMA', 'YPF', 'PAM', 'TEO', 'CRESY',
          'SUPV', 'LOMA', 'IRS', 'EDN', 'CEPU', 'BBAR', 'TGS'):
    chequear(t in u, f'{t} sigue sin entrar al universo')
# Y los dos que estan muertos NO pueden entrar, pero SI tienen que estar
# anotados: "no esta" y "esta excluido porque murio" son cosas distintas.
for t, quien in (('DESP', 'Despegar, comprado por Prosus en 2025'),
                 ('IRCP', 'IRSA Propiedades, fusionado en IRSA en 2022')):
    chequear(t not in u, f'{t} entro al universo y esta muerto: {quien}')
    chequear(t in C.EXCLUIDOS, f'{t} no entra pero tampoco esta anotado: se '
                               f'descarta en silencio, que es lo que este '
                               f'archivo promete que no pasa')
print('  los que faltaban    -> 16 adentro, 2 muertos anotados con motivo')

# ── 6. Los ETF quedan afuera, y anotados ──────────────────────────────────
# La tanda del 28/08 fueron 18 papeles: 13 acciones y 5 ETF. Marcos pidio los
# 13. Que los otros cinco esten en EXCLUIDOS es lo que deja constancia de que
# se los vio.
for t in ('BBCA', 'BBAX', 'GSG', 'CORN', 'SOYB'):
    chequear(t in C.EXCLUIDOS, f'{t} es un ETF de la tanda y no quedo anotado')
    chequear(t not in u, f'{t} es un ETF y entro al universo')
chequear(all('ETF' in C.EXCLUIDOS[t] for t in ('BBCA', 'BBAX', 'GSG', 'CORN', 'SOYB')),
         'el motivo de los ETF no dice que son ETF')
print('  ETF de la tanda     -> los 5 afuera, con el motivo escrito')

# ── 7. Solo medibles: forma y contenido ───────────────────────────────────
chequear(all(isinstance(v, list) and v and v[0].endswith('.BA')
             for v in C.SOLO_MEDIBLES.values()),
         'un solo-medible sin simbolo .BA: a Yahoo hay que pedirle la plaza')
chequear(C.es_solo_medible('ALUA') and not C.es_solo_medible('AAPL'),
         'es_solo_medible no distingue')
# Ecogas entro al panel lider del S&P Merval en 2026 y no tiene ADR.
chequear(C.es_solo_medible('ECOG'), 'falta Ecogas entre los solo medibles')
chequear(C.SOLO_MEDIBLES['ECOG'] == ['ECOG.BA'],
         f'el simbolo de Ecogas no es ECOG.BA: {C.SOLO_MEDIBLES.get("ECOG")}')
chequear(C.es_solo_medible('alua'), 'es_solo_medible no normaliza a mayusculas')
# Ninguna de estas puede tener ADR: si lo tuviera, el papel correcto seria el
# ADR (en dolares, con consenso e historico comparable) y tenerlo de las dos
# formas seria la misma empresa dos veces.
solapadas = sorted(set(C.SOLO_MEDIBLES) & set(C.ADR_ARGENTINOS))
chequear(not solapadas,
         f'estas tienen ADR y estan como solo medibles: {solapadas}')
print(f'  solo medibles       -> {len(C.SOLO_MEDIBLES)} en pesos, ninguna con ADR')

print('=' * 74)
if fallos:
    print(f'  {len(fallos)} FALLAS:')
    for f in fallos:
        print(f'    - {f}')
    sys.exit(1)
print('  Nadie entra y sale a la vez, los alias apuntan a algo real, la lista')
print('  curada solo agrega certezas, el grupo Argentina existe entero y')
print('  ningun papel se descarta en silencio.')
print('  OK')
