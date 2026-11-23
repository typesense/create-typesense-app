import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  COLLECTION_VAR,
  HOST_VAR,
  PORT_VAR,
  PRIVATE_ENV_VARS,
  PROTOCOL_VAR,
  PUBLIC_ENV_VARS,
  SEARCH_KEY_VAR,
} from '../constants.js'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Maps a logical variable name to the name actually written to the env file.
 *
 * Publicness is *looked up*, never passed in. That is what makes the hard rule
 * structural: there is no argument a caller could get wrong that would prefix the
 * admin key and expose it to the browser.
 */
export function envVarName(logicalName: string, publicPrefix: string): string {
  if ((PRIVATE_ENV_VARS as readonly string[]).includes(logicalName)) {
    return logicalName
  }
  if ((PUBLIC_ENV_VARS as readonly string[]).includes(logicalName)) {
    return `${publicPrefix}${logicalName}`
  }
  throw new Error(
    `Unknown env variable "${logicalName}". Add it to PUBLIC_ENV_VARS or ` +
      'PRIVATE_ENV_VARS in src/constants.ts so its exposure is an explicit decision.',
  )
}

/**
 * Merges values into existing env-file content: replaces an assignment if the
 * variable is already there, appends it otherwise, and leaves every other line
 * alone. Idempotent, so a re-run after a failed step is safe.
 */
export function upsertEnvContents(
  existing: string,
  values: Record<string, string>,
  publicPrefix: string,
): string {
  const lines = existing.length === 0 ? [] : existing.replace(/\n+$/, '').split('\n')

  for (const [logicalName, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) {
      throw new Error(
        `Refusing to write ${logicalName}: the value contains a newline, which ` +
          'would inject a second variable into the env file.',
      )
    }

    const name = envVarName(logicalName, publicPrefix)
    const assignment = `${name}=${value}`
    // Anchored and exact, so TYPESENSE_X is never mistaken for PUBLIC_TYPESENSE_X.
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}=`)
    const index = lines.findIndex((line) => pattern.test(line))

    if (index === -1) {
      lines.push(assignment)
    } else {
      lines[index] = assignment
    }
  }

  return `${lines.join('\n')}\n`
}

/**
 * Reads assignments back out of an env file. Deliberately minimal — enough to
 * recover a key written by an earlier run so a re-run reuses it instead of
 * generating one the running container would reject.
 */
export function parseEnvContents(contents: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of contents.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    const [, name, rawValue = ''] = match
    if (name === undefined) continue
    values[name] = rawValue.trim()
  }
  return values
}

export async function readEnvFile(filePath: string): Promise<Record<string, string>> {
  const contents = await readFile(filePath, 'utf8').catch(() => '')
  return parseEnvContents(contents)
}

/**
 * The browser-visible connection details, derived from the server URL so the CLI
 * and the template cannot disagree about where Typesense is.
 *
 * Every name returned is on PUBLIC_ENV_VARS, so the writer prefixes all of them.
 * The admin key is deliberately not here — it is written separately, unprefixed.
 */
export function connectionEnvValues(
  baseUrl: string,
  collection: string,
  searchOnlyKey: string,
): Record<string, string> {
  const url = new URL(baseUrl)
  const protocol = url.protocol.replace(/:$/, '')
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error(`Unsupported protocol "${url.protocol}" in server URL ${baseUrl}`)
  }

  return {
    [HOST_VAR]: url.hostname,
    // URL leaves `port` empty for a default port, but the client needs a number.
    [PORT_VAR]: url.port === '' ? (protocol === 'https' ? '443' : '80') : url.port,
    [PROTOCOL_VAR]: protocol,
    [COLLECTION_VAR]: collection,
    [SEARCH_KEY_VAR]: searchOnlyKey,
  }
}

export async function writeEnvFile(
  filePath: string,
  values: Record<string, string>,
  publicPrefix: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const existing = await readFile(filePath, 'utf8').catch(() => '')
  await writeFile(filePath, upsertEnvContents(existing, values, publicPrefix), 'utf8')
  await ensureGitIgnored(filePath)
}

/**
 * The env file holds the keys, so git must never pick it up. Vite's starters
 * ignore only `*.local` and Angular's ignores no env file at all, while their
 * frameworks read `.env`. An overlay cannot ship the fix: npm drops `.gitignore`
 * files from published packages.
 */
export async function ensureGitIgnored(filePath: string): Promise<void> {
  const gitignore = path.join(path.dirname(filePath), '.gitignore')
  const name = path.basename(filePath)
  const contents = await readFile(gitignore, 'utf8').catch(() => '')
  const covered = contents
    .split('\n')
    .map((line) => line.trim())
    .some(
      (line) =>
        line === name || line === `/${name}` || (line === '.env*' && name.startsWith('.env')),
    )
  if (covered) return

  const separator = contents === '' || contents.endsWith('\n') ? '' : '\n'
  await writeFile(
    gitignore,
    `${contents}${separator}\n# Typesense keys, written by create-typesense-app. Never commit them.\n/${name}\n`,
    'utf8',
  )
}
