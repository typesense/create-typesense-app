import type { TemplateManifest } from './templates.js'

/**
 * Where the Typesense server comes from.
 *
 * `byo` covers both "I already have one running" and "Typesense Cloud". They are
 * one code path on purpose: PLAN.md §2 rules out Cloud *provisioning*, so the
 * only difference between the two is the prompt copy and the default URL.
 */
export type ServerConfig =
  | { kind: 'docker'; port: number }
  | { kind: 'byo'; flavour: 'existing' | 'cloud'; url: string; adminKey: string }

export type Dataset = 'books' | 'empty'

export interface ProjectConfig {
  /** Directory name, also used as the npm package name. */
  projectName: string
  /** Absolute path to the project directory. */
  targetDir: string
  template: TemplateManifest
  server: ServerConfig
  dataset: Dataset
}
