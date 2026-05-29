import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

function safeMatter(raw) {
  try {
    return matter(raw);
  } catch {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { content: raw, data: {} };
    const data = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
    return { content: m[2], data };
  }
}
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';

const SKIP_TOP_LEVEL = new Set(['CLAUDE.md', 'README.md', 'MEMORY.md', 'SKILL_TEMPLATE.md']);

// Skills shipped by the Claude Code harness that do not live on disk as SKILL.md files.
// Refresh periodically by diffing the SessionStart skill list against `ls ~/.claude/skills`.
// Last refreshed: 2026-05-29 (Claude Code 2.1.x).
const HARNESS_BUILTINS = [
  { name: 'init', description: 'Initialize a new CLAUDE.md file with codebase documentation' },
  { name: 'review', description: 'Review a pull request' },
  { name: 'security-review', description: 'Complete a security review of the pending changes on the current branch' },
  { name: 'verify', description: "Verify that a code change actually does what it's supposed to by running the app and observing behavior" },
  { name: 'verify-oauth', description: 'Verify OAuth configuration for a subpath-deployed app' },
  { name: 'code-review', description: 'Review the current diff for correctness bugs at the given effort level. Pass --comment to post findings as inline PR comments.' },
  { name: 'fewer-permission-prompts', description: 'Scan transcripts for common read-only Bash and MCP tool calls and add a prioritized allowlist to .claude/settings.json.' },
  { name: 'loop', description: 'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo). Omit the interval to let the model self-pace.' },
  { name: 'schedule', description: 'Create, update, list, or run scheduled remote agents (routines) that execute on a cron schedule.' },
  { name: 'claude-api', description: 'Build, debug, and optimize Claude API / Anthropic SDK apps. Includes prompt caching guidance and model-version migration.' },
  { name: 'run', description: "Launch and drive this project's app to see a change working. Use when asked to run, start, or screenshot the app." },
  { name: 'update-config', description: 'Configure the Claude Code harness via settings.json — permissions, env vars, hooks, automated behaviors.' },
  { name: 'keybindings-help', description: 'Customize keyboard shortcuts, rebind keys, add chord bindings, modify ~/.claude/keybindings.json.' }
];

function collectSkills(roots) {
  const byName = new Map();

  for (const b of HARNESS_BUILTINS) {
    byName.set(b.name, {
      name: b.name,
      type: 'Built-in',
      source: '(Claude Code harness)',
      content: `---\nname: ${b.name}\ndescription: ${b.description}\n---\n\n${b.description}\n\n_This skill ships with the Claude Code harness and does not exist as a file on disk._`
    });
  }

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const skillMd = path.join(full, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          if (byName.has(entry.name)) continue;
          byName.set(entry.name, {
            name: entry.name,
            type: 'Custom',
            source: skillMd,
            content: fs.readFileSync(skillMd, 'utf8')
          });
        }
      } else if (entry.name.endsWith('.md') && !SKIP_TOP_LEVEL.has(entry.name)) {
        const name = entry.name.replace(/\.md$/, '');
        if (byName.has(name)) continue;
        byName.set(name, {
          name,
          type: 'Custom',
          source: full,
          content: fs.readFileSync(full, 'utf8')
        });
      }
    }
  }
  return [...byName.values()];
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
    const { content, data } = safeMatter(s.content);
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
