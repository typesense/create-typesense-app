import { describe, expect, it } from 'vitest'
import {
  TEMPLATE_IDS,
  TemplateManifestError,
  loadTemplate,
  loadTemplates,
  resolveTemplateWithoutPrompting,
  validateManifest,
} from '../src/templates.js'

/** A manifest that passes, so each test can break exactly one thing. */
function validManifest(): Record<string, unknown> {
  return {
    id: 'nextjs',
    name: 'Next.js + react-instantsearch',
    scaffold: 'npx --yes create-next-app@latest {{dir}} --ts --yes',
    deps: ['typesense', 'typesense-instantsearch-adapter'],
    env: { file: '.env.local', publicPrefix: 'NEXT_PUBLIC_' },
    seedCommand: 'tsx scripts/seed.ts',
    files: 'files/',
    devCommand: 'npm run dev',
    devUrl: 'http://localhost:3000',
  }
}

const source = 'test/manifest'

function expectRejected(mutate: (manifest: Record<string, unknown>) => void, match: RegExp): void {
  const manifest = validManifest()
  mutate(manifest)
  expect(() => validateManifest(manifest, source)).toThrow(match)
  expect(() => validateManifest(manifest, source)).toThrow(TemplateManifestError)
}

describe('validateManifest', () => {
  it('accepts a complete manifest', () => {
    expect(validateManifest(validManifest(), source)).toMatchObject({
      id: 'nextjs',
      env: { publicPrefix: 'NEXT_PUBLIC_' },
    })
  })

  it('rejects non-objects', () => {
    for (const bad of [undefined, null, 'nextjs', 42, ['nextjs']]) {
      expect(() => validateManifest(bad, source)).toThrow(/default export must be an object/)
    }
  })

  it.each(['id', 'name', 'scaffold', 'files', 'devCommand', 'devUrl'])(
    'rejects a missing %s',
    (key) => {
      expectRejected((manifest) => delete manifest[key], new RegExp(`"${key}" must be`))
    },
  )

  it('rejects unknown keys so a typo cannot fail silently', () => {
    expectRejected(
      (manifest) => {
        manifest['devComand'] = 'npm run dev'
      },
      /unknown manifest key: devComand/,
    )
  })

  it('rejects unknown env keys', () => {
    expectRejected(
      (manifest) => {
        manifest['env'] = { ...(manifest['env'] as object), prefix: 'NEXT_PUBLIC_' }
      },
      /unknown env key: prefix/,
    )
  })

  it('rejects a scaffold command without {{dir}}', () => {
    expectRejected(
      (manifest) => {
        manifest['scaffold'] = 'npx --yes create-next-app@latest --ts --yes'
      },
      /must contain the \{\{dir\}\} placeholder/,
    )
  })

  it('rejects a publicPrefix missing its trailing underscore', () => {
    expectRejected(
      (manifest) => {
        manifest['env'] = { ...validManifest()['env'] as object, publicPrefix: 'NEXT_PUBLIC' }
      },
      /must end with "_"/,
    )
  })

  it('rejects a lowercase publicPrefix', () => {
    expectRejected(
      (manifest) => {
        manifest['env'] = { ...validManifest()['env'] as object, publicPrefix: 'next_public_' }
      },
      /SCREAMING_SNAKE_CASE/,
    )
  })

  it('rejects an empty deps array', () => {
    expectRejected(
      (manifest) => {
        manifest['deps'] = []
      },
      /"deps" must be a non-empty array/,
    )
  })

  it('rejects paths that escape the project directory', () => {
    expectRejected(
      (manifest) => {
        manifest['files'] = '../../etc/'
      },
      /must not contain ".."/,
    )
    expectRejected(
      (manifest) => {
        manifest['env'] = { ...validManifest()['env'] as object, file: '/etc/environment' }
      },
      /"env.file" must be relative/,
    )
  })

  it('rejects a non-http devUrl', () => {
    expectRejected(
      (manifest) => {
        manifest['devUrl'] = 'localhost:3000'
      },
      /must be an http\(s\) URL/,
    )
  })

  it('rejects a non-kebab-case id', () => {
    expectRejected(
      (manifest) => {
        manifest['id'] = 'NextJS'
      },
      /must be lowercase kebab-case/,
    )
  })
})

describe('bundled templates', () => {
  it('ships the templates in the directory, nextjs first as the default', async () => {
    const templates = await loadTemplates()
    expect(templates.map((template) => template.id)).toEqual(['nextjs', 'qwik', 'solid', 'vanilla'])
  })

  it('gives each template its own env conventions rather than assuming one', async () => {
    const byId = Object.fromEntries((await loadTemplates()).map((t) => [t.id, t]))
    expect(byId['nextjs']?.env.publicPrefix).toBe('NEXT_PUBLIC_')
    expect(byId['vanilla']?.env.publicPrefix).toBe('VITE_')
    expect(byId['solid']?.env.publicPrefix).toBe('VITE_')
    expect(byId['qwik']?.env.publicPrefix).toBe('VITE_')
    expect(byId['nextjs']?.env.file).not.toBe(byId['solid']?.env.file)
    expect(byId['nextjs']?.seedCommand).not.toBe(byId['solid']?.seedCommand)
  })

  /** Every template must reach the same aha moment, whatever its stack. */
  it.each(['nextjs', 'qwik', 'solid', 'vanilla'])('%s wires up the search dependencies', async (id) => {
    const template = await loadTemplate(id)
    expect(template.deps).toContain('typesense-instantsearch-adapter')
    expect(template.devUrl).toMatch(/^http:\/\/localhost:\d+$/)
    expect(template.seedCommand).toMatch(/seed\.(ts|js)$/)
  })

  it.each(TEMPLATE_IDS)('%s satisfies the contract', async (id) => {
    const manifest = await loadTemplate(id)
    expect(manifest.id).toBe(id)
    expect(manifest.deps).toContain('typesense')
    expect(manifest.deps).toContain('typesense-instantsearch-adapter')
  })



  it('reports a helpful error for an unknown template id', async () => {
    await expect(loadTemplate('svelte')).rejects.toThrow(/file not found/)
  })
})

describe('resolveTemplateWithoutPrompting', () => {
  it('defers to the prompt now that there is a real choice', async () => {
    expect(resolveTemplateWithoutPrompting(await loadTemplates())).toBeUndefined()
  })

  it('settles immediately when only one template is bundled', async () => {
    const [nextjs] = await loadTemplates()
    expect(resolveTemplateWithoutPrompting([nextjs!])?.id).toBe('nextjs')
  })

  it('honours an explicit id', async () => {
    const templates = await loadTemplates()
    expect(resolveTemplateWithoutPrompting(templates, 'nextjs')?.id).toBe('nextjs')
  })

  it('rejects an id that is not on offer', async () => {
    const templates = await loadTemplates()
    expect(() => resolveTemplateWithoutPrompting(templates, 'astro')).toThrow(/Unknown template/)
  })

  it('honours vanilla too', async () => {
    expect(resolveTemplateWithoutPrompting(await loadTemplates(), 'solid')?.id).toBe('solid')
  })


})

describe('the contract carries everything framework-specific', () => {
  it('declares the command that runs the seed script', async () => {
    const [nextjs] = await loadTemplates()
    expect(nextjs?.seedCommand).toBe('tsx scripts/seed.ts')
  })

  it('requires a seedCommand', () => {
    expectRejected((manifest) => delete manifest['seedCommand'], /"seedCommand" must be/)
  })

  /**
   * accessor was in the contract but nothing ever read it: the overlay files are
   * static and reference process.env directly, so there is nothing to interpolate.
   * Rejecting it keeps the contract to fields that actually do something.
   */
  it('rejects the retired accessor field rather than silently ignoring it', () => {
    expectRejected(
      (manifest) => {
        manifest['env'] = { ...(manifest['env'] as object), accessor: 'process.env' }
      },
      /unknown env key: accessor/,
    )
  })

  it('discovers its templates from the directory, not a hardcoded list', async () => {
    const { readdirSync } = await import('node:fs')
    const { templatesDir } = await import('../src/paths.js')
    const onDisk = readdirSync(templatesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect([...TEMPLATE_IDS].sort()).toEqual(onDisk)
  })
})

describe('remove', () => {
  it('defaults to nothing when a template does not need it', () => {
    expect(validateManifest(validManifest(), source).remove).toEqual([])
  })

  it('accepts a list of paths the overlay supersedes', () => {
    const manifest = validManifest()
    manifest['remove'] = ['src/counter.js', 'src/assets']
    expect(validateManifest(manifest, source).remove).toEqual(['src/counter.js', 'src/assets'])
  })

  /** Same guard as `files`: a template must not reach outside the project. */
  it.each(['../../etc/passwd', '/etc/passwd'])('rejects the escaping path %s', (bad) => {
    expectRejected((manifest) => {
      manifest['remove'] = [bad]
    }, /must (not contain "\.\."|be relative)/)
  })

  it('rejects a non-array', () => {
    expectRejected((manifest) => {
      manifest['remove'] = 'src/counter.js'
    }, /"remove" must be an array/)
  })
})
