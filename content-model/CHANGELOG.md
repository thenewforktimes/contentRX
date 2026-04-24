# Changelog — ContentRX Content Model

Tracks changes to the public spec. Per-standard version history
lives inline in [`standards_library.json`](standards_library.json)
under each standard's `version_history` field — this file summarizes
library-level changes. For a browsable per-standard changelog, see
[docs.contentrx.io/model/changelog](https://docs.contentrx.io/model/changelog)
(generated from the same source data).

## 4.7.0 — 2026-04-24

Public-spec carve-out. First release under CC BY 4.0.

- **Added** `content-model/` directory inside the main ContentRX repo
  with the CC BY 4.0 license, this spec, and mirrored canonical
  JSON (`standards_library.json`, `moments_taxonomy.json`). Engine
  still reads from `src/content_checker/standards/` until the
  directory is extracted to its own public repo
  (`github.com/contentrx/content-model`, planned follow-up).
- **Added** `influences` sub-field on standards, documenting how each
  standard aligns with / diverges from / synthesizes external design
  systems. Populated initially on `ACT-01` and `CLR-01`; drip-filling
  the rest as `sources` audits complete.
- No rule text changes — this release is metadata + packaging only.

## 4.6.x — pre-public

Version 4.6 and earlier were internal to the ContentRX monorepo with
no separate public spec. The per-standard `version_history` fields
in `standards_library.json` preserve the history for individual
rules. Key internal milestones included:

- **4.6.1** — per-standard version tracking introduced. Every
  standard got a `version` field and an append-only
  `version_history` entry.
- **4.6.0** and earlier — the 47-standard library was assembled
  over roughly 30 sessions of taxonomy work, documented in
  `taxonomy_refinement_log.md`.

## How to read this

- Minor versions add standards, add metadata, or refine
  `content_type_notes` without changing existing rule meanings.
  Clients that read `standard_id` + `rule` don't break.
- Major versions retire or rename standards, or change a rule's
  meaning. Clients should re-validate against the current library.
- Patches fix typos or formatting.

Each release updates the top-level `version` in
`standards_library.json`. Per-standard versions bump only when that
specific standard's contents changed — a library-version bump does
not mean every rule changed.
