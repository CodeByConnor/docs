# Ramp Developer API (Mintlify)

Mintlify deployment of **Ramp Developer API** documentation. Guide content is generated from Ramp’s public **`llms-guides`** exports; API reference is wired to Ramp’s **OpenAPI** JSON.

## Prerequisites

- **Node.js 20.17+** (Mintlify CLI)
- [Mintlify CLI](https://www.npmjs.com/package/mint): `npm i -g mint`

## Commands

From this directory (next to `docs.json`):

```bash
mint dev
mint broken-links
```

Refresh guide MDX from Ramp (requires network):

```bash
node migration/convert-from-llms.mjs
```

Then restore [developer-api/v1/introduction.mdx](developer-api/v1/introduction.mdx) if you use the hand-tuned quickstart layout.

## Files

| File | Role |
| --- | --- |
| [docs.json](docs.json) | Site config, navigation, OpenAPI URL, redirects |
| [migration/manifest.json](migration/manifest.json) | Full guide inventory (not published) |
| [migration-notes.md](migration-notes.md) | Migration + QA notes (not published) |

## Links

- [Live Ramp docs](https://docs.ramp.com/)
- [Mintlify docs](https://mintlify.com/docs)
