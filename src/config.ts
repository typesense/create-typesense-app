import type { TemplateManifest } from './templates.js'

/**
 * Where the Typesense server comes from.
 *
 * `byo` is an existing server: "I already have one running" or "Typesense Cloud".
 * The CLI only reads from it, so `apiKey` is a key that can read
 * schemas and search, never an admin key, and it is the key the browser gets.
 */
export type ServerConfig =
  | { kind: 'docker'; port: number }
  | {
      kind: 'byo'
      flavour: 'existing' | 'cloud'
      url: string
      apiKey: string
      /** Collections or aliases to search. Empty means every one the key can see. */
      collections: string[]
    }

export interface ProjectConfig {
  /** Directory name, also used as the npm package name. */
  projectName: string
  /** Absolute path to the project directory. */
  targetDir: string
  template: TemplateManifest
  server: ServerConfig
}

/** A project on a local server, which the CLI starts and seeds. */
export type LocalProjectConfig = ProjectConfig & {
  server: Extract<ServerConfig, { kind: 'docker' }>
}
