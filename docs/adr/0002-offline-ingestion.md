# Ingestion runs offline on the admin's machine

Books are ingested by a local CLI, not by the hosted app. It splits Chapters into Passages, extracts Subjects and Aliases, records Mentions, and writes Book Summaries for Major Subjects. Ingestion is slow and makes many LLM calls, which a free-tier Vercel deployment can't run within its request limits. Book text never leaves the admin's machine except as Passages in the database. The hosted app reads book data and never creates it.
