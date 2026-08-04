#!/usr/bin/env node
import { intro, log, note, outro } from '@clack/prompts'
import pc from 'picocolors'
import { USAGE, isInteractive, parseCliArgs, type CliArgs } from './cli.js'
import { TYPESENSE_IMAGE } from './constants.js'
import type { ProjectConfig } from './config.js'
import { readPackageVersion } from './paths.js'
import { resolveDefaults, runPrompts } from './prompts.js'
import { assertAdminKeyNeverPublic, nextStepsLines, summaryLines } from './summary.js'
import { loadTemplates } from './templates.js'
import { checkDocker } from './util/docker.js'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main(): Promise<number> {
  let cli: CliArgs
  try {
    cli = parseCliArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${pc.red('✖')} ${messageOf(error)}\n\n${USAGE}`)
    return 1
  }

  if (cli.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (cli.version) {
    process.stdout.write(`${await readPackageVersion()}\n`)
    return 0
  }

  // Checked before the banner so a non-interactive run fails on one clean line.
  if (!cli.yes && !isInteractive()) {
    process.stderr.write(
      `${pc.red('✖')} No interactive terminal detected. Re-run with --yes to accept the defaults.\n`,
    )
    return 1
  }

  intro(pc.bgCyan(pc.black(' create-typesense-app ')))

  // Detect Docker up front (PLAN.md §7) — in parallel with loading manifests,
  // since the daemon probe is the slow one.
  const [templates, docker] = await Promise.all([loadTemplates(), checkDocker()])

  const options = {
    templates,
    docker,
    cwd: process.cwd(),
    projectName: cli.projectName,
    templateId: cli.templateId,
    port: cli.port,
  }

  let config: ProjectConfig
  try {
    config = cli.yes ? resolveDefaults(options) : await runPrompts(options)
  } catch (error) {
    log.error(messageOf(error))
    return 1
  }

  // Belt and braces: the hard rule is asserted before anything can be written.
  assertAdminKeyNeverPublic(config.template.env.publicPrefix)

  note(summaryLines(config).join('\n'), 'Plan')
  note(nextStepsLines(config).join('\n'), 'Then')

  log.warn(
    `${pc.bold('M0 — nothing was written.')} No directory created, no ${TYPESENSE_IMAGE} pulled.`,
  )
  outro(cli.yes ? 'Defaults resolved.' : 'Prompt flow complete.')
  return 0
}

process.exitCode = await main()
