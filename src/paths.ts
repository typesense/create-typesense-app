import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Root of the installed package.
 *
 * Both the published `dist/*.js` and the `src/*.ts` used under vitest sit
 * exactly one directory below the package root, so one expression covers both
 * and there is no dev/prod branch to get wrong.
 */
export const packageRoot = fileURLToPath(new URL('../', import.meta.url))

export const templatesDir = path.join(packageRoot, 'templates')
export const dataDir = path.join(packageRoot, 'data')

export async function readPackageVersion(): Promise<string> {
  const raw = await readFile(path.join(packageRoot, 'package.json'), 'utf8')
  const parsed = JSON.parse(raw) as { version?: string }
  return parsed.version ?? '0.0.0'
}
