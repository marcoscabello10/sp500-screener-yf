# Motor B — auditoría y plan

> Diagnóstico de Marcos: *"el informe hace mucho del motor A y relativamente
> poco del B"*. Verificado campo por campo. **Es correcto, y el motivo es
> arquitectónico, no de redacción.**

---

## 1. La auditoría, punto por punto

De los 8 puntos del Motor B, esto es lo que el bloque de datos manda hoy:

| # | Motor B pide | qué manda hoy | estado |
|---|---|---|---|
| 1 | cuánto pesa | `peso_pct` | ✅ |
| 2 | **cuánto debería pesar** | `tope_pct` | ⚠️ **es un TOPE, no un objetivo** |
| 3 | **cuánto riesgo aporta** | `beta` (del activo solo) | ❌ |
| 4 | **cuánto aporta al retorno** | — | ❌ |
| 5 | **cuánto correlaciona con el resto** | — | ❌ |
| 6 | qué reemplazo mejora la cartera | candidatos con `puntaje` | ⚠️ **mide la EMPRESA, no el encaje** |
| 7 | cuánto comprar/vender | `exceso_usd` | ⚠️ solo para volver al tope |
| 8 | **impacto antes/después** | — | ❌ |

**1 de 8 completo, 3 parciales, 4 ausentes.**

### El punto 2 es la raíz de todo

`analizarCartera()` implementa **restricciones**, no **optimización**. Un tope
dice *"no más de 12%"*. Un peso objetivo dice *"debería ser 9%"*. Todo lo que
el informe sabe hacer es empujar los excesos hacia el límite — y un límite no
es una recomendación, es una barrera.

Por eso el punto 7 también queda a medias: el `exceso_usd` contesta *"cuánto
sobra"*, no *"cuánto habría que tener"*.

---

## 2. La demostración: por qué esto no es teórico

Sobre una cartera de prueba (AAPL 30%, MSFT 13,3%, JPM 15%, KO 10%, XOM 6,7%),
usando el histórico real de 3 años:

```
Volatilidad de la cartera: 15,9%

        peso   vol propia   APORTE AL RIESGO   retorno esp.
AAPL   30,0%       26,8%          59,9%           +1,2%     ← el 30% del dinero
MSFT   13,3%       26,1%          16,9%          +10,4%       aporta el 60%
JPM    15,0%       23,0%          16,5%           +4,7%       del riesgo
XOM     6,7%       23,3%           3,5%           +8,9%
KO     10,0%       16,5%           3,2%           +5,6%
```

**AAPL pesa 30% y aporta el 60% del riesgo.** El informe de hoy no dice eso:
dice *"excede el tope de 12%"*, que es verdad pero es mucho menos útil.

### Y ahora lo grave

El informe recomienda recortar AAPL, pero **no tiene forma de decidir a dónde
va esa plata**. Las cuatro opciones:

| mover el excedente de AAPL a… | volatilidad resultante | mejora |
|---|---|---|
| **KO** | 12,3% | **−3,6 puntos** |
| XOM | 13,6% | −2,3 |
| JPM | 15,0% | −1,0 |
| **MSFT** | 15,5% | **−0,4** |

**Nueve veces de diferencia entre la mejor y la peor decisión**, y las dos son
"recortar AAPL al tope". La diferencia está enteramente en la correlación:

```
         AAPL   MSFT     KO    JPM    XOM
AAPL     1,00   0,35   0,12   0,28   0,10
MSFT     0,35   1,00  -0,06   0,23  -0,03
KO       0,12  -0,06   1,00   0,02   0,14
```

MSFT correlaciona 0,35 con AAPL; KO, 0,12. Poner la plata en MSFT es casi no
moverse.

> 🔴 **Y el sistema hoy elegiría MSFT.** Su único criterio de ranking es el
> puntaje fundamental, y MSFT tiene el puntaje más alto de la cartera (78).
> O sea: **con la información que tiene, el informe recomendaría la peor de las
> cuatro opciones, y sonaría razonable haciéndolo.**

---

## 3. Por qué ningún cambio de prompt arregla esto

**El Motor B es aritmética, no redacción.**

La contribución al riesgo, la correlación y el antes/después son cuentas sobre
una matriz de covarianza. Si se las pedimos al modelo, volvemos exactamente al
error que corregimos al principio de este diseño: **pedirle al modelo que haga
cuentas que el código tiene que hacer**. Las haría mal, y encima quedarían al
lado de una tabla que dice otra cosa.

> El principio no cambia: **el código decide los números, el modelo explica.**
> Lo que falta no es prompt: **faltan los números.**

---

## 4. La buena noticia: la materia prima ya está en el repo

| dato | dónde está | cobertura |
|---|---|---|
| precios diarios | `public/data/historico_precios.json` | **633 símbolos × 1673 fechas** |
| retorno esperado (proxy) | `informe_consenso.json` → `upsidePct` | 499/504 |
| beta | `informe_consenso.json` → `beta` | 492/504 |

**El histórico es un archivo estático en `/data/`, el mismo origen que el
informe.** El navegador puede bajarlo igual que baja `sp500_fundamentals.json`.
De ahí sale todo lo que falta:

- volatilidad de cada posición y de la cartera
- **matriz de covarianza** → contribución al riesgo y correlaciones
- simulación **antes/después** de cualquier operación
- Δvolatilidad de cada candidato de rotación

Es cálculo determinístico, en el navegador, **sin una sola llamada a la red
nueva y sin un solo token.** Y es exactamente lo que habilitó la fase B2 sin
que lo aprovecháramos.

---

## 5. Lo que propongo — y una decisión técnica que importa

### 5.1. El peso objetivo: paridad de riesgo con topes, NO Markowitz

Es tentador armar un optimizador de media-varianza (lo que hace F4 en el
screener). **No conviene acá**, por un motivo concreto:

> Markowitz es brutalmente sensible al retorno esperado que se le dé, y el
> único retorno esperado que tenemos es `upsidePct` — el precio objetivo de los
> analistas a 12 meses, que es un predictor **pobre**. Con retornos malos,
> Markowitz produce carteras extremas y con cara de precisión.

**Paridad de riesgo acotada por los topes que ya existen** es más robusta y no
necesita ningún pronóstico de retorno: reparte el peso para que cada posición
aporte un riesgo parecido, respetando `maxPosicion` y `maxSector` del perfil.
Contesta el punto 2 con un número defendible, y usa los topes que ya definimos
en vez de tirarlos.

El retorno esperado se muestra **al lado**, etiquetado como lo que es
(*"consenso de analistas a 12 meses"*), y **no entra en la optimización.**

### 5.2. Lo que se agrega, por punto

| # | qué se calcula | de dónde |
|---|---|---|
| 2 | **peso objetivo** por paridad de riesgo con topes | covarianza |
| 3 | **contribución al riesgo** de cada posición (% del total) | covarianza |
| 4 | **aporte al retorno esperado** = peso × upside, etiquetado | consenso |
| 5 | **correlación media con el resto** de la cartera, por posición | covarianza |
| 6 | **Δvolatilidad y Δconcentración** de cada candidato | covarianza |
| 7 | **cuánto comprar/vender para llegar al objetivo**, en USD y acciones | |
| 8 | **antes/después**: volatilidad, concentración, aporte al retorno | covarianza |

### 5.3. Lo que hay que decir y no esconder

- **El retorno esperado es débil.** `upsidePct` es consenso de analistas, no
  una expectativa propia. Se muestra con esa etiqueta y no se optimiza contra
  él.
- **La covarianza es histórica.** Mira 3 años para atrás; las correlaciones
  cambian, y suelen subir justo cuando uno preferiría que no. El stress test
  que ya existe sigue siendo el complemento honesto.
- **Papeles nuevos quedan afuera.** Con menos de ~60 días de historia no hay
  covarianza confiable. Esos se marcan "sin datos de riesgo" en vez de
  inventarles un número, igual que se hace con las métricas fundamentales.

---

## 6. Dónde vive esto

Un módulo nuevo, `src/informe/riesgo.js`, que:

1. baja `historico_precios.json` una vez (memoria del tab, como el snapshot),
2. calcula la covarianza de las posiciones de la cartera,
3. devuelve contribución al riesgo, correlaciones, peso objetivo y antes/después.

`analizarCartera()` **no se toca**: lo de riesgo se cuelga al lado y se
fusiona en `armarDatosTesis()`. Así el Motor A sigue funcionando igual aunque
el histórico no esté, y si el archivo falta, el Motor B se apaga solo y lo dice
—como el interruptor de la fase B2— en vez de romper el informe.

Y el prompt de la tesis cambia poco: recibe los campos nuevos y se le agrega
que **la sección "Qué hacer" tiene que decir a dónde va la plata y cuánto
mejora la cartera**, con el número que ya le llega calculado.
