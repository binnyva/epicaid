# Epic Aid

A spoiler-free memory aid for readers of long, multi-volume book series. A reader asks about someone or something from the story, and Epic Aid summarises only what the books have revealed up to the point the reader has reached.

## Books

**Series**:
A set of Books that share a world and cast, and so share one Subject catalogue, possibly by several authors (e.g. Malazan: Erikson's ten Books plus Esslemont's six). Epic Aid hosts many Series.
_Avoid_: Epic, saga, franchise, universe

**Book**:
One volume within a Series. Novellas are Books too.
_Avoid_: Volume, novel, title

**Chapter**:
The smallest unit of reading progress inside a Book. Prologues, interludes and epilogues are Chapters too.
_Avoid_: Section, part, page

**Passage**:
A short run of consecutive paragraphs within a Chapter; the unit of text that Summaries are built from.
_Avoid_: Chunk, excerpt, snippet

**Reading Order**:
A named, ordered list of whole Books in a Series, defined by the admin (e.g. publication order, chronological order). It need not include every Book in the Series and never splits a Book. A Reader chooses one for their Reading and can switch later. It suggests what to read next but never decides what counts as read.
_Avoid_: Sequence, book order

## Readers

**Reader**:
A person who signs in to look up Subjects in a Series they are reading.
_Avoid_: User (except in admin/account contexts), customer

**Reading**:
A Reader's ongoing progress through one Series: the Reading Order they chose, their Finished Books and their Reading Position. A Reader has at most one Reading per Series.
_Avoid_: Subscription, library entry, progress

**Finished Book**:
A Book the Reader has marked as read within a Reading. Readers see and edit this list directly; switching Reading Order never changes it.
_Avoid_: Completed book, read book

**Reading Position**:
The Book the Reader is currently in and the last Chapter of it they have finished. It may be empty between Books, and it may move backwards.
_Avoid_: Bookmark, current chapter, progress

**Spoiler Boundary**:
What a Reader may see: every Chapter of their Finished Books, plus the current Book up to and including the Reading Position. Everything else is a spoiler.
_Avoid_: Cutoff, limit

## Lookups

**Subject**:
Anything in a Series a Reader can look up: a character, place, artefact, faction, and so on. Subjects come from a prepared catalogue per Series, not from free text.
_Avoid_: Entity, element, term, topic

**Alias**:
A name by which a Subject is known. An Alias is visible to a Reader only if it appears in some Chapter inside their Spoiler Boundary; otherwise it must never be shown or matched.
_Avoid_: Nickname, alternate name

**Reveal**:
The Chapter where the text establishes that an Alias belongs to its Subject. Ordinary names need no Reveal and are joined to their Subject wherever they are visible. Until an Alias's Reveal is inside the Spoiler Boundary, it acts as a Subject of its own, and lookups never combine it with the Subject's other Aliases.
_Avoid_: Identity reveal, link point, unmasking

**Mention**:
A record that a Passage refers to a Subject, by any of its Aliases.
_Avoid_: Occurrence, hit, reference

**Book Summary**:
An LLM-written account of what one Book alone reveals about a Subject. Because it covers a whole Book, it holds no spoilers for anyone who has finished that Book, whatever their Reading Order.
_Avoid_: Volume summary, partial summary

**Major Subject**:
A Subject with enough Mentions that its Book Summaries are prepared ahead of time during Ingestion, not on first lookup.
_Avoid_: Main character, important subject

**Summary**:
An LLM-written account of a Subject for one Spoiler Boundary, built from Book Summaries of Finished Books plus Passages from the current Book. Every sentence cites its source.
_Avoid_: Recap, description, bio

**Lookup History**:
The Subjects a Reader recently looked up within a Reading. Reopening one always uses the current Spoiler Boundary.
_Avoid_: Recent searches, favourites

**Quote Search**:
Finding a Reading Position by typing a phrase from the current Book; it returns only matching Chapter numbers and titles, never text.
_Avoid_: Text search, find in book

## Operations

**Ingestion**:
Turning a Book's extracted HTML into Chapters, Passages, Subjects, Aliases, Mentions and Book Summaries. It runs on the admin's own machine, never on the hosted app.
_Avoid_: Import, upload, processing

**Spoiler Report**:
A Reader's flag that a cached Summary reveals something past their Spoiler Boundary. The admin resolves it by regenerating the Summary.
_Avoid_: Complaint, feedback, flag

**Draft**:
A Series or Book that has been ingested but not yet published by the admin. Readers never see Drafts.
_Avoid_: Unpublished, staging, pending
