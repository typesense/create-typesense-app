# create-typesense-app

Scaffold a working Typesense search-as-you-type UI in one command.

```sh
npx create-typesense-app@latest
```

> **Status: M0 (skeleton).** The prompt flow runs and prints the plan it would
> execute, but nothing is written yet. This README becomes the pitch once the
> end-to-end flow lands.

## What it will do for you

The frontend scaffold is the easy part — `create-next-app` already does that. The
four steps between "scaffold" and "results on keypress" are the friction:

1. Get a Typesense server running (`docker-compose.yml`, CORS preset)
2. Create the collection **with a schema**
3. Load sample data
4. **Scope the API keys** — a search-only key for the browser, the admin key kept
   server-side

Step 4 is the one people get wrong by hand. The admin key is never written to a
`NEXT_PUBLIC_` / `PUBLIC_` variable; only a key scoped to
`documents:search` on one collection reaches the browser.

## Templates

| id | Wiring |
|---|---|
| `nextjs` | `react-instantsearch` |
| `astro` | vanilla `instantsearch.js`, no island framework |

## Contribute a template

A template is a manifest plus a file overlay — see
[templates/README.md](templates/README.md).

## Development

```sh
npm install
npm run build      # tsc -> dist/, chmod +x the bin
npm test           # vitest
npm run typecheck  # src and test
npx .              # run the built CLI
```

---

An independent community project. Not affiliated with Typesense, Inc.
