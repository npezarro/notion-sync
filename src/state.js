import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const STATE_PATH = path.join(ROOT, 'state.json');

function backupPath() {
  return process.env.STATE_BACKUP_PATH || '';
}

export function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    const bp = backupPath();
    if (bp && fs.existsSync(bp)) {
      console.log(`[state] restoring from backup: ${bp}`);
      fs.copyFileSync(bp, STATE_PATH);
    } else {
      return {};
    }
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`state.json is malformed: ${e.message}`);
  }
}

export function saveState(state) {
  const tmp = STATE_PATH + '.tmp';
  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, STATE_PATH);
  const bp = backupPath();
  if (bp) {
    try {
      fs.mkdirSync(path.dirname(bp), { recursive: true });
      const btmp = bp + '.tmp';
      fs.writeFileSync(btmp, json);
      fs.renameSync(btmp, bp);
    } catch (e) {
      console.log(`[state] backup write failed (${bp}): ${e.message}`);
    }
  }
}
