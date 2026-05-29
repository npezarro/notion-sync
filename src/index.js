import 'dotenv/config';
import { bootstrap } from './bootstrap.js';
import { syncKnowledgeBase } from './syncs/knowledge-base.js';
import { syncSkills } from './syncs/skills.js';
import { syncRepos } from './syncs/repos.js';
import { syncBlogPosts } from './syncs/blog-posts.js';

const SYNCS = {
  'knowledge-base': syncKnowledgeBase,
  'skills': syncSkills,
  'repos': syncRepos,
  'blog-posts': syncBlogPosts
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const positional = args.filter(a => !a.startsWith('--'));
  return {
    command: positional[0],
    target: positional[1],
    dryRun: flags.has('--dry-run')
  };
}

async function main() {
  const { command, target, dryRun } = parseArgs(process.argv);

  if (command === 'bootstrap') {
    await bootstrap();
    return;
  }

  if (command === 'sync') {
    const opts = { dryRun };
    const names = target ? [target] : Object.keys(SYNCS);
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
