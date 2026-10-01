// npm run db:test — applies every migration to an in-memory Postgres and runs the suites.
import { run as clans } from './clans.test.mjs'
import { run as lint } from './lint.test.mjs'
import { run as map } from './map.test.mjs'
import { run as schema } from './schema.test.mjs'

let failed = 0
for (const suite of [lint, schema, map, clans]) {
  try {
    failed += await suite()
  } catch (e) {
    console.log(`✗ ${e.message}`)
    failed++
  }
}
process.exit(failed ? 1 : 0)
