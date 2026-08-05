# create-typesense-app

**From an empty directory to a working typo-tolerant search UI in about 30 seconds.**

```sh
npx create-typesense-app@latest
```

That's it. You get a Next.js app, a Typesense server running in Docker with CORS
already configured, ~10,000 books indexed, and — the part people get wrong by
hand — a **search-only API key** scoped to one collection, with the admin key kept
out of the browser.

Then type `hary potr` and watch it find *Harry Potter and the Philosopher's Stone*
in about 2ms.

```
◇  Plan ────────────────────────────────────────────────────────────╮
│  Template     Next.js + react-instantsearch                       │
│  Server       Docker (typesense/typesense:30.2) on port 8108      │
│  Collection   "books" + ~10k titles (downloaded)                  │
│  Env file     my-search-app/.env.local                            │
│    browser    NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY  (+ host, │
│               port, protocol, collection)                         │
│    server     TYPESENSE_API_KEY (admin — never prefixed)          │
├───────────────────────────────────────────────────────────────────╯
◇  Scaffolded Next.js + react-instantsearch
◇  Typesense is healthy at http://127.0.0.1:8108
◇  Indexed 9979 documents into "books"
◆  Typo tolerance works: "hary potr" → Harry Potter and the Philosopher's Stone (17 hits)

◇  Next ────────────────────────────────────────────────────────────╮
│  cd my-search-app                                                 │
│  npm run dev   # http://localhost:3000 — type "hary potr"         │
╰───────────────────────────────────────────────────────────────────╯
```

## Why this exists

Scaffolding a frontend is already solved — `create-next-app` does it well. The
friction is the four steps between "scaffold" and "results on keypress":

1. Getting a Typesense server running
2. Creating a collection **with a schema** before anything can be indexed
3. Loading data
4. **CORS and API keys** — `--enable-cors`, plus a browser-safe key instead of the
   admin key

Step 4 is the one that matters. It is why so many Typesense demos either don't
work in the browser or ship an admin key to it.

## What it does for you

- **Starts a Typesense server** from a generated `docker-compose.yml` with
  `--enable-cors` already set, and waits until `/health` actually reports ok
- **Creates the collection from a schema** you can read and edit —
  `scripts/schema.ts`, short and commented
- **Indexes ~10k real books** (Typesense's own sample dataset, with ratings and
  cover images)
- **Generates two keys, and keeps them apart.** A randomly generated admin key
  stays in `TYPESENSE_API_KEY`, unprefixed, so Next.js never sends it to the
  browser. A separate key scoped to `documents:search` on one collection is the
  only key that reaches the client — it cannot write documents, drop the
  collection, or create more keys
- **Wires up the search UI** — search box, hits with covers, one facet
- **Verifies the result itself** before claiming success, by running the typo query
  with the search-only key
- **Adds `seed`, `typesense:up` and `typesense:down`** to your `package.json`

## Requirements

- **Node 22+**
- **Docker** — optional. Without it you can point at a Typesense you already run,
  or a Typesense Cloud cluster.

## Options

```
npx create-typesense-app@latest [directory] [options]

  -t, --template <id>   nextjs (only one is bundled)
      --dataset <name>  books (default) | empty — skips the sample data download
      --port <number>   host port for the local Docker server (default 8108)
  -y, --yes             accept defaults: nextjs, local Docker, books dataset
  -h, --help            show this
  -v, --version         print the version
```

`--yes` collapses the whole flow into one non-interactive command, which is what
makes this usable in a tutorial or a CI check.

## What lands in your project

```
my-search-app/
├── docker-compose.yml       # CORS enabled, named volume
├── .env.local               # admin key unprefixed, search-only key prefixed
├── data/
│   ├── books.jsonl          # downloaded on first run, then cached
│   └── books.schema.json
├── scripts/
│   ├── schema.ts            # the collection schema — edit this first
│   └── seed.ts              # drop, recreate, re-import
├── lib/typesense.ts         # search client, reads the public env vars
└── app/page.tsx             # search box, hits, one facet
```

Three scripts are added alongside the framework's own:

| Script | What it does |
|---|---|
| `npm run seed` | rebuilds the collection from `data/books.jsonl`, and restores the search-only key if it has been lost |
| `npm run typesense:up` | starts the server |
| `npm run typesense:down` | stops it, **keeping** your indexed data |

To wipe the data as well, run `docker compose down --volumes`. That also deletes
the API keys — `npm run seed` recreates them.

## Re-running

Every step is idempotent. If a run fails part-way, run it again: the scaffold is
skipped if a project is already there, the admin key is reused, the dataset is
served from cache, and the collection is rebuilt. A `.create-typesense-app.json`
marker tracks an in-progress run and is deleted on success — so a *finished*
project is refused rather than silently overwritten.

## Contribute a template

A template is a manifest plus a file overlay, and no framework's name appears
anywhere in `src/`. See **[templates/README.md](templates/README.md)** for the
contract and a worked example.

Only Next.js ships today. That is deliberate: a second framework doubles the
surface that has to keep working against upstream churn, for a demo whose value is
the search wiring rather than the framework.

## Development

```sh
npm install
npm test           # 279 tests; the integration suite needs Docker and skips without it
npm run typecheck
npm run build
npx .              # run the built CLI
```

The integration tests start a real Typesense container, assert the search-only key
returns typo-tolerant hits, and assert it is refused for writes, key listing and
collection deletion.

---

An independent community project. Not affiliated with Typesense, Inc.
