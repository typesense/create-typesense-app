# The template contract

A template is a manifest and a file overlay. The CLI does everything else the
same way for every framework: Docker and CORS, the collection, the import, the
search-only key, and the env file.

The only framework name in `src/` is the default template, `nextjs`. Adding any
other template is a change to this directory alone. To add one, follow
[Add a template](adding-a-template.md).

| Template | Stack | Env prefix |
|---|---|---|
| `nextjs` | Next.js + `react-instantsearch` | `NEXT_PUBLIC_` |
| `angular` | Angular + `instantsearch.js` connectors, built by the Angular CLI | `NG_APP_` |
| `qwik` | Qwik + `instantsearch.js`, bundled by Vite | `VITE_` |
| `react` | React + `react-instantsearch`, bundled by Vite | `VITE_` |
| `solid` | SolidJS + `instantsearch.js` connectors, bundled by Vite | `VITE_` |
| `sveltekit` | SvelteKit + `instantsearch.js` | `PUBLIC_` |
| `vanilla` | JavaScript + `instantsearch.js`, bundled by Vite | `VITE_` |
| `vue` | Vue + `vue-instantsearch`, bundled by Vite | `VITE_` |

## Layout

```
templates/<id>/
├── template.config.js   # the manifest: default-exports one object
└── files/               # copied over the scaffolded project
```

The CLI finds templates by listing this directory. The directory name is the
template id, and it must equal the manifest's `id`. Template ids sort
alphabetically, after the default.

## The manifest

`validateManifest()` in [src/templates.ts](../src/templates.ts) checks every
manifest. An unknown key is an error, so a misspelled field fails the check
instead of being ignored. A new field needs an entry in `MANIFEST_KEYS` and in this table.

| Field | Type | Rules |
|---|---|---|
| `id` | string | Lowercase kebab-case. Equals the directory name. |
| `name` | string | Shown in the framework prompt and the CLI's summary. |
| `scaffold` | string | The command that creates the base project. Must contain `{{dir}}`. |
| `deps` | string[] | Runtime dependencies, installed with `npm install`. Not empty. |
| `devDeps` | string[] | Optional. Installed with `--save-dev`, before `deps`. |
| `env.file` | string | The env file that the framework reads, for example `.env.local`. Relative, no `..`. |
| `env.publicPrefix` | string | The prefix that makes a variable visible to the browser. SCREAMING_SNAKE_CASE, ends with `_`. |
| `seedCommand` | string | The command for `npm run seed`. Names the runner from `devDeps` if it needs one. |
| `files` | string | The overlay directory, relative to the template directory. |
| `remove` | string[] | Optional. Paths in the scaffolded project that the overlay replaces. The CLI deletes them after it copies the overlay. |
| `devCommand` | string | For example `npm run dev`. |
| `devUrl` | string | An `http` or `https` URL. The CLI prints it at the end. |

### `scaffold`

`scaffold` runs the framework's own generator at `@latest`.

- The CLI splits the command into arguments before it puts in `{{dir}}`. A
  directory name with spaces stays one argument.
- `{{dir}}` is a bare directory name, and the command runs in the parent
  directory. `create-vite` treats an absolute path as relative. With
  `/tmp/x/my-app`, it builds `tmp/x/my-app` inside the current directory, leaves
  the real target empty, and exits 0.
- The command must skip the generator's own install, for example with
  `--skip-install`. The CLI then installs the framework's dependencies and the
  template's in one pass.
- `create-next-app` refuses a directory that holds any file it did not create.
  So the CLI scaffolds first, before it writes any other file.

### `devDeps`

`devDeps` installs before `deps`, so a version pin there corrects the starter
before anything else resolves. create-vite's `qwik` starter pins `vite@^8`,
while `@builder.io/qwik` declares the peer `vite@">=5 <8"`. A plain
`npm install` on that starter fails with `ERESOLVE`. The `qwik` manifest pins
`vite@^7` in `devDeps` to fix it.

### `env.publicPrefix`

The CLI decides which variables reach the browser from the lists in
`src/constants.ts`. It puts the prefix only on those variables. The admin key,
`TYPESENSE_API_KEY`, never gets the prefix, so a wrong prefix cannot expose it.
A wrong prefix makes the project ship an `undefined` key that fails without an
error in the browser.

## The overlay

The CLI copies everything under `files/` into the project, with the same
directory structure. It skips `.gitkeep`. The overlay overwrites files that the
starter made, such as the default home page.

The overlay does not ship `package.json`, because the CLI adds the dependencies and
scripts itself. It does not ship `.gitignore` either, because npm drops that file
from published packages. The CLI adds the env file to the project's
`.gitignore` when the starter does not ignore it.

Starter files that the overlay replaces, such as a demo page and its images, go
in `remove`. The `vanilla` template removes `src/counter.js`, `src/assets`, and
`public/icons.svg`.

The Next.js overlay shows what a template contains:

| Path | Contents |
|---|---|
| `lib/typesense.ts` | The search client. Reads the public env variables and the search config, with `query_by` for each collection. |
| `app/search.tsx` | The page for one collection and the federated page. Field names come only from the search config. |
| `app/page.tsx` | The home page: the page for one collection, or the federated page for several. |
| `app/collections/[name]/page.tsx` | The **Show all in &lt;collection&gt;** page: one collection with its facets, with the query kept. |
| `app/search.module.css` | Styles for those pages. |
| `scripts/seed.ts` | Drops the collection, creates it from the `schema` in the search config, imports the data, and restores the search key if it is gone. |

## The search config

The CLI writes `typesense.config.json` in the project root. It is the
generated project's only schema, and the only description of the UI. The
[README](../README.md#change-what-the-page-searches-and-shows) describes its fields.

The UI of a template meets these rules:

- No field name appears in the overlay. The UI searches `queryBy`, shows one
  refinement list for each entry in `facets`, titles each hit with `title`,
  shows `image` when it is set, and lists the `display` fields.
- The adapter gets `query_by` for each collection through
  `collectionSpecificSearchParameters`.
- The page opens with results. The empty query browses the collection.
- A failed search shows its error on the page, in an element with
  `role="alert"`. InstantSearch otherwise turns the error into zero hits.
- A number shows as it is. `toLocaleString` would print a year as `2,008`.
- The UI hides an image that fails to load.
- The search input is `<input type="search">`. The end-to-end check types into it.
- With one collection, the home page is the page for that collection. With
  several, one query goes to all of them. The home page shows a section for
  each collection with its top 5 hits, `No results in <name>.` when there are
  none, and a link with the text `Show all in <name>`. That link opens a page
  for the collection alone, with its own facets, and keeps the query. A template
  without a router uses `?collection=<name>&q=<query>` on the same page.
- A collection can be an alias. The UI does not need to know.

## The design

Every template has the same design, which follows the Typesense Cloud
dashboard. The reference is the Next.js overlay, `app/search.module.css`.

| Token | Value | Use |
|---|---|---|
| `--ts-page` | `#fefefe` | page background |
| `--ts-panel` | `#f7f7fa` | facet search box, facet counts |
| `--ts-border` | `#e6e6ee` | dividers, panel border |
| `--ts-border-strong` | `#c9cad6` | search input border |
| `--ts-text` | `#303138` | text |
| `--ts-muted` | `#6f7082` | field labels, stats, header links |
| `--ts-indigo` | `#3943b7` | page and section headings |
| `--ts-pink` | `#ed0e73` | links, focus, checked facets, highlighted matches |
| `--ts-pink-tint` | `#fde7f1` | highlight and focus backgrounds |
| `--ts-checkbox-border` | `#9495a6` | facet checkbox border |

- Text is Palanquin at 1.0625rem, a little above the Cloud dashboard's 0.95rem
  so that it stays readable on large monitors. Headings and hit titles are
  Catamaran. Next.js loads both with `next/font`. The other templates load them
  from Google Fonts in the HTML head.
- The header shows the official logo, `typesense-logo.svg`, linked to
  typesense.org, and the links `docs`, `github`, and `cloud`.
- The favicon is the official `favicon.png`. The manifest's `remove` list
  deletes the starter's own icon.
- The facet checkbox is the Cloud checkbox: 1.35rem, a 0.375rem radius, pink
  when checked, with a white check mark.
- Each hit shows its `display` fields as a `<dl>` of muted labels and values.
- The window title is `Search <name> | Typesense` for one collection, and
  `Search | Typesense` for the federated page.

## Layout pitfalls

A starter's styles can make the layout follow its content, so the page changes
size on every keystroke. Next.js sets `body { display: flex }`, and auto margins
on a flex item stop it from stretching. The Solid starter fixes `#root` to a
centred column of fixed width. Give the page an explicit width. If the starter's
stylesheet sets the layout of `body` or `#root`, replace it.

## Framework bindings

`react-instantsearch` and `vue-instantsearch` render the widgets as components.
A framework without a binding uses `instantsearch.js` in one of two ways:

- **Connectors**, when the framework's state can hold any value. A connector
  returns state and a `refine()` function, and the template puts them in the
  framework's reactive state. The `solid` and `angular` templates do this with
  signals.
- **Widgets that own the DOM**, when the framework's state cannot hold any
  value. Qwik serializes component state
  to resume it, and InstantSearch state holds callbacks and class instances that
  Qwik cannot serialize. So the `qwik` template runs the library inside
  `useVisibleTask$`, and lets it fill elements that Qwik renders.
