# Ramp Docs Migration Notes

## Summary

This repository is a Mintlify migration preview of Ramp’s public developer documentation (`docs.ramp.com`). Content is sourced from Ramp’s machine-readable public exports, organized into Mintlify navigation groups, and published with OpenAPI-driven API reference generation.

## Source materials used

- `https://docs.ramp.com/llms.txt`
- `https://docs.ramp.com/llms-guides/*.txt` (primary per-page source)
- `https://docs.ramp.com/llms-guides.txt` (coverage cross-check)
- `https://docs.ramp.com/llms-full.txt` (coverage cross-check)
- `https://docs.ramp.com/llms-api.txt` (API text cross-check)
- `https://docs.ramp.com/openapi/developer-api.json` (API Reference generation)

## What was migrated

- Guide pages discovered from `llms.txt` and mapped via `migration/manifest.json`
- `developer-api/v1/**/*.mdx` guide pages (36 source pages currently mapped)
- Homepage: `index.mdx`
- API Reference overview page: `api-reference/introduction.mdx`
- OpenAPI-generated REST endpoint reference via `docs.json` `openapi` config

## Information architecture

`docs.json` uses two top-level tabs:

- **Guides**
  - Getting Started
  - Developer Resources
  - Applications
  - Accounting
  - Custom Records
  - Virtual Cards
  - Ramp Data
  - Cards and Funds
  - Bill Pay
  - Agentic / MCP
- **API Reference**
  - Overview page
  - Endpoints generated from Ramp OpenAPI URL

This structure mirrors Ramp’s major documentation areas while keeping Mintlify-native grouping and `root` pages for predictable sidebar behavior.

## Mintlify components used

Across migrated pages, formatting uses Mintlify-native components where appropriate:

- `Note` for source/contextual implementation notes
- `Warning` for security-sensitive credential/token guidance
- `Tip` for best-practice emphasis
- `Steps` / `Step` for procedural workflows (applied to Getting Started and selected workflows)
- `CardGroup` / `Card` for quick-navigation collections (homepage and introduction)
- `AccordionGroup` / `Accordion` used selectively when FAQ-style expansion is natural

## QA performed

- `mint dev` local preview boot + page click-through validation
- `mint validate` schema/build validation
- `mint broken-links` internal link verification
- Navigation/page existence check against `migration/manifest.json`
- OpenAPI reference check using `https://docs.ramp.com/openapi/developer-api.json`
- Starter content removal check (Mintlify template pages/directories removed)
- Internal link review and redirect checks for legacy starter paths

## Known production follow-ups

- Pull screenshots/image assets from source/customer-approved files where rendered pages reference visuals not present in `llms-guides` text exports.
- Guides pages under `developer-api/v1/guides/**` include places where rendered Ramp pages appear to rely on visuals/snippets not fully present in `llms-guides` exports; verify screenshot/media parity during production QA.
- `llms-guides` source for several Getting Started pages references setup snippets/config examples but does not include full snippet bodies in the export. Cross-check against rendered docs before final publish:
  - `developer-api/v1/getting-started/cli`
  - `developer-api/v1/getting-started/agent-cards`
  - `developer-api/v1/getting-started/ramp-mcp`
  - `developer-api/v1/getting-started/developer-mcp`
- Endpoint-by-endpoint API reference QA against production use cases.
- Track and document any OpenAPI rendering warnings if they appear in future spec updates.
- Replace placeholder logo/favicon with final customer-approved brand assets.
- Optional deeper visual parity tuning within Mintlify theme/config constraints.
- Keep endpoint docs OpenAPI-generated; avoid manually stubbing static endpoint MDX unless OpenAPI fails.
