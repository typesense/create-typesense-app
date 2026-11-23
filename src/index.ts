#!/usr/bin/env node
import path from 'node:path'
import { intro, log, note, outro, spinner } from '@clack/prompts'
import pc from 'picocolors'
import { USAGE, isInteractive, parseCliArgs, type CliArgs } from './cli.js'
import { ADMIN_KEY_VAR } from './constants.js'
import type { ProjectConfig } from './config.js'
import { readPackageVersion, templatesDir } from './paths.js'
import { resolveDefaults, reviewSearchConfig, runPrompts, settleLocalServer } from './prompts.js'
import { readFileSync } from 'node:fs'
import { rmdir } from 'node:fs/promises'
import { addPackageScripts, installDependencies, projectScripts } from './steps/deps.js'
import { applyOverlay, removeSuperseded } from './steps/overlay.js'
import {
  type ExistingServerResult,
  type InspectedCollection,
  inspectExistingServer,
  readOnlyNotice,
  setUpExistingServer,
} from './steps/existingServer.js'
import { type ProvisionedServer, provisionServer } from './steps/provision.js'
import { ensureScaffold } from './steps/scaffold.js'
import { type SearchSetupResult, setUpSearch } from './steps/searchSetup.js'
import { assertAdminKeyNeverPublic, nextStepsLines, summaryLines } from './summary.js'
import { loadTemplates } from './templates.js'
import { CommandError, showCommand } from './util/clipboard.js'
import { checkDocker } from './util/docker.js'
import { clearRunState, hasRunState, markRunStarted } from './util/state.js'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function logError(error: unknown): Promise<void> {
  log.error(messageOf(error))
  if (error instanceof CommandError) await showCommand(error.command)
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
    serverUrl: cli.serverUrl,
    collections: cli.collections,
    // Never a flag value: that would land in shell history and CI logs.
    apiKey: cli.apiKeyStdin
      ? readFileSync(0, 'utf8').trim()
      : process.env[ADMIN_KEY_VAR]?.trim() || undefined,
  }

  let config: ProjectConfig
  try {
    config = cli.yes ? resolveDefaults(options) : await runPrompts(options)
    // Skipped on a resumed run: this project's own container may hold the port.
    if (config.server.kind === 'docker' && !hasRunState(config.targetDir)) {
      config = {
        ...config,
        server: await settleLocalServer(config.server.port, !cli.yes, config.template, options),
      }
    }
  } catch (error) {
    await logError(error)
    return 1
  }

  // Belt and braces: the hard rule is asserted before anything can be written.
  assertAdminKeyNeverPublic(config.template.env.publicPrefix)

  note(summaryLines(config).join('\n'), 'Plan')

  // Before the scaffold, so a refused key or a missing collection writes nothing.
  let inspected: InspectedCollection[] | undefined
  if (config.server.kind === 'byo') {
    log.info(readOnlyNotice(config.server.url))
    const check = spinner()
    check.start(`Checking ${config.server.url}`)
    try {
      inspected = await inspectExistingServer(config.server)
    } catch (error) {
      check.error('Could not use the existing server')
      await logError(error)
      return 1
    }
    const names = inspected.map((collection) => `"${collection.name}"`).join(', ')
    check.stop(
      `The key can read ${names}, and cannot write documents or create or change collections`,
    )
    for (const collection of inspected) {
      // The interactive picker already warned about these.
      if (cli.yes && collection.documents === 0) {
        log.warn(`"${collection.name}" has no documents, so its section will be empty.`)
      }
      if (!cli.yes) {
        collection.search = await reviewSearchConfig(
          collection.name,
          collection.fields,
          collection.search,
        )
      }
    }
  }

  // Scaffolding has to come first: create-next-app refuses to run in a directory
  // that already holds files, so writing anything before it is a hard error.
  const build = spinner()
  build.start('Scaffolding the project')
  try {
    await ensureScaffold(config, { onStep: (step) => build.message(step) })

    // Only now can the run be marked resumable — before this the directory had to
    // be empty for the framework CLI's sake.
    await markRunStarted(config.targetDir, { version: 1, template: config.template.id })

    const written = await applyOverlay(
      path.join(templatesDir, config.template.id, config.template.files),
      config.targetDir,
    )
    build.message(`Wrote ${written.length} template files`)

    // An existing server is never seeded, so its project gets no seed script.
    const seedScript = config.template.seedCommand.split(' ').at(-1) ?? ''
    const removed = await removeSuperseded(config.targetDir, [
      ...config.template.remove,
      ...(config.server.kind === 'byo' ? [seedScript] : []),
    ])
    if (removed.length > 0) {
      build.message(`Removed ${removed.length} superseded scaffold files`)
    }
    if (config.server.kind === 'byo') {
      // Only succeeds when the seed script was alone in its directory.
      await rmdir(path.join(config.targetDir, path.dirname(seedScript))).catch(() => undefined)
    }

    await installDependencies(config.targetDir, config.template.deps, config.template.devDeps, {
      onStep: (step) => build.message(step),
    })

    if (config.server.kind === 'docker') {
      await addPackageScripts(config.targetDir, projectScripts(config.template))
      build.message('Added the seed and typesense scripts')
    }
  } catch (error) {
    build.error('Could not set up the project')
    await logError(error)
    return 1
  }
  build.stop(`Scaffolded ${config.template.name}`)

  if (config.server.kind === 'byo') {
    const server = config.server
    if (inspected === undefined) throw new Error('The existing server was not inspected.')
    const connect = spinner()
    connect.start(`Reading ${server.url}`)
    let existing: ExistingServerResult[]
    try {
      existing = await setUpExistingServer({ ...config, server }, inspected, {
        onStep: (step) => connect.message(step),
      })
    } catch (error) {
      connect.error('Could not use the existing server')
      await logError(error)
      return 1
    }
    connect.stop(
      `Wired ${existing.length} collection${existing.length === 1 ? '' : 's'} to the search UI`,
    )
    for (const { collection, found } of existing) {
      if (found > 0) log.success(`The search key finds ${found} documents in "${collection}".`)
    }
    log.info(readOnlyNotice(server.url))
    await clearRunState(config.targetDir)
    note(nextStepsLines(config).join('\n'), 'Next')
    outro(`Done in ${config.projectName}.`)
    return 0
  }

  const progress = spinner()
  progress.start('Starting Typesense')
  let provisioned: ProvisionedServer
  try {
    provisioned = await provisionServer(
      { ...config, server: config.server },
      {
        onStep: (step) => progress.message(step),
      },
    )
  } catch (error) {
    progress.error('Could not start Typesense')
    await logError(error)
    return 1
  }
  progress.stop(`Typesense is healthy at ${provisioned.baseUrl}`)

  if (provisioned.reusedAdminKey) {
    log.info('Reused the admin API key from a previous run in this directory.')
  }

  const setup = spinner()
  setup.start('Setting up search')
  let search: SearchSetupResult
  try {
    search = await setUpSearch(config, provisioned, {
      onStep: (step) => setup.message(step),
    })
  } catch (error) {
    setup.error('Could not set up the collection')
    await logError(error)
    return 1
  }
  setup.stop(`Indexed ${search.documentsImported} documents into "${search.collection}"`)

  log.success(
    `Typo tolerance works: ${pc.bold(`"${search.verification.query}"`)} → ` +
      `${pc.bold(search.verification.topHit)} (${search.verification.found} hits)`,
  )

  // The run completed, so the resume marker goes away: a finished project should
  // be refused next time, not silently scaffolded over.
  await clearRunState(config.targetDir)

  note(nextStepsLines(config).join('\n'), 'Next')

  outro(`Done in ${config.projectName}. Type a misspelling and watch.`)
  return 0
}

process.exitCode = await main()
