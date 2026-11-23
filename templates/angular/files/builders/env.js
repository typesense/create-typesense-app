/**
 * The browser's half of .env: only the NG_APP_ variables, inlined as
 * `import.meta.env`. Angular reads no env file by itself.
 *
 * The admin key, TYPESENSE_API_KEY, has no prefix, so it is skipped here and
 * never reaches the bundle. Only scripts/seed.js reads it.
 */
const { readFileSync } = require('node:fs')
const path = require('node:path')

const PREFIX = 'NG_APP_'

function publicEnv(root) {
  let contents = ''
  try {
    contents = readFileSync(path.join(root, '.env'), 'utf8')
  } catch {
    // No .env: the app reports each missing variable by name.
  }
  const env = {}
  for (const line of contents.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match?.[1].startsWith(PREFIX)) env[match[1]] = match[2].trim()
  }
  return env
}

/** Build options with the public env added to esbuild's `define`. */
async function withEnv(options, context) {
  const validated = await context.validateOptions(options, '@angular/build:application')
  const env = JSON.stringify(publicEnv(context.workspaceRoot))
  return { ...validated, define: { ...validated.define, 'import.meta.env': env } }
}

module.exports = { withEnv }
