import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return new Date(ymd(d) + 'T00:00:00Z');
}

function collectCommits(date) {
  const reposDir = process.env.REPOS_DIR;
  const start = ymd(date);
  const next = new Date(date.getTime() + 86400000);
  const end = ymd(next);

  const results = [];
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const repo = path.join(reposDir, entry.name);
    if (!fs.existsSync(path.join(repo, '.git'))) continue;
    try {
      const log = execSync(
        `git log --since="${start} 00:00" --until="${end} 00:00" --format="%h%x09%s" --no-merges`,
        { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (!log) continue;
      const commits = log.split('\n').map(line => {
        const [hash, ...rest] = line.split('\t');
        return { hash, subject: rest.join('\t') };
      });
      results.push({ repo: entry.name, commits });
    } catch {}
  }
  return results;
}

async function fetchWpPosts(date) {
  const base = process.env.WP_BASE_URL;
  if (!base) return [];
  const start = ymd(date);
  const next = ymd(new Date(date.getTime() + 86400000));
  const url = `${base}/wp-json/wp/v2/posts?after=${start}T00:00:00&before=${next}T00:00:00&per_page=20&_embed=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const posts = await res.json();
    return posts.map(p => ({
      title: (p.title?.rendered || '').replace(/<[^>]+>/g, ''),
      link: p.link,
      date: p.date
    }));
  } catch {
    return [];
  }
}

function collectMemoryChanges(date) {
  const memDir = path.join(process.env.HOME, '.claude/projects/-mnt-c-Users-npeza/memory');
  if (!fs.existsSync(memDir)) return [];
  const start = new Date(ymd(date) + 'T00:00:00Z').getTime();
  const end = start + 86400000;
  const out = [];
  for (const f of fs.readdirSync(memDir)) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    const full = path.join(memDir, f);
    const mtime = fs.statSync(full).mtimeMs;
    if (mtime >= start && mtime < end) {
      out.push({ file: f, content: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
}

function buildPrompt(date, commits, wp, memory) {
  const lines = [];
  lines.push(`Summarize this single day of work in markdown. Be specific and concrete (reference repo names, themes from commit subjects, file paths when relevant). Group by theme, not chronology. Skip filler. ~400 words.`);
  lines.push('');
  lines.push(`Required sections (use these exact h2 headings):`);
  lines.push(`## What I shipped`);
  lines.push(`## What I learned`);
  lines.push(`## Loose threads`);
  lines.push('');
  lines.push(`If a section has nothing meaningful, write "_Nothing notable._" — do not invent content.`);
  lines.push('');
  lines.push(`Date: ${ymd(date)}`);
  lines.push('');
  lines.push('=== Commits ===');
  for (const r of commits) {
    lines.push('');
    lines.push(`#### ${r.repo} (${r.commits.length})`);
    for (const c of r.commits) lines.push(`- ${c.hash}  ${c.subject}`);
  }
  if (wp.length) {
    lines.push('');
    lines.push('=== WordPress posts published ===');
    for (const w of wp) lines.push(`- ${w.title}  ${w.link}`);
  }
  if (memory.length) {
    lines.push('');
    lines.push('=== Memory / learning entries modified ===');
    for (const m of memory) {
      lines.push('');
      lines.push(`#### ${m.file}`);
      lines.push(m.content.slice(0, 1500));
    }
  }
  lines.push('');
  lines.push('Now write the summary in markdown. Do not include preamble or explanation, just the summary itself.');
  return lines.join('\n');
}

function synthesize(prompt) {
  try {
    const out = execFileSync('claude', ['-p'], {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 10_000_000,
      timeout: 240_000
    });
    return out.trim();
  } catch (e) {
    return `_Synthesis failed: ${e.message}_\n\n## Raw events\n\n${prompt}`;
  }
}

export async function syncDailyUpdate({ dryRun, date }) {
  const targetDate = date ? new Date(date + 'T00:00:00Z') : yesterday();
  const key = ymd(targetDate);

  const commits = collectCommits(targetDate);
  const wp = await fetchWpPosts(targetDate);
  const memory = collectMemoryChanges(targetDate);

  const totalCommits = commits.reduce((n, r) => n + r.commits.length, 0);
  const repoCount = commits.length;

  console.log(`[daily] ${key}: ${totalCommits} commits / ${repoCount} repos / ${wp.length} WP / ${memory.length} memory`);

  if (totalCommits === 0 && wp.length === 0 && memory.length === 0) {
    console.log('[daily] no activity, skipping');
    return;
  }

  const prompt = buildPrompt(targetDate, commits, wp, memory);
  console.log(`[daily] prompt ~${prompt.length} chars`);

  if (dryRun) {
    console.log('--- prompt preview (first 3KB) ---');
    console.log(prompt.slice(0, 3000));
    console.log('--- end preview ---');
    return;
  }

  console.log('[daily] calling claude -p ...');
  const summary = synthesize(prompt);
  console.log(`[daily] summary ~${summary.length} chars`);

  const body = `**${key}** · ${totalCommits} commits across ${repoCount} repos\n\n${summary}`;
  const blocks = mdToBlocks(body);

  const client = makeClient();
  const state = loadState();
  const dbId = state.databases?.dailyUpdates;
  if (!dbId) throw new Error('dailyUpdates DB not bootstrapped — re-run npm run bootstrap');

  state.pages = state.pages || {};
  state.pages.dailyUpdates = state.pages.dailyUpdates || {};
  const pageMap = state.pages.dailyUpdates;

  const properties = {
    Title: { title: richText(key) },
    Date: { date: { start: key } },
    Commits: { number: totalCommits },
    'Repos Touched': { number: repoCount },
    'Last Synced': { date: { start: new Date().toISOString() } }
  };

  const id = await upsertDbPage(client, {
    dbId,
    pageId: pageMap[key],
    properties,
    blocks
  });
  pageMap[key] = id;
  saveState(state);
  console.log(`[daily] done: ${key}`);
}
