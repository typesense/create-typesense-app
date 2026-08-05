# The template contract

> **Status: stub.** This gets written properly once anything framework-specific
> has been refactored out of `src/steps/` and the fields have been stress-tested
> by the Astro template.

A template is **a manifest plus a file overlay**. Nothing more. Roughly 80% of
what the CLI does — Docker, CORS, schema, seeding, key scoping — is
framework-agnostic and must never be duplicated here.

## Layout

```
templates/<id>/
├── template.config.js   # the manifest — default-exports one object
└── files/               # copied over the scaffolded project as-is
```

## Manifest fields

Validated by `validateManifest()` in [../src/templates.ts](../src/templates.ts).
Unknown keys are a hard error, so adding a field means updating both that
allowlist and this table.

| Field | Type | Notes |
|---|---|---|
| `id` | string | lowercase kebab-case; must equal the directory name |
| `name` | string | shown in the framework prompt |
| `scaffold` | string | shell command; **must** contain `{{dir}}` |
| `deps` | string[] | installed after scaffolding; non-empty |
| `devDeps` | string[] | optional; installed with `--save-dev` (e.g. the TypeScript runner for `scripts/seed.ts`) |
| `env.file` | string | relative path, e.g. `.env.local` |
| `env.publicPrefix` | string | SCREAMING_SNAKE_CASE, **must** end with `_` |
| `env.accessor` | string | how template code reads env, e.g. `process.env` |
| `files` | string | relative overlay directory |
| `devCommand` | string | e.g. `npm run dev` |
| `devUrl` | string | http(s) URL printed at the end |

## Why the prefix *and* the accessor

Getting one right and the other wrong ships an `undefined` API key that fails
silently in the browser. Both live in the manifest so no step file has to
hardcode a framework's convention.
