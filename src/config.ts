import type { TemplateManifest } from './templates.js'

/**
 * Where the Typesense server comes from.
 *
 * `byo` is an existing server: "I already have one running" or "Typesense Cloud".
 * `adminKey` is that server's admin key. The CLI uses it for one run, to read the
 * schemas and to create a search-only key for the browser. It is never written
 * to a file.
 */
export type ServerConfig =
  | { kind: 'docker'; port: number }
  | {
      kind: 'byo'
      flavour: 'existing' | 'cloud'
      url: string
      adminKey: string
      /** Collections or aliases to search. Empty means every one on the server. */
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
