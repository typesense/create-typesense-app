import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { cancel, isCancel, log, password, select, text } from '@clack/prompts'
import pc from 'picocolors'
import { DEFAULT_PORT, DEFAULT_PROJECT_NAME, STATE_FILE } from './constants.js'
import type { Dataset, ProjectConfig, ServerConfig } from './config.js'
import type { TemplateManifest } from './templates.js'
import type { DockerStatus } from './util/docker.js'

export interface PromptOptions {
  templates: TemplateManifest[]
  docker: DockerStatus
  cwd: string
  /** Pre-filled from a positional argument, skips the name prompt. */
  projectName?: string
  /** Pre-filled from `--template`, skips the framework prompt. */
  templateId?: string
  port: number
}

/** Clack returns a symbol when the user hits Ctrl-C. Exit the way a shell expects. */
function unwrap<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('Cancelled. Nothing was written.')
    process.exit(130)
  }
  return value
}

export function validateProjectName(value: string): string | undefined {
  const name = value.trim()
  if (name === '') return 'Project name is required.'
  if (/[/\\]/.test(name)) return 'Use a single directory name, not a path.'
  if (name === '.' || name === '..') return 'Pick a real directory name.'
  if (name.startsWith('.')) return 'Project name cannot start with a dot.'
  if (!/^[a-z0-9._-]+$/.test(name)) {
    return 'Use lowercase letters, numbers, dots, dashes and underscores only (it becomes an npm package name).'
  }
  return undefined
}

/**
 * A directory holding only our own state file is a resumed run (PLAN.md §7), not
 * a collision, so it is allowed.
 */
export function validateTargetDir(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined
  if (!statSync(dir).isDirectory()) return `${dir} already exists and is not a directory.`

  const ignorable = new Set(['.git', '.DS_Store', STATE_FILE])
  const entries = readdirSync(dir).filter((entry) => !ignorable.has(entry))
  if (entries.length > 0) {
    return `${path.basename(dir)}/ is not empty (${entries.length} ${
      entries.length === 1 ? 'entry' : 'entries'
    }). Pick another name.`
  }
  return undefined
}

function validateServerUrl(value: string): string | undefined {
  const raw = value.trim()
  if (raw === '') return 'A server URL is required.'
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return 'Enter a full URL, e.g. http://localhost:8108'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'URL must start with http:// or https://'
  }
  return undefined
}

async function askProjectName(options: PromptOptions): Promise<string> {
  if (options.projectName !== undefined) {
    const nameError = validateProjectName(options.projectName)
    if (nameError) throw new Error(nameError)
    const dirError = validateTargetDir(path.resolve(options.cwd, options.projectName))
    if (dirError) throw new Error(dirError)
    return options.projectName
  }

  const answer = unwrap(
    await text({
      message: 'Project name',
      placeholder: DEFAULT_PROJECT_NAME,
      defaultValue: DEFAULT_PROJECT_NAME,
      validate: (value) => {
        const name = (value || DEFAULT_PROJECT_NAME).trim()
        return validateProjectName(name) ?? validateTargetDir(path.resolve(options.cwd, name))
      },
    }),
  )
  return answer.trim()
}

async function askTemplate(options: PromptOptions): Promise<TemplateManifest> {
  if (options.templateId !== undefined) {
    const match = options.templates.find((template) => template.id === options.templateId)
    if (!match) {
      throw new Error(
        `Unknown template "${options.templateId}". Available: ${options.templates
          .map((template) => template.id)
          .join(', ')}`,
      )
    }
    return match
  }

  const id = unwrap(
    await select({
      message: 'Framework?',
      options: options.templates.map((template) => ({
        value: template.id,
        label: template.name,
        hint: template.deps.join(', '),
      })),
    }),
  )
  // `select` returns one of the values we just supplied, so this always matches.
  return options.templates.find((template) => template.id === id) as TemplateManifest
}

async function askServer(options: PromptOptions): Promise<ServerConfig> {
  const dockerHint = options.docker.available
    ? 'recommended'
    : `unavailable — ${options.docker.reason}`

  const kind = unwrap(
    await select<'docker' | 'existing' | 'cloud'>({
      message: 'Typesense server?',
      initialValue: options.docker.available ? 'docker' : 'existing',
      options: [
        {
          value: 'docker',
          label: 'Spin one up locally with Docker',
          hint: dockerHint,
        },
        { value: 'existing', label: 'I already have one running', hint: 'bring your own URL' },
        { value: 'cloud', label: 'Typesense Cloud', hint: 'paste your cluster URL and admin key' },
      ],
    }),
  )

  if (kind === 'docker') {
    if (!options.docker.available) {
      // Don't hard-fail; the two BYO paths are still open (PLAN.md §7).
      log.warn(
        `Docker is unavailable: ${options.docker.reason}\n` +
          'Pick "I already have one running" or "Typesense Cloud" instead.',
      )
      return askServer(options)
    }
    return { kind: 'docker', port: options.port }
  }

  const url = unwrap(
    await text({
      message: kind === 'cloud' ? 'Cluster URL' : 'Server URL',
      placeholder:
        kind === 'cloud'
          ? 'https://xxx.a1.typesense.net'
          : `http://localhost:${DEFAULT_PORT}`,
      defaultValue: kind === 'cloud' ? '' : `http://localhost:${DEFAULT_PORT}`,
      validate: (value) =>
        validateServerUrl(value || (kind === 'cloud' ? '' : `http://localhost:${DEFAULT_PORT}`)),
    }),
  )

  const adminKey = unwrap(
    await password({
      message: 'Admin API key',
      validate: (value) =>
        (value ?? '').trim() === ''
          ? 'Required — it creates the collection and the search-only key. It is never exposed to the browser.'
          : undefined,
    }),
  )

  return {
    kind: 'byo',
    flavour: kind,
    url: (url || `http://localhost:${DEFAULT_PORT}`).trim().replace(/\/+$/, ''),
    adminKey: adminKey.trim(),
  }
}

async function askDataset(): Promise<Dataset> {
  return unwrap(
    await select<Dataset>({
      message: 'Sample data?',
      options: [
        { value: 'books', label: 'Books', hint: '1k titles, best for seeing typo tolerance' },
        { value: 'empty', label: 'Empty', hint: "I'll bring my own JSON" },
      ],
    }),
  )
}

export async function runPrompts(options: PromptOptions): Promise<ProjectConfig> {
  if (!options.docker.available) {
    log.warn(`Docker not usable: ${options.docker.reason}`)
    log.info(`You can still point at an existing server. ${pc.dim('(PLAN.md §7)')}`)
  }

  const projectName = await askProjectName(options)
  const template = await askTemplate(options)
  const server = await askServer(options)
  const dataset = await askDataset()

  return {
    projectName,
    targetDir: path.resolve(options.cwd, projectName),
    template,
    server,
    dataset,
  }
}

/** Non-interactive resolution for `--yes` (PLAN.md §7): Next.js, Docker, books. */
export function resolveDefaults(options: PromptOptions): ProjectConfig {
  const projectName = options.projectName ?? DEFAULT_PROJECT_NAME

  const nameError = validateProjectName(projectName)
  if (nameError) throw new Error(nameError)

  const targetDir = path.resolve(options.cwd, projectName)
  const dirError = validateTargetDir(targetDir)
  if (dirError) throw new Error(dirError)

  const template = options.templates.find(
    (candidate) => candidate.id === (options.templateId ?? options.templates[0]?.id),
  )
  if (!template) {
    throw new Error(
      `Unknown template "${options.templateId}". Available: ${options.templates
        .map((candidate) => candidate.id)
        .join(', ')}`,
    )
  }

  if (!options.docker.available) {
    throw new Error(
      `--yes defaults to a local Docker server, but ${options.docker.reason}\n` +
        'Start Docker, or drop --yes and choose "I already have one running".',
    )
  }

  return {
    projectName,
    targetDir,
    template,
    server: { kind: 'docker', port: options.port },
    dataset: 'books',
  }
}
