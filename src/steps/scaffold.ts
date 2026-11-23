import { existsSync } from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import type { ProjectConfig } from '../config.js'
import type { TemplateManifest } from '../templates.js'

export interface ScaffoldOutcome {
  /** False when a project was already there and scaffolding was skipped. */
  scaffolded: boolean
}

/** Splits a shell-ish command, keeping quoted arguments in one piece. */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let started = false

  for (const character of command) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }

  if (started) tokens.push(current)
  return tokens
}

/**
 * Turns a manifest's `scaffold` string into an argv array.
 *
 * Tokenising happens *before* the placeholder is substituted, so a project
 * directory containing spaces stays a single argument instead of being split and
 * scaffolded into the wrong place.
 */
export function buildScaffoldCommand(
  scaffold: string,
  dir: string,
): { command: string; args: string[] } {
  if (!scaffold.includes('{{dir}}')) {
    throw new Error(`Scaffold command is missing the {{dir}} placeholder: ${scaffold}`)
  }

  const tokens = tokenizeCommand(scaffold).map((token) =>
    token.includes('{{dir}}') ? token.replaceAll('{{dir}}', dir) : token,
  )

  const [command, ...args] = tokens
  if (command === undefined) {
    throw new Error('Scaffold command is empty.')
  }
  return { command, args }
}

/**
 * Where and how to run a template's scaffold command.
 *
 * The directory is passed as a bare name with the parent as cwd, never as an
 * absolute path. create-next-app accepts either, but create-vite treats its
 * argument as relative even when it is absolute: given /tmp/x/my-app it builds
 * tmp/x/my-app *inside* the current directory and leaves the real target empty,
 * exiting 0 either way.
 */
export function scaffoldInvocation(
  template: TemplateManifest,
  targetDir: string,
): { command: string; args: string[]; cwd: string } {
  const { command, args } = buildScaffoldCommand(template.scaffold, path.basename(targetDir))
  return { command, args, cwd: path.dirname(targetDir) }
}

/**
 * Runs the framework's own CLI, unless a project is already there.
 *
 * The skip matters twice over: it makes a re-run after a failure work, and
 * create-next-app refuses outright to run in a directory that already holds
 * files, so trying again would otherwise be a hard error.
 */
export async function ensureScaffold(
  config: ProjectConfig,
  { onStep = () => {} }: { onStep?: (message: string) => void } = {},
): Promise<ScaffoldOutcome> {
  if (existsSync(path.join(config.targetDir, 'package.json'))) {
    onStep('A project is already here — skipping scaffold')
    return { scaffolded: false }
  }

  const { command, args, cwd } = scaffoldInvocation(config.template, config.targetDir)
  onStep(`Scaffolding ${config.template.name}`)

  try {
    await execa(command, args, { cwd, timeout: 600_000, stdin: 'ignore' })
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '').trim()
        : ''
    throw new Error(
      `Scaffolding failed: \`${command} ${args.join(' ')}\`${stderr ? `\n${stderr}` : ''}`,
      { cause: error },
    )
  }

  if (!existsSync(path.join(config.targetDir, 'package.json'))) {
    throw new Error(`Scaffolding reported success but left no package.json in ${config.targetDir}.`)
  }

  return { scaffolded: true }
}
