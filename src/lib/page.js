import { chunkBlocks } from '../md-to-blocks.js';

async function listAllChildren(client, pageId) {
  const ids = [];
  let cursor;
  do {
    const res = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100
    });
    for (const b of res.results) ids.push(b.id);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return ids;
}

export async function clearPageChildren(client, pageId) {
  const ids = await listAllChildren(client, pageId);
  for (const id of ids) {
    try {
      await client.blocks.delete({ block_id: id });
    } catch (e) {
      if (e.code !== 'object_not_found') throw e;
    }
  }
}

export async function writePageBody(client, pageId, blocks) {
  for (const chunk of chunkBlocks(blocks)) {
    await client.blocks.children.append({ block_id: pageId, children: chunk });
  }
}

export async function upsertDbPage(client, { dbId, pageId, properties, blocks }) {
  let id = pageId;
  if (id) {
    await client.pages.update({ page_id: id, properties });
    await clearPageChildren(client, id);
  } else {
    const page = await client.pages.create({
      parent: { database_id: dbId },
      properties
    });
    id = page.id;
  }
  if (blocks?.length) await writePageBody(client, id, blocks);
  return id;
}
