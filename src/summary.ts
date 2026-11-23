import path from 'node:path'
import pc from 'picocolors'
import {
  ADMIN_KEY_VAR,
  COLLECTION_NAME,
  DATASET_APPROX_COUNT,
  PRIVATE_ENV_VARS,
  PUBLIC_ENV_VARS,
  TYPESENSE_IMAGE,
} from './constants.js'
import type { ProjectConfig } from './config.js'

const LABEL_WIDTH = 13

/**
 * One `label   value` row. Multi-line values are indented to the value column so
 * the alignment is derived from LABEL_WIDTH rather than hand-counted spaces.
 */
function row(label: string, value: string): string {
  const [first = '', ...rest] = value.split('\n')
  const indent = ' '.repeat(LABEL_WIDTH)
  return [pc.dim(label.padEnd(LABEL_WIDTH)) + first, ...rest.map((line) => indent + line)].join(
    '\n',
  )
}

function describeServer(config: ProjectConfig): string {
  const { server } = config
  if (server.kind === 'docker') {
    return `Docker (${TYPESENSE_IMAGE}) on port ${server.port}, CORS enabled`
  }
  const label = server.flavour === 'cloud' ? 'Typesense Cloud' : 'Existing server'
  return `${label} at ${server.url}`
}

/**
 * The resolved plan, as lines. Returned rather than printed so tests can assert
 * on it.
 */
export function summaryLines(config: ProjectConfig): string[] {
  const { template, server } = config
  const local = server.kind === 'docker'

  return [
    row('Directory', config.targetDir),
    row('Template', template.name),
    row('Server', describeServer(config)),
    row(
      'Collection',
      local
        ? `"${COLLECTION_NAME}" + ${DATASET_APPROX_COUNT} titles (downloaded)`
        : `${
            server.collections.length > 0
              ? server.collections.map((name) => `"${name}"`).join(', ')
              : 'every collection and alias the key can see'
          } ${pc.dim('(read-only)')}`,
    ),
    row('Install', template.deps.join(', ')),
    '',
    row('Env file', path.join(config.projectName, template.env.file)),
    row(
      '  browser',
      PUBLIC_ENV_VARS.map((name) => `${template.env.publicPrefix}${name}`).join('\n'),
    ),
    // An existing server's admin key never reaches the CLI, let alone the project.
    ...(local
      ? [row('  server', `${PRIVATE_ENV_VARS.join(', ')} ${pc.dim('(admin — never prefixed)')}`)]
      : []),
  ]
}

export function nextStepsLines(config: ProjectConfig): string[] {
  if (config.server.kind === 'byo') {
    return [
      `cd ${config.projectName}`,
      `${config.template.devCommand}${pc.dim(`   # ${config.template.devUrl}`)}`,
      '',
      pc.dim('Change what the page searches and shows in typesense.config.json.'),
    ]
  }
  return [
    `cd ${config.projectName}`,
    `${config.template.devCommand}${pc.dim(`   # ${config.template.devUrl} — type "hary potr"`)}`,
    '',
    `npm run seed${pc.dim('             # rebuild the collection from data/books.jsonl')}`,
    `npm run typesense:down${pc.dim('   # stop the server, keeping the indexed data')}`,
    pc.dim('docker compose down --volumes   # ...or stop it and wipe the data too'),
  ]
}

/**
 * Guard rail for the hard rule in CLAUDE.md, enforced at runtime as well as in
 * tests: nothing on the browser-visible list may also be on the secret list.
 */
export function assertAdminKeyNeverPublic(publicPrefix: string): void {
  const offenders = PUBLIC_ENV_VARS.filter((name) =>
    (PRIVATE_ENV_VARS as readonly string[]).includes(name),
  )
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to continue: ${offenders.join(', ')} would be written with the ` +
        `"${publicPrefix}" prefix. ${ADMIN_KEY_VAR} must never reach the browser.`,
    )
  }
}
