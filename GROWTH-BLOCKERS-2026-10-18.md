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

## Owner-only item (already tracked, reaffirmed still open)

TURN is still disabled (`TURN_SERVER_ENABLED=false` in `.env`/`deploy/.env.production.template`).
STUN-only works for most home/office NATs but not symmetric NAT / strict corporate
firewalls — those real visitors will silently fail to connect on a call. Fix is an
owner-only signup (Cloudflare Calls TURN free tier, or metered.ca), already documented
in `deploy/README.md` ("Cloudflare Calls TURN account signup... owner-only"). Not
re-doing that write-up here, just flagging it's still the single biggest *technical*
ceiling on call-completion rate once real traffic shows up — worth prioritizing once
someone with the Cloudflare account has 10 minutes.

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
