import { parseArgs } from 'node:util'
import { isCI } from '@clack/prompts'
import pc from 'picocolors'
import { DEFAULT_PORT } from './constants.js'
import { TEMPLATE_IDS } from './templates.js'

/**
 * Whether we can actually prompt.
 *
 * Note that `@clack/prompts` exports `isTTY` as `(output) => boolean`, so using
 * it as a bare boolean silently always passes — hence this explicit check on
 * stdin, which is the stream the prompts read from.
 */
export function isInteractive(
  stdin: { isTTY?: boolean | undefined } = process.stdin,
  ci: boolean = isCI(),
): boolean {
  return stdin.isTTY === true && !ci
}

export const USAGE = `
${pc.bold('create-typesense-app')} — scaffold a working Typesense search UI in one command.

${pc.bold('Usage')}
  npx create-typesense-app@latest [directory] [options]

${pc.bold('Options')}
  -t, --template <id>      ${TEMPLATE_IDS.join(' | ')}
      --port <number>      host port for the local Docker server (default ${DEFAULT_PORT})
      --server-url <url>   search an existing server instead, read-only
      --collections <a,b>  collections or aliases to search there (default: all)
      --api-key-stdin      read its key from stdin (otherwise $TYPESENSE_API_KEY, or a prompt)
  -y, --yes                accept defaults: ${TEMPLATE_IDS[0]}, local Docker, books sample data
  -h, --help               show this
  -v, --version            print the version

${pc.bold('Examples')}
  npx create-typesense-app@latest
  npx create-typesense-app@latest my-search-app --yes
  TYPESENSE_API_KEY=… npx create-typesense-app@latest my-search-app --yes \\
    --server-url https://xyz.a1.typesense.net --collections products
`.trimStart()

export function validateServerUrl(value: string): string | undefined {
  const raw = value.trim()
  if (raw === '') return 'A server URL is required.'
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return 'Enter a full URL, e.g. http://localhost:8108'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'URL must start with http:// or https://'
  }
  // The generated app connects with host, port and protocol only, so a path such
  // as https://example.com/typesense would work for the CLI but not the browser.
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    return 'Use the server address without a path, e.g. https://xyz.a1.typesense.net'
  }
  return undefined
}

export interface CliArgs {
  projectName?: string
  templateId?: string
  port: number
  serverUrl?: string
  collections?: string[]
  apiKeyStdin: boolean
  yes: boolean
  help: boolean
  version: boolean
}

/**
 * Pure so it can be tested without booting the prompt flow. Throws on bad input;
 * the caller turns that into usage output and a non-zero exit.
 */
/** A comma-separated list of names, trimmed, with empty entries dropped. */
export function splitNames(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      template: { type: 'string', short: 't' },
      dataset: { type: 'string' },
      port: { type: 'string' },
      'server-url': { type: 'string' },
      collections: { type: 'string' },
      'api-key-stdin': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
  })

  if (positionals.length > 1) {
    throw new Error(
      `Expected at most one directory argument, got ${positionals.length}: ${positionals.join(' ')}`,
    )
  }

  if (values.template !== undefined && !TEMPLATE_IDS.includes(values.template as never)) {
    throw new Error(`Unknown template "${values.template}". Available: ${TEMPLATE_IDS.join(', ')}`)
  }

  // Still parsed so old scripts passing `--dataset books` keep working; books is now the only option.
  if (values.dataset === 'empty') {
    throw new Error(
      'The empty dataset was removed: a local server always loads the books sample data.\n' +
        'To search your own data, drop --yes and choose "I already have one running".',
    )
  }
  if (values.dataset !== undefined && values.dataset !== 'books') {
    throw new Error(`Unknown dataset "${values.dataset}". A local server always loads books.`)
  }

  const serverUrl = values['server-url']
  if (serverUrl !== undefined) {
    const error = validateServerUrl(serverUrl)
    if (error) throw new Error(`--server-url: ${error}`)
  }

  const collections = values.collections === undefined ? undefined : splitNames(values.collections)
  if (collections !== undefined && serverUrl === undefined) {
    throw new Error('--collections needs --server-url: it names collections on an existing server.')
  }

  let port = DEFAULT_PORT
  if (values.port !== undefined) {
    port = Number(values.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`--port must be an integer between 1 and 65535, got "${values.port}"`)
    }
  }

  return {
    projectName: positionals[0],
    templateId: values.template,
    port,
    serverUrl: serverUrl?.trim().replace(/\/+$/, ''),
    collections,
    apiKeyStdin: values['api-key-stdin'],
    yes: values.yes,
    help: values.help,
    version: values.version,
  }
}
