import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';
import {
  ymd,
  addDays,
  yesterdayUTC,
  collectCommitsRange,
  fetchWpPostsRange,
  collectMemoryChangesRange
} from '../lib/collectors.js';

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

function sendEmail({ date, totalCommits, repoCount, summary, pageId }) {
  if (process.env.DAILY_UPDATE_EMAIL === 'false') return;
  const sender = process.env.EMAIL_SENDER_SCRIPT;
  if (!sender || !fs.existsSync(sender)) {
    console.log('[daily] EMAIL_SENDER_SCRIPT not set or missing, skipping email');
    return;
  }
  const url = `https://www.notion.so/${pageId.replace(/-/g, '')}`;
  const subject = `Daily update: ${date} — ${totalCommits} commits / ${repoCount} repos`;
  const body = `${url}\n\n${totalCommits} commits across ${repoCount} repos\n\n${summary}\n`;
  const senderName = process.env.EMAIL_SENDER_NAME || 'Notion Sync';
  const res = spawnSync('bash', [sender, subject, '--sender-name', senderName], {
    input: body,
    encoding: 'utf8',
    timeout: 30_000
  });
  if (res.status === 0) {
    console.log('[daily] email sent');
  } else {
    console.log(`[daily] email failed (exit ${res.status}): ${(res.stderr || res.stdout || '').slice(0, 200)}`);
  }
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
  const targetDate = date ? new Date(date + 'T00:00:00Z') : yesterdayUTC();
  const nextDay = addDays(targetDate, 1);
  const key = ymd(targetDate);

  const commits = collectCommitsRange(targetDate, nextDay);
  const wp = await fetchWpPostsRange(targetDate, nextDay);
  const memory = collectMemoryChangesRange(targetDate, nextDay);

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

  sendEmail({ date: key, totalCommits, repoCount, summary, pageId: id });

  console.log(`[daily] done: ${key}`);
}
