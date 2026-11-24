# Add a template

A template adds one framework to the CLI. You need Node.js 22 or later and
Docker. The rules that a template meets are in the
[template contract](README.md).

1. Run the framework's generator once in a scratch directory, without the CLI.
   Install its dependencies and start it. Note the files that the starter makes,
   and any version conflict that `npm install` reports.
2. Create `templates/<id>/` with a `template.config.js` and a `files/`
   directory. Use a lowercase kebab-case id.
3. Write the manifest. Take the `scaffold` command from step 1, add the flag
   that skips the generator's install, and use `{{dir}}` for the directory. If
   `npm install` failed in step 1, pin the fix in `devDeps`.
4. Write the overlay. Start from the template whose framework is closest to
   yours. Read field names only from `typesense.config.json`.
5. List the starter files that the overlay replaces in `remove`.
6. Run the checks:

   ```bash
   npm run check
   ```

   `npm run check` runs Biome, the typecheck, and the tests. Manifest validation
   is part of the tests. The test that lists the template ids fails until you add
   your id to `test/templates.test.ts`.
7. Run the end-to-end check on both server paths:

   ```bash
   npm run build
   npm run e2e -- <id>
   npm run e2e -- <id> --existing
   ```

   The first run uses a local server with the books sample data. The page must
   open with "The Hunger Games", and `hary potr` must find Harry Potter. The
   second run starts its own Typesense with a movies collection from
   `test/fixtures/movies.json`, which has no field in common with books. The
   page must open with "Oppenheimer", and `godfathr` must find The Godfather.
   Both checks skip without Docker.
8. Open the generated project in a browser, and type a misspelling. The automated
   checks do not judge the quality of the results.
9. Add a row for the template to the table in [README.md](README.md), and add
   its id to the `-t` list in the [main README](../README.md#run-it-from-an-ai-agent).

`git push` runs `npm run check` first, through the Husky `pre-push` hook, and
stops the push if it fails.

## Checking every template

GitHub Actions runs `npm run check` only, not the end-to-end check. The
maintainer runs step 7 for every template on a schedule. Each run uses the
latest version of each framework's generator, so it finds an upstream breaking
change before a user does.
