# ContentRX Content Model

> **🔒 Status: DEFERRED — preserved as reversibility insurance.**
>
> Per the [2026-04-25 private-taxonomy pivot ADR](../decisions/2026-04-25-private-taxonomy-pivot.md),
> the ContentRX taxonomy is private. This `content-model/` directory was
> prepared to be split out as a public `contentrx-standards` repository
> under CC BY 4.0 (BUILD_PLAN_v2 Sessions 19 and 20). That work is
> deferred. The directory stays in the monorepo as reversibility
> insurance: if the positioning pivots back, the publishable artifacts
> are already shaped and ready to extract. Until that happens:
>
> - **The engine does not read from this directory.** The canonical
>   substrate lives at `src/content_checker/standards/standards_library.json`.
>   Do not edit anything in this directory by hand — it will drift.
> - **Build scripts do not reference this directory.**
>   `scripts/generate-spec.mjs` is removed from the deploy pipeline.
> - **Nothing in this directory is published.** The CC BY 4.0 license
>   below is held in place but inert; no public consumer of this content
>   exists.
> - **Don't delete anything in here.** If a future ADR reverses the
>   pivot, this directory is the seed for the public repo.
>
> The text below is the original README for the planned public spec
> repository. Read it as historical context for what the public-taxonomy
> world would have looked like.

---

The public, versioned spec that ContentRX's engine evaluates against.
Contains 13 situational **moments**, 8 **content types**, and 47
**standards** describing what good UI copy looks like across the
surfaces engineers actually build.

Licensed under [CC BY 4.0](LICENSE) — you can use this model, cite it,
fork it, or extend it, subject to attribution.

## What's in here

| File | Purpose |
|---|---|
| [`SPEC.md`](SPEC.md) | Numbered spec — the canonical human-readable description of moments, content types, standards, and how they compose. |
| [`standards_library.json`](standards_library.json) | Machine-readable standards. Schema versioned. Every standard carries a stable ID, rule text, content-type applicability, and per-standard version history. |
| [`moments_taxonomy.json`](moments_taxonomy.json) | Machine-readable moments. Each moment lists the standards it emphasizes, relaxes, or suppresses. |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history for the library as a whole plus a pointer to per-standard `version_history` entries. |
| [`LICENSE`](LICENSE) | CC BY 4.0 license text + attribution requirements. |

## Why CC BY and not MIT

The content model is a statement of editorial judgment — "this is what
ContentRX thinks good copy looks like in this situation." Treating it
as prose under a Creative Commons license matches that framing better
than a software license. Attribution is required; commercial use is
allowed.

## Relationship to the `contentrx` repo

Today these files live inside the main ContentRX monorepo so the
engine and the spec evolve in lockstep. The engine still reads from
`src/content_checker/standards/standards_library.json` and
`src/content_checker/moments_taxonomy.json` — this directory is a
public-facing mirror of the same data plus the prose spec.

The planned next step (BUILD_PLAN_v2 Session 20 follow-up) is to
extract this directory to its own public repo at
`github.com/contentrx/content-model` and have the engine consume a
pinned version. Until that split happens, treat both locations as
authoritative — whatever change lands in one should land in the other
with the same PR. The CI guard for taxonomy changes
(`.github/workflows/taxonomy_changelog.yml`) already enforces the
parallel-update discipline.

## Citing this model

When citing in code or prose:

```
ContentRX Content Model, version <X.Y.Z>
https://docs.contentrx.io/model
```

When re-publishing the data files, include the LICENSE file verbatim
and record any changes you made in your own CHANGELOG.
