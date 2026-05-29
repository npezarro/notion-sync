import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';
import {
  ymd,
  addDays,
  collectCommitsRange,
  fetchWpPostsRange,
  collectMemoryChangesRange
} from '../lib/collectors.js';

// ISO week: Monday start. Returns the Monday at 00:00 UTC of the week containing `d`.
function mondayOfWeek(d) {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(ymd(addDays(d, offset)) + 'T00:00:00Z');
}

// Last completed full week ending on the most recent Sunday (UTC).
function lastFullWeekStart() {
  const todayMonday = mondayOfWeek(new Date());
  return addDays(todayMonday, -7);
}

function buildPrompt(start, end, commits, wp, memory) {
  const lines = [];
  lines.push(`Synthesize this week of work into a markdown recap. The events span ${ymd(start)} through ${ymd(addDays(end, -1))}. Be specific. Group by theme. Pull out patterns. ~500 words.`);
  lines.push('');
  lines.push(`Required sections (use these exact h2 headings):`);
  lines.push(`## Themes of the week`);
  lines.push(`## Wins`);
  lines.push(`## Patterns & learnings`);
  lines.push(`## Heads-up for next week`);
  lines.push('');
  lines.push(`If a section has nothing meaningful, write "_Nothing notable._" — do not invent content. Skip filler and chronology; focus on what mattered.`);
  lines.push('');
  lines.push(`=== Commits (${commits.reduce((n, r) => n + r.commits.length, 0)} across ${commits.length} repos) ===`);
  for (const r of commits) {
    lines.push('');
    lines.push(`#### ${r.repo} (${r.commits.length})`);
    for (const c of r.commits) {
      const day = (c.date || '').slice(0, 10);
      lines.push(`- ${day}  ${c.hash}  ${c.subject}`);
    }
  }
  if (wp.length) {
    lines.push('');
    lines.push('=== WordPress posts published this week ===');
    for (const w of wp) lines.push(`- ${(w.date || '').slice(0, 10)}  ${w.title}  ${w.link}`);
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
  lines.push('Now write the recap in markdown. Do not include preamble or explanation.');
  return lines.join('\n');
}

function sendEmail({ key, weekStart, weekEnd, totalCommits, repoCount, summary, pageId }) {
  if (process.env.DAILY_UPDATE_EMAIL === 'false') return;
  const sender = process.env.EMAIL_SENDER_SCRIPT;
  if (!sender || !fs.existsSync(sender)) {
    console.log('[weekly] EMAIL_SENDER_SCRIPT not set, skipping email');
    return;
  }
  const url = `https://www.notion.so/${pageId.replace(/-/g, '')}`;
  const subject = `Weekly recap: ${weekStart} → ${weekEnd} — ${totalCommits} commits / ${repoCount} repos`;
  const body = `${url}\n\n${totalCommits} commits across ${repoCount} repos · ${weekStart} → ${weekEnd}\n\n${summary}\n`;
  const senderName = process.env.EMAIL_SENDER_NAME || 'Notion Sync';
  const res = spawnSync('bash', [sender, subject, '--sender-name', senderName], {
    input: body,
    encoding: 'utf8',
    timeout: 30_000
  });
  if (res.status === 0) {
    console.log('[weekly] email sent');
  } else {
    console.log(`[weekly] email failed (exit ${res.status})`);
  }
}

function synthesize(prompt) {
  try {
    const out = execFileSync('claude', ['-p'], {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 20_000_000,
      timeout: 300_000
    });
    return out.trim();
  } catch (e) {
    return `_Synthesis failed: ${e.message}_\n\n## Raw events\n\n${prompt}`;
  }
}

export async function syncWeeklyUpdate({ dryRun, date }) {
  // Auto-mode (no date arg): only run on Mondays, recap the prior Mon-Sun week.
  const isManual = !!date;
  const start = date ? mondayOfWeek(new Date(date + 'T00:00:00Z')) : lastFullWeekStart();
  const end = addDays(start, 7); // exclusive
  const key = ymd(start);
  const weekEndDisplay = ymd(addDays(start, 6));

  if (!isManual) {
    const todayDow = new Date().getUTCDay();
    if (todayDow !== 1) {
      console.log(`[weekly] today is dow ${todayDow}, only auto-runs Mondays — skipping`);
      return;
    }
  }

  const commits = collectCommitsRange(start, end);
  const wp = await fetchWpPostsRange(start, end);
  const memory = collectMemoryChangesRange(start, end);

  const totalCommits = commits.reduce((n, r) => n + r.commits.length, 0);
  const repoCount = commits.length;

  console.log(`[weekly] ${key} → ${weekEndDisplay}: ${totalCommits} commits / ${repoCount} repos / ${wp.length} WP / ${memory.length} memory`);

  if (totalCommits === 0 && wp.length === 0 && memory.length === 0) {
    console.log('[weekly] no activity, skipping');
    return;
  }

  const prompt = buildPrompt(start, end, commits, wp, memory);
  console.log(`[weekly] prompt ~${prompt.length} chars`);

  if (dryRun) {
    console.log('--- prompt preview (first 3KB) ---');
    console.log(prompt.slice(0, 3000));
    console.log('--- end preview ---');
    return;
  }

  console.log('[weekly] calling claude -p ...');
  const summary = synthesize(prompt);
  console.log(`[weekly] summary ~${summary.length} chars`);

  const body = `**Week of ${key} → ${weekEndDisplay}** · ${totalCommits} commits across ${repoCount} repos\n\n${summary}`;
  const blocks = mdToBlocks(body);

  const client = makeClient();
  const state = loadState();
  const dbId = state.databases?.weeklyUpdates;
  if (!dbId) throw new Error('weeklyUpdates DB not bootstrapped — re-run npm run bootstrap');

  state.pages = state.pages || {};
  state.pages.weeklyUpdates = state.pages.weeklyUpdates || {};
  const pageMap = state.pages.weeklyUpdates;

  const properties = {
    Title: { title: richText(`Week of ${key}`) },
    'Week Start': { date: { start: key } },
    'Week End': { date: { start: weekEndDisplay } },
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

  sendEmail({
    key,
    weekStart: key,
    weekEnd: weekEndDisplay,
    totalCommits,
    repoCount,
    summary,
    pageId: id
  });

  console.log(`[weekly] done: ${key}`);
}
