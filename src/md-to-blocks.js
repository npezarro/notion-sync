import { markdownToBlocks } from '@tryfabric/martian';

const APPEND_CHUNK = 100;

export function mdToBlocks(md) {
  if (!md || !md.trim()) return [];
  try {
    const blocks = markdownToBlocks(md, {
      strictImageUrls: false,
      notionLimits: { truncate: true }
    });
    return blocks.slice(0, 1000);
  } catch (e) {
    return [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `[md parse error: ${e.message}]` } }]
        }
      }
    ];
  }
}

export function chunkBlocks(blocks) {
  const chunks = [];
  for (let i = 0; i < blocks.length; i += APPEND_CHUNK) {
    chunks.push(blocks.slice(i, i + APPEND_CHUNK));
  }
  return chunks;
}
