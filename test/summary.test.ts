import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADMIN_KEY_VAR, SEARCH_KEY_VAR, TYPESENSE_IMAGE } from '../src/constants.js'
import { resolveDefaults } from '../src/prompts.js'
import type { PromptOptions } from '../src/prompts.js'
import { nextStepsLines, summaryLines } from '../src/summary.js'
import { loadTemplates } from '../src/templates.js'
import type { DockerStatus } from '../src/util/docker.js'

const dockerUp: DockerStatus = {
  available: true,
  composeVersion: '5.1.2',
  serverVersion: '29.4.0',
}

const dockerDown: DockerStatus = { available: false, reason: 'the Docker daemon is not responding' }

async function options(overrides: Partial<PromptOptions> = {}): Promise<PromptOptions> {
  return {
    templates: await loadTemplates(),
    docker: dockerUp,
    cwd: mkdtempSync(path.join(tmpdir(), 'cta-summary-')),
    port: 8108,
    ...overrides,
  }
}

describe('resolveDefaults', () => {
  it('defaults to the first template, Docker and the books dataset', async () => {
    const config = resolveDefaults(await options())
    expect(config.projectName).toBe('my-search-app')
    expect(config.template.id).toBe('nextjs')
    expect(config.dataset).toBe('books')
    expect(config.server).toEqual({ kind: 'docker', port: 8108 })
  })

  it('honours a positional name and an explicit template', async () => {
    const config = resolveDefaults(await options({ projectName: 'demo', templateId: 'astro' }))
    expect(config.projectName).toBe('demo')
    expect(config.template.id).toBe('astro')
    expect(config.targetDir.endsWith(path.join(path.sep, 'demo'))).toBe(true)
  })

  it('refuses --yes when Docker is down, and says what to do instead', async () => {
    const withDockerDown = { ...(await options()), docker: dockerDown }
    expect(() => resolveDefaults(withDockerDown)).toThrow(
      /drop --yes and choose "I already have one running"/,
    )
  })

  it('rejects an invalid project name before touching anything', async () => {
    const badName = await options({ projectName: 'My App' })
    expect(() => resolveDefaults(badName)).toThrow(/lowercase/)
  })
})

describe('summaryLines', () => {
  it('shows the pinned image and port for a Docker run', async () => {
    const lines = summaryLines(resolveDefaults(await options())).join('\n')
    expect(lines).toContain(TYPESENSE_IMAGE)
    expect(lines).toContain('port 8108')
    expect(lines).toContain('CORS enabled')
  })

  it('lists the search-only key as browser-visible and the admin key as server-only', async () => {
    const config = resolveDefaults(await options())
    const lines = summaryLines(config).join('\n')
    expect(lines).toContain(`NEXT_PUBLIC_${SEARCH_KEY_VAR}`)
    expect(lines).toContain(ADMIN_KEY_VAR)
    expect(lines).not.toContain(`NEXT_PUBLIC_${ADMIN_KEY_VAR}`)
  })

  it('uses the Astro env conventions when Astro is chosen', async () => {
    const config = resolveDefaults(await options({ templateId: 'astro' }))
    const lines = summaryLines(config).join('\n')
    expect(lines).toContain(`PUBLIC_${SEARCH_KEY_VAR}`)
    expect(lines).toContain('.env')
    expect(lines).not.toContain('NEXT_PUBLIC_')
  })

  it('points at the template dev URL in the next steps', async () => {
    const nextjs = nextStepsLines(resolveDefaults(await options())).join('\n')
    expect(nextjs).toContain('http://localhost:3000')
    expect(nextjs).toContain('hary potr')

    const astro = nextStepsLines(
      resolveDefaults(await options({ templateId: 'astro' })),
    ).join('\n')
    expect(astro).toContain('http://localhost:4321')
  })
})
