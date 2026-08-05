import path from 'node:path'
import { ADMIN_KEY_VAR } from '../constants.js'
import type { ProjectConfig, ServerConfig } from '../config.js'
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

export interface ProvisionOptions {
  /** Progress callback, so the CLI can render a step per stage. */
  onStep?: (message: string) => void
  /** Health-poll tuning. Defaults to the 60s budget from PLAN.md §7. */
  health?: WaitForHealthOptions
}

export interface ProvisionedServer {
  adminKey: string
  baseUrl: string
  envFile: string
  /** Absent when the user brought their own server — we write no compose file then. */
  composeFile?: string
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
 * Brings a Typesense server up and does not return until it is healthy.
 *
 * Idempotent by design (PLAN.md §7): an admin key from an earlier run is reused,
 * the compose file is rewritten identically, and `compose up` on an already
 * running project is a no-op. Nothing here knows about a framework — the only
 * template input is the env file's name and prefix.
 */
export async function provisionServer(
  config: ProjectConfig,
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
  } else if (server.kind === 'docker') {
    adminKey = generateAdminKey()
    onStep('Generated an admin API key')
  } else {
    adminKey = server.adminKey
  }

  await writeEnvFile(envFile, { [ADMIN_KEY_VAR]: adminKey }, template.env.publicPrefix)
  onStep(`Wrote ${template.env.file}`)

  let composeFile: string | undefined
  if (server.kind === 'docker') {
    // The env file must exist before this: compose declares it with `env_file:`
    // and refuses to start if it is missing.
    composeFile = await writeComposeFile(targetDir, {
      projectName: config.projectName,
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
  }

  onStep('Waiting for /health')
  await waitForHealth(baseUrl, health)
  onStep('Server is healthy')

  return { adminKey, baseUrl, envFile, composeFile, reusedAdminKey }
}
