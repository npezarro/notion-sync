# context.md

## Last Updated
2026-05-29 — initial scaffold + 5 sync modules live; first cron firing tomorrow 06:00 PT.

## Current State
- 6 sync modules working end-to-end: knowledge-base, skills, repos, blog-posts, daily-update, weekly-update.
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
