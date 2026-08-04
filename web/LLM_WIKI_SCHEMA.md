# Knowledge Wiki Schema

This product follows the LLM Wiki pattern with a database-backed representation.
The database is the persistent artifact; it is not a chat-memory cache.

## Layers

- `clips` is the immutable Raw layer. Preserve the captured URL, text, verification state, and processing history. Do not rewrite a source to make it fit a later conclusion.
- `knowledge_cards` is a reading projection of a verified Raw source. A card is not the Wiki itself.
- `wiki_pages` is the persistent Wiki. Claim pages hold one reusable claim. Topic pages are living indexes of linked claim pages.
- `wiki_page_sources` records which Raw source contributed to a page.
- `wiki_links` records explicit relations. `about` and `related_to` are safe indexing links. `supports`, `contradicts`, and `depends_on` require source-grounded rationale; never infer them from shared tags alone.
- `wiki_activity` is append-only. Record ingestion, index changes, Story paths, queries, lint passes, and learning attempts.

## Ingest

1. Store a Raw source first.
2. Compile only a source with usable text and a verified original URL. A directory page, an AI HOT lead, or a video without a transcript stays Raw.
3. Create one claim page per compiled card and link it to its source and topic pages.
4. Update topic indexes and write the operation to the log.

## Story Mode

Story Mode is a temporary reading path through existing Wiki pages: question, progressive evidence, then an actionable takeaway. It may order and frame pages, but may not upgrade `related_to` into support, causation, contradiction, or the user's own stance.

## Query And Maintenance

Read the Wiki index before answering a question, follow the relevant pages and sources, and file durable answers back as pages or links. Lint for orphan pages, missing sources, unverified claims, stale summaries, missing concepts, and unsupported relation types. Preserve uncertainty instead of manufacturing a clean synthesis.

## Human Boundary

The human chooses sources, directs questions, and owns judgment. The LLM maintains extraction, cross-references, indexes, logs, and Story paths. A knowledge card or Story never writes a judgment delta automatically.
