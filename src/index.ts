#!/usr/bin/env node
import path from 'node:path'
import { intro, log, note, outro, spinner } from '@clack/prompts'
import pc from 'picocolors'
import { USAGE, isInteractive, parseCliArgs, type CliArgs } from './cli.js'
import { DEMO_QUERY_BY } from './constants.js'
import type { ProjectConfig } from './config.js'
import { readPackageVersion, templatesDir } from './paths.js'
import { resolveDefaults, runPrompts } from './prompts.js'
import { addPackageScripts, installDependencies, projectScripts } from './steps/deps.js'
import { applyOverlay } from './steps/overlay.js'
import { provisionServer } from './steps/provision.js'
import { ensureScaffold } from './steps/scaffold.js'
import { setUpSearch } from './steps/searchSetup.js'
import { assertAdminKeyNeverPublic, nextStepsLines, summaryLines } from './summary.js'
import { loadTemplates } from './templates.js'
import { checkDocker } from './util/docker.js'
import { clearRunState, markRunStarted } from './util/state.js'

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
    dataset: cli.dataset,
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

    await installDependencies(config.targetDir, config.template.deps, config.template.devDeps, {
      onStep: (step) => build.message(step),
    })

    await addPackageScripts(config.targetDir, projectScripts())
    build.message('Added the seed and typesense scripts')
  } catch (error) {
    build.error('Could not set up the project')
    log.error(messageOf(error))
    return 1
  }
  build.stop(`Scaffolded ${config.template.name}`)

  const progress = spinner()
  progress.start('Starting Typesense')
  let provisioned
  try {
    provisioned = await provisionServer(config, {
      onStep: (step) => progress.message(step),
    })
  } catch (error) {
    progress.error('Could not start Typesense')
    log.error(messageOf(error))
    return 1
  }
  progress.stop(`Typesense is healthy at ${provisioned.baseUrl}`)

  if (provisioned.reusedAdminKey) {
    log.info('Reused the admin API key from a previous run in this directory.')
  }

  const setup = spinner()
  setup.start('Setting up search')
  let search
  try {
    search = await setUpSearch(config, provisioned, {
      onStep: (step) => setup.message(step),
    })
  } catch (error) {
    setup.error('Could not set up the collection')
    log.error(messageOf(error))
    return 1
  }
  setup.stop(
    search.documentsImported > 0
      ? `Indexed ${search.documentsImported} documents into "${search.collection}"`
      : `Created empty collection "${search.collection}"`,
  )

  if (search.verification.found > 0) {
    log.success(
      `Typo tolerance works: ${pc.bold(`"${search.verification.query}"`)} → ` +
        `${pc.bold(search.verification.topHit)} (${search.verification.found} hits)`,
    )
  }

  // The run completed, so the resume marker goes away: a finished project should
  // be refused next time, not silently scaffolded over.
  await clearRunState(config.targetDir)

  note(nextStepsLines(config).join('\n'), 'Next')

  outro(`Done in ${config.projectName}. Type a misspelling and watch.`)
  return 0
}

process.exitCode = await main()
