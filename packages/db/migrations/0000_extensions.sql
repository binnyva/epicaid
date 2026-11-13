-- Fuzzy Alias search (ADR 0001): trigram matching for typos, Double Metaphone for sound-alikes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
