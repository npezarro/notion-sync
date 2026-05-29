# notion-sync

One-way daily sync from ecosystem sources into Notion. Notion is a read-only browsable mirror; source of truth always lives in git/WP.

## Sources -> Notion databases

| Source | Notion DB | Key |
|---|---|---|
| `${KB_DIR}/**/*.md` | Knowledge Base | source path (relative) |
| `${SKILLS_DIRS}` | Skills | skill name |
| `${REPOS_DIR}/*/` | Repos | repo name |
| `${WP_BASE_URL}/wp-json/wp/v2/posts` | Blog Posts | WP post ID |

## Run

```bash
npm install
cp .env.example .env   # fill in NOTION_TOKEN + NOTION_PARENT_PAGE_ID
npm run bootstrap      # creates 4 databases under parent page (idempotent)
npm run dry            # dry-run all syncs, no writes
npm run sync           # full sync
npm run sync:kb        # individual sync
```

`state.json` (gitignored) tracks database IDs + per-source page IDs for upsert.

## Setup notes

1. Create an internal integration at notion.so/profile/integrations and copy the secret.
2. Create a blank page in Notion called "Ecosystem".
3. Click "..." -> Connections -> add your integration.
4. Copy the page ID from its URL into `NOTION_PARENT_PAGE_ID`.
5. Run `npm run bootstrap`.

## Cron

PM2 cron at 06:00 PT daily (`ecosystem.config.cjs`).

## Email hook

After `daily-update` upserts a page it shells out to `$EMAIL_SENDER_SCRIPT` with the synthesized summary on stdin. The script is expected to accept `<subject> --sender-name <name>` and read the body from stdin. Disable per-run with `DAILY_UPDATE_EMAIL=false`. Skipped silently if `EMAIL_SENDER_SCRIPT` is unset or missing.

## Semantics

- Upsert by stable key; re-runs do not duplicate.
- Missing-source rows get `Archived: true` rather than deletion.
- Page bodies are fully rewritten each run (markdown -> blocks via martian). HTML (WP) is run through turndown first.
