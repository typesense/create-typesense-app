import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildScaffoldCommand, scaffoldInvocation, tokenizeCommand } from '../src/steps/scaffold.js'
import { applyOverlay, removeSuperseded } from '../src/steps/overlay.js'
import { addPackageScripts, mergeScripts, projectScripts } from '../src/steps/deps.js'
import {
  clearRunState,
  hasRunState,
  markRunStarted,
  readRunState,
} from '../src/util/state.js'
import { STATE_FILE } from '../src/constants.js'
import { loadTemplate } from '../src/templates.js'
import { validateTargetDir } from '../src/prompts.js'

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'cta-m3-'))
}

describe('tokenizeCommand', () => {
  it('splits on whitespace', () => {
    expect(tokenizeCommand('npm install typesense')).toEqual(['npm', 'install', 'typesense'])
  })

  it('collapses repeated whitespace', () => {
    expect(tokenizeCommand('npm   install    typesense')).toEqual([
      'npm',
      'install',
      'typesense',
    ])
  })

  it('keeps a double-quoted argument together', () => {
    expect(tokenizeCommand('npm create vite -- --template "my template"')).toEqual([
      'npm',
      'create',
      'vite',
      '--',
      '--template',
      'my template',
    ])
  })

  it('keeps a single-quoted argument together', () => {
    expect(tokenizeCommand("cmd --name 'two words'")).toEqual(['cmd', '--name', 'two words'])
  })

  it('returns nothing for an empty command', () => {
    expect(tokenizeCommand('   ')).toEqual([])
  })
})

describe('buildScaffoldCommand', () => {
  it('splits the manifest command into a program and its arguments', () => {
    const { command, args } = buildScaffoldCommand(
      'npx --yes create-next-app@latest {{dir}} --ts',
      '/tmp/my-app',
    )
    expect(command).toBe('npx')
    expect(args).toEqual(['--yes', 'create-next-app@latest', '/tmp/my-app', '--ts'])
  })

  /**
   * The directory is user-supplied and may contain spaces. Substituting into the
   * string before tokenising would split it into two arguments and scaffold into
   * the wrong place.
   */
  it('keeps a directory containing spaces as one argument', () => {
    const { args } = buildScaffoldCommand('npx create-next-app {{dir}} --ts', '/tmp/my app/here')
    expect(args).toContain('/tmp/my app/here')
    expect(args).toEqual(['create-next-app', '/tmp/my app/here', '--ts'])
  })

  it('substitutes every occurrence of the placeholder', () => {
    const { args } = buildScaffoldCommand('cmd {{dir}} --out {{dir}}', '/tmp/x')
    expect(args).toEqual(['/tmp/x', '--out', '/tmp/x'])
  })

  it('rejects a command with no placeholder', () => {
    expect(() => buildScaffoldCommand('npx create-next-app --ts', '/tmp/x')).toThrow(/\{\{dir\}\}/)
  })

  it('rejects an empty command', () => {
    expect(() => buildScaffoldCommand('  ', '/tmp/x')).toThrow()
  })

  it('builds a runnable command from the real Next.js manifest', async () => {
    const template = await loadTemplate('nextjs')
    const { command, args } = buildScaffoldCommand(template.scaffold, '/tmp/my-app')
    expect(command).toBe('npx')
    expect(args).toContain('/tmp/my-app')
    // Verified against create-next-app 16: a second install pass is wasteful, so
    // the manifest skips it and the dependency step installs everything at once.
    expect(args).toContain('--skip-install')
  })
})

describe('applyOverlay', () => {
  it('copies files into the project, creating directories as needed', async () => {
    const source = scratch()
    const target = scratch()
    mkdirSync(path.join(source, 'app'), { recursive: true })
    mkdirSync(path.join(source, 'lib'), { recursive: true })
    writeFileSync(path.join(source, 'app', 'page.tsx'), 'export default null')
    writeFileSync(path.join(source, 'lib', 'typesense.ts'), 'export const x = 1')

    const written = await applyOverlay(source, target)

    expect(written.sort()).toEqual([
      path.join('app', 'page.tsx'),
      path.join('lib', 'typesense.ts'),
    ])
    expect(readFileSync(path.join(target, 'app', 'page.tsx'), 'utf8')).toContain('export default')
  })

  /** The overlay owns app/page.tsx — replacing the framework's default is the point. */
  it("overwrites the framework's own files", async () => {
    const source = scratch()
    const target = scratch()
    mkdirSync(path.join(source, 'app'), { recursive: true })
    mkdirSync(path.join(target, 'app'), { recursive: true })
    writeFileSync(path.join(source, 'app', 'page.tsx'), 'ours')
    writeFileSync(path.join(target, 'app', 'page.tsx'), 'the default page')

    await applyOverlay(source, target)
    expect(readFileSync(path.join(target, 'app', 'page.tsx'), 'utf8')).toBe('ours')
  })

  it('ignores .gitkeep placeholders', async () => {
    const source = scratch()
    const target = scratch()
    writeFileSync(path.join(source, '.gitkeep'), '')
    writeFileSync(path.join(source, 'real.ts'), 'x')

    expect(await applyOverlay(source, target)).toEqual(['real.ts'])
  })

  it('is idempotent', async () => {
    const source = scratch()
    const target = scratch()
    writeFileSync(path.join(source, 'a.ts'), 'x')
    const first = await applyOverlay(source, target)
    expect(await applyOverlay(source, target)).toEqual(first)
  })
})

describe('mergeScripts', () => {
  const base = JSON.stringify(
    { name: 'my-app', scripts: { dev: 'next dev', build: 'next build' } },
    null,
    2,
  )

  it("leaves the framework's own scripts alone", () => {
    const merged = JSON.parse(mergeScripts(base, { seed: 'tsx scripts/seed.ts' })) as {
      scripts: Record<string, string>
    }
    expect(merged.scripts['dev']).toBe('next dev')
    expect(merged.scripts['build']).toBe('next build')
    expect(merged.scripts['seed']).toBe('tsx scripts/seed.ts')
  })

  it('adds the typesense lifecycle scripts', () => {
    const merged = JSON.parse(
      mergeScripts(base, {
        'typesense:up': 'docker compose up -d',
        'typesense:down': 'docker compose down --volumes',
      }),
    ) as { scripts: Record<string, string> }
    expect(merged.scripts['typesense:up']).toBe('docker compose up -d')
    expect(merged.scripts['typesense:down']).toBe('docker compose down --volumes')
  })

  it('is idempotent', () => {
    const once = mergeScripts(base, { seed: 'tsx scripts/seed.ts' })
    expect(mergeScripts(once, { seed: 'tsx scripts/seed.ts' })).toBe(once)
  })

  it('preserves everything else in package.json', () => {
    const withDeps = JSON.stringify({
      name: 'my-app',
      private: true,
      scripts: { dev: 'next dev' },
      dependencies: { next: '16.3.0' },
    })
    const merged = JSON.parse(mergeScripts(withDeps, { seed: 'x' })) as Record<string, unknown>
    expect(merged['private']).toBe(true)
    expect(merged['dependencies']).toEqual({ next: '16.3.0' })
  })

  it('copes with a package.json that has no scripts block', () => {
    const merged = JSON.parse(mergeScripts('{"name":"x"}', { seed: 'y' })) as {
      scripts: Record<string, string>
    }
    expect(merged.scripts['seed']).toBe('y')
  })

  it('ends with a trailing newline, as npm writes it', () => {
    expect(mergeScripts(base, { seed: 'x' }).endsWith('\n')).toBe(true)
  })
})

describe('addPackageScripts', () => {
  it('writes the merged scripts back to disk', async () => {
    const dir = scratch()
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'my-app', scripts: { dev: 'next dev' } }, null, 2),
    )

    await addPackageScripts(dir, { seed: 'tsx scripts/seed.ts' })

    const written = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(written.scripts).toEqual({ dev: 'next dev', seed: 'tsx scripts/seed.ts' })
  })

  it('fails clearly when there is no package.json to merge into', async () => {
    await expect(addPackageScripts(scratch(), { seed: 'x' })).rejects.toThrow(/package\.json/)
  })
})

describe('run state', () => {
  it('reports no state for an untouched directory', () => {
    expect(hasRunState(scratch())).toBe(false)
  })

  it('records and reads back the run', async () => {
    const dir = path.join(scratch(), 'my-app')
    await markRunStarted(dir, { version: 1, template: 'nextjs' })

    expect(hasRunState(dir)).toBe(true)
    expect(await readRunState(dir)).toEqual({ version: 1, template: 'nextjs' })
  })

  it('writes it under the documented filename', async () => {
    const dir = scratch()
    await markRunStarted(dir, { version: 1, template: 'nextjs' })
    expect(readFileSync(path.join(dir, STATE_FILE), 'utf8')).toContain('nextjs')
  })

  /** Deleted on success, so a finished project is not silently scaffolded over. */
  it('clears the marker', async () => {
    const dir = scratch()
    await markRunStarted(dir, { version: 1, template: 'nextjs' })
    await clearRunState(dir)
    expect(hasRunState(dir)).toBe(false)
    expect(await readRunState(dir)).toBeUndefined()
  })

  it('clearing an absent marker is not an error', async () => {
    await expect(clearRunState(scratch())).resolves.toBeUndefined()
  })

  it('treats unreadable state as absent rather than throwing', async () => {
    const dir = scratch()
    writeFileSync(path.join(dir, STATE_FILE), 'not json at all')
    expect(await readRunState(dir)).toBeUndefined()
  })
})

describe('validateTargetDir with a resume marker', () => {
  it('resumes a directory holding a half-finished project', async () => {
    const dir = scratch()
    // What a crash after scaffolding leaves behind.
    writeFileSync(path.join(dir, 'package.json'), '{"name":"my-app"}')
    mkdirSync(path.join(dir, 'app'))
    writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default null')

    expect(validateTargetDir(dir)).toMatch(/is not empty/)

    await markRunStarted(dir, { version: 1, template: 'nextjs' })
    expect(validateTargetDir(dir)).toBeUndefined()
  })

  /** Cleared on success, so a finished project is not scaffolded over. */
  it('refuses a finished project again once the marker is cleared', async () => {
    const dir = scratch()
    writeFileSync(path.join(dir, 'package.json'), '{"name":"my-app"}')
    await markRunStarted(dir, { version: 1, template: 'nextjs' })
    await clearRunState(dir)
    expect(validateTargetDir(dir)).toMatch(/is not empty/)
  })
})

const nextjsTemplate = await loadTemplate('nextjs')

describe('projectScripts', () => {
  const scripts = projectScripts(nextjsTemplate)

  it('adds exactly the three scripts the plan calls for', () => {
    expect(Object.keys(scripts).sort()).toEqual(['seed', 'typesense:down', 'typesense:up'])
  })

  it('starts the server detached, so the shell comes back', () => {
    expect(scripts['typesense:up']).toBe('docker compose up --detach')
  })

  /**
   * Deliberately NOT `--volumes`: this is the everyday "stop for now" script, and
   * wiping the index on every stop means the app comes back empty until reseeded.
   * A full wipe is `docker compose down --volumes`, which the CLI prints.
   */
  it('stops the server without destroying the indexed data', () => {
    expect(scripts['typesense:down']).toBe('docker compose down')
    expect(scripts['typesense:down']).not.toContain('--volumes')
  })

  it('needs no --env-file, because the compose file needs no substitution', () => {
    for (const script of Object.values(scripts)) {
      expect(script).not.toContain('--env-file')
    }
  })

  it('takes the seed command from the manifest, not from src/', () => {
    expect(scripts['seed']).toBe(nextjsTemplate.seedCommand)
    expect(nextjsTemplate.devDeps).toContain('tsx')
  })

  it('uses whatever runner a manifest declares', () => {
    const pretend = { ...nextjsTemplate, seedCommand: 'node --run seed' }
    expect(projectScripts(pretend)['seed']).toBe('node --run seed')
  })
})

describe('removeSuperseded', () => {
  it('deletes the files a template says its overlay replaces', async () => {
    const dir = scratch()
    writeFileSync(path.join(dir, 'counter.js'), 'export const x = 1')
    writeFileSync(path.join(dir, 'keep.js'), 'keep me')

    expect(await removeSuperseded(dir, ['counter.js'])).toEqual(['counter.js'])
    expect(existsSync(path.join(dir, 'counter.js'))).toBe(false)
    expect(existsSync(path.join(dir, 'keep.js'))).toBe(true)
  })

  it('deletes a directory and its contents', async () => {
    const dir = scratch()
    mkdirSync(path.join(dir, 'assets'))
    writeFileSync(path.join(dir, 'assets', 'logo.svg'), '<svg/>')

    await removeSuperseded(dir, ['assets'])
    expect(existsSync(path.join(dir, 'assets'))).toBe(false)
  })

  /** A framework CLI may stop shipping a file; that must not fail the run. */
  it('ignores paths that are already gone', async () => {
    expect(await removeSuperseded(scratch(), ['never-existed.js'])).toEqual([])
  })

  it('does nothing when the list is empty', async () => {
    expect(await removeSuperseded(scratch(), [])).toEqual([])
  })

  it('refuses a path that escapes the project directory', async () => {
    await expect(removeSuperseded(scratch(), ['../outside.txt'])).rejects.toThrow(/outside/)
  })
})

describe('scaffoldInvocation', () => {
  /**
   * Regression: create-vite treats its directory argument as relative to cwd even
   * when handed an absolute path, silently building a nested tree
   * (private/tmp/.../my-app) and leaving the real target empty. create-next-app
   * accepts either. A bare name in the parent directory works for both.
   */
  it('passes a bare directory name and runs in the parent', () => {
    const { args, cwd } = scaffoldInvocation(nextjsTemplate, '/tmp/somewhere/my-app')
    expect(args).toContain('my-app')
    expect(args).not.toContain('/tmp/somewhere/my-app')
    expect(cwd).toBe('/tmp/somewhere')
  })

  it('does the same for the vanilla template', async () => {
    const vanilla = await loadTemplate('vanilla')
    const { command, args, cwd } = scaffoldInvocation(vanilla, '/tmp/somewhere/my-app')
    expect(command).toBe('npm')
    expect(args).toEqual(['create', 'vite@latest', 'my-app', '--', '--template', 'vanilla'])
    expect(cwd).toBe('/tmp/somewhere')
  })

  it('keeps a name containing spaces as a single argument', () => {
    const { args } = scaffoldInvocation(nextjsTemplate, '/tmp/some dir/my app')
    expect(args).toContain('my app')
  })
})
