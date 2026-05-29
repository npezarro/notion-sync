import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export function ymd(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

export function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return new Date(ymd(d) + 'T00:00:00Z');
}

export function collectCommitsRange(start, end) {
  const reposDir = process.env.REPOS_DIR;
  const since = `${ymd(start)} 00:00`;
  const until = `${ymd(end)} 00:00`;

  const results = [];
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const repo = path.join(reposDir, entry.name);
    if (!fs.existsSync(path.join(repo, '.git'))) continue;
    try {
      const log = execSync(
        `git log --since="${since}" --until="${until}" --format="%h%x09%cI%x09%s" --no-merges`,
        { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (!log) continue;
      const commits = log.split('\n').map(line => {
        const [hash, isoDate, ...rest] = line.split('\t');
        return { hash, date: isoDate, subject: rest.join('\t') };
      });
      results.push({ repo: entry.name, commits });
    } catch {}
  }
  return results;
}

export async function fetchWpPostsRange(start, end) {
  const base = process.env.WP_BASE_URL;
  if (!base) return [];
  const url = `${base}/wp-json/wp/v2/posts?after=${ymd(start)}T00:00:00&before=${ymd(end)}T00:00:00&per_page=50&_embed=1`;
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

export function collectMemoryChangesRange(start, end) {
  const memDir = path.join(process.env.HOME, '.claude/projects/-mnt-c-Users-npeza/memory');
  if (!fs.existsSync(memDir)) return [];
  const startMs = start.getTime();
  const endMs = end.getTime();
  const out = [];
  for (const f of fs.readdirSync(memDir)) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    const full = path.join(memDir, f);
    const mtime = fs.statSync(full).mtimeMs;
    if (mtime >= startMs && mtime < endMs) {
      out.push({ file: f, content: fs.readFileSync(full, 'utf8') });
    }
  }
  return out;
}
