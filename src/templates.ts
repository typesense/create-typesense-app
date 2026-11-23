import { type Dirent, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { templatesDir } from './paths.js'

/**
 * The templates this CLI ships, read from the templates directory rather than
 * written down here.
 *
 * Deliberate: the only framework name in src/ is DEFAULT_TEMPLATE_ID, so adding
 * or removing any other template is a change to templates/ alone.
 *
 * Sorted, so the order does not depend on the filesystem, with the default first.
 */
function discoverTemplateIds(): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(templatesDir, { withFileTypes: true })
  } catch (error) {
    throw new Error(
      `Could not read the bundled templates from ${templatesDir}. The installation looks incomplete.`,
      { cause: error },
    )
  }

  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    // The first id is the `--yes` default, so it must not change when a template sorts before it.
    .sort((a, b) => Number(b === DEFAULT_TEMPLATE_ID) - Number(a === DEFAULT_TEMPLATE_ID))

  if (ids.length === 0) {
    throw new Error(`No templates found in ${templatesDir}. The installation looks incomplete.`)
  }
  return ids
}

/** What `--yes` scaffolds, and the first choice in the framework prompt. */
export const DEFAULT_TEMPLATE_ID = 'nextjs'

export const TEMPLATE_IDS: readonly string[] = discoverTemplateIds()
export type TemplateId = string

export interface TemplateEnv {
  /** Env file the framework reads, relative to the project root. */
  file: string
  /** Prefix that makes a variable browser-visible, e.g. `NEXT_PUBLIC_`. */
  publicPrefix: string
}

export interface TemplateManifest {
  id: string
  name: string
  /** Command that creates the base project. Must contain `{{dir}}`. */
  scaffold: string
  deps: string[]
  /** Installed with --save-dev. May be empty. */
  devDeps: string[]
  env: TemplateEnv
  /**
   * Command wired up as `npm run seed` in the generated project. Framework-specific
   * because it names the TypeScript runner from devDeps.
   */
  seedCommand: string
  /** Overlay directory, relative to the template dir. */
  files: string
  /**
   * Paths in the scaffolded project the overlay supersedes, deleted after it is
   * applied. A framework CLI ships a demo page and its assets; once our own page
   * replaces the entry point, those become dead files the user has to reason about.
   */
  remove: string[]
  devCommand: string
  devUrl: string
}

export class TemplateManifestError extends Error {
  constructor(source: string, detail: string) {
    super(`Invalid template manifest (${source}): ${detail}`)
    this.name = 'TemplateManifestError'
  }
}

/**
 * Every key the contract currently defines. Unknown keys are rejected rather
 * than ignored: a typo'd field would otherwise fail silently, and PLAN.md §5
 * expects the contract to grow explicitly (add the field here, then document it
 * in templates/README.md).
 */
const MANIFEST_KEYS = [
  'id',
  'name',
  'scaffold',
  'deps',
  'devDeps',
  'env',
  'seedCommand',
  'files',
  'remove',
  'devCommand',
  'devUrl',
] as const

const ENV_KEYS = ['file', 'publicPrefix'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TemplateManifestError(source, `"${key}" must be a non-empty string`)
  }
  return value
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  source: string,
  scope: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new TemplateManifestError(
      source,
      `unknown ${scope} ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}. ` +
        `Add the field to MANIFEST_KEYS in src/templates.ts and document it in templates/README.md.`,
    )
  }
}

/** Reject anything that would escape the project directory. */
function requireRelativePath(value: string, key: string, source: string): string {
  if (path.isAbsolute(value)) {
    throw new TemplateManifestError(source, `"${key}" must be relative, got "${value}"`)
  }
  if (value.split(/[/\\]/).includes('..')) {
    throw new TemplateManifestError(source, `"${key}" must not contain "..", got "${value}"`)
  }
  return value
}

function validateEnv(raw: unknown, source: string): TemplateEnv {
  if (!isRecord(raw)) {
    throw new TemplateManifestError(source, '"env" must be an object')
  }
  rejectUnknownKeys(raw, ENV_KEYS, source, 'env')

  const file = requireRelativePath(requireString(raw, 'file', source), 'env.file', source)
  const publicPrefix = requireString(raw, 'publicPrefix', source)

  // A prefix missing its trailing underscore produces `PUBLIC_TYPESENSEHOST`
  // style names that the framework silently fails to expose.
  if (!publicPrefix.endsWith('_')) {
    throw new TemplateManifestError(
      source,
      `"env.publicPrefix" must end with "_", got "${publicPrefix}"`,
    )
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(publicPrefix)) {
    throw new TemplateManifestError(
      source,
      `"env.publicPrefix" must be SCREAMING_SNAKE_CASE, got "${publicPrefix}"`,
    )
  }

  return { file, publicPrefix }
}

function validateDeps(raw: unknown, source: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TemplateManifestError(source, '"deps" must be a non-empty array')
  }
  return raw.map((dep, index) => {
    if (typeof dep !== 'string' || dep.trim() === '') {
      throw new TemplateManifestError(source, `"deps[${index}]" must be a non-empty string`)
    }
    return dep
  })
}

/** Optional: most templates supersede nothing. Same path guard as `files`. */
function validateRemove(raw: unknown, source: string): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    throw new TemplateManifestError(source, '"remove" must be an array when present')
  }
  return raw.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new TemplateManifestError(source, `"remove[${index}]" must be a non-empty string`)
    }
    return requireRelativePath(entry, `remove[${index}]`, source)
  })
}

/** Optional, unlike deps: a template may need no extra tooling. */
function validateDevDeps(raw: unknown, source: string): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    throw new TemplateManifestError(source, '"devDeps" must be an array when present')
  }
  return raw.map((dep, index) => {
    if (typeof dep !== 'string' || dep.trim() === '') {
      throw new TemplateManifestError(source, `"devDeps[${index}]" must be a non-empty string`)
    }
    return dep
  })
}

/**
 * The whole contract check, as a pure function so it can be unit tested without
 * touching the filesystem.
 */
export function validateManifest(raw: unknown, source: string): TemplateManifest {
  if (!isRecord(raw)) {
    throw new TemplateManifestError(source, 'default export must be an object')
  }
  rejectUnknownKeys(raw, MANIFEST_KEYS, source, 'manifest')

  const id = requireString(raw, 'id', source)
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new TemplateManifestError(source, `"id" must be lowercase kebab-case, got "${id}"`)
  }

  const scaffold = requireString(raw, 'scaffold', source)
  if (!scaffold.includes('{{dir}}')) {
    throw new TemplateManifestError(
      source,
      '"scaffold" must contain the {{dir}} placeholder, or the base project lands in the wrong directory',
    )
  }

  const devUrl = requireString(raw, 'devUrl', source)
  try {
    const parsed = new URL(devUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('bad protocol')
    }
  } catch {
    throw new TemplateManifestError(source, `"devUrl" must be an http(s) URL, got "${devUrl}"`)
  }

  return {
    id,
    name: requireString(raw, 'name', source),
    scaffold,
    deps: validateDeps(raw['deps'], source),
    devDeps: validateDevDeps(raw['devDeps'], source),
    env: validateEnv(raw['env'], source),
    seedCommand: requireString(raw, 'seedCommand', source),
    files: requireRelativePath(requireString(raw, 'files', source), 'files', source),
    remove: validateRemove(raw['remove'], source),
    devCommand: requireString(raw, 'devCommand', source),
    devUrl,
  }
}

export async function loadTemplate(id: string): Promise<TemplateManifest> {
  const dir = path.join(templatesDir, id)
  const source = `templates/${id}/template.config.js`
  const configPath = path.join(dir, 'template.config.js')

  if (!existsSync(configPath)) {
    throw new TemplateManifestError(source, 'file not found')
  }

  const loaded: unknown = await import(pathToFileURL(configPath).href)
  const manifest = validateManifest(isRecord(loaded) ? loaded['default'] : undefined, source)

  if (manifest.id !== id) {
    throw new TemplateManifestError(
      source,
      `"id" is "${manifest.id}" but the directory is "${id}"; they must match`,
    )
  }

  const filesDir = path.join(dir, manifest.files)
  if (!existsSync(filesDir) || !statSync(filesDir).isDirectory()) {
    throw new TemplateManifestError(source, `"files" is not a directory: ${manifest.files}`)
  }

  return manifest
}

export async function loadTemplates(): Promise<TemplateManifest[]> {
  return Promise.all(TEMPLATE_IDS.map((id) => loadTemplate(id)))
}

/**
 * The chosen template, when it can be settled without asking.
 *
 * With a single bundled template there is nothing to choose, and a one-option
 * prompt is just a keystroke tax. Returns undefined only when a genuine choice
 * exists, which is the caller's cue to prompt.
 */
export function resolveTemplateWithoutPrompting(
  templates: TemplateManifest[],
  templateId?: string,
): TemplateManifest | undefined {
  if (templateId !== undefined) {
    const match = templates.find((template) => template.id === templateId)
    if (!match) {
      throw new Error(
        `Unknown template "${templateId}". Available: ${templates
          .map((template) => template.id)
          .join(', ')}`,
      )
    }
    return match
  }

  return templates.length === 1 ? templates[0] : undefined
}
