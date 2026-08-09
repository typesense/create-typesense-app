# create-typesense-app <a href="https://npmjs.com/package/create-typesense-app"><img src="https://img.shields.io/npm/v/create-typesense-app" alt="npm package"></a>

Typo-tolerant Typesense search, running locally, in one command.

![Next.js installed, the server reporting healthy, 9979 books indexed, and "hary potr" finding Harry Potter](https://raw.githubusercontent.com/Nikhiladiga/create-typesense-app/main/docs/demo.gif)

> **Compatibility note:**
> Requires [Node.js](https://nodejs.org) 22+. Docker is optional. Without it, point
> at a Typesense you already run or a Typesense Cloud cluster.

## Scaffolding your first search app

With NPM:

```bash
npm create typesense-app@latest
```

Or with npx:

```bash
npx create-typesense-app@latest
```

Then follow the prompts!

To skip them, pass a directory and `--yes`:

```bash
# npm 7+, extra double-dash is needed:
npm create typesense-app@latest my-search-app -- --yes
```

```bash
cd my-search-app
npm run dev
```

Type `hary potr`. It finds Harry Potter.

## Options

```
-t, --template <id>   nextjs | vanilla
    --dataset <name>  books (default) | empty
    --port <number>   host port for the local server (default 8108)
-y, --yes             take the defaults, no prompts
-h, --help            show this
-v, --version         print the version
```

## Templates

| id | Stack |
|---|---|
| `nextjs` | Next.js + `react-instantsearch` |
| `vanilla` | Vanilla JS + `instantsearch.js`, bundled by Vite |

Both give you the same app. A template is a manifest plus a file overlay, so
adding one touches nothing else. See
[templates/README.md](templates/README.md).

## What you get

- A search box, hits with covers, and one facet
- Typesense in Docker, CORS already configured
- ~10,000 books indexed
- A schema and a seed script, short and commented, in the template's language
- A search-only API key in the browser, scoped to `documents:search` on one
  collection. The admin key stays server-side and never gets the public prefix.

## Scripts

| Script | Does |
|---|---|
| `npm run seed` | rebuilds the collection, and restores the search key if it went missing |
| `npm run typesense:up` | starts the server |
| `npm run typesense:down` | stops it, keeping your data |
