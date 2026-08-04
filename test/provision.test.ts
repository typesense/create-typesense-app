import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ADMIN_KEY_VAR } from '../src/constants.js'
import type { ProjectConfig } from '../src/config.js'
import { COMPOSE_FILE } from '../src/steps/compose.js'
import { writeEnvFile } from '../src/steps/env.js'
import { provisionServer, serverBaseUrl } from '../src/steps/provision.js'
import { loadTemplate } from '../src/templates.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

/** Stands in for a Typesense the user already has running. */
async function healthyServer(): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      return
    }
    response.writeHead(404).end()
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

async function byoConfig(url: string, adminKey = 'their-own-key'): Promise<ProjectConfig> {
  const targetDir = path.join(mkdtempSync(path.join(tmpdir(), 'cta-prov-')), 'my-app')
  return {
    projectName: 'my-app',
    targetDir,
    template: await loadTemplate('nextjs'),
    server: { kind: 'byo', flavour: 'existing', url, adminKey },
    dataset: 'books',
  }
}

describe('serverBaseUrl', () => {
  it('points at the mapped host port for a Docker server', () => {
    expect(serverBaseUrl({ kind: 'docker', port: 9108 })).toBe('http://127.0.0.1:9108')
  })

  it('uses the URL as given for a server the user brought', () => {
    expect(
      serverBaseUrl({
        kind: 'byo',
        flavour: 'cloud',
        url: 'https://abc.a1.typesense.net',
        adminKey: 'k',
      }),
    ).toBe('https://abc.a1.typesense.net')
  })
})

describe('provisionServer with a server the user brought', () => {
  it('writes no compose file — it is not our container to manage', async () => {
    const config = await byoConfig(await healthyServer())
    const result = await provisionServer(config)
    expect(result.composeFile).toBeUndefined()
    expect(existsSync(path.join(config.targetDir, COMPOSE_FILE))).toBe(false)
  })

  it('keeps the admin key the user supplied instead of generating one', async () => {
    const config = await byoConfig(await healthyServer(), 'supplied-key')
    const result = await provisionServer(config)
    expect(result.adminKey).toBe('supplied-key')
  })

  it('records the key in the env file, unprefixed', async () => {
    const config = await byoConfig(await healthyServer(), 'supplied-key')
    const result = await provisionServer(config)
    const contents = readFileSync(result.envFile, 'utf8')
    expect(contents).toMatch(new RegExp(`^${ADMIN_KEY_VAR}=supplied-key$`, 'm'))
    expect(contents).not.toContain(`NEXT_PUBLIC_${ADMIN_KEY_VAR}`)
  })

  it("uses the template's env file name", async () => {
    const config = await byoConfig(await healthyServer())
    const result = await provisionServer(config)
    expect(path.basename(result.envFile)).toBe('.env.local')
  })

  it('fails with an actionable error when their server is unreachable', async () => {
    const config = await byoConfig('http://127.0.0.1:1')
    await expect(
      provisionServer(config, { health: { timeoutMs: 300, intervalMs: 50 } }),
    ).rejects.toThrow(/did not become healthy/)
  })

  it('reuses an admin key already present from an earlier run', async () => {
    const config = await byoConfig(await healthyServer(), 'supplied-key')
    await writeEnvFile(
      path.join(config.targetDir, '.env.local'),
      { [ADMIN_KEY_VAR]: 'from-earlier-run' },
      'NEXT_PUBLIC_',
    )
    const result = await provisionServer(config)
    expect(result.adminKey).toBe('from-earlier-run')
    expect(result.reusedAdminKey).toBe(true)
  })

  it('reports its progress so the CLI can show steps', async () => {
    const config = await byoConfig(await healthyServer())
    const steps: string[] = []
    await provisionServer(config, { onStep: (message) => steps.push(message) })
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.join('\n')).toMatch(/health|Health/)
  })
})
