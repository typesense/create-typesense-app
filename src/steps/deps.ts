import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import type { TemplateManifest } from '../templates.js'

export interface InstallOptions {
  onStep?: (message: string) => void
}

/**
 * Installs the template's dependencies.
 *
 * The scaffold step runs the framework CLI with install skipped, so this single
 * pass installs the framework's own dependencies and the template's together
 * instead of paying for two full installs.
 */
export async function installDependencies(
  targetDir: string,
  deps: string[],
  devDeps: string[],
  { onStep = () => {} }: InstallOptions = {},
): Promise<void> {
  async function npm(args: string[], description: string): Promise<void> {
    onStep(description)
    try {
      await execa('npm', args, { cwd: targetDir, timeout: 900_000, stdin: 'ignore' })
    } catch (error) {
      const stderr =
        typeof error === 'object' && error !== null && 'stderr' in error
          ? String((error as { stderr?: unknown }).stderr ?? '').trim()
          : ''
      throw new Error(
        `\`npm ${args.join(' ')}\` failed in ${targetDir}${stderr ? `:\n${stderr}` : '.'}`,
        { cause: error },
      )
    }
  }

  await npm(['install', ...deps], `Installing ${deps.join(', ')}`)

  if (devDeps.length > 0) {
    await npm(['install', '--save-dev', ...devDeps], `Installing ${devDeps.join(', ')}`)
  }
}

/** Merges scripts into the project's package.json, leaving the framework's own alone. */
export function mergeScripts(packageJson: string, scripts: Record<string, string>): string {
  const parsed = JSON.parse(packageJson) as Record<string, unknown> & {
    scripts?: Record<string, string>
  }

  parsed.scripts = { ...(parsed.scripts ?? {}), ...scripts }

  // npm writes package.json with two-space indent and a trailing newline.
  return `${JSON.stringify(parsed, null, 2)}\n`
}

export async function addPackageScripts(
  targetDir: string,
  scripts: Record<string, string>,
): Promise<void> {
  const file = path.join(targetDir, 'package.json')
  const contents = await readFile(file, 'utf8').catch(() => undefined)
  if (contents === undefined) {
    throw new Error(`No package.json in ${targetDir} to add scripts to.`)
  }
  await writeFile(file, mergeScripts(contents, scripts), 'utf8')
}

/**
 * Scripts added alongside the framework's own (PLAN.md §6).
 *
 * The two docker commands are framework-agnostic and need no flags, because the
 * generated compose file uses no variable substitution. Only the seed runner is
 * framework-specific, and it comes from the manifest.
 *
 * `typesense:down` deliberately omits `--volumes`. It is the everyday "stop for
 * now" command, and wiping the index on every stop would bring the app back empty
 * until it was reseeded. A deliberate wipe is `docker compose down --volumes`.
 */
export function projectScripts(template: TemplateManifest): Record<string, string> {
  return {
    seed: template.seedCommand,
    'typesense:up': 'docker compose up --detach',
    'typesense:down': 'docker compose down',
  }
}
