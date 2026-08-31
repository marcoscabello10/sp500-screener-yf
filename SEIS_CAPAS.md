# Las 6 capas: ¿reorganizamos, o estamos mejor así?

> Dos preguntas de Marcos. La primera tiene una respuesta con matiz; la segunda
> es, creo, la más valiosa de las dos.

---

## 1. ¿Reorganizamos el código en 6 módulos?

**No — pero el marco encontró siete cosas reales, y una ya se arregló.**

### Por qué no como estructura de código

Nuestro corte actual es **por quién calcula**:

```
    código determinístico          │  el modelo
    ───────────────────────────────┼──────────────────
    informe.py::evaluar   (Motor A)│  el prompt de la
    cartera.js            (pesos)  │  tesis: prosa,
    riesgo.js             (Motor B)│  orden, cliente
    sugerencias.js        (rotación)│
```

Tus 6 capas cortan **por etapa analítica**. Y ahí está el punto: **las capas
1 a 5 son TODAS determinísticas, y solo la 6 es del modelo.** Reorganizar en
seis módulos partiría el código por una línea que no es la que aguanta el peso
— la que aguanta el peso es "quién calcula", porque de ella dependen el costo,
la reproducibilidad y que el texto no contradiga la tabla.

Y hay un motivo empírico además: **mover código con pruebas nos costó caro dos
veces esta semana.** El bug del pool de reemplazos apareció al reimplementar lo
mismo en otro archivo; el de shadowing en `cartera.js` apareció al mover una
variable. Reordenar 2.000 líneas que funcionan, sin ganar función, es
exactamente el tipo de cambio que introduce ese tipo de bug.

### Pero como CHECKLIST es excelente — encontró esto

| capa | hueco encontrado | estado |
|---|---|---|
| **1** | **Inferíamos pesos por cantidad de posiciones** y los mandábamos como `pct` con `excede:true`, sin marca | 🔴 **arreglado hoy** |
| **1** | No hay una compuerta `DATA_INSUFFICIENT`: la cobertura está desparramada en 5 campos | ❌ falta |
| **3** | **`industry` se captura hace dos días y no se usa en ningún lado** | ❌ falta |
| **3** | **SPY está en el histórico** (1673 puntos) y no comparamos contra el benchmark | ❌ falta |
| **3** | Tenemos contribución al *riesgo*, falta contribución al *retorno* | ❌ falta |
| **4** | Pedís 4 ratings separados; nosotros colapsamos valuación dentro del puntaje y no hay Risk Rating | ⚠️ parcial |
| **5** | **Las "alternativas descartadas" ya las calculamos** (el delta de cada candidato) y solo mostramos la ganadora | ⚠️ el dato ya está |
| **6** | **Invalidation points**: qué haría que esta tesis esté mal | ❌ falta, y es barato |

### El bug de la capa 1, en concreto

Sin montos cargados, el porcentaje por sector se calculaba como **cantidad de
papeles**: *"3 de 5 posiciones son Technology"* = 60%. Eso salía al informe como
`pct: 60, excede: true`, y **el modelo no tenía cómo saber que no era plata**.
Una cartera con tres tecnológicas de 2% cada una disparaba *"Technology excede
el 35%"* — una alarma falsa con cara de dato.

Tu regla — *"todo porcentaje debe indicar su denominador"* — es exactamente el
arreglo. Ahora cada porcentaje viaja con `denominador: "valor de la cartera"` o
`"cantidad de posiciones"`, y un exceso **por conteo ya no se marca como
exceso**.

### Donde SÍ conviene adoptarlas: la forma del informe

Sospecho que de acá viene tu sensación al leer la tesis. El informe tiene 5
secciones que **no muestran el análisis que existe**: hay contribución al
riesgo, correlaciones y peso objetivo calculados, pero el texto los usa de
costado. Las capas 3, 4 y 5 tuyas son, en el fondo, **una tabla que falta**:

```
TICKER  peso → objetivo   Δpp   monto    aporte riesgo   corr   acción
```

Eso es capa 4 y 5 juntas, es determinístico, y hoy no se dibuja en ningún lado.

---

## 2. La optimización de API — la pregunta más útil

La regla que ya venimos usando sin haberla escrito:

> **El modelo recibe CONCLUSIONES, nunca materia prima. Y se le pide solo lo
> que no tiene una respuesta correcta.**

Un test práctico para clasificar cualquier cosa nueva:

> Si dos personas competentes con los mismos datos llegarían **al mismo
> número** → es código.
> Si llegarían a **redacciones distintas pero igual de válidas** → es el modelo.

### Los tres cajones

**A. Nunca entra al modelo** *(capas 1-5 enteras)*

Series de precios, la matriz de covarianza, el padrón de candidatos, los
fundamentales crudos, cualquier cosa que el modelo tendría que reducir. Ya lo
hacemos, y la dirección correcta es seguir **moviendo cosas hacia acá**, no
hacia allá: cada cálculo que baja al código sale gratis, es reproducible y no
puede contradecir la tabla.

**B. Entra, pero comprimido y con detalle proporcional a la decisión**

Acá está el ahorro que queda, y está **medido**. Cartera de 15 posiciones con
Motor B, con el reparto típico de 4 accionables y 11 en orden:

| | tokens |
|---|---|
| las 15 completas | 1.937 |
| las 4 accionables | 514 |
| las 11 que no requieren decisión, **completas** | **1.423** |
| las 11 que no requieren decisión, **comprimidas** | **214** |

> **El 62% del bloque de posiciones se gasta en las que no hay que decidir
> nada.** Comprimirlas a ticker, peso, objetivo, aporte al riesgo, puntaje y
> acción ahorra **1.209 tokens por llamada** sin perder nada: el modelo igual
> las nombra en su línea, que es todo lo que tiene que hacer con ellas.

**C. Lo que el modelo SÍ aporta** *(capa 6, y nada más)*

1. **El orden de ejecución.** No hay fórmula para "qué hago primero" cuando hay
   tres cosas que arreglar y presupuesto para dos.
2. **El porqué en prosa**, atado a los números que recibió.
3. **La traducción al cliente** — el mismo contenido en otro registro.
4. **Los invalidation points**: qué tendría que pasar para que esto esté mal.
   Es lo más valioso que puede escribir y hoy no se lo pedimos.

### Lo que NO conviene hacer aunque tiente

- **Pedirle ratings numéricos.** Un "Risk Rating 7/10" del modelo no es
  reproducible y va a contradecir el `aporte_al_riesgo_pct` que está al lado.
  Si hace falta un Risk Rating, **es una fórmula sobre la volatilidad y la
  contribución**, no una opinión.
- **Dos llamadas** (una por activo, una por cartera). Duplica el costo fijo por
  el mismo análisis.
- **Mandarle el histórico** para que "vea la tendencia". Son 9 MB.

### El ahorro que ya está y conviene no perder de vista

El caché por huella de cartera es, de lejos, el más grande: **el costo es por
CAMBIO, no por consulta.** Abrir el informe diez veces sin tocar nada cuesta
cero.

---

## 3. Lo que propongo, en orden

**Antes de volver a probar el botón**, tres cosas baratas y que se notan:

1. ✅ **El denominador** — hecho hoy. Era una alarma falsa saliendo al informe.
2. **La tabla ACTUAL vs OBJETIVO** (capas 4+5), determinística, en el informe.
   Es donde vive la mitad de tu Motor B y hoy no se dibuja.
3. **Comprimir las posiciones sin decisión** en el payload: −1.209 tokens por
   llamada, sin perder información.

Después, en orden de valor por esfuerzo:

4. **Invalidation points** en el prompt (capa 6). Una línea de prompt, alto
   valor.
5. **Benchmark contra SPY** (capa 3). El dato ya está en el snapshot.
6. **Compuerta `DATA_INSUFFICIENT`** (capa 1): un solo lugar que diga "con esto
   no alcanza", en vez de cinco campos de cobertura desparramados.
7. **`industry`** (capa 3): lo capturamos y no lo usamos. Sirve para
   concentración por industria, que es más fina que por sector.

Lo que **no** haría por ahora: los 4 ratings separados de la capa 4. El puntaje
fundamental y el aporte al riesgo ya dicen eso con más precisión y sin inventar
escalas nuevas.
