# -*- coding: utf-8 -*-
"""VOLCAR LOS PROMPTS a archivos de texto, para poder leerlos sin abrir el .py.

    python test/volcar_prompts.py

Escribe PROMPT_CARTERA.txt y PROMPT_CLIENTE.txt en la raiz, SIEMPRE a partir
de las constantes reales. Existe porque `PROMPT_CARTERA.txt` se escribio a mano
una vez y quedo viejo al dia siguiente: una copia manual de algo que se edita
seguido es una mentira con fecha de vencimiento.

NO GASTA UN SOLO TOKEN.
"""
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'api'))
import informe as I                                          # noqa: E402

CABECERA = ('# GENERADO por test/volcar_prompts.py desde api/informe.py.\n'
            '# No lo edites acá: editá la constante {} y volvé a correrlo.\n'
            '# {} tokens.\n\n')

for archivo, const, texto in (
        ('PROMPT_CARTERA.txt', 'SISTEMA_CARTERA', I.SISTEMA_CARTERA),
        ('PROMPT_CLIENTE.txt', 'SISTEMA_CLIENTE', I.SISTEMA_CLIENTE)):
    destino = os.path.join(RAIZ, archivo)
    with open(destino, 'w', encoding='utf-8') as f:
        f.write(CABECERA.format(const, len(texto) // 4) + texto + '\n')
    print(f'  {archivo:<22} {len(texto) // 4:>5} tokens')
