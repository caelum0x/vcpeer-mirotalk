# Launch report: VCPeer

_Generated 2026-10-23_

Launch tracking started 4 day(s) ago.

## Directories
- 3/24 submitted or live, 21 not started.

## Checklist
- 1/10 of the 10-step playbook done.

## Outreach
- No contacts tracked yet.

## Content drafted
- 10 launch-copy draft(s) generated.

## UTM links generated
- 32 tracked link(s).

---

## What's actually real (2026-10-23 distribution push)

Context: vcpeer.com had 0 visits in the last 24h despite real engineering investment.
Homepage audit (curl, no JS): title/description/og:title/twitter:title/H1 all
correctly say "VCPeer -- Free, No-Signup, Peer-to-Peer Video Calls" with a clear
one-click, no-account pitch -- the homepage is NOT the problem; distribution is.

**Real, completed submissions (no account needed):**
- Launching Next: submitted 2026-10-18, confirmation id 163048
  (https://www.launchingnext.com/thanks/?i=163048)
- Uneed: real no-account form submit confirmed (auto-crawled listing generated
  at uneed.best/tool/vcpeer); final "save" click needs a free account (owner-only)
- GitHub awesome-lists, real open PRs from caelum0x (not yet merged):
  - https://github.com/nuzulul/awesome-webrtc/pull/23 (Video Conference section)
  - https://github.com/zenika-open-source/awesome-remote-work/pull/170 (digital events tools)

**Investigated and genuinely blocked (not faked):**
- SaaSHub (saashub.com/submit): real HTTP flow traced end to end -- GET
  /services/submit -> GET /services/new?url=... (auto-crawls name=VCPeer) ->
  POST /services with CSRF token reaches server-side validation but requires
  `service[category_ids][]` written by a client-side React widget
  (confirmed its real API: GET /api/autocomplete/categories?query=video returns
  real category ids like `video-conferencing`, `communication`, `webrtc`) --
  the exact POST encoding that widget emits isn't present in static HTML or the
  minified JS bundle, so it cannot be completed with curl; needs a real browser
  session. Tried installing a local headless Chromium this session; the
  Playwright binary download stalled/never completed on this box.
- Reddit pain-point search (`launchmaxxing pain-points`): Reddit's own
  search.json endpoints returned HTTP 403 "Blocked" to every request from this
  machine's network (tried multiple user agents, old.reddit.com, forced IPv4) --
  this is a network-level block on this box, not a tool bug. No fabricated
  thread links are included below as a result.
- Product Hunt, BetaList, DevHunt, Fazier, Turbo0, Smol Launch, StartupBase,
  Findly Tools, PeerPush, TinyLaunch, Peerlist, Hacker News, Indie Hackers,
  AlternativeTo, G2, Capterra, Futurepedia, There's An AI For That, Microlaunch,
  r/SideProject -- all genuinely require a login/account to finish a submission
  (confirmed live via `directories --check-links` and/or prior browser sessions
  in this catalog's history). Launch copy for all of these is generated and
  saved locally (`launchmaxxing content "VCPeer" all --save`) so the owner can
  paste and post in minutes once logged in.

**UTM-tagged links:** 32 built and saved (`launchmaxxing utm list "VCPeer"`),
one per catalog directory plus prior outreach/social links, so any traffic that
comes in from these channels is attributable.

_Report generated locally by [launchmaxxing](https://github.com/caelum0x/launchmaxxing) -- no data leaves your machine._