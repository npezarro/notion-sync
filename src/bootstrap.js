import { makeClient } from './notion.js';
import { loadState, saveState } from './state.js';

const DATABASES = {
  knowledgeBase: {
    title: 'Knowledge Base',
    properties: {
      Title: { title: {} },
      Category: {
        select: {
          options: [
            { name: 'Infrastructure' },
            { name: 'Integrations' },
            { name: 'Projects' },
            { name: 'Patterns' },
            { name: 'Agent System' },
            { name: 'Other' }
          ]
        }
      },
      'Source Path': { rich_text: {} },
      'Last Synced': { date: {} },
      Archived: { checkbox: {} }
    }
  },
  skills: {
    title: 'Skills',
    properties: {
      Name: { title: {} },
      Type: {
        select: {
          options: [
            { name: 'Built-in' },
            { name: 'Custom' }
          ]
        }
      },
      Trigger: { rich_text: {} },
      'Source Path': { rich_text: {} },
      'Last Synced': { date: {} },
      Archived: { checkbox: {} }
    }
  },
  repos: {
    title: 'Repos',
    properties: {
      Name: { title: {} },
      Stack: { multi_select: {} },
      'Deploy Target': { rich_text: {} },
      'Last Commit': { date: {} },
      'Last Synced': { date: {} },
      Archived: { checkbox: {} }
    }
  },
  dailyUpdates: {
    title: 'Daily Updates',
    properties: {
      Title: { title: {} },
      Date: { date: {} },
      Commits: { number: {} },
      'Repos Touched': { number: {} },
      'Last Synced': { date: {} }
    }
  },
  blogPosts: {
    title: 'Blog Posts',
    properties: {
      Title: { title: {} },
      Date: { date: {} },
      URL: { url: {} },
      Tags: { multi_select: {} },
      'Last Synced': { date: {} },
      Archived: { checkbox: {} }
    }
  }
};

export async function bootstrap() {
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) {
    throw new Error('NOTION_PARENT_PAGE_ID not set. Create a blank page in Notion, share it with your integration, and put its ID in .env');
  }

  const client = makeClient();
  const state = loadState();
  state.parentPageId = parentPageId;
  state.databases = state.databases || {};

  for (const [key, schema] of Object.entries(DATABASES)) {
    if (state.databases[key]) {
      console.log(`= ${schema.title.padEnd(16)} ${state.databases[key]}`);
      continue;
    }
    const db = await client.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: schema.title } }],
      properties: schema.properties
    });
    state.databases[key] = db.id;
    console.log(`+ ${schema.title.padEnd(16)} ${db.id} (created)`);
  }

  saveState(state);
  console.log('\nBootstrap complete. state.json updated.');
}
