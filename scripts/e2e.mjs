#!/usr/bin/env node
/**
 * Proves one template works for a real user: scaffold it with the built CLI,
 * build it, start its dev server, then check in a headless browser that the page
 * opens with results and that a misspelling finds its document.
 *
 *   npm run build && npm run e2e -- nextjs              # local server, books
 *   npm run build && npm run e2e -- nextjs --existing   # existing server, movies
 *
 * --existing starts its own Typesense, loads test/fixtures/movies.json (no field
 * in common with books) and runs the CLI against it with the admin key, the way
 * a developer with their own server would.
 *
 * Skips (exit 0) when Docker is unavailable. Never prints a key: the CLI's own
 * output names the key variables but not their values.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { chromium } from 'playwright'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const [id, mode] = process.argv.slice(2)
const existing = mode === '--existing'
if (id === undefined) {
  console.error('Usage: npm run e2e -- <template id> [--existing]')
  process.exit(2)
}

const docker = await execa('docker', ['info'], { reject: false })
if (docker.exitCode !== 0) {
  console.log(`Skipped ${id}: Docker is not available.`)
  process.exit(0)
}

const { default: manifest } = await import(path.join(root, 'templates', id, 'template.config.js'))

// Another dev server on the template's port would answer the checks instead of ours,
// while the framework quietly moves ours to the next port.
if (
  await fetch(manifest.devUrl).then(
    () => true,
    () => false,
  )
) {
  console.error(
    `✖ ${manifest.devUrl} already answers. Stop the process on that port, then run the check again.`,
  )
  process.exit(1)
}

// What the page must show: the top document of the empty query, and the
// document a misspelling must find instead of it.
const expected = existing
  ? { firstLoad: 'Oppenheimer', query: 'godfathr', hit: 'The Godfather' }
  : { firstLoad: 'The Hunger Games', query: 'hary potr', hit: 'Harry Potter' }

const workDir = mkdtempSync(path.join(tmpdir(), `e2e-${id}-`))
const appDir = path.join(workDir, 'app')
const run = (file, args, cwd, env = {}) =>
  execa(file, args, { cwd, stdio: 'inherit', env: { CI: '1', ...env } })

const container = `cta-e2e-existing-${process.pid}`
let dev
let existingAdminKey
try {
  const cli = [path.join(root, 'dist', 'index.js'), 'app', '--yes', '-t', id]
  if (existing) {
    console.log('\n▸ Starting a Typesense that already holds a movies collection')
    const url = 'http://localhost:8308'
    existingAdminKey = await startExistingServer(url)
    console.log(`\n▸ Scaffolding ${id} against ${url}`)
    await run('node', [...cli, '--server-url', url, '--collections', 'movies'], workDir, {
      TYPESENSE_API_KEY: existingAdminKey,
    })
  } else {
    console.log(`\n▸ Scaffolding ${id} in ${appDir}`)
    await run('node', cli, workDir)
  }

  console.log('\n▸ Building the generated project')
  await run('npm', ['run', 'build'], appDir)

  // A local project keeps its admin key in the env file, for the seed script. An
  // existing server's admin key is used for the run only, so it must be in no file.
  const leaks = existing
    ? filesContaining(appDir, existingAdminKey, { skipEnv: false })
    : filesContaining(appDir, adminKeyOf(appDir, manifest.env.file), { skipEnv: true })
  if (leaks.length > 0) {
    throw new Error(`The admin key is in files the build produced: ${leaks.join(', ')}`)
  }
  console.log(`  the admin key is in no file${existing ? '' : ' except the env file'}`)

  console.log(`\n▸ Starting ${manifest.devCommand}`)
  const [command, ...args] = manifest.devCommand.split(' ')
  // Its own process group, so the dev server's children die with it.
  dev = spawn(command, args, { cwd: appDir, stdio: 'ignore', detached: true })
  await waitForHttp(manifest.devUrl)
  console.log(`  ${manifest.devUrl} answers 200`)

  console.log('\n▸ Searching in a headless browser')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(manifest.devUrl)
    const text = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30_000 })

    await text((first) => document.body.innerText.includes(first), expected.firstLoad)
    console.log('  opens with results')

    await page.locator('input[type=search]').first().fill(expected.query)
    // The first-load results are gone and the typo found its document.
    await text(
      ({ firstLoad, hit }) =>
        !document.body.innerText.includes(firstLoad) && document.body.innerText.includes(hit),
      expected,
    )
    // Text only: Next.js adds an empty role=alert element as its route announcer.
    const error = page.locator('[role=alert]').filter({ hasText: /\S/ })
    if ((await error.count()) > 0) {
      throw new Error(`The page shows a search error: ${await error.first().textContent()}`)
    }
    console.log(`  "${expected.query}" finds ${expected.hit}`)
  } finally {
    await browser.close()
  }
  console.log(`\n✔ ${id}${existing ? ' --existing' : ''} works`)
} catch (error) {
  console.error(
    `\n✖ ${id}${existing ? ' --existing' : ''} failed: ${error instanceof Error ? error.message : error}`,
  )
  process.exitCode = 1
} finally {
  if (dev?.pid !== undefined) {
    try {
      process.kill(-dev.pid)
    } catch {}
  }
  if (existing) await execa('docker', ['rm', '--force', container], { reject: false })
  else await execa('docker', ['compose', 'down', '--volumes'], { cwd: appDir, reject: false })
}

/**
 * Test setup, not the CLI: this server is ours to write to. Returns its admin
 * key, which the CLI uses to create the browser's search-only key.
 */
async function startExistingServer(url) {
  const { TYPESENSE_IMAGE } = await import(path.join(root, 'dist', 'constants.js'))
  const adminKey = randomBytes(24).toString('hex')
  await execa('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--publish',
    `${new URL(url).port}:8108`,
    TYPESENSE_IMAGE,
    '--data-dir=/tmp',
    `--api-key=${adminKey}`,
    '--enable-cors',
  ])
  await waitForHttp(`${url}/health`)

  const admin = (method, endpoint, body) =>
    fetch(`${url}${endpoint}`, {
      method,
      headers: { 'X-TYPESENSE-API-KEY': adminKey, 'Content-Type': 'application/json' },
      body,
    }).then(async (response) => {
      if (!response.ok)
        throw new Error(`Fixture setup: ${method} ${endpoint} replied ${response.status}`)
      return response.text()
    })

  const fixture = JSON.parse(
    readFileSync(path.join(root, 'test', 'fixtures', 'movies.json'), 'utf8'),
  )
  await admin('POST', '/collections', JSON.stringify(fixture.schema))
  // The import replies with one JSON object per line: a 200 does not mean success.
  const imported = await admin(
    'POST',
    '/collections/movies/documents/import',
    fixture.documents.map((document) => JSON.stringify(document)).join('\n'),
  )
  if (imported.includes('"success":false')) throw new Error(`Fixture import failed: ${imported}`)
  return adminKey
}

/** The admin key's value, from the env file the CLI wrote. */
function adminKeyOf(dir, envFile) {
  const line = readFileSync(path.join(dir, envFile), 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('TYPESENSE_API_KEY='))
  const key = line?.slice('TYPESENSE_API_KEY='.length).trim() ?? ''
  if (key === '') throw new Error(`${envFile} has no TYPESENSE_API_KEY`)
  return key
}

/**
 * Every file under `dir` that contains `secret`, so a leak shows in the built
 * output whatever the framework calls its build directory. Skips installed
 * packages, and with `skipEnv` the env files, which hold a local admin key on
 * purpose.
 */
function filesContaining(dir, secret, { skipEnv }, root = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return ['node_modules', '.git'].includes(entry.name)
        ? []
        : filesContaining(full, secret, { skipEnv }, root)
    }
    if (!entry.isFile() || (skipEnv && /^\.env/.test(entry.name))) return []
    return readFileSync(full).includes(secret) ? [path.relative(root, full)] : []
  })
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await fetch(url).then(
      (response) => response.status,
      () => 0,
    )
    if (status === 200) return
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`${url} did not answer 200 within ${timeoutMs / 1_000}s`)
}
