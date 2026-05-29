import { markdownToBlocks } from '@tryfabric/martian';

const APPEND_CHUNK = 100;

const MAX_NEST_DEPTH = 2;

function capDepth(blocks, depth = 0) {
  for (const b of blocks) {
    const inner = b[b.type];
    if (inner && Array.isArray(inner.children)) {
      if (depth >= MAX_NEST_DEPTH) {
        delete inner.children;
      } else {
        capDepth(inner.children, depth + 1);
      }
    }
  }
}

const VALID_URL_RE = /^(https?:|mailto:|tel:)/i;

function sanitizeRichText(rt) {
  if (!Array.isArray(rt)) return;
  for (const item of rt) {
    if (item?.text?.link?.url && !VALID_URL_RE.test(item.text.link.url)) {
      item.text.link = null;
    }
    if (item?.href && !VALID_URL_RE.test(item.href)) {
      item.href = null;
    }
  }
}

function sanitizeBlock(b) {
  const inner = b[b.type];
  if (!inner) return;
  if (Array.isArray(inner.rich_text)) sanitizeRichText(inner.rich_text);
  if (b.type === 'table_row' && Array.isArray(inner.cells)) {
    for (const cell of inner.cells) sanitizeRichText(cell);
  }
  if (Array.isArray(inner.children)) {
    for (const child of inner.children) sanitizeBlock(child);
  }
}

function normalizeBlocks(blocks) {
  capDepth(blocks);
  for (const b of blocks) sanitizeBlock(b);
  for (const b of blocks) {
    if (b.type === 'table' && b.table) {
      const rows = b.table.children || [];
      const widths = rows.map(r => r.table_row?.cells?.length || 0);
      const width = Math.max(b.table.table_width || 0, ...widths, 1);
      b.table.table_width = width;
      for (const r of rows) {
        if (!r.table_row) continue;
        const cells = r.table_row.cells || [];
        while (cells.length < width) cells.push([]);
        if (cells.length > width) cells.length = width;
        r.table_row.cells = cells;
      }
    }
    const kids = b[b.type]?.children;
    if (Array.isArray(kids)) normalizeBlocks(kids);
  }
  return blocks;
}

export function mdToBlocks(md) {
  if (!md || !md.trim()) return [];
  try {
    const blocks = markdownToBlocks(md, {
      strictImageUrls: false,
      notionLimits: { truncate: true }
    });
    return normalizeBlocks(blocks.slice(0, 1000));
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
