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
  -t, --template <id>   ${TEMPLATE_IDS.join(' | ')}
      --port <number>   host port for the local Docker server (default ${DEFAULT_PORT})
  -y, --yes             accept defaults: ${TEMPLATE_IDS[0]}, local Docker, books dataset
  -h, --help            show this
  -v, --version         print the version

${pc.bold('Examples')}
  npx create-typesense-app@latest
  npx create-typesense-app@latest my-search-app --yes
  npx create-typesense-app@latest my-search-app -t ${TEMPLATE_IDS[1]}
`.trimStart()

export interface CliArgs {
  projectName?: string
  templateId?: string
  port: number
  yes: boolean
  help: boolean
  version: boolean
}

/**
 * Pure so it can be tested without booting the prompt flow. Throws on bad input;
 * the caller turns that into usage output and a non-zero exit.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      template: { type: 'string', short: 't' },
      port: { type: 'string' },
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
    throw new Error(
      `Unknown template "${values.template}". Available: ${TEMPLATE_IDS.join(', ')}`,
    )
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
    yes: values.yes,
    help: values.help,
    version: values.version,
  }
}
