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

## Launchboard/Notify data files and local-disk upload storage — never overwrite on redeploy

Launchboard submissions persist to `app/data/launchboard.json` and Notify signups to
`app/data/notify.json` on the box (no DB is wired into this fork — see
`app/src/launchboard.js` / `app/src/notify.js`). VCPeer Send transfers and VCPeer Clips
recordings, when `*_STORAGE_DRIVER` is left at its default `local` (no R2 bucket
configured), persist encrypted blobs + metadata under `app/src/data/transfers/` and
`app/src/data/clips/` respectively. The live box is a plain rsync'd directory, not a
git checkout, so any redeploy command MUST exclude all four of these or real user data
(founder submissions, notify signups, in-flight/shared Send transfers, Clips recordings)
is lost on the next push:

```
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude app/data/launchboard.json \
  --exclude app/data/notify.json \
  --exclude app/src/data/transfers \
  --exclude app/src/data/clips \
  ./ deploy@130.61.180.42:/srv/src/vcpeer/
pm2 restart vcpeer
```

`LAUNCHBOARD_DATA_DIR`/`NOTIFY_DATA_DIR`/`SEND_LINK_DATA_DIR`/`CLIPS_DATA_DIR` env vars
can point these at paths outside the synced tree entirely if that's ever preferred
(or switch `SEND_LINK_STORAGE_DRIVER`/`CLIPS_STORAGE_DRIVER` to `r2` once a bucket is
provisioned, which removes this risk for Send/Clips entirely since blobs then live in
R2, not on the box's local disk).

## `.node22` — the pinned runtime, also never overwrite on redeploy

`/srv/src/vcpeer/.node22` is a Node v22 runtime installed directly on the box (not
part of this git repo — system `node` on the box is v20, and pm2's `vcpeer` process
is configured with `exec_interpreter: /srv/src/vcpeer/.node22/bin/node`). Because it
isn't in this repo, it isn't in the rsync source tree either, so `rsync -az --delete`
treats the whole directory as extraneous and deletes it — which deletes the exact
binary pm2 needs to start the app, taking the site down until someone notices and
restores it (hit live during this audit's deploy, 2026-10-17: a redeploy without this
exclude took vcpeer.com to 502 for a few minutes before being caught by the post-deploy
smoke test). **Always exclude it:**

```
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude app/data/launchboard.json \
  --exclude app/data/notify.json \
  --exclude app/src/data/transfers \
  --exclude app/src/data/clips \
  --exclude .node22 \
  ./ deploy@130.61.180.42:/srv/src/vcpeer/
pm2 restart vcpeer
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/   # on the box, must be 200 before trusting the deploy
```

If it's ever deleted again: download the matching official build from
`https://nodejs.org/dist/`, e.g. `node-v22.23.3-linux-arm64.tar.xz` (verify its
checksum against that release's `SHASUMS256.txt`), extract it straight into
`/srv/src/vcpeer/.node22` (it has the same `bin/lib/include/share` layout Node's own
tarball uses), `chown -R deploy:deploy` it, then `pm2 restart vcpeer`.

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
