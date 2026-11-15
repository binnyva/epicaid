# Epic Aid

Spoiler-free reminders of who's who in long book series. The domain language is in [CONTEXT.md](CONTEXT.md) and the key decisions are in [docs/adr](docs/adr).

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js app on Vercel: the Reader app and the admin site |
| `apps/cli` | Admin CLI, run on your own machine; Ingestion lives here (ADR 0002) |
| `packages/db` | Drizzle schema and SQL migrations for Neon Postgres |
| `packages/core` | Spoiler Boundary rules, the Summary cache key, and later prompts and the citation check |

## Setup

Requires Node 22+ and pnpm 10 (`corepack enable`).

1. `pnpm install`
2. Create the services (free tiers):
   - **Neon**: create a project and a database called `epicaid`. Copy the pooled and the direct connection strings.
   - **Upstash**: create a Redis database and copy its REST URL and token.
   - **OpenRouter**: create an API key, and set a monthly credit limit on it.
3. `cp .env.example .env` and fill in the values.
4. `pnpm db:migrate` creates the extensions and tables on Neon.
5. `pnpm cli check` should print `Connected. Extensions: fuzzystrmatch, pg_trgm. Tables: 18.`

## Deploy to Vercel

1. Put the folder in a GitHub repository (`git init`, commit, push).
2. In Vercel, import the repository and set **Root Directory** to `apps/web`. Vercel detects the pnpm workspace.
3. Add `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `OPENROUTER_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` and `ADMIN_EMAIL` as environment variables.

## Sign-in

Google only, invite-only. In Google Cloud, create an OAuth client of type *Web application* with the redirect URIs `http://localhost:3000/api/auth/callback/google` and `https://<your-domain>/api/auth/callback/google`. While the consent screen is in *Testing*, each Reader must also be a test user there.

`ADMIN_EMAIL` can always sign in and is always an admin. Everyone else must be on the invite list at `/admin/readers`. Sessions are signed cookies (`AUTH_SECRET`), valid for 30 days; removing someone from the invite list locks them out on their next request.

## Admin

`/admin` lists each Series. From there:

- **Series**: rename, publish (also publishes its Books), and edit Reading Orders (number the Books; leave a box empty to leave a Book out).
- **Subjects**: search the catalogue, rename, change kind, mark Major, add an Alias, set or clear an Alias's Reveal Chapter, split an Alias into its own Subject, merge another Subject in, delete.
- **To review**: Aliases that Ingestion flagged as possible secret identities. Confirm the Reveal, change it, or split the Alias off.

Re-ingesting a Book replaces its Chapters, which clears Reveal Chapters set in that Book. Do catalogue fixes once a Book's Ingestion is final. After merging Subjects, refresh their Book Summaries with `pnpm cli ingest … --resummarise`.

## Reader app

Signed-in Readers land on the reader side, built to `docs/design/reader-pocket.md` (Pocket):

- **Series picker** on first sign-in, and from Reading → Series to switch. Each Series keeps its own Reading.
- **Reading**: choose a Reading Order and tick Finished Books.
- **Position**: pick the current Book (Change Book) and the last finished Chapter, from the Chapter list or by Quote Search (four or more words, current Book only, returns Chapters, never text).
- **Look up**: fuzzy and sound-alike search over Aliases mentioned inside the Spoiler Boundary, with kind filters and Lookup History (the last 20 per Reading). A Subject page shows the name, kind and other visible names; Summaries arrive in Phase 4.

Every reader query filters on the Spoiler Boundary in SQL (`packages/db/src/reader.ts`), and Draft Books never count. `packages/db/src/reader.test.ts` checks this against a made-up Series in an in-process Postgres (PGlite), so `pnpm test` needs no database.

## Everyday commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Run the web app locally |
| `pnpm test` | Run the unit tests |
| `pnpm typecheck` | Type-check every package |
| `pnpm db:generate` | Write a new migration after changing `packages/db/src/schema.ts` |
| `pnpm db:migrate` | Apply migrations to the database in `DATABASE_URL_UNPOOLED` |

## Adding a Book

1. Put the EPUB in its own folder, e.g. `0Meta/Books/<Series>/<NN-Book>/` (`0Meta/` is git-ignored, so book text never reaches GitHub).
2. `python3 apps/cli/scripts/extract_epub.py "<folder>/<Book>.epub"` writes `extracted/book.json` and one cleaned HTML file per table-of-contents entry.
3. Check `kind` in `book.json`: `front` and `back` matter (dramatis personae, glossaries) are skipped, and everything marked `chapter` becomes a Chapter. Fix any wrong guesses by hand.
4. `pnpm cli ingest "<folder>" --series malazan --dry-run` shows the Chapter and Passage counts without spending anything.
5. `pnpm cli ingest "<folder>" --series malazan --series-name "Malazan"` runs Ingestion:
   - **Extraction**: one model call per Passage, cached in `extracted/extraction/`, so re-runs only pay for Chapters not yet done. A Chapter another model already extracted is reused too, so switching to a cheaper model only pays for new Chapters (`--fresh` turns that off).
   - **Merge**: names become Subjects and Aliases. Likely secret identities get a Reveal Chapter (ADR 0005).
   - **Load**: writes the Book into Neon as a Draft. Re-running replaces that Book's Chapters and Passages.
   - **Book Summaries** for Major Subjects (25+ Passages by default). Existing ones are kept unless you pass `--resummarise`.
6. Read `extracted/ingest-report.md`: Subjects by size, and every flagged secret identity to check.
