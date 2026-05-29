import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';

const CATEGORY_MAP = {
  infra: 'Infrastructure',
  integrations: 'Integrations',
  projects: 'Projects',
  patterns: 'Patterns',
  'agent-system': 'Agent System'
};

const SKIP_FILES = new Set(['README.md', 'CLAUDE.md', 'INDEX.md', 'MANIFEST.md']);

function walkMd(dir, root = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMd(full, root));
    } else if (entry.name.endsWith('.md') && !SKIP_FILES.has(entry.name)) {
      out.push({ full, rel: path.relative(root, full) });
    }
  }
  return out;
}

function titleFromPath(rel) {
  const base = path.basename(rel, '.md');
  return base
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export async function syncKnowledgeBase({ dryRun }) {
  const kbDir = process.env.KB_DIR;
  if (!kbDir || !fs.existsSync(kbDir)) {
    console.log('[kb] KB_DIR not set or missing, skipping');
    return;
  }

  const client = makeClient();
  const state = loadState();
  const dbId = state.databases?.knowledgeBase;
  if (!dbId) throw new Error('knowledge-base database not bootstrapped (run npm run bootstrap)');

  state.pages = state.pages || {};
  state.pages.knowledgeBase = state.pages.knowledgeBase || {};
  const pageMap = state.pages.knowledgeBase;

  const files = walkMd(kbDir);
  console.log(`[kb] ${files.length} markdown files`);
  const seen = new Set();
  let written = 0;

  for (const { full, rel } of files) {
    const topDir = rel.split(path.sep)[0];
    const category = CATEGORY_MAP[topDir] || 'Other';
    const raw = fs.readFileSync(full, 'utf8');
    const { content, data } = matter(raw);
    const title = data.title || titleFromPath(rel);
    const blocks = mdToBlocks(content);
    seen.add(rel);

    if (dryRun) {
      console.log(`  DRY  ${category.padEnd(14)} ${rel}  (${blocks.length} blocks)`);
      continue;
    }

    const properties = {
      Title: { title: richText(title) },
      Category: { select: { name: category } },
      'Source Path': { rich_text: richText(rel) },
      'Last Synced': { date: { start: new Date().toISOString() } },
      Archived: { checkbox: false }
    };

    const id = await upsertDbPage(client, {
      dbId,
      pageId: pageMap[rel],
      properties,
      blocks
    });
    pageMap[rel] = id;
    written++;
    if (written % 10 === 0) console.log(`  ... ${written}`);
  }

  // Archive missing
  for (const [rel, pageId] of Object.entries(pageMap)) {
    if (seen.has(rel)) continue;
    if (dryRun) {
      console.log(`  DRY archive ${rel}`);
      continue;
    }
    await client.pages.update({
      page_id: pageId,
      properties: { Archived: { checkbox: true } }
    });
    console.log(`  ~ archive ${rel}`);
  }

  if (!dryRun) saveState(state);
  console.log(`[kb] done. ${written} written, ${files.length - written} unchanged-or-archived`);
}
