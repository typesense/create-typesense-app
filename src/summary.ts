import path from 'node:path'
import pc from 'picocolors'
import {
  ADMIN_KEY_VAR,
  COLLECTION_NAME,
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
  const { template } = config

  return [
    row('Directory', config.targetDir),
    row('Template', template.name),
    row('Server', describeServer(config)),
    row(
      'Collection',
      config.dataset === 'books'
        ? `"${COLLECTION_NAME}" + 1k sample titles`
        : 'none (empty — bring your own JSON)',
    ),
    row('Install', template.deps.join(', ')),
    '',
    row('Env file', path.join(config.projectName, template.env.file)),
    row(
      '  browser',
      PUBLIC_ENV_VARS.map((name) => `${template.env.publicPrefix}${name}`).join('\n'),
    ),
    row('  server', `${PRIVATE_ENV_VARS.join(', ')} ${pc.dim('(admin — never prefixed)')}`),
  ]
}

export function nextStepsLines(config: ProjectConfig): string[] {
  return [
    `cd ${config.projectName}`,
    config.template.devCommand,
    pc.dim(`# then open ${config.template.devUrl} and type "hary potr"`),
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
