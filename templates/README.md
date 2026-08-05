# The template contract

A template is **a manifest plus a file overlay**. Nothing else.

Almost everything this CLI does is framework-agnostic — Docker and CORS, the
collection schema, the JSONL import, scoping the search-only key, writing the env
file. A template's job is only to describe the parts that genuinely differ.

Exactly one template ships today (`nextjs`). The indirection is still here because
it keeps the framework-specific surface small, declarative, and in one place: no
framework's name appears anywhere in `src/`, so adding a template is a change to
this directory alone.

## Layout

```
templates/<id>/
├── template.config.js   # the manifest — default-exports one object
└── files/               # copied over the scaffolded project as-is
```

`<id>` is the template's identity. The CLI discovers templates by listing this
directory, so creating `templates/svelte/` is all it takes to register one; the
directory name must equal the manifest's `id`.

## The manifest

Validated by `validateManifest()` in [../src/templates.ts](../src/templates.ts).
**Unknown keys are a hard error** — a typo'd field would otherwise be silently
ignored — so adding a field means updating `MANIFEST_KEYS` there and this table.

| Field | Type | Notes |
|---|---|---|
| `id` | string | lowercase kebab-case; must equal the directory name |
| `name` | string | shown in the framework prompt, and in the CLI's summary |
| `scaffold` | string | shell command that creates the base project. **Must** contain `{{dir}}` |
| `deps` | string[] | runtime dependencies; installed with `npm install`. Non-empty |
| `devDeps` | string[] | optional; installed with `--save-dev` |
| `env.file` | string | the env file the framework reads, e.g. `.env.local`. Relative, no `..` |
| `env.publicPrefix` | string | prefix that makes a variable browser-visible. SCREAMING_SNAKE_CASE, **must** end with `_` |
| `seedCommand` | string | wired up as `npm run seed`; names the runner from `devDeps` |
| `files` | string | overlay directory, relative to the template directory |
| `devCommand` | string | e.g. `npm run dev` |
| `devUrl` | string | http(s) URL, printed at the end |

### Two fields worth explaining

**`scaffold` runs the framework's own CLI**, rather than this project
reimplementing it. Two things learned the hard way:

- It is tokenised *before* `{{dir}}` is substituted, so a project directory
  containing spaces stays one argument.
- Pass whatever flag skips the framework's own dependency install
  (`--skip-install` for `create-next-app`). The dependency step then installs the
  framework's dependencies and the template's in a single pass.

Note also that `create-next-app` refuses to run in a directory containing any file
it did not create. That is why scaffolding happens **first**, before the compose
file, the env file or anything else is written. Assume other framework CLIs are
equally fussy.

**`env.publicPrefix` is the only reason the env step is not fully generic.** Get
it wrong and the project ships an `undefined` API key that fails silently in the
browser. The CLI classifies each variable as browser-visible or secret from lists
in `src/constants.ts` and applies the prefix only to the former, so the admin key
cannot be exposed by a template getting this wrong.

> An earlier `env.accessor` field (`process.env` vs `import.meta.env`) has been
> removed. Nothing read it: overlay files are static and reference their
> framework's env object directly, so there was never anything to interpolate.

## The overlay

Everything under `files/` is copied into the project verbatim, preserving
directory structure. `.gitkeep` is skipped.

The overlay **owns what it writes** and overwrites existing files — replacing the
framework's placeholder home page is the point. Keep it to files you mean to own;
the CLI edits `package.json` itself, so do not ship one.

What the Next.js overlay provides, as a guide to what a template needs:

| Path | Purpose |
|---|---|
| `lib/typesense.ts` | the search client, reading the public env vars |
| `app/page.tsx` | search box, hits, one facet |
| `app/search.module.css` | styles scoped to that page |
| `scripts/schema.ts` | the collection schema, heavily commented — the file to edit first |
| `scripts/seed.ts` | drop, recreate, re-import; also restores the search key if it is gone |

Two things the UI must get right, or the demo quietly stops being impressive:

- **Search `title` and `authors`, not just `title`.** A misspelled author name
  finds nothing otherwise.
- **Do not let the page size itself from its own content.** Frameworks style
  `body` in ways you do not control — Next.js sets `display: flex`, and auto
  margins on a flex item suppress stretch, which makes the layout resize on every
  keystroke. Set an explicit width. See the comments in `search.module.css`.

## Adding a template

1. Create `templates/<id>/` with a `template.config.js` and a `files/` directory.
2. Run `npm test` — manifest validation covers the contract, and the id is picked
   up from the directory automatically.
3. Run the CLI end to end and actually type a misspelling in the browser. The
   unit tests cannot tell you whether the search UI works.
