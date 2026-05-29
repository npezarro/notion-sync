import { Client } from '@notionhq/client';

export function makeClient() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN not set');
  return new Client({ auth: token });
}

export function richText(text) {
  if (!text) return [];
  return [{ type: 'text', text: { content: String(text).slice(0, 2000) } }];
}

export function titleProp(text) {
  return { title: richText(text) };
}
