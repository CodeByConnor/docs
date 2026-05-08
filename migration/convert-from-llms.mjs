#!/usr/bin/env node
/**
 * Downloads Ramp llms-guides/*.txt and writes Mintlify MDX under developer-api/v1/.
 * Run from repo root (directory containing docs.json): node migration/convert-from-llms.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = join(__dirname, "..");
const MANIFEST = JSON.parse(readFileSync(join(__dirname, "manifest.json"), "utf8"));
const BASE = "https://docs.ramp.com/llms-guides/";

const iconByGroup = {
  "Getting started": "rocket",
  Guides: "book-open",
  "Core API concepts": "gears",
};

function fetchText(url) {
  return execFileSync("curl", ["-fsSL", url], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
}

function parseLlmsGuide(raw) {
  const lines = raw.split(/\r?\n/);
  let title = "Untitled";
  let summary = "";
  let sourceUrl = "";
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("title:")) title = line.slice(6).trim();
    else if (line.startsWith("summary:")) summary = line.slice(8).trim();
    else if (line.startsWith("source_url:")) sourceUrl = line.slice(11).trim();
    else if (line.startsWith("content:")) {
      i++;
      break;
    }
  }
  const body = lines.slice(i).join("\n").trim();
  return { title, summary, sourceUrl, body };
}

/** Wrap one-level JSON objects in inline code so `{` never starts MDX JSX inside prose. */
function backtickInlineJson(s) {
  return s.replace(/\{[^{}\n]{0,800}\}/g, (m) => {
    if (/"\s*:/.test(m) || /'\s*:/.test(m)) return "`" + m.replace(/`/g, "") + "`";
    return m;
  });
}

/** Escape text that could break MDX when angle brackets appear */
function escapeMdxText(s) {
  return s.replace(/</g, "&lt;");
}

/** Fence lines that look like JSON objects so `{` does not start a JSX expression. */
function fenceJsonLines(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\{/.test(line) && /"\s*:/.test(line)) {
      const block = [line];
      while (i + 1 < lines.length && /^\s*\{/.test(lines[i + 1]) && /"\s*:/.test(lines[i + 1])) {
        i++;
        block.push(lines[i]);
      }
      out.push("```json");
      out.push(...block);
      out.push("```");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Turn plain guide body into Markdown paragraphs (conservative). */
function bodyToMarkdown(body) {
  let t = body.replace(/\r\n/g, "\n").trim();
  t = backtickInlineJson(t);
  t = escapeMdxText(t);
  // Preserve blank-line paragraph breaks
  const blocks = t.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  let md = blocks
    .map((b) => {
      if (/^[-*]\s/m.test(b) || /^\d+\.\s/m.test(b)) return b;
      if (b.includes("\n") && !b.includes("|")) {
        const lines = b.split("\n");
        if (lines.every((l) => l.length < 200)) return lines.map((l) => `- ${l}`).join("\n");
      }
      return b.split("\n").join("\n\n");
    })
    .join("\n\n");
  return fenceJsonLines(md);
}

function toMdx({ title, summary, sourceUrl, body }, group) {
  const desc = summary.slice(0, 300) || `${title} — Ramp Developer API`;
  const icon = iconByGroup[group] || "file-lines";
  const md = bodyToMarkdown(body);
  return `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(desc)}
icon: ${JSON.stringify(icon)}
---

<Note>
  Source: [docs.ramp.com](https://docs.ramp.com${sourceUrl || ""}) — plain-text export \`llms-guides\`. This page is migrated for Mintlify; verify details on the live site if needed.
</Note>

${md}
`;
}

for (const page of MANIFEST.pages) {
  const url = BASE + page.llms;
  console.error("fetch", url);
  let raw;
  try {
    raw = fetchText(url);
  } catch (e) {
    console.error("FAILED", page.llms, e.message);
    process.exit(1);
  }
  const parsed = parseLlmsGuide(raw);
  const outPath = join(DOCS_ROOT, page.path + ".mdx");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, toMdx(parsed, page.group), "utf8");
  console.error("wrote", outPath);
}

console.log("OK", MANIFEST.pages.length, "pages");
