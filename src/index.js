import 'dotenv/config';
import { bootstrap } from './bootstrap.js';
import { syncKnowledgeBase } from './syncs/knowledge-base.js';
import { syncSkills } from './syncs/skills.js';
import { syncRepos } from './syncs/repos.js';
import { syncBlogPosts } from './syncs/blog-posts.js';
import { syncDailyUpdate } from './syncs/daily-update.js';
import { syncWeeklyUpdate } from './syncs/weekly-update.js';
import { syncSecondBrain } from './syncs/second-brain.js';

const SYNCS = {
  'second-brain': syncSecondBrain,
  'knowledge-base': syncKnowledgeBase,
  'skills': syncSkills,
  'repos': syncRepos,
  'blog-posts': syncBlogPosts,
  'daily-update': syncDailyUpdate,
  'weekly-update': syncWeeklyUpdate
};

const DEFAULT_SYNCS = ['second-brain', 'knowledge-base', 'skills', 'repos', 'blog-posts', 'daily-update', 'weekly-update'];

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const positional = args.filter(a => !a.startsWith('--'));
  return {
    command: positional[0],
    target: positional[1],
    extra: positional[2],
    dryRun: flags.has('--dry-run')
  };
}

async function main() {
  const { command, target, extra, dryRun } = parseArgs(process.argv);

  if (command === 'bootstrap') {
    await bootstrap();
    return;
  }

  if (command === 'sync') {
    const opts = { dryRun, date: extra };
    const names = target ? [target] : DEFAULT_SYNCS;
    for (const name of names) {
      const fn = SYNCS[name];
      if (!fn) throw new Error(`unknown sync: ${name}. options: ${Object.keys(SYNCS).join(', ')}`);
      const t0 = Date.now();
      try {
        await fn(opts);
      } catch (e) {
        console.error(`[${name}] FAILED: ${e.message}`);
        if (process.env.DEBUG) console.error(e.stack);
        process.exitCode = 1;
      }
      console.log(`[${name}] ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    }
    return;
  }

  console.log(`usage:
  node src/index.js bootstrap
  node src/index.js sync [target] [--dry-run]

targets: ${Object.keys(SYNCS).join(', ')}`);
  process.exit(1);
}

main().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
