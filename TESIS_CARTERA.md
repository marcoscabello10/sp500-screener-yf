# Tesis de cartera con IA — diseño

> Documento de trabajo. Acá se decide **qué le pedimos al modelo y qué NO**,
> antes de escribir una línea de código. Marcos revisa, después se implementa.

---

## 1. El error central del prompt original

El prompt pide al modelo que produzca **target weights** y después que
**valide que suman 100%**.

Las dos cosas están mal, por el mismo motivo:

### 1.1. Esos números ya los calcula el código, y bien

`analizarCartera()` en `src/informe/cartera.js` ya devuelve, para cada posición
y de forma **determinística**:

| campo | qué es |
|---|---|
| `peso` | peso actual sobre la cartera COMPLETA |
| `topeClase` | el tope que le corresponde por perfil × clase |
| `estado` | `bajo` / `neutral` / `sobre` / `critico` |
| `excesoPct` | cuánto se pasa del tope |
| **`excesoUSD`** | **cuántos dólares hay que vender para volver al tope** |
| `accion` | la matriz fundamental × peso (nunca promediada) |
| `tomaGanancia` | pesa de más **pero la empresa está bien** — otro motivo de venta |
| `afinidad` / `brechaObjetivo` | qué tan bien encaja con el objetivo declarado |

Y a nivel cartera: `sectores` con `pct`, `tope`, `excede` y `excesoUSD`;
`clases`; `pesoEquiponderado`; `topeGeneral`; `stressTest()`.

**Si el modelo recalcula los pesos objetivo, va a producir números distintos a
los que están en la tabla de arriba en la misma página.** El cliente ve una
tabla que dice "recortar USD 4.200" y un párrafo que dice "reducir a 8%", y no
cierran. Ese es el peor resultado posible: dos fuentes de verdad.

### 1.2. "Validate that target weights sum to 100%" no valida nada

Un modelo de lenguaje al que se le pide que valide su propia aritmética
contesta **que sí**. No es una validación, es una pregunta retórica. Si hace
falta validar, se valida **en código, después de recibir la respuesta** — y si
no cierra, no se muestra.

### 1.3. Además, la cartera NO suma 100% en acciones

El prompt asume que todo es renta variable. Pero ya tenemos `CLASES_RESTO`
(renta fija, acciones locales, efectivo) y `TOPE_RENTA_VARIABLE`
(50/70/90% según perfil). Si el modelo "valida que suma 100%", va a ignorar
en silencio la parte que no es acciones — que en un perfil conservador es
**la mitad de la cartera**.

### ✅ La corrección

> **El código decide los números. El modelo explica, prioriza y redacta.**

El modelo **recibe** los pesos objetivo ya calculados. No los inventa. Lo que
aporta es lo que el código no puede: el porqué, el orden en que conviene
ejecutar, qué rotación tiene sentido, y cómo se le explica al cliente.

---

## 2. Las otras correcciones

### 2.1. Diez secciones se solapan y cuestan de más

`Executive Summary`, `Final Action Plan` y `Client Explanation` son **tres
versiones del mismo contenido**. `Position Actions`, `Priority Reductions` y
`Positions to Reinforce` también se pisan. Eso no solo cuesta tokens: invita a
que una sección contradiga a la otra.

**Se pasa de 10 secciones a 5**, sin perder nada:

| original | nuevo |
|---|---|
| Executive Summary + Final Action Plan | **1. Qué hacer** (con el orden de ejecución) |
| Portfolio Diagnosis | **2. Cómo está la cartera** |
| Position Actions + Priority Reductions + Positions to Reinforce | **3. Posición por posición** |
| Rotation Candidates | **4. Rotaciones** |
| Client Explanation | **5. Para el cliente** |
| Target Weights + Before vs After | ❌ **los muestra el código, no el modelo** |

### 2.2. "Do not invent missing data" es demasiado débil

Tenemos un problema de datos faltantes **medido**: FISV con 2 de 6 métricas,
los bancos sin EV/EBITDA, 33 empresas con patrimonio negativo que usan
reemplazos (P/S, ROA, DN/EBITDA).

Pedirle "no inventes" y no decirle **qué falta** es esperar que adivine. En
cambio se le manda, por activo, `metricas_usadas: "4/6"` y qué reemplazos se
aplicaron, **y se le exige que lo nombre** cuando la cobertura es baja.

### 2.3. "confidence" suelto siempre vuelve "high"

Un campo de confianza sin criterio es decorativo. Se ata a algo que **medimos**:

```
alta   = 6/6 métricas, sin reemplazos, con histórico de EDGAR
media  = 4-5 métricas, o con reemplazos, o sin histórico
baja   = menos de 4 métricas, o sin consenso de analistas
```

### 2.4. Faltan tres cosas que ya tenemos

- **El stress test** (`stressTest()`): cuánto cae la cartera en un escenario
  malo. Es lo primero que pregunta un cliente y no está en el prompt.
- **Objetivo y horizonte** (`afinidad`, `brechaObjetivo`): el prompt los
  menciona como factores pero no le manda el número que ya calculamos.
- **El resto de la cartera**: renta fija, efectivo, acciones locales.

### 2.5. ~~El costo de operar~~ → DESCARTADO, pero queda un caso distinto

**Marcos: la comisión es un costo fijo mensual, así que siempre justifica
operar.** El piso por monto se elimina.

Pero queda una objeción **distinta**, que no es de comisiones sino de
ejecutabilidad: **no se pueden vender fracciones de acción**. Si el exceso son
USD 40 y el papel cotiza a USD 500, la recomendación "recortar USD 40" no se
puede ejecutar. La regla que queda no es de monto mínimo sino de redondeo:

> Toda operación se expresa además en **cantidad entera de acciones**. Si
> redondeando a acciones enteras el ajuste da **cero**, se dice "el desvío es
> menor a una acción, no hay nada que operar" en vez de proponer un monto que
> no se puede ejecutar.

### 2.6. "Do not sell solely because price increased" — bien, pero incompleto

Esa regla es correcta y ya está implementada en `tomaGanancia`. Falta la
simétrica y la más importante:

> **Una posición que subió mucho pesa más, y eso es un motivo VÁLIDO de
> recorte — pero es un motivo de RIESGO, no de que la empresa esté mal.** Los
> dos motivos se nombran distinto y nunca se mezclan.

---

## 3. ¿Para Marcos o para el cliente? → **una llamada, dos registros**

Dos llamadas serían **el doble de costo por el mismo análisis**. La sección
"Para el cliente" es una **sección**, no una llamada aparte.

Pero con una regla explícita: **lo que va en la sección del cliente no incluye
el razonamiento interno.** "Esta posición se compró mal" es información para
Marcos; al cliente se le dice qué conviene hacer ahora y por qué, sin juzgar
decisiones pasadas.

---

## 4. El prompt corregido

### Bloque de reglas (ESTÁTICO — va cacheado)

> Este bloque no cambia entre carteras. Con prompt caching se paga a **0,1×**
> en las lecturas siguientes, que es lo que hace viable correr esto seguido.

```
ROL
Sos un estratega de carteras. Tu trabajo NO es analizar empresas sueltas: eso
ya está hecho y te llega calculado. Tu trabajo es decidir qué conviene hacer
con ESTA cartera, en este orden y con estos motivos.

PRINCIPIO CENTRAL
Puntaje fundamental ≠ acción de cartera.
Cada activo se mira dos veces:
  1. Como empresa (¿es buena?).
  2. Como posición en ESTA cartera (¿cuánto debe pesar acá?).
Una empresa excelente puede tener que recortarse. Una mediocre puede quedarse.

LOS NÚMEROS YA ESTÁN CALCULADOS — NO LOS REHAGAS
Recibís pesos actuales, pesos objetivo, excesos en dólares, estado de cada
posición y la acción sugerida. Todo eso viene del sistema y ya se le muestra al
usuario en una tabla.
  · NO recalcules pesos objetivo.
  · NO inventes porcentajes que no te dieron.
  · NO contradigas un número que recibiste.
Si creés que un número está mal, DECILO explícitamente en vez de corregirlo por
tu cuenta.
Tu aporte es el POR QUÉ, el ORDEN y la REDACCIÓN.

DATOS FALTANTES
Cada activo trae `metricas_usadas` (ej. "4/6") y qué reemplazos se usaron
(P/S en vez de P/B, ROA en vez de ROE, Deuda neta/EBITDA en vez de D/E) porque
la empresa tiene patrimonio neto negativo.
  · Si un activo tiene menos de 4 métricas, NOMBRALO y bajá la confianza.
  · Nunca completes un dato que no está. "No hay dato" es una respuesta válida.
  · Si no te alcanza para opinar de una posición, decilo. Es preferible a
    inventar una tesis.

REGLAS DE DECISIÓN
  · No recomiendes vender solo porque el precio subió.
  · No recomiendes mantener solo porque el precio bajó.
  · No recomiendes comprar solo porque el precio objetivo de los analistas
    está alto.
  · Un dividendo bajo NO es una señal de malos fundamentals. El peso del
    dividendo depende del sector y del objetivo declarado del cliente.
    Tratalo como parte de la asignación de capital, no como una nota.
  · Distinguí SIEMPRE, y nombralos distinto, estos cinco motivos de recorte:
      – toma de ganancia (subió y ahora pesa de más; la empresa está BIEN)
      – rebalanceo (se desalineó del objetivo)
      – reducción de riesgo (concentración, beta, correlación)
      – rotación (hay algo que le sirve más a esta cartera)
      – tesis rota (la empresa cambió; es el único que es sobre la empresa)
  · Todo recorte tiene que decir A DÓNDE va la plata.
  · Toda incorporación tiene que MEJORAR la cartera, no simplemente tener mejor
    puntaje. Un activo con puntaje 80 que duplica un sector que ya está al tope
    empeora la cartera.
  · No cambies una concentración por otra.
  · Cada operación va también en CANTIDAD ENTERA DE ACCIONES, no solo en
    dólares: no se pueden vender fracciones. Si al redondear a acciones enteras
    el ajuste da cero, decí "el desvío es menor a una acción, no hay nada que
    operar" en vez de proponer un monto que no se puede ejecutar.

ROTACIÓN
Cuando recortes algo, el reemplazo tiene que aportar al menos una de estas, y
tenés que decir CUÁL:
  mejor calidad · mejor valuación · mejor crecimiento · menos riesgo ·
  diversificación de sector · diversificación de factor
Elegí el que MEJOR LE SIRVE A ESTA CARTERA, no la mejor empresa en abstracto.

CONFIANZA
Asigná confianza por cobertura de datos, no por lo convencido que estés:
  alta  = 6/6 métricas, sin reemplazos, con histórico
  media = 4-5 métricas, o con reemplazos, o sin histórico
  baja  = menos de 4 métricas, o sin cobertura de analistas

SALIDA — cinco secciones, en este orden
  1. QUÉ HACER — lo primero que hay que ejecutar y en qué orden. Máximo 5
     acciones. Si no hay nada urgente, decilo.
  2. CÓMO ESTÁ LA CARTERA — concentración, clases, encaje con el objetivo y el
     horizonte, y qué pasa en el escenario de estrés que te dan.
  3. POSICIÓN POR POSICIÓN — por cada una: qué dice como empresa, qué dice como
     posición, la acción, el motivo (con el nombre del motivo, de la lista de
     cinco) y la confianza.
  4. ROTACIONES — solo las que tengan sentido. Si no hay ninguna que valga la
     pena, decilo en vez de forzar una.
  5. PARA EL CLIENTE — la misma conclusión en lenguaje llano, sin jerga y sin
     juzgar decisiones pasadas. Qué conviene hacer y por qué, en pocas frases.

IDIOMA Y TONO
Español rioplatense, directo, sin adornos. Nada de "es importante destacar" ni
"cabe mencionar". Si algo es una duda, se dice como duda.
Esto es un insumo de análisis para que decida una persona, no una
recomendación de inversión cerrada. No prometas rendimientos.
```

### Bloque de datos (VARIABLE — se arma por cartera)

```json
{
  "perfil": "moderado",
  "objetivo": "equilibrado",
  "horizonte": "medio",
  "cartera": {
    "valor_total_usd": 48200,
    "cobertura_analizada_pct": 87.5,
    "es_parcial": true,
    "renta_variable_pct": 72.0,
    "tope_renta_variable_pct": 70,
    "resto": [{"clase": "renta fija", "pct": 20}, {"clase": "efectivo", "pct": 8}]
  },
  "topes": {"por_posicion": 12, "por_sector": 35, "equiponderado": 8.3},
  "estres": { "caida_estimada_pct": -22.4, "peor_posicion": "NVDA" },
  "sectores": [
    {"sector": "Technology", "pct": 41.2, "tope": 35, "excede": true,
     "exceso_usd": 2990}
  ],
  "posiciones": [
    {
      "ticker": "AAPL", "nombre": "Apple Inc.", "sector": "Technology",
      "clase": "core", "puntaje_fundamental": 72, "afinidad_objetivo": 68,
      "brecha_objetivo": -4, "banderas_altas": 0, "metricas_usadas": "6/6",
      "reemplazos": [],
      "peso_pct": 14.2, "tope_pct": 12, "estado": "sobre",
      "exceso_pct": 2.2, "exceso_usd": 1060,
      "ganancia_pct": 34.1, "precio_compra": 178.2,
      "accion_calculada": "recortar", "toma_ganancia": true,
      "beta": 1.21
    }
  ],
  "candidatos_rotacion": [
    {"ticker": "UNH", "sector": "Healthcare", "puntaje_fundamental": 78,
     "metricas_usadas": "6/6", "ya_en_cartera": false, "tiene_cedear": true}
  ]
}
```

---

## 4bis. Los candidatos de rotación — dos hallazgos

**Decisión de Marcos:** los candidatos salen del screener, CEDEARs solamente,
mismo sector + otro sector, y propuso *"las 50 mejores por sector"* con caché
de 15-30 días.

### 🔎 Hallazgo 1: no hay 50 por sector. Hay 150 en total.

Conté los CEDEARs del snapshot:

| sector | CEDEARs |
|---|---|
| Technology | 33 |
| Industrials | 20 |
| Healthcare | 19 |
| Consumer Discretionary | 18 |
| Financials | 15 |
| Consumer Staples | 13 |
| Communication Services | 10 |
| Materials | 9 |
| Energy | 9 |
| Utilities | **3** |
| Real Estate | **1** |
| **total** | **150** |

**Ningún sector llega a 50.** El más grande tiene 33 y dos tienen menos de 4.
Un "top 50 por sector" sería, en todos los casos, "todos".

> ✅ **Se usan los 150, sin recorte.** Es más simple y no pierde nada.

### 🔎 Hallazgo 2: no hace falta correr F1 ni cachear nada

Esto es lo que ahorra más trabajo. Puntuar los 150 CEDEARs es **puro cálculo
sobre `sp500_fundamentals.json`, que ya está en el navegador**:

- **cero llamadas de red** — el archivo ya se bajó,
- **cero tokens** — no interviene ningún modelo,
- **milisegundos** — son 150 papeles y seis percentiles.

`sugerencias.js::scoresPorSector()` **ya hace exactamente esto** y ya filtra por
CEDEAR y por "no está en la cartera".

> ✅ **No hay que correr la Fase 1 aparte ni guardar un caché de 15-30 días.**
> Un caché acá solo agregaría una forma nueva de mostrar datos viejos: el
> snapshot de fundamentales ya se regenera con el bot, y el cálculo es gratis.
> Lo único que cambia el resultado es el snapshot, y ese ya tiene su propia
> fecha a la vista.

### ⚠️ Pero hay una divergencia real que resolver antes

`sugerencias.js` **reimplementa** el criterio de F1 en vez de compartirlo — su
propio encabezado lo admite. Y hoy difieren en dos cosas:

| | F1 (`App.jsx`) | `sugerencias.js` |
|---|---|---|
| múltiplo negativo | descartado ✅ | descartado ✅ |
| promedio de los percentiles | **ponderado** (0,20 / 0,15 / 0,22 / 0,13 / 0,15 / 0,15) | **simple** ❌ |
| reemplazos P/S, ROA, DN/EBITDA | sí ✅ | **no** ❌ |
| `SECTOR_NO_APLICA` en bancos | sí ✅ | **no** ❌ |

La buena noticia: el bug del patrimonio negativo **no está** acá — este archivo
nació con el filtro de `<= 0` bien puesto. Fue solo App.jsx el que se quedó
atrás.

La mala: sin los reemplazos, un candidato con patrimonio negativo (MCD, BKNG,
MO, PM…) pierde tres métricas en vez de sustituirlas, y puede quedar por debajo
del corte de `ps.length >= 3` o puntuar mal por falta de datos. **Los candidatos
de rotación se rankearían con un criterio distinto al de la tabla que Marcos ve
en F1.**

**Propuesta: portar a `sugerencias.js` el promedio ponderado y los reemplazos**,
antes de conectar la tesis de cartera. Es el mismo trabajo que ya se hizo en
App.jsx y ya está probado.

> 📌 Y anotar la causa raíz: **tres copias del mismo criterio**
> (`App.jsx::norm`, `informe.py::percentil`, `sugerencias.js::percentil`) que se
> desincronizan de a una. No se pueden unificar —el screener y el informe son
> proyectos separados a propósito, y uno es Python—, pero **sí hay que revisar
> las tres cada vez que cambia el criterio**. Ya pasó dos veces.

---

## 4ter. Impresión: todo, con la parte del cliente separable

**Decisión de Marcos:** se imprime todo; al mandar a imprimir elige las páginas
para el cliente y se guarda el resto para no volver a gastar tokens.

Eso impone **un requisito de maquetado**, no de contenido:

> La sección **"Para el cliente" tiene que empezar en página nueva** y ser la
> última, para que el rango de páginas salga limpio y no arrastre media hoja de
> análisis interno.

Se resuelve con la clase `salto-antes` que ya usa `Cartera.jsx`.

Y como el objetivo es **no volver a gastar**, el resultado se guarda entero en
el caché del navegador (por huella de cartera + proveedor), no solo la parte que
se imprime.

---

## 5. Validación en código (después de la respuesta)

Lo que el prompt original pedía "validar" preguntando, se comprueba de verdad:

| chequeo | si falla |
|---|---|
| ¿nombró algún ticker que no está en la cartera ni en los candidatos? | se marca en pantalla |
| ¿repitió un número distinto al que se le dio? | se marca el conflicto |
| ¿la cantidad de acciones redondea a cero? | se marca |
| ¿usó uno de los cinco motivos, o inventó otro? | se marca |
| ¿cubrió todas las posiciones? | se lista lo que faltó |

**No se corrige la respuesta en silencio: se muestra el aviso.** Ocultar que el
modelo se equivocó es peor que mostrarlo.

---

## 6. Costo — la llamada más cara de la app

Es la única llamada que crece con el tamaño de la cartera.

| | tokens aprox |
|---|---|
| bloque de reglas (estático, **cacheado a 0,1×**) | ~1.300 |
| datos, cartera de 10 posiciones | ~1.800 |
| respuesta | ~2.500 |

Reglas de costo, en línea con lo ya establecido:

1. **Un solo botón, explícito**, en el informe de cartera. Nunca automático.
2. **Muestra el costo estimado antes de clickear** ("~10 posiciones, ~1 centavo").
3. **Caché por huella de la cartera + proveedor.** Si no cambió ninguna
   posición ni el perfil, no se vuelve a llamar.
4. **Prompt caching** en el bloque de reglas: es lo que hace que la segunda
   corrida cueste una fracción.
5. Los dos proveedores siguen separados: si elegís uno, el otro no se toca.

---

## 7. Decisiones tomadas

| # | pregunta | decisión |
|---|---|---|
| 1 | monto mínimo de operación | ❌ **no va** — la comisión es un costo fijo mensual. Queda solo el redondeo a acciones enteras. |
| 2 | de dónde salen los candidatos | los **150 CEDEARs**, mismo sector + otro sector. Sin top-50 (no existe) y **sin caché** (el cálculo es gratis). |
| 3 | impresión | **todo se imprime**; "Para el cliente" arranca en página nueva y va última, para que el rango salga limpio. |

## 8. Lo único que queda antes de implementar

**Portar a `sugerencias.js` el promedio ponderado y los reemplazos** (sección
4bis). Si no, los candidatos de rotación se rankean con un criterio distinto al
que muestra F1, y la tesis va a recomendar cosas que no coinciden con la tabla.

Orden propuesto:

1. `sugerencias.js` al día con F1 — con su prueba, como la de F1.
2. `action=tesis_cartera` en `api/informe.py`: prompt + prompt caching +
   los dos proveedores separados como ya están.
3. El armado del bloque de datos en `cartera.js` (nada nuevo: es juntar lo que
   `analizarCartera` y `stressTest` ya devuelven).
4. Botón + render + caché por huella de cartera en `Cartera.jsx`.
5. Validación en código de la respuesta (sección 5) y su prueba.
