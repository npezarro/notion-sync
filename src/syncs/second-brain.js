import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';

// Mirrors the second brain into Notion as a browsable database:
//  - memory/ atomic facts  -> Type "Fact"        (the Zettelkasten notes)
//  - privateContext/inbox/ -> Type "Raw Thought" (captured, pre-processing)
// Runs as part of the daily notion-sync (headless, NOTION_TOKEN API auth).

const hash8 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Notion rejects link blocks whose URL isn't a valid http(s) URL. Memory notes
// use [[wikilinks]] and relative [text](file.md) pointers — neutralize both to
// plain text so mdToBlocks never emits an invalid-URL link.
function sanitizeMarkdown(md) {
  return String(md || '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                                   // [[slug]] -> slug
    .replace(/\[([^\]]+)\]\((?!https?:\/\/)[^)]*\)/g, '$1');              // [text](non-http) -> text
}

// Block-level safety net: mdToBlocks AUTOLINKS bare URLs in text (e.g. the
// literal "http://localhost:N/" placeholder in a note), and Notion rejects any
// link whose URL won't parse. Drop invalid link annotations, keep the text.
function stripInvalidLinks(blocks) {
  for (const b of blocks || []) {
    const body = b?.[b?.type];
    for (const rt of body?.rich_text || []) {
      const url = rt?.text?.link?.url;
      if (!url) continue;
      let ok = false;
      try { const u = new URL(url); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { ok = false; }
      if (!ok) rt.text.link = null;
    }
    if (Array.isArray(body?.children)) stripInvalidLinks(body.children);
  }
  return blocks;
}

// ── memory/ facts ───────────────────────────────────────────────────
function collectFacts(memDir) {
  if (!memDir || !fs.existsSync(memDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(memDir)) {
    if (!name.endsWith('.md') || name === 'MEMORY.md') continue;
    const full = path.join(memDir, name);
    let parsed;
    try { parsed = matter(fs.readFileSync(full, 'utf8')); } catch { continue; }
    const { content, data } = parsed;
    const title = data.name || name.replace(/\.md$/, '');
    const type = data?.metadata?.type || 'reference';
    out.push({
      key: `mem:${name}`,
      title: truncate(String(title), 90),
      type: 'Fact',
      category: String(type),
      description: truncate(String(data.description || ''), 1800),
      captured: fs.statSync(full).mtime.toISOString(),
      source: `memory/${name}`,
      blocks: mdToBlocks(sanitizeMarkdown(content))
    });
  }
  return out;
}

// ── privateContext/inbox/ raw thoughts ──────────────────────────────
// Parses bullets: "- **HH:MM** (author) — text" with optional nested "  - url".
function parseInboxFile(full, rel, dateFromName) {
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const items = [];
  let cur = null;
  const bullet = /^- \*\*(\d{2}:\d{2})\*\*\s*(?:\(([^)]*)\))?\s*[—-]\s*(.*)$/;
  for (const line of lines) {
    const m = line.match(bullet);
    if (m) {
      if (cur) items.push(cur);
      cur = { time: m[1], author: m[2] || 'nick', text: m[3].trim(), attachments: [] };
    } else if (cur) {
      const a = line.match(/^\s+- (.*)$/);
      if (a) cur.attachments.push(a[1].trim());
    }
  }
  if (cur) items.push(cur);
  return items.map((it) => {
    const text = it.text || '(attachment only)';
    return {
      key: `inbox:${dateFromName}:${it.time}:${hash8(text)}`,
      title: truncate(text, 90),
      type: 'Raw Thought',
      category: 'inbox',
      description: truncate(text, 1800),
      captured: `${dateFromName}T${it.time}:00-07:00`,
      source: rel,
      blocks: mdToBlocks(sanitizeMarkdown([text, ...it.attachments.map((u) => `- ${u}`)].join('\n\n')))
    };
  });
}

function collectThoughts(inboxDir) {
  if (!inboxDir || !fs.existsSync(inboxDir)) return [];
  const out = [];
  const dirs = [inboxDir, path.join(inboxDir, 'processed')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue;
      const full = path.join(dir, name);
      const rel = path.relative(inboxDir, full);
      out.push(...parseInboxFile(full, `inbox/${rel}`, name.replace(/\.md$/, '')));
    }
  }
  return out;
}

export async function syncSecondBrain({ dryRun }) {
  const items = [...collectFacts(process.env.MEMORY_DIR), ...collectThoughts(process.env.INBOX_DIR)];
  console.log(`[second-brain] ${items.length} items (facts + thoughts)`);
  if (items.length === 0) { console.log('[second-brain] nothing to sync'); return; }

  const client = makeClient();
  const state = loadState();
  const dbId = state.databases?.secondBrain;
  if (!dbId) throw new Error('secondBrain database not bootstrapped (run npm run bootstrap)');

  state.pages = state.pages || {};
  state.pages.secondBrain = state.pages.secondBrain || {};
  const pageMap = state.pages.secondBrain;

  const seen = new Set();
  let written = 0, failed = 0, skipped = 0, adopted = 0;
  try {
    for (const it of items) {
      seen.add(it.key);
      if (dryRun) {
        console.log(`  DRY  ${it.type.padEnd(11)} ${it.category.padEnd(9)} ${it.title}`);
        continue;
      }
      // Content hash (excludes mtime-based Captured so git touches don't churn).
      const hash = hash8(JSON.stringify([it.title, it.type, it.category, it.description, it.source, it.blocks]));
      const entry = pageMap[it.key];
      const existingId = typeof entry === 'string' ? entry : entry?.id;
      const existingHash = typeof entry === 'string' ? null : entry?.hash;

      if (existingId && existingHash === hash) { skipped++; continue; }  // unchanged — no API call

      const properties = {
        Name: { title: richText(it.title) },
        Type: { select: { name: it.type } },
        Category: { select: { name: it.category } },
        Description: { rich_text: richText(it.description) },
        Captured: { date: { start: it.captured } },
        'Source Path': { rich_text: richText(it.source) },
        Archived: { checkbox: false }
      };
      try {
        let id;
        if (existingId && existingHash == null) {
          // Legacy page (id-only state): adopt cheaply — refresh properties,
          // trust the existing body (already written correctly). Avoids
          // rewriting every block on the migration run (which would time out).
          await client.pages.update({ page_id: existingId, properties });
          id = existingId; adopted++;
        } else {
          // New page, or content changed: full upsert (rewrites blocks).
          id = await upsertDbPage(client, { dbId, pageId: existingId, properties, blocks: stripInvalidLinks(it.blocks) });
        }
        pageMap[it.key] = { id, hash };
        written++;
        if (written % 20 === 0) { console.log(`  ... ${written}`); saveState(state); }
      } catch (e) {
        failed++;
        console.warn(`  ! skip ${it.source}: ${e.message.split('\n')[0]}`);
      }
    }

    // Archive rows whose source is gone (deleted memory file / removed thought).
    for (const [key, entry] of Object.entries(pageMap)) {
      if (seen.has(key) || dryRun) continue;
      const pageId = typeof entry === 'string' ? entry : entry?.id;
      await client.pages.update({ page_id: pageId, properties: { Archived: { checkbox: true } } }).catch(() => {});
      console.log(`  ~ archive ${key}`);
    }
  } finally {
    if (!dryRun) saveState(state);  // persist progress even on partial failure
  }
  console.log(`[second-brain] done. ${written} written (${adopted} adopted), ${skipped} unchanged, ${failed} failed.`);
}
