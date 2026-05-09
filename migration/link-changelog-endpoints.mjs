#!/usr/bin/env node
/**
 * Rewrites changelog.mdx "View endpoint" tails into internal Mintlify links.
 *
 * Uses OpenAPI (method + path -> summary) + llms.txt (summary -> /api-reference/... slug).
 *
 * Usage:
 *   node migration/link-changelog-endpoints.mjs [--dry-run]
 *
 * Default MINT_SITE_URL: https://modus-6367903b.mintlify.app (override for your preview/prod).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CHANGELOG = path.join(
  ROOT,
  "developer-api/v1/getting-started/changelog.mdx",
);

const OPENAPI_URL =
  process.env.OPENAPI_URL ||
  "https://docs.ramp.com/openapi/developer-api.json";
const MINT_SITE_URL =
  process.env.MINT_SITE_URL || "https://modus-6367903b.mintlify.app";

const HTTP_METHODS = new Set(["get", "post", "patch", "put", "delete"]);

/** OpenAPI tags whose Mintlify folder does not match `tag.split(/\s+/).join('-').toLowerCase()` */
const TAG_FOLDER = {
  BlankCanvas: "blankcanvas",
  CustomForm: "customform",
};

function openapiTagToFolder(tag) {
  if (TAG_FOLDER[tag]) return TAG_FOLDER[tag];
  return tag.replace(/\s+/g, "-").toLowerCase();
}

function normalizeSummaryKey(summary) {
  return summary.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeApiPath(p) {
  let x = p.trim();
  if (!x.startsWith("/")) x = "/" + x;
  if (x.startsWith("/developer/v1")) return x.replace(/\/{2,}/g, "/");
  return ("/developer/v1" + x).replace(/\/{2,}/g, "/");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url}: ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url}: ${res.status}`);
  return res.text();
}

/** Parse llms.txt: title -> list of { folder, relPath, desc } */
function buildSummaryIndex(llmsText) {
  const index = new Map();
  const lineRe =
    /^-\s*\[([^\]]+)\]\((https?:\/\/[^/]+)(\/api-reference\/[^)]+\.md)\)(?::\s*(.+))?$/;
  for (const line of llmsText.split("\n")) {
    const m = line.match(lineRe);
    if (!m) continue;
    const title = m[1];
    const pathname = m[3];
    const relPath = pathname.replace(/\.md$/, "");
    const seg = relPath.split("/").filter(Boolean);
    const folder = seg[1] || "";
    const desc = (m[4] || "").trim();
    const key = normalizeSummaryKey(title);
    const arr = index.get(key) || [];
    arr.push({ folder, relPath, desc });
    index.set(key, arr);
  }
  return index;
}

function pickCandidateForSummary(summary, tag, summaryIndex, pathTemplate = "") {
  const key = normalizeSummaryKey(summary);
  const candidates = summaryIndex.get(key);
  if (!candidates?.length) return null;
  const folder = openapiTagToFolder(tag);
  let pool = candidates.filter((c) => c.folder === folder);
  if (!pool.length) pool = [...candidates];

  if (pool.length === 1) return pool[0].relPath;

  if (pathTemplate && pool.length > 1) {
    const collapsed = pathTemplate.replace(/\{[^}]+\}/g, "").replace(/\/+/g, "/");
    const scored = pool.map((c) => {
      const d = c.desc || "";
      let score = 0;
      if (d.includes(collapsed)) score += 3;
      else {
        for (const part of collapsed.split("/")) {
          if (part && d.includes(part)) score += 1;
        }
      }
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) return scored[0].c.relPath;
  }

  return pool[0].relPath;
}

/** GET + POST etc -> Map "GET:/developer/v1/foo" -> "/api-reference/..." */
function buildMethodPathMap(openapi, summaryIndex) {
  const map = new Map();
  const unresolved = [];

  for (const [pathTemplate, pathItem] of Object.entries(openapi.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!op?.summary) continue;
      const tag = op.tags?.[0] || "";
      const url = pickCandidateForSummary(
        op.summary,
        tag,
        summaryIndex,
        pathTemplate,
      );
      const key = `${method.toUpperCase()}:${pathTemplate}`;
      if (url) map.set(key, url);
      else unresolved.push({ key, summary: op.summary, tag });
    }
  }
  return { map, unresolved };
}

/** Ordered method/path pairs from changelog bullet body */
function extractMethodPaths(operationPart) {
  const pairs = [];
  const reMethodPath =
    /\b(GET|POST|PATCH|PUT|DELETE)\s+`([^`]+)`/gi;
  let m;
  while ((m = reMethodPath.exec(operationPart))) {
    pairs.push({
      method: m[1].toUpperCase(),
      path: normalizeApiPath(m[2]),
    });
  }
  if (pairs.length > 0) return pairs;

  const rePathOnly = /`(\/[^`]+)`/g;
  while ((m = rePathOnly.exec(operationPart))) {
    pairs.push({
      method: null,
      path: normalizeApiPath(m[1]),
    });
  }
  return pairs;
}

function inferMethodFromLine(line, pathTemplate, methodsOnPath) {
  const low = line.toLowerCase();
  if (methodsOnPath.length === 1) return methodsOnPath[0];

  const wants =
    /\blist\b|\bretrieve\b|\bfetch\b|\bget\b/i.test(low) &&
    !/\bupdate\b|\bpatch\b|\bcreate\b|\bpost\b|\bdelete\b/i.test(
      low.replace(/\bget\b/i, ""),
    );
  if (
    wants &&
    methodsOnPath.includes("GET") &&
    !/\bupdate\b|\bpatch\b|\bcreating\b|\bpost\b/i.test(low)
  )
    return "GET";

  if (
    /\bpatch\b|\bupdat(e|ing)\b/i.test(low) &&
    methodsOnPath.includes("PATCH")
  )
    return "PATCH";
  if (/\bpost\b|\bcreat(e|ing)\b|\bsubmit\b/i.test(low) && methodsOnPath.includes("POST"))
    return "POST";
  if (/\bdelete\b/i.test(low) && methodsOnPath.includes("DELETE"))
    return "DELETE";
  if (/\bput\b/i.test(low) && methodsOnPath.includes("PUT")) return "PUT";

  return methodsOnPath[0];
}

/** Build path -> methods[] from openapi */
function pathMethodsIndex(openapi) {
  const ix = new Map();
  for (const [pathTemplate, pathItem] of Object.entries(openapi.paths || {})) {
    const ms = [];
    for (const method of Object.keys(pathItem)) {
      if (HTTP_METHODS.has(method)) ms.push(method.toUpperCase());
    }
    if (ms.length) ix.set(pathTemplate, ms);
  }
  return ix;
}

function resolvePairsWithInference(line, rawPairs, pmIndex, methodPathMap) {
  const urls = [];
  for (const pair of rawPairs) {
    let method = pair.method;
    const p = pair.path;
    if (!pmIndex.has(p)) continue;
    const ms = pmIndex.get(p);
    if (!method) method = inferMethodFromLine(line, p, ms);
    const key = `${method}:${p}`;
    const url = methodPathMap.get(key);
    if (url) urls.push({ method, path: p, url });
  }
  return urls;
}

/** Keyword fallbacks when no backtick path is present */
function fallbackUrls(line) {
  const low = line.toLowerCase();
  const out = [];

  if (
    low.includes("audit logs endpoint") ||
    (low.includes("audit log") &&
      (low.includes("event types") ||
        low.includes("resource types") ||
        low.includes("filtering")))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/audit-log/get-audit-log-events",
    });
    return out;
  }

  if (
    low.includes("webhook") &&
    (low.includes("subscribe") ||
      low.includes("event types") ||
      low.includes("entities.created") ||
      low.includes("transactions.synced") ||
      low.includes("applications.status_updated") ||
      low.includes("vendors.updated"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/developer-api/v1/developer-resources/webhooks",
    });
    return out;
  }

  if (low.includes("mock webhook")) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/webhooks/create-a-mock-webhook-event-for-active-subscriptions-matching-the-event-type",
    });
    return out;
  }

  if (
    low.includes("purchase order") &&
    low.includes("deep link") &&
    low.includes("ramp_url")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/purchase-order/fetch-a-purchase-order",
    });
    return out;
  }

  if (
    low.includes("unified request") &&
    low.includes("deep link") &&
    low.includes("ramp_url")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/unified-request/get-details-for-a-specific-unifiedrequest",
    });
    return out;
  }

  if (
    low.includes("bill") &&
    low.includes("line item") &&
    low.includes("purchase_order_line_item")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/update-a-bill",
    });
    return out;
  }

  if (
    low.includes("matrix table") &&
    low.includes("append") &&
    low.includes("duplicate")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/custom-records/append-cells-to-matrix-table-rows",
    });
    return out;
  }

  if (
    low.includes("matrix table") &&
    low.includes("is_not_null")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/custom-records/list-matrix-table-rows",
    });
    return out;
  }

  if (
    low.includes("vendor document categor") ||
    (low.includes("document_category") && low.includes("vendor agreement"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/upload-documents-for-a-vendor-agreement",
    });
    return out;
  }

  if (
    low.includes("new ramp-only accounting fields") ||
    (low.includes("ramp-only") &&
      low.includes("accounting fields") &&
      low.includes("erp"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/list-ramp-only-accounting-fields",
    });
    return out;
  }

  if (
    low.includes("draft user creation") ||
    (low.includes("is_draft") && low.includes("user"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/user/create-a-user-invite",
    });
    return out;
  }

  if (
    low.includes("draft spend requests via ocr") ||
    low.includes("create draft spend requests via ocr")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/spend-request/create-a-draft-spend-request-via-ocr",
    });
    return out;
  }

  if (
    low.includes("decimal quantity") &&
    low.includes("bill line items")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/update-a-bill",
    });
    return out;
  }

  if (
    low.includes("blank canvas approvals endpoints") ||
    (low.includes("approve or reject blank canvas workflow steps") &&
      low.includes("external approval requests"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/blankcanvas/approve-or-reject-a-blank-canvas-workflow-step",
    });
    return out;
  }

  if (
    low.includes("vendor memo") &&
    low.includes("bill")
  ) {
    return [
      {
        label: "create bill",
        url: "/api-reference/bill/create-a-bill",
      },
      {
        label: "update bill",
        url: "/api-reference/bill/update-a-bill",
      },
      {
        label: "draft bill create",
        url: "/api-reference/bill/create-a-draft-bill",
      },
      {
        label: "draft bill update",
        url: "/api-reference/bill/update-a-draft-bill",
      },
    ];
  }

  if (
    low.includes("financing applications endpoints") ||
    (low.includes("financing application") &&
      low.includes("programmatically"))
  ) {
    return [
      {
        label: "View GET endpoint",
        method: "GET",
        url: "/api-reference/application/fetch-a-financing-application",
      },
      {
        label: "View POST endpoint",
        method: "POST",
        url: "/api-reference/application/create-a-financing-application",
      },
    ];
  }

  if (
    low.includes("ready-to-sync endpoint") ||
    (low.includes("ready to sync") &&
      low.includes("mark accounting") &&
      low.includes("object_ids"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/post-ready-to-sync-status",
    });
    return out;
  }

  if (
    low.includes("new vendor agreement endpoints") &&
    low.includes("beta")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/create-a-vendor-agreement",
    });
    return out;
  }

  if (
    low.includes("new repayments endpoint") ||
    (low.includes("list repayments") && low.includes("funding method"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/repayment/list-repayments",
    });
    return out;
  }

  if (low.includes("new unified requests endpoints")) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/unified-request/list-unified-requests-with-pagination",
    });
    return out;
  }

  if (low.includes("spend program workflow nodes endpoint")) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/spend-program/fetch-blank-canvas-workflow-nodes-for-a-spend-program",
    });
    return out;
  }

  if (low.includes("custom form collection response endpoint")) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/customform/fetch-a-custom-form-collection-response-by-id",
    });
    return out;
  }

  if (
    low.includes("new list bank accounts endpoint") ||
    (low.includes("list bank accounts") && low.includes("paginated"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bank-accounts/list-bank-accounts",
    });
    return out;
  }

  if (
    low.includes("embedded cards endpoint") ||
    low.includes("embed init token")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/embedded-cards/create-an-embed-init-token-for-a-card",
    });
    return out;
  }

  if (low.includes("payment_details_missing")) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-bills",
    });
    return out;
  }

  if (
    low.includes("vendor credits list endpoints") ||
    (low.includes("vendor credits") &&
      low.includes("entity_id") &&
      low.includes("from_created_at"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/list-all-vendor-credits-for-all-vendors-of-a-business",
    });
    return out;
  }

  if (low.includes("transfer_ledger_entry_mapping")) {
    out.push({
      label: "View endpoint",
      url: "/developer-api/v1/guides/accounting",
    });
    return out;
  }

  if (
    low.includes("invoice_number field on bills") ||
    (low.includes("invoice_number") &&
      low.includes("supports up to") &&
      low.includes("characters"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/update-a-bill",
    });
    return out;
  }

  if (
    low.includes("gl_account_id field") &&
    low.includes("inventory item options") &&
    low.includes("creating or viewing")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/list-inventory-item-options",
    });
    return out;
  }

  if (
    low.includes("purchase order external id support") ||
    (low.includes("external_id field") &&
      low.includes("purchase order") &&
      low.includes("remote_id query"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/purchase-order/list-purchase-orders",
    });
    return out;
  }

  if (
    low.includes("remote_id query parameter") &&
    low.includes("list bills") &&
    low.includes("draft bills")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-bills",
    });
    return out;
  }

  if (
    low.includes("bill payment_status") &&
    low.includes("on_hold")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-bills",
    });
    return out;
  }

  if (
    low.includes("list trips endpoint") &&
    low.includes("cancelled")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/trips/list-all-trips-for-the-business",
    });
    return out;
  }

  if (
    low.includes("refresh_token_expires_in") &&
    low.includes("token endpoint response")
  ) {
    out.push({
      label: "View endpoint",
      url: "/developer-api/v1/developer-resources/authorization",
    });
    return out;
  }

  if (
    low.includes("customer_friendly_payment_id") ||
    low.includes("draft_bill_id query parameter") ||
    (low.includes("payment_id query parameter") &&
      low.includes("list bills endpoint"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-bills",
    });
    return out;
  }

  if (
    low.includes("list vendors endpoint") &&
    (low.includes("to_created_at") ||
      low.includes("from_updated_at") ||
      low.includes("merchant_id") ||
      low.includes("external_vendor_id"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/list-vendors",
    });
    return out;
  }

  if (
    low.includes("allowed_overage_percent_override") &&
    low.includes("creating limits")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/limit/create-a-limit",
    });
    return out;
  }

  if (
    low.includes("user status filter") &&
    low.includes("user_draft") &&
    low.includes("scheduled_invitation_date")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/user/list-users",
    });
    return out;
  }

  if (
    low.includes("business balance response") &&
    low.includes("currencyamount")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/business/fetch-the-company-balance-information",
    });
    return out;
  }

  if (
    low.includes("bank account responses") &&
    low.includes("account_name field")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bank-accounts/get-bank-account-details",
    });
    return out;
  }

  if (
    low.includes("visibility query parameter") &&
    low.includes("accounting field options")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/list-custom-accounting-fields",
    });
    return out;
  }

  if (
    low.includes("is_accounting_sync_enabled") &&
    (low.includes("filter bills") || low.includes("list bills endpoint"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-bills",
    });
    return out;
  }

  if (
    low.includes("include_subsidiary") &&
    low.includes("list vendors endpoint")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/list-vendors",
    });
    return out;
  }

  if (
    low.includes("payment_accounts array") &&
    low.includes("entity response")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/business-entities/get-a-business-entity",
    });
    return out;
  }

  if (
    low.includes("custom_record_fields array") &&
    low.includes("vendor responses")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/list-vendors",
    });
    return out;
  }

  if (
    low.includes("is_exempt_from_policy_agent") &&
    low.includes("spend limit responses")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/limit/update-a-limit",
    });
    return out;
  }

  if (
    low.includes("requires_accounting_vendor_creation_to_sync") &&
    low.includes("transaction responses")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/transaction/list-transactions",
    });
    return out;
  }

  if (
    low.includes("transaction_accounting_vendor_creation_on_sync_enabled") &&
    low.includes("accounting connection")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/fetch-an-accounting-connection-by-id",
    });
    return out;
  }

  if (
    low.includes("scheduled_deactivation_date field") &&
    low.includes("create user request")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/user/create-a-user-invite",
    });
    return out;
  }

  if (
    low.includes("status_summary field") &&
    low.includes("bill responses")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/fetch-a-bill",
    });
    return out;
  }

  if (
    low.includes("status_summary query parameter") &&
    low.includes("list bills endpoint")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-bills",
    });
    return out;
  }

  if (
    low.includes("non_erp") &&
    low.includes("accounting field types")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/list-custom-accounting-fields",
    });
    return out;
  }

  if (
    low.includes("card_id query parameter") &&
    low.includes("list limits endpoint")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/limit/list-limits",
    });
    return out;
  }

  if (
    low.includes("draft bill response") &&
    low.includes("remote_id field")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-draft-bills",
    });
    return out;
  }

  if (
    low.includes("fetch accounting connection by id") ||
    (low.includes("connection_id") &&
      low.includes("accounting connection") &&
      low.includes("beta"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/fetch-an-accounting-connection-by-id",
    });
    return out;
  }

  if (
    low.includes("functional_currency_amount") &&
    low.includes("query parameter") &&
    low.includes("transactions")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/transaction/list-transactions",
    });
    return out;
  }

  if (
    low.includes("draft bill creation and updates") ||
    (low.includes("create and update draft bills") &&
      low.includes("accounting fields"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/create-a-draft-bill",
    });
    return out;
  }

  if (
    low.includes("tax code accounting field endpoints") &&
    low.includes("beta")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/create-a-new-tax-code-accounting-field",
    });
    return out;
  }

  if (
    low.includes("functional_currency_amount field") &&
    low.includes("transaction responses")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/transaction/list-transactions",
    });
    return out;
  }

  if (
    low.includes("gl_account_id field") &&
    low.includes("tax rate resources") &&
    low.includes("accounting_gl_account_id")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/list-tax-rates",
    });
    return out;
  }

  if (
    low.includes("use_default_vendor_contact parameter") &&
    low.includes("creating bills")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/create-a-bill",
    });
    return out;
  }

  if (
    low.includes("card vault endpoint") &&
    low.includes("beta")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/card-vault/fetch-a-cards-sensitive-details",
    });
    return out;
  }

  if (
    low.includes("use_default_payment_method parameter") &&
    low.includes("create bills")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/create-a-bill",
    });
    return out;
  }

  if (
    low.includes("item receipts filtering") ||
    (low.includes("item receipts") &&
      low.includes("purchase_order_line_item_id"))
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/item-receipts/list-item-receipts",
    });
    return out;
  }

  if (
    low.includes("scheduled_deactivation_date field") &&
    low.includes("user objects")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/user/list-users",
    });
    return out;
  }

  if (
    low.includes("status_summaries query parameter") &&
    low.includes("filter bills")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-bills",
    });
    return out;
  }

  if (
    low.includes("accounting connection update endpoint") &&
    low.includes("beta")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/update-an-accounting-connection",
    });
    return out;
  }

  if (
    low.includes("state query parameter") &&
    low.includes("reimbursements")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/reimbursement/list-reimbursements",
    });
    return out;
  }

  if (low.includes("new vendor credits endpoints") && low.includes("beta")) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/list-all-vendor-credits-for-all-vendors-of-a-business",
    });
    return out;
  }

  if (
    low.includes("individual vendor credit retrieval") &&
    low.includes("beta")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/fetch-a-vendor-credit",
    });
    return out;
  }

  if (
    low.includes("vendor-specific credit listing") &&
    low.includes("beta")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/list-vendor-credits-by-vendor",
    });
    return out;
  }

  if (
    low.includes("purchase_order_ids array field") &&
    low.includes("create and update")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/update-a-bill",
    });
    return out;
  }

  if (
    low.includes("invoice_number query parameter") &&
    low.includes("filter bills")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/bill/list-bills",
    });
    return out;
  }

  if (
    low.includes("receipts filtering") &&
    low.includes("reimbursement_id")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/receipt/list-receipts",
    });
    return out;
  }

  if (
    low.includes("users filtering") &&
    low.includes("status query parameter") &&
    low.includes("user_active")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/user/list-users",
    });
    return out;
  }

  if (
    low.includes("is_active") &&
    low.includes("code query parameters") &&
    low.includes("custom accounting fields")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/accounting/list-custom-accounting-fields",
    });
    return out;
  }

  if (
    low.includes("archive vendor bank accounts") &&
    low.includes("replacement account")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/archive-a-vendor-bank-account",
    });
    return out;
  }

  if (
    low.includes("external_vendor_id query parameter") &&
    low.includes("filter vendors")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/list-vendors",
    });
    return out;
  }

  if (
    low.includes("external_vendor_id field") &&
    low.includes("vendor creation")
  ) {
    out.push({
      label: "View endpoint",
      url: "/api-reference/vendor/create-a-new-vendor",
    });
    return out;
  }

  return [];
}

const VIEW_MARKER =
  /\s(View (?:GET |POST |PATCH |PUT |DELETE )?endpoint|View metadata endpoint|View documents endpoint|View comments endpoint|View draft bills endpoint|View guide)\b/g;

const METADATA_URL =
  "/api-reference/blankcanvas/update-metadata-for-a-blank-canvas-external-approval-request";
const DOCUMENTS_BC_URL =
  "/api-reference/blankcanvas/upload-a-document-for-a-blank-canvas-workflow-step";
const DOCUMENTS_VENDOR_URL =
  "/api-reference/vendor/upload-documents-for-a-vendor-agreement";
const COMMENTS_CREATE_URL =
  "/api-reference/comments/create-a-comment-on-an-objects-discussion-thread";
const DRAFT_BILLS_URL = "/api-reference/bill/list-draft-bills";
const APPLICATIONS_GUIDE_URL = "/developer-api/v1/guides/applications";

function linkMarkdown(label, url) {
  return `[${label}](${url})`;
}

/** Ensure a visible separator before a markdown link when the raw gap ate trailing spaces. */
function glueGap(gap, piece) {
  const g = gap ?? " · ";
  if (!piece.startsWith("[")) return g + piece;
  return `${g.replace(/\s*$/, "")} ${piece}`;
}

function rebuildLine(line, markers, pmIndex, methodPathMap) {
  if (markers.length === 0) return line;

  const firstIdx = markers[0].index;
  const prefix = line.slice(0, firstIdx).trimEnd().replace(/\.{2,}$/, ".");
  const markerLabels = markers.map((m) => m[1]);
  const plainViewEndpointCount = markerLabels.filter(
    (l) => l === "View endpoint",
  ).length;

  let resolved = resolvePairsWithInference(
    prefix,
    extractMethodPaths(prefix),
    pmIndex,
    methodPathMap,
  );

  if (resolved.length === 0) {
    const fb = fallbackUrls(prefix);
    if (fb.length) {
      resolved = fb.map((f) => ({
        method: f.method || "",
        path: "",
        url: f.url,
        fbLabel: f.label,
      }));
    }
  }

  const gaps = [];
  for (let i = 0; i < markers.length - 1; i++) {
    const endPrev = markers[i].index + markers[i][0].length;
    gaps.push(line.slice(endPrev, markers[i + 1].index));
  }

  let genericQueue = [...resolved];
  const pieces = [];

  for (const label of markerLabels) {
    if (label === "View metadata endpoint") {
      pieces.push(linkMarkdown(label, METADATA_URL));
      continue;
    }
    if (label === "View documents endpoint") {
      const vendorCtx =
        prefix.toLowerCase().includes("vendor agreement") &&
        !prefix.toLowerCase().includes("blank canvas");
      pieces.push(
        linkMarkdown(
          label,
          vendorCtx ? DOCUMENTS_VENDOR_URL : DOCUMENTS_BC_URL,
        ),
      );
      continue;
    }
    if (label === "View comments endpoint") {
      pieces.push(linkMarkdown(label, COMMENTS_CREATE_URL));
      continue;
    }
    if (label === "View draft bills endpoint") {
      pieces.push(linkMarkdown(label, DRAFT_BILLS_URL));
      continue;
    }
    if (label === "View guide") {
      pieces.push(linkMarkdown(label, APPLICATIONS_GUIDE_URL));
      continue;
    }

    if (label === "View GET endpoint") {
      const nx = genericQueue.find((r) => r.method === "GET");
      if (nx)
        pieces.push(
          linkMarkdown(
            label,
            nx.url,
          ),
        );
      else if (genericQueue.length)
        pieces.push(linkMarkdown(label, genericQueue[0].url));
      continue;
    }
    if (label === "View POST endpoint") {
      const nx = genericQueue.find((r) => r.method === "POST");
      if (nx) pieces.push(linkMarkdown(label, nx.url));
      else if (genericQueue.length)
        pieces.push(linkMarkdown(label, genericQueue[0].url));
      continue;
    }

    if (label === "View endpoint") {
      if (
        plainViewEndpointCount === 1 &&
        genericQueue.length >= 2 &&
        !genericQueue.some((r) => r.fbLabel)
      ) {
        const chunk = genericQueue.splice(0);
        pieces.push(
          chunk
            .map((nx) =>
              linkMarkdown(
                nx.fbLabel ||
                  (nx.method && nx.path
                    ? `${nx.method} ${nx.path.split("/").pop()}`
                    : "View endpoint"),
                nx.url,
              ),
            )
            .join(" · "),
        );
        continue;
      }

      const nx = genericQueue.shift();
      if (nx) {
        const text =
          nx.fbLabel ||
          (nx.method && nx.path
            ? `${nx.method} ${nx.path.split("/").pop()}`
            : "View endpoint");
        pieces.push(linkMarkdown(text, nx.url));
      }
      else pieces.push(label);
      continue;
    }

    pieces.push(label);
  }

  let tail = pieces[0];
  for (let i = 1; i < pieces.length; i++) {
    tail += glueGap(gaps[i - 1], pieces[i]);
  }
  return `${prefix} ${tail}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.error(`OpenAPI: ${OPENAPI_URL}`);
  console.error(`llms.txt: ${MINT_SITE_URL}/llms.txt`);

  const [openapi, llmsText] = await Promise.all([
    fetchJson(OPENAPI_URL),
    fetchText(new URL("/llms.txt", MINT_SITE_URL).href),
  ]);

  const summaryIndex = buildSummaryIndex(llmsText);
  const { map: methodPathMap, unresolved } = buildMethodPathMap(
    openapi,
    summaryIndex,
  );
  if (unresolved.length) {
    console.error(
      `Note: ${unresolved.length} OpenAPI operations missing llms title match (sample):`,
    );
    console.error(unresolved.slice(0, 8));
  }

  const pmIndex = pathMethodsIndex(openapi);
  const raw = await fs.readFile(CHANGELOG, "utf8");
  const lines = raw.split("\n");
  let changed = 0;

  const out = lines.map((line) => {
    if (!line.startsWith("- ") || !line.includes("View")) return line;
    VIEW_MARKER.lastIndex = 0;
    const markers = [...line.matchAll(VIEW_MARKER)];
    if (!markers.length) return line;
    const next = rebuildLine(line, markers, pmIndex, methodPathMap);
    if (next !== line) changed++;
    return next;
  });

  const text = out.join("\n");
  if (dryRun) {
    console.error(`Dry run: would modify ~${changed} bullet lines`);
    return;
  }

  await fs.writeFile(CHANGELOG, text, "utf8");
  console.error(`Updated changelog: ${changed} bullet lines rewritten`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
