# create-typesense-app

Get a working Typesense search UI in about 30 seconds.

```sh
npx create-typesense-app@latest
```

You get a Next.js app, Typesense running in Docker with CORS set up, roughly
10,000 books indexed, and a search-only API key scoped to one collection. The
admin key stays out of the browser.

```
◇  Scaffolded Next.js + react-instantsearch
◇  Typesense is healthy at http://127.0.0.1:8108
◇  Indexed 9979 documents into "books"
◆  Typo tolerance works: "hary potr" → Harry Potter and the Philosopher's Stone (17 hits)
```

```sh
cd my-search-app
npm run dev
```

Type `hary potr` and it finds *Harry Potter and the Philosopher's Stone* in 2ms.

## Why

`create-next-app` already scaffolds a frontend well. The gap is what comes after.
You still need a running server, a collection with a schema, data in it, and CORS
plus API keys done properly. That last part is why so many Typesense demos either
fail in the browser or ship an admin key to it.

## Requirements

Node 22 or newer. Docker is optional. Without it, point at a Typesense you
already run or a Cloud cluster.

## Options

```
npx create-typesense-app@latest [directory] [options]

  -t, --template <id>   nextjs (only one is bundled)
      --dataset <name>  books (default) or empty
      --port <number>   host port for the local server (default 8108)
  -y, --yes             take the defaults, no prompts
  -h, --help            show this
  -v, --version         print the version
```

## What you get

```
my-search-app/
├── docker-compose.yml   # CORS enabled
├── .env.local           # admin key unprefixed, search key prefixed
├── data/books.jsonl     # downloaded once, then cached
├── scripts/schema.ts    # the collection schema, edit this first
├── scripts/seed.ts      # drop, recreate, re-import
├── lib/typesense.ts     # search client
└── app/page.tsx         # search box, hits, one facet
```

| Script | Does |
|---|---|
| `npm run seed` | rebuilds the collection, and restores the search key if it went missing |
| `npm run typesense:up` | starts the server |
| `npm run typesense:down` | stops it, keeping your data |

`docker compose down --volumes` wipes the data and the API keys with it. Run
`npm run seed` to put them back.

## Two keys, never one

The admin key lives in `TYPESENSE_API_KEY` with no public prefix, so Next.js
never sends it to the browser. Only `scripts/seed.ts` reads it.

A second key, scoped to `documents:search` on one collection, is the only one the
client ever sees. It cannot write documents, drop the collection, or create more
keys.

## Re-running

Every step is safe to repeat. A run that fails part way picks up where it left
off. A finished project is refused rather than overwritten.

## Templates

A template is a manifest plus a file overlay. See
[templates/README.md](templates/README.md) for the contract.

Only Next.js ships. More frameworks would mean keeping each one working against
upstream churn, and the value here is the search wiring rather than the framework.

## Development

```sh
npm install
npm test        # 279 tests, the integration suite needs Docker
npm run build
```

---

Independent community project. Not affiliated with Typesense, Inc.
