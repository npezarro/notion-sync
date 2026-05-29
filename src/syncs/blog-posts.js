import TurndownService from 'turndown';
import { makeClient, richText } from '../notion.js';
import { loadState, saveState } from '../state.js';
import { mdToBlocks } from '../md-to-blocks.js';
import { upsertDbPage } from '../lib/page.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

async function fetchAllPosts(baseUrl) {
  const all = [];
  let page = 1;
  const perPage = 50;
  while (true) {
    const url = `${baseUrl}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&_embed=1&orderby=date&order=desc`;
    const res = await fetch(url);
    if (res.status === 400) break; // out of range
    if (!res.ok) throw new Error(`WP fetch failed page ${page}: ${res.status}`);
    const batch = await res.json();
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return all;
}

function extractTags(post) {
  const terms = post._embedded?.['wp:term'] || [];
  const tags = [];
  for (const group of terms) {
    for (const t of group) {
      if (t.taxonomy === 'post_tag' || t.taxonomy === 'category') {
        tags.push(t.name);
      }
    }
  }
  return tags;
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export async function syncBlogPosts({ dryRun }) {
  const baseUrl = process.env.WP_BASE_URL;
  if (!baseUrl) {
    console.log('[wp] WP_BASE_URL not set, skipping');
    return;
  }

  const client = makeClient();
  const state = loadState();
  const dbId = state.databases?.blogPosts;
  if (!dbId) throw new Error('blogPosts database not bootstrapped');

  state.pages = state.pages || {};
  state.pages.blogPosts = state.pages.blogPosts || {};
  const pageMap = state.pages.blogPosts;

  const posts = await fetchAllPosts(baseUrl);
  console.log(`[wp] ${posts.length} posts`);
  const seen = new Set();

  for (const post of posts) {
    const key = String(post.id);
    seen.add(key);
    const title = decodeHtmlEntities(post.title?.rendered || '(untitled)');
    const html = post.content?.rendered || '';
    const md = turndown.turndown(html);
    const blocks = mdToBlocks(md);
    const tags = extractTags(post).slice(0, 100);

    if (dryRun) {
      console.log(`  DRY  ${post.date?.slice(0,10)}  ${title}`);
      continue;
    }

    const properties = {
      Title: { title: richText(title) },
      Date: { date: { start: post.date } },
      URL: { url: post.link || null },
      Tags: { multi_select: tags.map(t => ({ name: t.slice(0, 100) })) },
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
      console.log(`  DRY archive post ${key}`);
      continue;
    }
    await client.pages.update({
      page_id: pageId,
      properties: { Archived: { checkbox: true } }
    });
  }

  if (!dryRun) saveState(state);
  console.log(`[wp] done`);
}
