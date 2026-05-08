# Ramp full migration — recovery notes

## Summary

This repo was reset to the Mintlify starter baseline, then rebuilt using **Ramp’s public `llms-guides` text exports** as the source of truth (per [llms.txt](https://docs.ramp.com/llms.txt)). All **36** guide URLs from the migration manifest are present as MDX under `developer-api/v1/`. The **API reference** tab uses Ramp’s canonical OpenAPI URL. Starter-only Mintlify demo content was removed after navigation stabilized.

## What was migrated

| Area | Count | Location |
| --- | --- | --- |
| Guide pages (from manifest) | 36 | `developer-api/v1/**/*.mdx` |
| Home | 1 | `index.mdx` |
| API overview | 1 | `api-reference/introduction.mdx` |
| OpenAPI-driven reference | auto | `docs.json` → `https://docs.ramp.com/openapi/developer-api.json` |

### Manifest

Canonical list: [migration/manifest.json](migration/manifest.json) (ignored from Mintlify build via `.mintignore`).

### Regeneration

To refresh guide bodies from Ramp’s servers:

```bash
cd /path/to/docs   # directory containing docs.json
node migration/convert-from-llms.mjs
```

Then restore the hand-built [developer-api/v1/introduction.mdx](developer-api/v1/introduction.mdx) if you want the Ramp-style quickstart cards (the script overwrites it).

## Source precedence

1. `https://docs.ramp.com/llms.txt` (guide index)
2. `https://docs.ramp.com/llms-guides/<path>.txt` (per-page body)
3. `https://docs.ramp.com/openapi/developer-api.json` (API reference)
4. `https://docs.ramp.com/sitemap.xml` — optional cross-check (HTTP 200 as of last QA); `llms.txt` remains the authoritative guide list for this migration.

## MDX conversion rules

The converter (`migration/convert-from-llms.mjs`):

- Preserves Ramp `title` / `summary` / `source_url` in frontmatter and a source `<Note>`.
- Escapes `<` as HTML entities to avoid accidental tags.
- Fences **line-initial** JSON objects in ```json blocks.
- Wraps **inline** one-level JSON objects in backticks so `{` does not start MDX expressions.

**Not yet done to “full component parity”:** automated conversion does not infer Ramp UI **Steps**, **Accordions**, or image embeds from the plain-text export. Those must be added incrementally where the live HTML docs show them. Textual content is complete from `llms-guides`.

## Branding

- `logo/light.svg` and `logo/dark.svg` use a **simple text wordmark** (“Ramp”) for light/dark backgrounds — not official trademark artwork. Replace with approved Ramp brand assets when you have them.
- Theme colors in `docs.json` approximate Ramp’s dark + lime accent (`primary` / `light`).

## Redirects (starter URLs)

`docs.json` includes redirects so old starter bookmarks do not 404:

- `/quickstart` → `/developer-api/v1/getting-started`
- `/development` → `/developer-api/v1/getting-started`

## QA (local)

| Check | Result |
| --- | --- |
| Node | Use **20.17+** (`nvm use 20`) — Mintlify CLI requirement |
| `mint broken-links` | **Pass** (after MDX JSON fixes) |
| `mint dev` | **Pass** — preview ready (port may shift if 3000–3002 are busy) |

## Follow-ups (checklist alignment)

- [ ] Replace text wordmark SVGs with **official** Ramp logo + favicon when available.
- [ ] Optional: Mintlify **custom font** if brand requires it ([settings reference](https://mintlify.com/docs/organize/settings-reference)).
- [ ] Rich component parity: map Ramp callouts / steppers / accordions from live HTML where `llms-guides` is too plain.
- [ ] Media: pull screenshots/video only where they exist in public sources (not invented).
- [ ] CI: run `node migration/convert-from-llms.mjs` + `mint broken-links` on a schedule or before deploy if you need drift detection against Ramp’s text exports.

## Starter fix (baseline)

`essentials/images.mdx` had a broken relative link to Mintlify embed docs; it was updated to an absolute `https://mintlify.com/docs/content/embed` link before starter folders were removed (so `mint broken-links` was green on baseline).
