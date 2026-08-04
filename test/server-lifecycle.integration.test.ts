/**
 * The M1 acceptance criterion, automated: a real container comes up, /health
 * reports ok, and teardown leaves nothing behind.
 *
 * Skipped when Docker is unavailable so the unit suite still runs anywhere.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterAll, describe, expect, it } from 'vitest'
import { ADMIN_KEY_VAR } from '../src/constants.js'
import type { ProjectConfig } from '../src/config.js'
import { COMPOSE_FILE } from '../src/steps/compose.js'
import { readEnvFile } from '../src/steps/env.js'
import { provisionServer } from '../src/steps/provision.js'
import { composeDown, waitForHealth } from '../src/steps/server.js'
import { loadTemplate } from '../src/templates.js'
import { checkDocker } from '../src/util/docker.js'

const docker = await checkDocker()

// A high port, so a developer's own Typesense on 8108 is never disturbed.
const PORT = 8391
const PROJECT = 'cta-m1'

const projectDir = path.join(mkdtempSync(path.join(tmpdir(), 'cta-m1-')), PROJECT)
const envFile = path.join(projectDir, '.env.local')
const baseUrl = `http://127.0.0.1:${PORT}`

async function containerExists(): Promise<boolean> {
  const { stdout } = await execa('docker', [
    'ps',
    '--all',
    '--filter',
    `name=^${PROJECT}-typesense$`,
    '--format',
    '{{.Names}}',
  ])
  return stdout.trim() !== ''
}

async function volumeCount(): Promise<number> {
  const { stdout } = await execa('docker', [
    'volume',
    'ls',
    '--filter',
    `name=${PROJECT}`,
    '--format',
    '{{.Name}}',
  ])
  return stdout.trim() === '' ? 0 : stdout.trim().split('\n').length
}

afterAll(async () => {
  // Never leave a container behind, even if an assertion above failed.
  if (docker.available) {
    await composeDown(projectDir).catch(() => undefined)
  }
})

describe.skipIf(!docker.available)('server lifecycle against a real container', () => {
  let adminKey = ''

  async function config(): Promise<ProjectConfig> {
    return {
      projectName: PROJECT,
      targetDir: projectDir,
      template: await loadTemplate('nextjs'),
      server: { kind: 'docker', port: PORT },
      dataset: 'books',
    }
  }

  it(
    'starts Typesense, reports healthy, and answers only with the generated key',
    async () => {
      const result = await provisionServer(await config())
      adminKey = result.adminKey

      expect(result.composeFile).toBe(path.join(projectDir, COMPOSE_FILE))
      expect(result.reusedAdminKey).toBe(false)
      expect(adminKey).toHaveLength(43)

      // The M1 curl, as a request: GET /health returns {"ok":true}.
      const health = await fetch(`${baseUrl}/health`)
      expect(await health.json()).toEqual({ ok: true })

      // The generated key is really in force: an admin-only endpoint needs it...
      const authorized = await fetch(`${baseUrl}/collections`, {
        headers: { 'X-TYPESENSE-API-KEY': adminKey },
      })
      expect(authorized.status).toBe(200)

      // ...and rejects a wrong one, so the container is not running open.
      const unauthorized = await fetch(`${baseUrl}/collections`, {
        headers: { 'X-TYPESENSE-API-KEY': 'not-the-key' },
      })
      expect(unauthorized.status).toBe(401)
    },
    180_000,
  )

  it(
    'writes the admin key to the env file unprefixed, never to the browser',
    async () => {
      const contents = await readEnvFile(envFile)
      expect(contents[ADMIN_KEY_VAR]).toBe(adminKey)
      expect(contents[`NEXT_PUBLIC_${ADMIN_KEY_VAR}`]).toBeUndefined()
    },
  )

  it(
    're-runs cleanly: the key is reused and the container is not disturbed',
    async () => {
      const result = await provisionServer(await config())
      expect(result.reusedAdminKey).toBe(true)
      expect(result.adminKey).toBe(adminKey)
      expect(await containerExists()).toBe(true)

      // Still the same key in force, so the container was not recreated with a new one.
      const authorized = await fetch(`${baseUrl}/collections`, {
        headers: { 'X-TYPESENSE-API-KEY': adminKey },
      })
      expect(authorized.status).toBe(200)
    },
    180_000,
  )

  /**
   * Regression, and the M1 criterion: this is the *bare* command printed for the
   * user, with no --env-file. With `${...}` substitution in the compose file it
   * failed to interpolate and teardown was impossible.
   */
  it(
    'tears down with a bare `docker compose down --volumes`, leaving nothing behind',
    async () => {
      expect(await containerExists()).toBe(true)
      expect(await volumeCount()).toBeGreaterThan(0)

      const result = await execa('docker', ['compose', 'down', '--volumes'], {
        cwd: projectDir,
        timeout: 120_000,
      })
      expect(result.exitCode).toBe(0)

      expect(await containerExists()).toBe(false)
      expect(await volumeCount()).toBe(0)
      await expect(fetch(`${baseUrl}/health`)).rejects.toThrow()
    },
    180_000,
  )

  it(
    'and brings itself back up with a bare `docker compose up -d` too',
    async () => {
      await execa('docker', ['compose', 'up', '--detach'], {
        cwd: projectDir,
        timeout: 180_000,
      })
      await waitForHealth(baseUrl, { timeoutMs: 60_000 })
      expect((await (await fetch(`${baseUrl}/health`)).json())).toEqual({ ok: true })
      await composeDown(projectDir)
    },
    240_000,
  )
})
