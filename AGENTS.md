> For Mintlify product knowledge (components, `docs.json`, writing standards), install the Mintlify skill: `npx skills add https://mintlify.com/docs`

# Ramp Developer API docs (Mintlify)

## About this project

- Public content is sourced from Ramp **`llms-guides`** (see [llms.txt](https://docs.ramp.com/llms.txt)); do not invent endpoints or behaviors not present in source exports or OpenAPI.
- Configuration is in [docs.json](docs.json). Page files are MDX under `developer-api/v1/` plus [index.mdx](index.mdx).
- Regenerate guides with `node migration/convert-from-llms.mjs` from the repo root (requires `curl`).

## Terminology

- Use **Ramp Developer API** for the REST API; **Sandbox** vs **production** hosts must be explicit.
- Distinguish **MCP**, **Ramp MCP**, and **Developer MCP** — separate products/pages.
- Prefer **OAuth 2.0**, **access token**, and **scopes** as in Ramp’s authorization guide.

## Style

- Active voice, second person (“you”).
- Sentence case headings; bold UI labels (**Settings**).
- Use Mintlify callouts (`Note`, `Warning`, `Tip`, `Steps`) when improving scannability beyond plain-text imports.

## Boundaries

- Do not add undocumented REST paths or request fields.
- Official brand assets: replace placeholder wordmark SVGs in `logo/` when Ramp provides approved files.
