import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';

function collectSkills(roots) {
  const skills = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const type = root.includes('claude-skills') ? 'Custom' : 'Built-in';
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const skillMd = path.join(full, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          skills.push({
            name: entry.name,
            type,
            source: skillMd,
            content: fs.readFileSync(skillMd, 'utf8')
          });
        }
      } else if (entry.name.endsWith('.md')) {
        skills.push({
          name: entry.name.replace(/\.md$/, ''),
          type,
          source: full,
          content: fs.readFileSync(full, 'utf8')
        });
      }
    }
  }
  return skills;
}

export async function syncSkills({ dryRun }) {
  const dirs = (process.env.SKILLS_DIRS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!dirs.length) {
    console.log('[skills] SKILLS_DIRS not set, skipping');
    return;
  }

  const client = makeClient();
  const state = loadState();
  const dbId = state.databases?.skills;
  if (!dbId) throw new Error('skills database not bootstrapped');

  state.pages = state.pages || {};
  state.pages.skills = state.pages.skills || {};
  const pageMap = state.pages.skills;

  const skills = collectSkills(dirs);
  console.log(`[skills] ${skills.length} skills`);
  const seen = new Set();

  for (const s of skills) {
    const key = `${s.type}::${s.name}`;
    seen.add(key);
    const { content, data } = matter(s.content);
    const trigger = data.description || data.when_to_use || '';
    const blocks = mdToBlocks(content);

    if (dryRun) {
      console.log(`  DRY  ${s.type.padEnd(8)} ${s.name}  (${blocks.length} blocks)`);
      continue;
    }

    const properties = {
      Name: { title: richText(s.name) },
      Type: { select: { name: s.type } },
      Trigger: { rich_text: richText(trigger) },
      'Source Path': { rich_text: richText(s.source) },
      'Last Synced': { date: { start: new Date().toISOString() } },
      Archived: { checkbox: false }
    };

    const id = await upsertDbPage(client, {
      dbId,
      pageId: pageMap[key],
      properties,
      blocks
    });
    pageMap[key] = id;
  }

  for (const [key, pageId] of Object.entries(pageMap)) {
    if (seen.has(key)) continue;
    if (dryRun) {
      console.log(`  DRY archive ${key}`);
      continue;
    }
    await client.pages.update({
      page_id: pageId,
      properties: { Archived: { checkbox: true } }
    });
  }

  if (!dryRun) saveState(state);
  console.log(`[skills] done`);
}
