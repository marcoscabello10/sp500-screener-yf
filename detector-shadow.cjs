// Detector de shadowing en los modulos del informe.
//
// POR QUE EXISTE: esta misma clase de bug pego dos veces en este proyecto.
//   1. probe_edgar.py: `base` era la carpeta del script y el bucle de margenes
//      la reasignaba a un float. Reventaba DESPUES de bajar todos los datos.
//   2. cartera.js (27/08/2026): `const base` dentro del .map tapaba al `base`
//      de afuera durante todo el callback, incluida una linea ANTERIOR a su
//      propia declaracion. Resultado: TDZ, "Cannot access before initialization".
//
// Busca declaraciones que reusan un nombre ya declarado en un alcance exterior
// del mismo archivo. No pretende ser un linter completo: apunta a este error.
const fs = require('fs')
const path = require('path')

const DIR = 'src/informe'
const DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g
let hallazgos = 0

for (const f of fs.readdirSync(DIR).filter(n => /\.(js|jsx)$/.test(n))) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8')
  const lineas = src.split('\n')
  // pila de alcances por profundidad de llaves
  const porNivel = new Map()
  let nivel = 0
  lineas.forEach((linea, idx) => {
    const limpia = linea.replace(/\/\/.*$/, '')
    for (const m of limpia.matchAll(DECL)) {
      const nombre = m[1]
      for (const [n, nombres] of porNivel) {
        if (n < nivel && nombres.has(nombre)) {
          console.log(`  ⚠ ${f}:${idx + 1}  '${nombre}' tapa a otro '${nombre}' ` +
                      `declarado en la linea ${nombres.get(nombre)}`)
          hallazgos++
        }
      }
      if (!porNivel.has(nivel)) porNivel.set(nivel, new Map())
      porNivel.get(nivel).set(nombre, idx + 1)
    }
    nivel += (limpia.match(/\{/g) || []).length
    const cierra = (limpia.match(/\}/g) || []).length
    for (let k = 0; k < cierra; k++) { porNivel.delete(nivel); nivel-- }
    if (nivel < 0) nivel = 0
  })
}
console.log(hallazgos ? `\n${hallazgos} posibles shadowings` : '  sin shadowings')
process.exit(hallazgos ? 1 : 0)
