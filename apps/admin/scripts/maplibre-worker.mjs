// MapLibre GL 6 runs its tile work in a module worker that it loads by URL, together with
// the shared chunk the worker imports. Bundlers don't emit those files, so they are copied
// from the installed package into public/maplibre/ before `dev` and `build`.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json')), 'dist')
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre')
mkdirSync(out, { recursive: true })
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) copyFileSync(join(dist, file), join(out, file))
