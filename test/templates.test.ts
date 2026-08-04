import { describe, expect, it } from 'vitest'
import {
  TEMPLATE_IDS,
  TemplateManifestError,
  loadTemplate,
  loadTemplates,
  validateManifest,
} from '../src/templates.js'

/** A manifest that passes, so each test can break exactly one thing. */
function validManifest(): Record<string, unknown> {
  return {
    id: 'nextjs',
    name: 'Next.js + react-instantsearch',
    scaffold: 'npx --yes create-next-app@latest {{dir}} --ts --yes',
    deps: ['typesense', 'typesense-instantsearch-adapter'],
    env: { file: '.env.local', publicPrefix: 'NEXT_PUBLIC_', accessor: 'process.env' },
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
  it('ships exactly the two templates the spec allows', async () => {
    const templates = await loadTemplates()
    expect(templates.map((template) => template.id)).toEqual(['nextjs', 'astro'])
  })

  it.each(TEMPLATE_IDS)('%s satisfies the contract', async (id) => {
    const manifest = await loadTemplate(id)
    expect(manifest.id).toBe(id)
    expect(manifest.deps).toContain('typesense')
    expect(manifest.deps).toContain('typesense-instantsearch-adapter')
  })

  it('gives the two templates distinct env conventions', async () => {
    const [nextjs, astro] = await loadTemplates()
    expect(nextjs?.env.publicPrefix).not.toBe(astro?.env.publicPrefix)
    expect(nextjs?.env.accessor).not.toBe(astro?.env.accessor)
    expect(nextjs?.env.file).not.toBe(astro?.env.file)
  })

  it('reports a helpful error for an unknown template id', async () => {
    await expect(loadTemplate('svelte')).rejects.toThrow(/file not found/)
  })
})
