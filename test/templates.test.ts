import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { templatesDir } from '../src/paths.js'
import {
  DEFAULT_TEMPLATE_ID,
  loadTemplates,
  TemplateManifestError,
  validateManifest,
} from '../src/templates.js'

/** The template contract, and the eight templates that ship with the CLI. */

const valid = {
  id: 'my-framework',
  name: 'My framework',
  scaffold: 'npm create my-framework@latest {{dir}}',
  deps: ['typesense'],
  env: { file: '.env', publicPrefix: 'VITE_' },
  seedCommand: 'node scripts/seed.js',
  files: 'files/',
  devCommand: 'npm run dev',
  devUrl: 'http://localhost:5173',
}

describe('the template manifest', () => {
  it('accepts a complete manifest, and fills in the optional fields', () => {
    expect(validateManifest(valid, 'test')).toMatchObject({ devDeps: [], remove: [] })
  })

  it.each([
    ['an unknown key, so a typo cannot fail silently', { ...valid, seedComand: 'x' }, /unknown/],
    ['a scaffold command without {{dir}}', { ...valid, scaffold: 'npm create x' }, /\{\{dir\}\}/],
    [
      'a public prefix without its trailing _',
      { ...valid, env: { file: '.env', publicPrefix: 'VITE' } },
      /end with "_"/,
    ],
    [
      'a lowercase public prefix',
      { ...valid, env: { file: '.env', publicPrefix: 'vite_' } },
      /SCREAMING_SNAKE_CASE/,
    ],
    [
      'an env file outside the project',
      { ...valid, env: { file: '../.env', publicPrefix: 'VITE_' } },
      /\.\./,
    ],
    ['a remove path outside the project', { ...valid, remove: ['../outside'] }, /\.\./],
    ['an empty deps list', { ...valid, deps: [] }, /deps/],
    ['a devUrl that is not http', { ...valid, devUrl: 'ftp://localhost' }, /devUrl/],
    ['an id that is not kebab-case', { ...valid, id: 'My_Framework' }, /kebab-case/],
  ])('rejects %s', (_case, manifest, message) => {
    expect(() => validateManifest(manifest, 'test')).toThrow(TemplateManifestError)
    expect(() => validateManifest(manifest, 'test')).toThrow(message)
  })
})

describe('the bundled templates', async () => {
  const templates = await loadTemplates()

  it('are the eight framework templates, with the default first', () => {
    expect(templates.map((template) => template.id)).toEqual([
      DEFAULT_TEMPLATE_ID,
      'angular',
      'qwik',
      'react',
      'solid',
      'sveltekit',
      'vanilla',
      'vue',
    ])
    expect(DEFAULT_TEMPLATE_ID).toBe('nextjs')
  })

  /** Every file in a template's overlay, relative to the overlay directory. */
  function overlayFiles(id: string, files: string): string[] {
    const root = path.join(templatesDir, id, files)
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry)
        return statSync(full).isDirectory() ? walk(full) : [path.relative(root, full)]
      })
    return walk(root).map((file) => file.split(path.sep).join('/'))
  }

  it.each(templates.map((template) => [template.id, template]))(
    '%s: ships its seed script, installs its runner, and removes none of its own files',
    (id, template) => {
      const files = overlayFiles(id, template.files)
      const [runner, ...rest] = template.seedCommand.split(' ')
      const script = rest.at(-1) ?? ''

      expect(files, `the overlay has no ${script}`).toContain(script)
      if (runner !== 'node')
        expect(template.devDeps, `${runner} is not installed`).toContain(runner)
      // The CLI copies the overlay first, then deletes `remove`.
      const clashes = template.remove.filter((removed) =>
        files.some((file) => file === removed || file.startsWith(`${removed}/`)),
      )
      expect(clashes, 'remove deletes files that the overlay writes').toEqual([])
    },
  )
})
