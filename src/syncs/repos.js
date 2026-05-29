import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';

function detectStack(repoPath) {
  const stack = [];
  const has = (f) => fs.existsSync(path.join(repoPath, f));
  if (has('package.json')) stack.push('Node');
  if (has('next.config.js') || has('next.config.mjs') || has('next.config.cjs')) stack.push('Next.js');
  if (has('prisma/schema.prisma')) stack.push('Prisma');
  if (has('requirements.txt') || has('pyproject.toml') || has('setup.py')) stack.push('Python');
  if (has('Cargo.toml')) stack.push('Rust');
  if (has('go.mod')) stack.push('Go');
  if (has('manifest.json')) stack.push('Browser Ext');
  if (has('Dockerfile') || has('docker-compose.yml')) stack.push('Docker');
  if (has('ecosystem.config.cjs') || has('ecosystem.config.js')) stack.push('PM2');
  return stack;
}

function lastCommitISO(repoPath) {
  try {
    const out = execSync('git log -1 --format=%cI', {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

function readDocs(repoPath) {
  const claudeMd = path.join(repoPath, 'CLAUDE.md');
  const readme = path.join(repoPath, 'README.md');
  const parts = [];
  if (fs.existsSync(claudeMd)) {
    parts.push('## CLAUDE.md\n\n' + fs.readFileSync(claudeMd, 'utf8'));
  }
  if (fs.existsSync(readme)) {
    parts.push('## README.md\n\n' + fs.readFileSync(readme, 'utf8'));
  }
  return parts.join('\n\n---\n\n');
}

export async function syncRepos({ dryRun }) {
  const reposDir = process.env.REPOS_DIR;
  if (!reposDir || !fs.existsSync(reposDir)) {
    console.log('[repos] REPOS_DIR not set or missing, skipping');
    return;
  }

  const client = makeClient();
  const state = loadState();
  const dbId = state.databases?.repos;
  if (!dbId) throw new Error('repos database not bootstrapped');

  state.pages = state.pages || {};
  state.pages.repos = state.pages.repos || {};
  const pageMap = state.pages.repos;

  const entries = fs.readdirSync(reposDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'));
  console.log(`[repos] ${entries.length} directories`);
  const seen = new Set();

  for (const entry of entries) {
    const repoPath = path.join(reposDir, entry.name);
    if (!fs.existsSync(path.join(repoPath, '.git'))) continue;

    seen.add(entry.name);
    const stack = detectStack(repoPath);
    const lastCommit = lastCommitISO(repoPath);
    const docsMd = readDocs(repoPath);
    const blocks = mdToBlocks(docsMd || `_No CLAUDE.md or README.md_`);

    if (dryRun) {
      console.log(`  DRY  ${entry.name}  stack=[${stack.join(',')}]  commit=${lastCommit?.slice(0,10) || 'none'}`);
      continue;
    }

    const properties = {
      Name: { title: richText(entry.name) },
      Stack: { multi_select: stack.map(s => ({ name: s })) },
      'Deploy Target': { rich_text: richText('') },
      'Last Synced': { date: { start: new Date().toISOString() } },
      Archived: { checkbox: false }
    };
    if (lastCommit) {
      properties['Last Commit'] = { date: { start: lastCommit } };
    }

    const id = await upsertDbPage(client, {
      dbId,
      pageId: pageMap[entry.name],
      properties,
      blocks
    });
    pageMap[entry.name] = id;
  }

  for (const [name, pageId] of Object.entries(pageMap)) {
    if (seen.has(name)) continue;
    if (dryRun) {
      console.log(`  DRY archive ${name}`);
      continue;
    }
    await client.pages.update({
      page_id: pageId,
      properties: { Archived: { checkbox: true } }
    });
  }

  if (!dryRun) saveState(state);
  console.log(`[repos] done`);
}
