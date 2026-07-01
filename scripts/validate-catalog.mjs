// Validates catalog/catalog.json against its JSON Schema plus referential
// rules the schema can't express. Run locally or in CI: node scripts/validate-catalog.mjs
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const schema = JSON.parse(readFileSync(new URL('../catalog/catalog.schema.json', import.meta.url)))
const catalog = JSON.parse(readFileSync(new URL('../catalog/catalog.json', import.meta.url)))

const ajv = new Ajv2020({ allErrors: true })
addFormats(ajv)
const validate = ajv.compile(schema)

const errors = []
if (!validate(catalog)) {
  errors.push(...validate.errors.map((e) => `${e.instancePath} ${e.message}`))
}

const catIds = new Set(catalog.categories.map((c) => c.id))
const appIds = new Set()
for (const app of catalog.apps) {
  if (appIds.has(app.id)) errors.push(`duplicate app id: ${app.id}`)
  appIds.add(app.id)
  if (!catIds.has(app.category)) errors.push(`${app.id}: unknown category "${app.category}"`)
  const sourceCount =
    app.sources.windows.length + app.sources.macos.length + app.sources.linux.length
  if (sourceCount === 0) errors.push(`${app.id}: no install sources on any platform`)
}

if (errors.length) {
  console.error(`catalog validation FAILED (${errors.length} error${errors.length === 1 ? '' : 's'}):`)
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log(`catalog OK: ${catalog.apps.length} apps, ${catalog.categories.length} categories`)
