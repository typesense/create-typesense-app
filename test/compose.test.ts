import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { composeFileContents, writeComposeFile } from '../src/steps/compose.js'
import { ADMIN_KEY_VAR, TYPESENSE_IMAGE } from '../src/constants.js'
import { checkDocker } from '../src/util/docker.js'

const docker = await checkDocker()

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'cta-compose-'))
}

const base = { projectName: 'my-app', port: 8108, envFile: '.env.local' }

describe('composeFileContents', () => {
  it('pins the Typesense image', () => {
    expect(composeFileContents(base)).toContain(TYPESENSE_IMAGE)
  })

  it('enables CORS — the single highest-value thing this file does', () => {
    expect(composeFileContents(base)).toContain('--enable-cors')
  })

  it('maps the requested host port to the container port', () => {
    expect(composeFileContents({ ...base, port: 9108 })).toContain('9108:8108')
  })

  /**
   * Regression: the key used to be injected with `${VAR}` substitution, which
   * compose resolves only from `.env`. With a template whose env file is
   * `.env.local`, a plain `docker compose down` then failed to interpolate and
   * teardown was impossible without an extra flag.
   */
  it('needs no variable substitution, so bare docker compose commands work', () => {
    expect(composeFileContents(base)).not.toContain('${')
  })

  it("declares the template's env file, which is where the key comes from", () => {
    expect(composeFileContents(base)).toMatch(/env_file:\n\s+- \.env\.local/)
    expect(composeFileContents({ ...base, envFile: '.env' })).toMatch(/env_file:\n\s+- \.env$/m)
  })

  it('never inlines a literal key', () => {
    // A 43-char base64url run would mean a real key had been baked in.
    expect(composeFileContents(base)).not.toMatch(/[A-Za-z0-9_-]{43}/)
  })

  it('names the variable Typesense itself reads, so no mapping is needed', () => {
    expect(ADMIN_KEY_VAR).toBe('TYPESENSE_API_KEY')
  })

  it('stores data in a named volume so teardown can remove it', () => {
    const yaml = composeFileContents(base)
    expect(yaml).toMatch(/^volumes:/m)
    expect(yaml).not.toMatch(/\.\/[\w-]*data:/)
  })

  it('namespaces the container by project so two projects can coexist', () => {
    expect(composeFileContents({ ...base, projectName: 'alpha' })).toContain('alpha')
    expect(composeFileContents({ ...base, projectName: 'beta' })).toContain('beta')
  })
})

describe('writeComposeFile', () => {
  it('writes docker-compose.yml and returns its path', async () => {
    const dir = scratch()
    const written = await writeComposeFile(dir, base)
    expect(written).toBe(path.join(dir, 'docker-compose.yml'))
    expect(readFileSync(written, 'utf8')).toContain('--enable-cors')
  })

  it('creates the project directory if it does not exist yet', async () => {
    const dir = path.join(scratch(), 'nested', 'my-app')
    const written = await writeComposeFile(dir, base)
    expect(readFileSync(written, 'utf8')).toContain(TYPESENSE_IMAGE)
  })

  it('is idempotent — re-running produces identical content', async () => {
    const dir = scratch()
    const first = await writeComposeFile(dir, base)
    const before = readFileSync(first, 'utf8')
    await writeComposeFile(dir, base)
    expect(readFileSync(first, 'utf8')).toBe(before)
  })
})

/**
 * The string assertions above cannot catch invalid YAML or an unknown compose
 * key. Only compose itself can, so ask it.
 */
describe.skipIf(!docker.available)('docker compose config', () => {
  it('accepts the generated file with no variables in the environment at all', async () => {
    const dir = scratch()
    await writeComposeFile(dir, base)
    writeFileSync(path.join(dir, '.env.local'), `${ADMIN_KEY_VAR}=test-key\n`)
    const result = await execa(
      'docker',
      ['compose', '--project-directory', dir, 'config', '--quiet'],
      { timeout: 30_000 },
    )
    expect(result.exitCode).toBe(0)
  })

  it('reports a clear error when the declared env file is missing', async () => {
    const dir = scratch()
    await writeComposeFile(dir, base)
    // No .env.local written — compose should refuse rather than start keyless.
    await expect(
      execa('docker', ['compose', '--project-directory', dir, 'config', '--quiet'], {
        timeout: 30_000,
      }),
    ).rejects.toThrow(/env.?file/i)
  })
})
