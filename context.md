# context.md

## Last Updated
2026-06-24 — added `second-brain` sync (7th module): mirrors memory/ atomic facts + privateContext/inbox/ raw thoughts into a new "Second Brain" Notion DB (Type: Fact / Raw Thought). Gives a cloud/mobile browse layer for the second-brain system. Content-hash skipping makes daily re-runs idempotent (0.7s when unchanged). Fixed Notion invalid-URL rejection (memory notes have wikilinks/relative-links/bare autolink placeholders) via markdown + block-level `URL()` sanitization. Initial mirror: 182 rows. Commits `2813897`/`914d413`/`ead26b9`. Closeout: `privateContext/deliverables/closeouts/2026-06-24-second-brain-system.md`.

Prior: 2026-05-29 — initial scaffold + 5 sync modules live.

## Current State
- 7 sync modules working end-to-end: second-brain, knowledge-base, skills, repos, blog-posts, daily-update, weekly-update.
- `second-brain`: 182 rows (180 memory facts + 2 inbox thoughts); state entries are `{id, hash}` for content-skip; runs on the same 0600 cron.
- First full sync + extensions wrote ~250 pages: 42 KB / 14 user-owned skills (harness built-ins excluded by design) / 98 repos / 95 WP posts / 1 daily / 1 weekly.
- PM2 process `notion-sync` registered, `cron_restart: 0 6 * * *`, currently stopped (waits for cron). Weekly auto-runs only on Mondays.
- Email hook tested; fires on daily-update + weekly-update upsert via `EMAIL_SENDER_SCRIPT`.
- State backup live: every `saveState` writes to `STATE_BACKUP_PATH` (atomic temp+rename); restores from backup if main `state.json` is missing.
- Public repo: github.com/npezarro/notion-sync.

## Open Work
- First organic cron firing tomorrow 06:00 PT. If it doesn't land, check `pm2 logs notion-sync` and WSL timezone.
- WP post embeds (YouTube etc.) dropped by turndown. Custom converter could emit Notion embed blocks if desired.

## Environment Notes
- **Deploy target:** local WSL, PM2-managed
- **Process manager:** PM2 process name `notion-sync`
- **Schedule:** `cron_restart: '0 6 * * *'` (server local time)
- **Node version:** 18+
- **Auth:** Notion internal integration token (privateContext); parent page must be explicitly shared with integration via Notion Connections menu
- **Persistence:** `state.json` (gitignored) maps source key → Notion page ID for upsert
- **Email hook:** reads `EMAIL_SENDER_SCRIPT` env var; silently no-ops if unset

## Active Branch
master

---

**Never include:** credentials, API keys, tokens, passwords, or `.env` contents.
**For change history**, see `progress.md`.
**Full closeout:** `privateContext/deliverables/closeouts/2026-05-29-notion-sync-scaffold.md`
