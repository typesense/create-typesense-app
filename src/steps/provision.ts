import path from 'node:path'
import { ADMIN_KEY_VAR } from '../constants.js'
import type { LocalProjectConfig, ServerConfig } from '../config.js'
import { writeComposeFile } from './compose.js'
import { readEnvFile, writeEnvFile } from './env.js'
import {
  composeUp,
  describeStartFailure,
  waitForHealth,
  type WaitForHealthOptions,
} from './server.js'
import { generateAdminKey } from '../util/apiKey.js'
import { composePull, missingImages } from '../util/docker.js'
import { createPullTracker } from '../util/pullProgress.js'
import { createTypesenseClient, TypesenseError } from '../util/typesense.js'

export interface ProvisionOptions {
  /** Progress callback, so the CLI can render a step per stage. */
  onStep?: (message: string) => void
  /** Health-poll tuning. Defaults to a 60s budget. */
  health?: WaitForHealthOptions
}

export interface ProvisionedServer {
  adminKey: string
  baseUrl: string
  envFile: string
  composeFile: string
  /** True when an admin key from a previous run was reused. */
  reusedAdminKey: boolean
}

/**
 * 127.0.0.1 rather than localhost: on some setups localhost resolves to ::1 first
 * while the published port is bound to IPv4, which looks exactly like a server
 * that never came up.
 */
export function serverBaseUrl(server: ServerConfig): string {
  return server.kind === 'docker' ? `http://127.0.0.1:${server.port}` : server.url
}

/**
 * /health answers without a key, so it passes for any Typesense on the port.
 * Only a request with this project's admin key proves it is the right server.
 */
async function assertAcceptsAdminKey(
  baseUrl: string,
  adminKey: string,
  port: number,
): Promise<void> {
  try {
    await createTypesenseClient(baseUrl, adminKey).listKeys()
  } catch (error) {
    if (!(error instanceof TypesenseError) || error.status !== 401) throw error
    throw new Error(
      `A Typesense server answers on port ${port}, but it is not the one this project ` +
        `started: it rejected this project's admin key. Stop it, or re-run with --port ${port + 1}.`,
      { cause: error },
    )
  }
}

/**
 * Brings the local Typesense server up and does not return until it is healthy.
 * An existing server never comes here: the CLI only reads from it.
 *
 * Idempotent by design: an admin key from an earlier run is reused,
 * the compose file is rewritten identically, and `compose up` on an already
 * running project is a no-op. Nothing here knows about a framework — the only
 * template input is the env file's name and prefix.
 */
export async function provisionServer(
  config: LocalProjectConfig,
  { onStep = () => {}, health }: ProvisionOptions = {},
): Promise<ProvisionedServer> {
  const { server, template, targetDir } = config
  const envFile = path.join(targetDir, template.env.file)
  const baseUrl = serverBaseUrl(server)

  const existing = await readEnvFile(envFile)
  const previousAdminKey = existing[ADMIN_KEY_VAR]

  let adminKey: string
  let reusedAdminKey = false
  if (previousAdminKey !== undefined && previousAdminKey !== '') {
    adminKey = previousAdminKey
    reusedAdminKey = true
    onStep('Reused the admin API key from the previous run')
  } else {
    adminKey = generateAdminKey()
    onStep('Generated an admin API key')
  }

  await writeEnvFile(envFile, { [ADMIN_KEY_VAR]: adminKey }, template.env.publicPrefix)
  onStep(`Wrote ${template.env.file}`)

  // The env file must exist before this: compose declares it with `env_file:`
  // and refuses to start if it is missing.
  const composeFile = await writeComposeFile(targetDir, {
    projectName: config.projectName,
    targetDir,
    port: server.port,
    envFile: template.env.file,
  })
  onStep('Wrote docker-compose.yml (CORS enabled)')

  // Pull as its own reported step. `compose up` would pull silently, leaving the
  // spinner on a stale message for however long the download takes — which on a
  // cold cache looks exactly like a hang.
  const missing = await missingImages(targetDir)
  if (missing.length > 0) {
    const tracker = createPullTracker()
    // "(first run)" explains why this particular run is the slow one.
    const label = `${missing.join(', ')} (first run)`
    onStep(tracker.describe(label))
    await composePull(targetDir, (line) => {
      if (tracker.ingest(line)) onStep(tracker.describe(label))
    })
  }

  try {
    await composeUp(targetDir)
  } catch (error) {
    throw new Error(
      describeStartFailure(error instanceof Error ? error.message : String(error), server.port),
      { cause: error },
    )
  }
  onStep(`Started Typesense on :${server.port}`)

  onStep('Waiting for /health')
  await waitForHealth(baseUrl, health)
  await assertAcceptsAdminKey(baseUrl, adminKey, server.port)
  onStep('Server is healthy')

  return { adminKey, baseUrl, envFile, composeFile, reusedAdminKey }
}
