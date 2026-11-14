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
3. Add `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `OPENROUTER_API_KEY` as environment variables.

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
   - **Extraction**: one model call per Passage, cached in `extracted/extraction/`, so re-runs only pay for Chapters not yet done.
   - **Merge**: names become Subjects and Aliases. Likely secret identities get a Reveal Chapter (ADR 0005).
   - **Load**: writes the Book into Neon as a Draft. Re-running replaces that Book's Chapters and Passages.
   - **Book Summaries** for Major Subjects (25+ Passages by default). Existing ones are kept unless you pass `--resummarise`.
6. Read `extracted/ingest-report.md`: Subjects by size, and every flagged secret identity to check.
