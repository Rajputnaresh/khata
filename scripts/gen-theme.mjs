import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'src', 'styles', 'm3.generated.css')

/**
 * Node's ESM resolver cannot load @material/material-color-utilities directly
 * (the package ships extensionless internal imports), but Vite's resolver
 * handles it. So bundle the theme module with Vite, evaluate it in Node, and
 * write the resulting CSS. The generated file is committed, so a normal
 * `npm run build` never needs the color engine.
 */
const result = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    lib: {
      entry: join(here, '..', 'src', 'lib', 'm3.ts'),
      formats: ['es'],
      fileName: 'm3',
    },
    minify: false,
  },
})

// Vite 8 returns RollupOutput | RollupOutput[].
const outputs = Array.isArray(result) ? result.flat() : [result]
const chunk = outputs
  .flatMap((o) => o.output ?? [])
  .find((o) => o.type === 'chunk')

if (!chunk || chunk.type !== 'chunk') throw new Error('theme bundle not produced')

const mod = await import(
  `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
)
const css = mod.themeCss()

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, css, 'utf8')
console.log(`theme written: ${out} (${(css.length / 1024).toFixed(1)} KB)`)
