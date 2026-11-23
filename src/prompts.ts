import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  cancel,
  confirm,
  isCancel,
  log,
  multiselect,
  note,
  password,
  select,
  text,
} from '@clack/prompts'
import {
  ADMIN_KEY_VAR,
  DEFAULT_PORT,
  SEARCH_KEY_VAR,
  DEFAULT_PROJECT_NAME,
  STATE_FILE,
} from './constants.js'
import { validateServerUrl } from './cli.js'
import { COMPOSE_FILE } from './steps/compose.js'
import {
  inspectExistingServer,
  keyNeeds,
  listRefusedMessage,
  listSearchable,
  MAKE_KEY_AND_PASTE,
  searchKeyCommand,
} from './steps/existingServer.js'
import { CommandError, showCommand } from './util/clipboard.js'
import type { SearchConfig, SearchField } from './steps/searchConfig.js'
import { waitForHealth } from './steps/server.js'
import { hasRunState } from './util/state.js'
import type { ProjectConfig, ServerConfig } from './config.js'
import { resolveTemplateWithoutPrompting, type TemplateManifest } from './templates.js'
import type { DockerStatus } from './util/docker.js'
import { isPortInUse, nextFreePort } from './util/port.js'
import { createTypesenseClient, type StoredAlias, type StoredCollection } from './util/typesense.js'

export interface PromptOptions {
  templates: TemplateManifest[]
  docker: DockerStatus
  cwd: string
  /** Pre-filled from a positional argument, skips the name prompt. */
  projectName?: string
  /** Pre-filled from `--template`, skips the framework prompt. */
  templateId?: string
  port: number
  /** From `--server-url`: an existing server, so no Docker. */
  serverUrl?: string
  /** From `--collections`. */
  collections?: string[]
  /** From `--api-key-stdin` or the environment; never from a flag value. */
  apiKey?: string
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
 * Files a previous run of this CLI leaves behind. A directory containing only
 * these is a resumed run, not a collision — otherwise every failed
 * run would need a manual `rm -rf` before retrying.
 *
 * Env files are matched by pattern because the name is the template's choice.
 */
function isOurOwnArtifact(entry: string): boolean {
  // 'data' holds the downloaded dataset and the copied schema.
  if (['.git', '.DS_Store', STATE_FILE, COMPOSE_FILE, 'data'].includes(entry)) return true
  return /^\.env(\..+)?$/.test(entry)
}

export function validateTargetDir(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined
  if (!statSync(dir).isDirectory()) return `${dir} already exists and is not a directory.`

  // A run that crashed part-way left its marker: resuming is exactly what should
  // happen, whatever else is in there. This is the precise signal —
  // the filename matching below is only a fallback for a run that failed before
  // the marker could be written.
  if (hasRunState(dir)) return undefined

  const entries = readdirSync(dir).filter((entry) => !isOurOwnArtifact(entry))
  if (entries.length > 0) {
    return `${path.basename(dir)}/ is not empty (${entries.length} ${
      entries.length === 1 ? 'entry' : 'entries'
    }). Pick another name.`
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
  const settled = resolveTemplateWithoutPrompting(options.templates, options.templateId)
  if (settled !== undefined) return settled

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
        {
          value: 'existing',
          label: 'I already have one running',
          hint: 'read-only, bring your own URL',
        },
        { value: 'cloud', label: 'Typesense Cloud', hint: 'read-only, paste your cluster URL' },
      ],
    }),
  )

  if (kind === 'docker') {
    if (!options.docker.available) {
      // Don't hard-fail; the existing server paths are still open.
      log.warn(
        `Docker is unavailable: ${options.docker.reason}\n` +
          'Pick "I already have one running" or "Typesense Cloud" instead.',
      )
      return askServer(options)
    }
    return { kind: 'docker', port: options.port }
  }

  return askExistingServer(kind, options)
}

/**
 * The URL, key and collection of a server the developer already runs.
 *
 * `hint` is printed above the key prompt, for the case where the CLI found the
 * server itself and can say where its key most likely is.
 */
async function askExistingServer(
  kind: 'existing' | 'cloud',
  options: Pick<PromptOptions, 'apiKey' | 'collections'>,
  defaultUrl = `http://localhost:${DEFAULT_PORT}`,
  hint?: string,
): Promise<ServerConfig> {
  const fallback = kind === 'cloud' ? '' : defaultUrl
  const url = unwrap(
    await text({
      message: kind === 'cloud' ? 'Cluster URL' : 'Server URL',
      placeholder: kind === 'cloud' ? 'https://xxx.a1.typesense.net' : defaultUrl,
      defaultValue: fallback,
      validate: (value) => validateServerUrl(value || fallback),
    }),
  )
  const serverUrl = (url || fallback).trim().replace(/\/+$/, '')
  return askUntilKeyWorks(serverUrl, kind, options, hint)
}

/**
 * Asks for the search key until the run can use it, or the developer presses
 * Ctrl+C. The key gets the same checks the run makes: the collection list, the
 * schema and a search of each chosen collection, and the admin and write checks.
 * A key from the environment is tried first, and asked for again if it fails.
 */
async function askUntilKeyWorks(
  url: string,
  flavour: 'existing' | 'cloud',
  options: Pick<PromptOptions, 'apiKey' | 'collections'>,
  hint?: string,
): Promise<ServerConfig> {
  let apiKey = options.apiKey
  if (apiKey === undefined) {
    if (hint) log.info(hint)
    log.info(keyNeeds())
    await showCommand(searchKeyCommand(url, ['*']))
  }

  for (;;) {
    apiKey ??= await askSearchKey()
    const checked = await checkKey(url, flavour, apiKey, options.collections)
    if ('server' in checked) return checked.server
    if ('empty' in checked) {
      // The key works; a new key would not help. Keep it, and check again once
      // the developer has made a collection.
      log.warn(
        `There are no collections on ${url} that this key can see. The search UI needs a\n` +
          'collection with documents. Create one, for example in the Typesense Cloud dashboard.',
      )
      const next = unwrap(
        await select({
          message: 'When the collection exists:',
          options: [
            { value: 'again', label: 'Check again' },
            { value: 'exit', label: 'Exit' },
          ],
        }),
      )
      if (next === 'exit') {
        cancel('Nothing was written.')
        process.exit(1)
      }
      continue
    }
    log.warn(`${checked.message}\n${MAKE_KEY_AND_PASTE}`)
    await showCommand(checked.command)
    apiKey = undefined
  }
}

/**
 * The server config for a key that works, or why it does not. A refusal is an
 * answer, not an error; a server that does not answer still throws.
 */
async function checkKey(
  url: string,
  flavour: 'existing' | 'cloud',
  apiKey: string,
  named: string[] | undefined,
): Promise<{ server: ServerConfig } | { empty: true } | { message: string; command: string }> {
  // With --collections, the run does not need to list collections.
  let collections = named
  if (collections === undefined) {
    const listing = await listSearchable(createTypesenseClient(url, apiKey))
    if (listing.listRefused) {
      return { message: listRefusedMessage(), command: searchKeyCommand(url, ['*']) }
    }
    if (listing.collections.length === 0 && listing.aliases.length === 0) return { empty: true }
    collections = await pickCollections(listing.collections, listing.aliases)
  }

  const server: ServerConfig = { kind: 'byo', flavour, url, apiKey, collections }
  try {
    await inspectExistingServer(server)
    return { server }
  } catch (error) {
    if (error instanceof CommandError) return { message: error.message, command: error.command }
    throw error
  }
}

/** The key prompt's check. The key is the one the browser gets. */
export function validateSearchKey(value: string | undefined): string | undefined {
  return (value ?? '').trim() === ''
    ? 'Paste a search key. To make one, run the curl command above.'
    : undefined
}

async function askSearchKey(): Promise<string> {
  return unwrap(
    await password({
      message: 'Search key (the "value" from the curl reply)',
      validate: validateSearchKey,
    }),
  ).trim()
}

/** The picker's options: each collection and alias, with its document count. */
export function collectionChoices(
  collections: Pick<StoredCollection, 'name' | 'num_documents'>[],
  aliases: StoredAlias[],
): { value: string; label: string; hint: string }[] {
  const count = new Map(
    collections.map((collection) => [collection.name, collection.num_documents]),
  )
  const documents = (name: string) => `${(count.get(name) ?? 0).toLocaleString()} documents`
  return [
    ...collections.map((collection) => ({
      value: collection.name,
      label: collection.name,
      hint: documents(collection.name),
    })),
    ...aliases.map((alias) => ({
      value: alias.name,
      label: alias.name,
      hint: `alias → ${alias.collection_name}, ${documents(alias.collection_name)}`,
    })),
  ]
}

/** The chosen names whose collection holds no documents. An alias counts its target. */
export function emptySelections(
  chosen: string[],
  collections: Pick<StoredCollection, 'name' | 'num_documents'>[],
  aliases: StoredAlias[],
): string[] {
  const count = new Map(
    collections.map((collection) => [collection.name, collection.num_documents]),
  )
  const target = new Map(aliases.map((alias) => [alias.name, alias.collection_name]))
  return chosen.filter((name) => (count.get(target.get(name) ?? name) ?? 0) === 0)
}

/** Asks which of the listed collections and aliases to search, with document counts. */
async function pickCollections(
  collections: StoredCollection[],
  aliases: StoredAlias[],
): Promise<string[]> {
  const chosen = unwrap(
    await multiselect({
      message: 'Collections to search?',
      options: collectionChoices(collections, aliases),
      required: true,
    }),
  )
  for (const name of emptySelections(chosen, collections, aliases)) {
    log.warn(`"${name}" has no documents, so its section will be empty.`)
  }
  return chosen
}

/**
 * Shows the inferred search config and, if the developer wants, lets them change
 * each part. Only offers what Typesense can do: searched and facet fields must be
 * indexed text, and the title must be a searched field so it can be highlighted.
 */
export async function reviewSearchConfig(
  name: string,
  fields: SearchField[],
  search: SearchConfig,
): Promise<SearchConfig> {
  note(
    [
      `Searches  ${search.queryBy.join(', ')}`,
      `Facets    ${search.facets.join(', ') || 'none'}`,
      `Title     ${search.title}`,
      `Image     ${search.image ?? 'none'}`,
    ].join('\n'),
    `Search config for "${name}"`,
  )
  if (unwrap(await confirm({ message: 'Use this search config?' }))) return search

  const choices = searchConfigChoices(fields)
  const option = (name: string) => ({ value: name, label: name })

  const queryBy = unwrap(
    await multiselect({
      message: 'Fields to search',
      options: choices.searchable.map(option),
      initialValues: search.queryBy,
      required: true,
    }),
  )
  const facets =
    choices.facetable.length === 0
      ? []
      : unwrap(
          await multiselect({
            message: 'Facets',
            options: choices.facetable.map(option),
            initialValues: search.facets,
            required: false,
          }),
        )
  const title = unwrap(
    await select({
      message: 'Hit title',
      options: queryBy.map(option),
      initialValue: queryBy.includes(search.title) ? search.title : queryBy[0],
    }),
  )
  const imageChoice = unwrap(
    await select({
      message: 'Image field',
      options: [{ value: '', label: 'none' }, ...choices.images.map(option)],
      initialValue: search.image ?? '',
    }),
  )

  return buildSearchConfig(fields, {
    queryBy,
    facets,
    title,
    image: imageChoice === '' ? null : imageChoice,
  })
}

/**
 * The fields the review may offer for each part. Only what Typesense can do:
 * searched and facet fields must be indexed text, and the image must be a string.
 */
export function searchConfigChoices(fields: SearchField[]): {
  searchable: string[]
  facetable: string[]
  images: string[]
} {
  const named = fields.filter((field) => field.name !== '.*')
  const text = named.filter(
    (field) => (field.type === 'string' || field.type === 'string[]') && field.index !== false,
  )
  return {
    searchable: text.map((field) => field.name),
    facetable: text.filter((field) => field.facet === true).map((field) => field.name),
    images: named.filter((field) => field.type === 'string').map((field) => field.name),
  }
}

/** The search config from the review's answers. Every other field is shown in the hit. */
export function buildSearchConfig(
  fields: SearchField[],
  answers: Omit<SearchConfig, 'display'>,
): SearchConfig {
  return {
    ...answers,
    display: fields
      .map((field) => field.name)
      .filter((name) => name !== '.*' && name !== answers.title && name !== answers.image),
  }
}

export type PortAction = 'keep' | 'next' | 'ask-reuse' | 'ask-next'

/** What to do about the local server's port. Pure, so every branch is testable. */
export function portAction(inUse: boolean, typesense: boolean, interactive: boolean): PortAction {
  if (!inUse) return 'keep'
  if (!interactive) return 'next'
  return typesense ? 'ask-reuse' : 'ask-next'
}

/**
 * Settles the local server's port before anything is pulled or written.
 *
 * A Typesense already on the port can be reused, read-only, as an existing
 * server; anything else means moving to the next free port. `--yes` moves
 * without asking. The template only names the env file in the key hint.
 */
export async function settleLocalServer(
  port: number,
  interactive: boolean,
  template: TemplateManifest,
  options: Pick<PromptOptions, 'apiKey' | 'collections'> = {},
): Promise<ServerConfig> {
  const inUse = await isPortInUse(port)
  const typesense =
    inUse &&
    (await waitForHealth(`http://127.0.0.1:${port}`, { timeoutMs: 1_500 }).then(
      () => true,
      () => false,
    ))

  const action = portAction(inUse, typesense, interactive)
  if (action === 'keep') return { kind: 'docker', port }

  const next = await nextFreePort(port)
  if (action === 'next') {
    log.info(`Port ${port} is in use, so the local server will use port ${next}.`)
  } else if (action === 'ask-reuse') {
    const choice = unwrap(
      await select({
        message: `Typesense already runs at localhost:${port}.`,
        options: [
          { value: 'reuse', label: 'Use it', hint: 'read-only, asks for a search key' },
          { value: 'new', label: `Start a new local server on port ${next}` },
        ],
      }),
    )
    if (choice === 'reuse') {
      return askExistingServer(
        'existing',
        options,
        `http://localhost:${port}`,
        `If an earlier create-typesense-app run started it, its ${template.env.publicPrefix}${SEARCH_KEY_VAR} is in that project's ${template.env.file}.`,
      )
    }
  } else {
    const move = unwrap(
      await confirm({
        message: `Port ${port} is used by another program. Start Typesense on port ${next}?`,
      }),
    )
    if (!move) {
      cancel(`Cancelled. Free port ${port}, or pass another one with --port.`)
      process.exit(130)
    }
  }
  return { kind: 'docker', port: next }
}

export async function runPrompts(options: PromptOptions): Promise<ProjectConfig> {
  if (!options.docker.available) {
    log.warn(`Docker not usable: ${options.docker.reason}`)
    log.info('You can still use a Typesense server that you already run.')
  }

  const projectName = await askProjectName(options)
  const template = await askTemplate(options)
  const server =
    options.serverUrl === undefined
      ? await askServer(options)
      : await askUntilKeyWorks(options.serverUrl, serverFlavour(options.serverUrl), options)

  return {
    projectName,
    targetDir: path.resolve(options.cwd, projectName),
    template,
    server,
  }
}

/** A Typesense Cloud cluster is any host under typesense.net. */
export function serverFlavour(url: string): 'cloud' | 'existing' {
  return /\.typesense\.net$/.test(new URL(url).hostname) ? 'cloud' : 'existing'
}

/** `--server-url` settles the server; the key comes from the environment, stdin or a prompt. */
function existingServerFromFlags(options: PromptOptions, apiKey: string | undefined): ServerConfig {
  if (apiKey === undefined || apiKey === '') {
    throw new Error(
      `--server-url needs a key: set ${ADMIN_KEY_VAR} to a search key, or pipe one in with --api-key-stdin.`,
    )
  }
  return {
    kind: 'byo',
    flavour: serverFlavour(options.serverUrl ?? ''),
    url: options.serverUrl ?? '',
    apiKey,
    collections: options.collections ?? [],
  }
}

/** Non-interactive resolution for `--yes`: first template, local Docker, books. */
export function resolveDefaults(options: PromptOptions): ProjectConfig {
  const projectName = options.projectName ?? DEFAULT_PROJECT_NAME

  const nameError = validateProjectName(projectName)
  if (nameError) throw new Error(nameError)

  const targetDir = path.resolve(options.cwd, projectName)
  const dirError = validateTargetDir(targetDir)
  if (dirError) throw new Error(dirError)

  const template =
    resolveTemplateWithoutPrompting(options.templates, options.templateId) ?? options.templates[0]
  if (template === undefined) {
    throw new Error('No templates are bundled with this package.')
  }

  if (options.serverUrl !== undefined) {
    return {
      projectName,
      targetDir,
      template,
      server: existingServerFromFlags(options, options.apiKey),
    }
  }

  if (!options.docker.available) {
    throw new Error(
      `--yes defaults to a local Docker server, but ${options.docker.reason}\n` +
        'Start Docker, or pass --server-url to search an existing server.',
    )
  }

  return {
    projectName,
    targetDir,
    template,
    server: { kind: 'docker', port: options.port },
  }
}
