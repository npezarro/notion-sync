# context.md

## Last Updated
2026-05-29 — initial scaffold + 5 sync modules live; first cron firing tomorrow 06:00 PT.

## Current State
- 5 sync modules working end-to-end: knowledge-base, skills, repos, blog-posts, daily-update.
- First full sync wrote 250 pages to Notion (42 KB / 14 skills / 98 repos / 95 WP posts / 1 daily-update for 2026-05-28).
- PM2 process `notion-sync` registered, `cron_restart: 0 6 * * *`, currently stopped (waits for cron).
- Email hook tested; fires on daily-update upsert via `EMAIL_SENDER_SCRIPT`.
- Public repo: github.com/npezarro/notion-sync.

## Open Work
- First organic cron firing tomorrow 06:00 PT. If it doesn't land, check `pm2 logs notion-sync` and WSL timezone.
- `state.json` is local-only — repo nuke loses the source→page-ID map. Consider backing up to a secondary location on each successful run.
- Built-in harness skills (loop, schedule, claude-api, init, review, security-review) aren't filesystem-resident and so aren't synced. Hardcoded list would close the gap.
- WP post embeds (YouTube etc.) dropped by turndown. Custom converter could emit Notion embed blocks if desired.
- Weekly rollup synthesis is a small extension if useful.

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
