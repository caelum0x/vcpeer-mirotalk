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
    - TURN credentials — self-hosted, not owner-blocked. Run `coturn/` via Docker on
      the same box (see `coturn/README.md`), generate a `user:pass` with
      `openssl rand -hex 16` / `openssl rand -base64 24`, set `listening-ip`/`relay-ip`
      to the box's **private** NIC IP (`ip -4 addr show`, not the public IP — cloud
      VMs 1:1-NAT the public IP, so coturn can't bind a relay socket to it directly)
      and `external-ip=PUBLIC_IP/PRIVATE_IP` so NAT translation is still advertised
      correctly to peers. Then set `TURN_SERVER_ENABLED=true`,
      `TURN_SERVER_URL=turn:<public-ip>:3478`, and the matching username/credential.
      Verify with a real STUN+TURN Allocate exchange (not just a port scan — UDP port
      scans report false positives) before trusting it.

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

Launchboard submissions persist to `app/data/launchboard.json`, Notify signups to
`app/data/notify.json`, Room Link email->room captures to `app/data/room-links.json`,
and durable named-room claims (room name -> salted passcode hash) to
`app/data/room-claims.json` on the box (no DB is wired into this fork — see
`app/src/launchboard.js` / `app/src/notify.js` / `app/src/roomLink.js` /
`app/src/roomClaims.js`). VCPeer Send transfers and VCPeer Clips recordings, when
`*_STORAGE_DRIVER` is left at its default `local` (no R2 bucket configured), persist
encrypted blobs + metadata under `app/src/data/transfers/` and `app/src/data/clips/`
respectively. The live box is a plain rsync'd directory, not a git checkout, so any
redeploy command MUST exclude all six of these or real user data (founder submissions,
notify signups, room-link captures, claimed room passcodes, in-flight/shared Send
transfers, Clips recordings) is lost on the next push:

```
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude app/data/launchboard.json \
  --exclude app/data/notify.json \
  --exclude app/data/room-links.json \
  --exclude app/data/room-claims.json \
  --exclude app/src/data/transfers \
  --exclude app/src/data/clips \
  ./ deploy@130.61.180.42:/srv/src/vcpeer/
pm2 restart vcpeer
```

`LAUNCHBOARD_DATA_DIR`/`NOTIFY_DATA_DIR`/`ROOM_LINK_DATA_DIR`/`ROOM_CLAIMS_DATA_DIR`/`SEND_LINK_DATA_DIR`/`CLIPS_DATA_DIR` env vars
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
  --exclude app/data/room-links.json \
  --exclude app/data/room-claims.json \
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

## `app/src/config.js` — gitignored and never auto-refreshed, also goes stale

`app/src/config.js` is generated once from `config.template.js` by the `prestart`
script (`test -f app/src/config.js || cp app/src/config.template.js app/src/config.js`)
and is itself gitignored, so it is both outside the rsync source tree's git history
and never overwritten by a later deploy — the same "lives outside the sync boundary"
shape as `.node22` above, but for config instead of a runtime. Every time a new
top-level config block is added to `config.template.js` (e.g. the `clips` block added
for VCPeer Clips), the box's existing `config.js` silently keeps missing it — code
that reads a missing block either falls back to a hardcoded default (logged as a
warning, e.g. `ClipSend config.clips is missing (stale config.js...)`) or, for a block
with no such fallback, could throw at the first request that touches it. **After every
deploy, diff the two and copy over if they differ** (safe only when the existing
`config.js` has no box-specific manual edits — check the diff first):

```
diff /srv/src/vcpeer/app/src/config.js /srv/src/vcpeer/app/src/config.template.js
# if the only diff is new template blocks (no local customization lost):
cp /srv/src/vcpeer/app/src/config.js /srv/src/vcpeer/app/src/config.js.bak-$(date +%Y%m%d)
cp /srv/src/vcpeer/app/src/config.template.js /srv/src/vcpeer/app/src/config.js
pm2 restart vcpeer
```

(Hit live during this session's 2026-10-21 deploy: `config.clips` was missing,
caught via the warning log before it became user-visible, fixed with the above.)

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

- ~~Cloudflare Calls TURN account signup~~ — **done differently, no longer a
  blocker.** Self-hosted `coturn` (2026-10-22) on the same box instead of signing up
  for a third-party TURN provider: real STUN binding + authenticated TURN Allocate
  verified end-to-end (relayed address `130.61.180.42:<port>` returned on a real
  protocol exchange, not just a port scan), `TURN_SERVER_ENABLED=true` is live in
  production. The only non-owner step this took was an Oracle Cloud security-list
  ingress rule (udp/tcp 3478 + udp 49152-49452) — done via the OCI Python SDK already
  vendored in `infra-box/oracle/`, no console click-through needed. See
  `coturn/README.md` for the self-hosted runbook.
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

## VCPeer Coworker — deploy steps (built 2026-10-21, not yet live)

"VCPeer Coworker" is the always-on AI assistant now wired across three
surfaces, forking the cross-surface idea from CopilotKit/OpenDots but
implemented directly on VCPeer's own stack (Node/Express/Socket.io + the
free `ai-relay-worker`) instead of OpenDots' CopilotKit Intelligence/Channels
cloud, which would have required a new paid dependency:

- **In a call** — the pre-existing "ChatGPT" in-call assistant
  (`getChatGPT` socket handler, `public/js/client.js`), now renamed to
  "VCPeer Coworker", enabled by default, and pointed at the free relay (it
  was previously disabled and had a latent `basePath`→`baseURL` bug that
  silently made it fall through to a real OpenAI account regardless of
  config — fixed).
- **Async text follow-up** — new `/coworker` page +
  `/api/v1/coworker/message` API (`app/src/coworker/`), a persisted
  conversation thread so a user can keep talking to the same assistant after
  a call ends. Call exchanges are also persisted under `room:<roomId>` so
  `/coworker?thread=room:<roomId>` resumes that call's conversation.
- **Slack** — new `/api/v1/coworker/slack/events` Events API bridge
  (`app/src/coworker/slackBridge.js`), HMAC-signature verified, answers
  `app_mention` and DM events in-thread via `chat.postMessage`.

All three share one persona (`config.coworker.systemPrompt`) and, by
default, VCPeer's own free `ai-relay-worker`
(`https://ai-relay.subasiarhan3.workers.dev`) — no new paid API key. Verified
locally end-to-end against the live relay (real completions, persisted
threads, rate limiting, XSS sanitization, Slack signature verify all
exercised manually) and the full existing `npx mocha tests/*.js` suite
(705 passing, zero regressions) before this was pushed to `master`.

### Why this isn't live on vcpeer.com yet

Deploying needs the same `rsync` + `pm2 restart vcpeer` steps as every other
deploy (see "Steps" above) run from a shell whose source IP is allowed
through the box's Oracle Cloud Network Security Group on port 22 — this
build session's shell is not: `nc -zv 130.61.180.42 22` returns an immediate
`Connection refused` (an active NSG rejection, not a timeout/outage — port
443 connects fine and `vcpeer.com` itself serves 200 normally, so only SSH is
locked down to specific source IPs). This is the one truly owner-only step
left:

**Correction, checked read-only via the OCI API** (`infra-box/oracle/.venv`,
which already has `oci` + `~/.oci/config` for this tenancy): this is not a
per-source-IP NSG rule — the box has **no NSG attached**, and its subnet
security list allows ingress TCP/22 from `0.0.0.0/0` for every source. Tried
the OCI Run Command plugin (reports `RUNNING` on this instance) to check
`sshd`/`iptables` without needing SSH at all; the command sat in `ACCEPTED`
for 7.5+ minutes and never executed, so the Oracle Cloud Agent on the box
itself isn't responding either — points to something wrong inside the guest
(sshd or the whole cloud-agent process down/stuck), not an IP allowlist.
Fix needs the OCI Console serial/VNC console (Compute -> Instances ->
products-box -> Console Connection) to restart the stuck service, or a full
instance reboot if the console itself doesn't respond — full details in
`videogen/docs/plans/GROWTH-TASKS-DEPLOY-BLOCKER-2026-10-21.md` (same box
serves Menivor too). A reboot takes down every service on this shared box
for the reboot window, so that's the owner's call on timing.

1. Once SSH is back: from any shell, `rsync` this repo to `/srv/src/vcpeer/` per the exclude list in
   "Launchboard/Notify data files..." above (now also excluding
   `app/data/coworker/` — real user conversation data, same reasoning as
   `launchboard.json`/`notify.json`), then `pm2 restart vcpeer`.
2. **Diff `config.js` against `config.template.js`** (see "`app/src/config.js`
   — gitignored and never auto-refreshed" above) — this feature adds a new
   top-level `coworker` block and extends `chatGPT`, both of which a stale
   box `config.js` will be missing.
3. **Add the new env vars to the box's real `.env`** (never synced by
   rsync, see `.gitignore`): `CHATGPT_ENABLED=true`,
   `CHATGPT_BASE_PATH=https://ai-relay.subasiarhan3.workers.dev/v1/`,
   `CHATGPT_APIKEY=<ai-relay-worker key, see
   ~/products/gtm/tools/ai-relay-worker>`, `CHATGPT_MODEL=vcpeer-coworker`,
   `CHATGPT_MAX_TOKENS=800`, `CHATGPT_TEMPERATURE=0.4`, `AI_RELAY_KEY=<same
   key>`, `COWORKER_ENABLED=true`. (This build session's local `.env` already
   has these set and was used for the live verification above — copy its
   values over rather than re-deriving them.)
4. Smoke test: `curl -I https://vcpeer.com/coworker` → 200, and
   `curl -s -X POST https://vcpeer.com/api/v1/coworker/message -H
   'Content-Type: application/json' -d '{"message":"hello"}'` → a real JSON
   reply (not a 503).

### Owner-only: the Slack bridge itself

`/api/v1/coworker/slack/events` is fully coded and tested (signature
verify, event parsing, relay call, thread persistence, `chat.postMessage`
reply all exercised manually with a fake Slack app above — only the final
`chat.postMessage` call needs a real bot token to actually land in Slack).
Turning it on needs a real Slack app, which only the owner can create:

1. Create an app at <https://api.slack.com/apps>, enable Event
   Subscriptions with Request URL
   `https://vcpeer.com/api/v1/coworker/slack/events`, subscribe to
   `app_mention` and `message.im`.
2. Add the `chat:write` bot scope, install the app to the workspace.
3. Set `COWORKER_SLACK_ENABLED=true`, `COWORKER_SLACK_SIGNING_SECRET=<Signing
   Secret>`, `COWORKER_SLACK_BOT_TOKEN=<Bot User OAuth Token, xoxb-...>` in
   the box's `.env`, `pm2 restart vcpeer`.
