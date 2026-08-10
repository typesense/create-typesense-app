# The template contract

A template is **a manifest plus a file overlay**. Nothing else.

Almost everything this CLI does is framework-agnostic — Docker and CORS, the
collection schema, the JSONL import, scoping the search-only key, writing the env
file. A template's job is only to describe the parts that genuinely differ.

No framework's name appears anywhere in `src/`, so adding a template is a change
to this directory alone.

| Template | Stack | Env prefix |
|---|---|---|
| `nextjs` | Next.js + `react-instantsearch` | `NEXT_PUBLIC_` |
| `qwik` | Qwik + `instantsearch.js`, bundled by Vite | `VITE_` |
| `solid` | SolidJS + `instantsearch.js` connectors, bundled by Vite | `VITE_` |
| `vanilla` | Vanilla JS + `instantsearch.js`, bundled by Vite | `VITE_` |

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
| `devDeps` | string[] | optional; installed with `--save-dev`, **before** `deps`, so a corrected version pin lands first |
| `env.file` | string | the env file the framework reads, e.g. `.env.local`. Relative, no `..` |
| `env.publicPrefix` | string | prefix that makes a variable browser-visible. SCREAMING_SNAKE_CASE, **must** end with `_` |
| `seedCommand` | string | wired up as `npm run seed`; names the runner from `devDeps` |
| `files` | string | overlay directory, relative to the template directory |
| `remove` | string[] | optional; paths in the scaffolded project the overlay supersedes, deleted after it is applied |
| `devCommand` | string | e.g. `npm run dev` |
| `devUrl` | string | http(s) URL, printed at the end |

### Two fields worth explaining

**`scaffold` runs the framework's own CLI**, rather than this project
reimplementing it. Two things learned the hard way:

- It is tokenised *before* `{{dir}}` is substituted, so a project directory
  containing spaces stays one argument.
- `{{dir}}` is a **bare directory name**, and the command runs in the parent.
  Do not assume an absolute path works: `create-vite` treats its argument as
  relative even when it is absolute, so `/tmp/x/my-app` builds `tmp/x/my-app`
  *inside* the current directory, leaves the real target empty, and exits 0.
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

Framework starters ship a demo page and its artwork. Once your entry point
replaces theirs, those files linger as unreferenced clutter a reader cannot tell
apart from the real thing, so list them in `remove`. The vanilla template drops
`src/counter.js`, `src/assets` and `public/icons.svg` this way.

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
- **Do not let the page size itself from its own content.** Starters style the
  page or its mount point in ways you do not control. Next.js sets
  `body { display: flex }`, where auto margins on a flex item suppress stretch;
  the Solid starter pins `#root` to a fixed-width centred flex column. Either way
  the layout resizes on every keystroke. Set an explicit width, and replace the
  starter's stylesheet if it fights you.
- **Where no framework binding exists, pick one of two shapes.** Use
  `instantsearch.js/es/connectors` when the framework's state can hold anything:
  a connector hands back state and a `refine()` function instead of rendering, and
  drops straight into a signal (the `solid` template). Use the widgets with DOM
  refs when it cannot: Qwik serialises component state to resume, and
  InstantSearch's state holds callbacks and class instances that will not
  serialise, so the `qwik` template keeps the library inside `useVisibleTask$` and
  lets it own the DOM.

### When the starter itself is broken

Scaffolds are not always internally consistent. create-vite's qwik template pins
`vite@^8` while `@builder.io/qwik` declares `peer vite@">=5 <8"`, so even a plain
`npm install` on the untouched scaffold fails with ERESOLVE. Correct it with a
pinned entry in `devDeps` (`vite@^7`), which is installed first for exactly this
reason. Always run a scaffold and install it before writing the overlay.

## Adding a template

1. Create `templates/<id>/` with a `template.config.js` and a `files/` directory.
2. Run `npm test` — manifest validation covers the contract, and the id is picked
   up from the directory automatically.
3. Run the CLI end to end and actually type a misspelling in the browser. The
   unit tests cannot tell you whether the search UI works.
