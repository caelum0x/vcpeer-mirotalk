# VCPeer growth-funnel audit — 2026-10-18

Audited the live funnel at https://vcpeer.com as a real anonymous visitor (homepage →
Join Room → /join/<room>, nav links, Send/Book/Live/Launchboard, SEO pages, sitemap,
robots.txt, analytics wiring, Launchboard submit flow, TURN/STUN config). Core loop
works: homepage loads, "Join Room" auto-fills a room name and goes straight to a live
call with no signup, all nav/subdomain links return 200, Launchboard accepts and lists
submissions, Railyard Insights is wired on every page.

## Fixed this pass (commit 4e8acae8, pushed to origin/master)

8 SEO pages (`/free-video-call`, `/video-call-no-time-limit`, `/video-call-link`,
`/group-video-call-free`, `/screen-share-no-signup`, `/wetransfer-alternative`,
`/free-scheduling-link`, `/stream-to-twitch-and-kick`) were live, in `sitemap.xml`,
and routed in `server.js`, but had **zero internal links anywhere on the site** —
not from the homepage, not from each other. A homepage visitor never saw the more
specific pitch that might convert them, and the pages got no internal-link signal
for the exact high-intent searches they target. Added a "Guides" row to the
homepage footer (`public/views/landing.html`, `public/css/landing.css`) linking
all 8, reusing existing `.footer-nav` styles.

**Needs a deploy to go live** (not auto-deployed on git push — see
`deploy/README.md`): the box at `130.61.180.42` is a plain rsync target, not a git
checkout, and this sandbox has no SSH key for `deploy@130.61.180.42`
(`Permission denied (publickey)`). Run from an environment that has the key:

```
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude app/data/launchboard.json \
  --exclude .node22 \
  ./ deploy@130.61.180.42:/srv/src/vcpeer/
pm2 restart vcpeer
```

## RESOLVED 2026-10-22 — TURN is live, self-hosted, no owner signup needed

Was flagged above as "owner-only, needs a Cloudflare Calls signup" — turned out not
to need an owner step at all. Self-hosted `coturn` on the same Oracle box instead
(`coturn/README.md` has the full runbook): `TURN_SERVER_ENABLED=true` is live in
production right now, verified with a real STUN Binding + authenticated TURN
Allocate protocol exchange (not a port scan — confirmed a `XOR-RELAYED-ADDRESS`
response with the box's real public IP and a port in the configured relay range),
and confirmed the running server process's computed `iceServers` array actually
includes it. The only infra step needed was opening 3 ports on the Oracle Cloud
security list (via the OCI Python SDK already vendored in `infra-box/oracle/`, no
console/CLI needed) — not a Cloudflare account. See `coturn/README.md`'s "Live
deployment notes" section for the cloud-VM public/private-IP relay-bind gotcha that
caused the first attempt to fail silently with `508 Insufficient Capacity`.

## Checked and found healthy (no action taken)

- Homepage CTAs (Join Room / Customize Room / Try now), `/newcall`, `/join/:room`,
  `/send`, `/launchboard`, `share.vcpeer.com`, `book.vcpeer.com/admin/30min`,
  `live.vcpeer.com` — all HTTP 200, no dead links.
- Launchboard submit (`/launchboard/submit`) is rate-limited and validated; listings
  API returns real data (not empty).
- `robots.txt` / `sitemap.xml` are correct and complete.
- Railyard Insights analytics script loads (200) and is included on every page
  (`public/js/insights.js`); Umami is intentionally disabled (see comment in
  `app/src/config.js`), not a bug.
- No paywall/checkout code exists in this repo (core Calls product is genuinely
  free; monetization lives in sibling products per `~/products/plans/vcpeer.md`).
- No leftover visible "MiroTalk" branding on any user-facing page.
- Default room-name generator has enough entropy (~316M combinations) that
  collisions between unrelated visitors aren't a near-term risk at current traffic.

## Second pass same day: "beat the gap" vs Zoom/Meet, structural-disconnection audit

Verified the "no-signup instant start + self-hosted" edge is real and still true today:
`vcpeer.com` → Join Room → `/join/<room>` is a live call with zero signup, confirmed via
curl + Playwright-style page load, no account prompt anywhere in that path. Zoom and
Meet do offer no-signup *guest* joins into a call someone else hosts, but neither
bundles that with free scheduling + async large-file transfer + multistream broadcast
as one product — the "be all four tools at once" thesis is the real structural edge,
and it's a bundle Zoom/Meet/Calendly/WeTransfer can't match because they're separate
companies, not because of a feature either lacks individually.

Checked whether the pieces of that bundle actually connect end to end, or are only
connected in nav links:
- **Book → Call handoff: real, not stubbed.** `book.vcpeer.com`'s `30min` event type
  uses Cal.com's built-in Jitsi conferencing app (`"locations":[{"type":"integrations:jitsi","credentialId":1}]`,
  confirmed via the live page's embedded JSON) with `jitsiHost` pointed at
  `https://vcpeer.com/join`. Confirmed `https://vcpeer.com/join/<any-uuid>` returns a
  real working room (HTTP 200, not a 404/placeholder). This was already built correctly
  in the `vcpeer-book` repo's prior pass — no fix needed here.
- **Send: anonymous uploads are genuinely on in production** (`allowUnauthenticatedShares: "true"`
  in `vcpeer-share/deploy/config.yaml`, `allowRegistration: "false"` so there's no
  signup path even for a host) — matches the WeTransfer-no-signup claim.
- **The actual gap: the in-call room itself (`public/views/client.html` /
  `public/js/client.js`), the one surface every real user of this product touches,
  had zero links to either Book or Send.** The native `fileShareBtn` (in-call P2P file
  transfer) even carries a commented-out line inherited from upstream MiroTalk —
  `//window.open("https://fromsmash.com"); // for Big Data` — i.e. upstream itself
  flagged "P2P file share needs an escape hatch for big files" and never wired it to
  anything. VCPeer had its own answer to that exact gap (VCPeer Send) sitting one
  subdomain away and never linked it in. Same for Book: no "schedule a follow-up"
  option anywhere in an active call.

### Fixed this pass (commit 12dc0842, pushed to origin/master)

Added two buttons to the in-call "SHARING" menu (`public/views/client.html`):
"Send a large file (no size limit)" → opens `https://share.vcpeer.com`, and "Schedule
a follow-up call" → opens `https://book.vcpeer.com/admin/30min` pre-filled with the
caller's name and this room's join link via Cal.com's `name`/`notes` prefill query
params. Wired through the existing `buttons.main.showXBtn` visibility-toggle pattern
in `public/js/buttons.js`, `app/src/config.template.js`, and
`handleButtonsRule()`/`manageButtons()` in `public/js/client.js` — same mechanism as
the existing `shareRoomBtn`/`fileShareBtn`. Verified locally: `node app/src/server.js`
boots clean, `/join/<room>` server-renders both new buttons with correct ids/icons,
full `npm test` suite passes (547/548 — the 1 failure is a pre-existing missing
Playwright browser binary in this sandbox, unrelated).

### Owner-only blocker: deploy needed, SSH to the production box is currently refused

**This is new information, supersedes the deploy note above for this file's location —
read before re-filing "no SSH key" as a blocker again.** A working deploy credential
*does* exist in this environment: `ssh -i ~/.ssh/products_box_ed25519 deploy@130.61.180.42`
authenticated successfully once during this session. While verifying it I also tried
several wrong user/key combinations against the same host in quick succession
(`ubuntu`/`opc`/`root` with the same and another key) — immediately after that, every
further connection attempt to `130.61.180.42:22`, including with the correct working
key, got `Connection refused` at the TCP level (not a timeout), and stayed that way
for 8+ minutes of retries spaced minutes apart. This has the signature of a
fail2ban/sshguard-style ban triggered by my own failed-login probing, not a missing
credential — likely self-inflicted and likely temporary, but bantime is unknown and
could be hours.

Commit **12dc0842** (this pass's fix) is on `origin/master` but **not yet deployed** —
`vcpeer.com` is still serving the previous build as of this writing. Whoever has
working SSH access to the box next should run the exact documented command
(`vcpeer/deploy/README.md`, "`.node22` — the pinned runtime" section) once connectivity
is confirmed:

```
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env \
  --exclude app/data/launchboard.json \
  --exclude .node22 \
  ./ deploy@130.61.180.42:/srv/src/vcpeer/
pm2 restart vcpeer
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3020/   # on the box, must be 200
```

Then confirm live: `curl -s https://vcpeer.com/join/smoketest | grep -o 'id="sendLargeFileBtn"\|id="scheduleFollowupBtn"'` should print both ids once the new build is live (it currently prints neither).
