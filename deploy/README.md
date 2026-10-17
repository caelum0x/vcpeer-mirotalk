# VCPeer deploy runbook

Everything in this directory was **written and committed, not executed**, during the
2026-10-14 build session (hard limit: no production deploy, no server/DNS changes in
that session). This file is the exact runbook for whoever runs the deploy later
(owner-approved session, per the standing deploy-approval rule).

Target box: Oracle E2.1.Micro, `89.168.106.142` (956MB RAM, ~400MB free, Node 20, no
Docker, Caddy currently serving a static "closed" page), `ssh ubuntu@89.168.106.142 -i
~/.ssh/vcpeer_newbox_ed25519`.

## Repo

`caelum0x/vcpeer` was already taken by the old VC-investor product (separate repo,
untouched, dead product). This fork lives at **`caelum0x/vcpeer-mirotalk`**. The
production domain is still `vcpeer.com` — only the GitHub repo name differs from the
domain. If the owner wants the GitHub repo renamed to `vcpeer` later (after confirming
the old `caelum0x/vcpeer` repo can be archived/renamed away), that's a one-time GitHub
Settings action, not a code change — update every `github.com/caelum0x/vcpeer-mirotalk`
reference in this codebase (config.template.js, brand.js, all view footers, NOTICE.md,
package.json, README.md) to match if that happens.

## Steps

1. **Backup current box state** (read-only-safe, just a tar of config):

    ```
    ssh ubuntu@89.168.106.142 -i ~/.ssh/vcpeer_newbox_ed25519 \
      "sudo tar czf ~/caddy-backup-$(date +%Y%m%d).tar.gz /etc/caddy"
    ```

    Note the current Caddy "closed" static page location so it can be restored verbatim
    on rollback.

2. **Clone and install on the box:**

    ```
    git clone https://github.com/caelum0x/vcpeer-mirotalk.git vcpeer
    cd vcpeer
    git checkout feat/vcpeer-launch-2026-10-14   # or main, once merged
    npm install --omit=dev
    ```

3. **Env file:**

    ```
    cp deploy/.env.production.template .env
    ```

    Fill in:
    - `JWT_KEY` — generate with `openssl rand -hex 32`
    - TURN credentials, if the Cloudflare Calls TURN signup (owner-only, see below) is
      done by then; otherwise leave `TURN_SERVER_ENABLED=false` and ship STUN-only.

4. **AGPL Section 13 — update the source-code link to the exact deployed commit.**
   This is a legal requirement, not a nice-to-have: if the link is ever missing or
   points at an older commit than what's live, that's a license violation the instant
   it's live and user-facing. Before every deploy:
    - Note the commit SHA being deployed: `git rev-parse HEAD`
    - The footer/about-modal link currently points at the repo root
      (`https://github.com/caelum0x/vcpeer-mirotalk`), which is acceptable only because
      `main`/the deployed branch is kept in sync with what's live. If a deploy ever
      lags behind `main`, change the three links (`app/src/config.template.js` about
      block, `public/js/brand.js` about block, every view's footer "Source code" link)
      to point at the specific commit/tag, e.g.
      `https://github.com/caelum0x/vcpeer-mirotalk/tree/<sha>`.
    - Put this check in the deploy checklist every time, not just the first deploy.

5. **Start the app:**

    ```
    pm2 start deploy/ecosystem.config.js
    pm2 save
    pm2 logs vcpeer   # confirm clean startup
    curl localhost:3000   # should return 200 from the box itself, before touching Caddy
    ```

6. **Caddy:** merge `deploy/Caddyfile.vcpeer`'s site block into the box's live
   Caddyfile (append, don't replace the whole file), then:

    ```
    caddy validate
    caddy reload
    ```

7. **Smoke test from outside** (or run `deploy/smoke-test.sh https://vcpeer.com`):
    - `curl -I https://vcpeer.com` → 200, real landing page (not the closed splash)
    - Each SEO page (`/free-video-call`, `/video-call-no-time-limit`, `/video-call-link`,
      `/group-video-call-free`, `/screen-share-no-signup`) → 200
    - `/sitemap.xml`, `/robots.txt` → 200
    - Each old path (`/vcs/anything`, `/fresh-funding`, `/pricing`, `/tools`,
      `/support`) → 301 → `/`
    - Footer "Source code" link and About-modal "Source code" row both resolve to the
      deployed commit (AGPL check from step 4)
    - Railyard Insights dashboard (`deploy/.env.insights`, gitignored, has the token)
      shows a page view within a minute
    - `/launchboard` returns 200 and `/api/v1/launchboard/listings` returns real JSON

## Launchboard data file — never overwrite on redeploy

Launchboard submissions persist to `app/data/launchboard.json` on the box (no DB is
wired into this fork — see `app/src/launchboard.js`). The live box is a plain rsync'd
directory, not a git checkout, so any redeploy command MUST exclude that file or every
real founder submission is lost on the next push:

```
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude app/data/launchboard.json \
  ./ deploy@130.61.180.42:/srv/src/vcpeer/
pm2 restart vcpeer
```

`LAUNCHBOARD_DATA_DIR` env var can point this at a path outside the synced tree
entirely if that's ever preferred.

## Rollback (single command, no history rewrite needed)

```
pm2 stop vcpeer && pm2 delete vcpeer
# restore the pre-deploy Caddyfile from the step-1 backup tarball
caddy reload
```

Box returns to serving the static "closed" splash exactly as it was, under 2 minutes.
No data loss: nothing on the box held state before this (P2P app is stateless, no DB
migration to reverse).

## Owner-only (not done in the build session, silent blockers)

- **Cloudflare Calls TURN account signup** (or metered.ca free-tier signup, own
  account not the shared demo key) — needed to flip `TURN_SERVER_ENABLED=true` for
  real NAT traversal. Until then, ship STUN-only (honest, statable limitation).
- Actual production deploy (steps 1-7 above) — DNS already points at the Oracle box,
  no DNS change needed, just running this runbook.
- GitHub repo rename decision (`vcpeer-mirotalk` vs. reclaiming `vcpeer` from the old
  VC-investor repo) — see "Repo" section above.
- Legal gut-check on the upstream config-template comment ("Branding and
  customizations require a license" / CodeCanyon link) if the owner wants a second
  opinion beyond the AGPL text itself (AGPL explicitly permits modification +
  redistribution; this reads as upstream's own commercial-upsell comment, not a
  separate restriction).

## Fork maintenance (standing follow-up, not done in this build)

`upstream` remote (`miroslavpejic85/mirotalk`) is added but no process pulls security
fixes automatically. Periodically run:

```
git fetch upstream
git merge upstream/master
```

and re-check for new literal "MiroTalk" strings reintroduced by the merge (the
`config.test.js` brand-name assertion in `tests/` catches the config-level ones).
