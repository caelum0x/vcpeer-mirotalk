# VCPeer launch copy (2026-10-18)

Generated locally via `launchmaxxing content "VCPeer" all --profile-file vcpeer_profile.json --save`
(no LLM call, deterministic templates — see `~/products/launchmaxxing`). Positioning used: free
video-calling + Live + Book + Send sharing suite vs Zoom/Meet/Calendly/WeTransfer, one no-signup
link starts a call, and Send/Book are now reachable from inside the call itself (commit `12dc0842`,
live).

Every link below carries a UTM tag (built with `launchmaxxing utm build`, saved locally) so a future
analytics check can attribute clicks from each specific submission, instead of the bare
`https://vcpeer.com` link used in the 2026-10-16 cold-outreach batch, which couldn't be measured.

## Product Hunt — owner-gated (needs a real Product Hunt account to post)

**Tagline** (59/60 chars): Free video calls, scheduling, and file sharing, no account…

**Description:**
Zoom caps free calls at 40 minutes, Meet needs a Google account, Calendly and
WeTransfer are separate signups, and nobody wants four tools for one
conversation. VCPeer fixes that: one link starts a call with no signup, and
from inside that same call you can send a large file (no size limit, no
account) or book a follow-up meeting, because Call + Send + Book + Live are
one self-hosted suite instead of four separate products.

**Link to submit:** https://vcpeer.com?utm_source=producthunt&utm_medium=launch_directory&utm_campaign=vcpeer_launch_w1

**Submit at:** https://www.producthunt.com/posts/new

## Hacker News (Show HN) — owner-gated (needs a real HN account)

**Title** (80/80 chars):
`Show HN: VCPeer – one link starts a call with no signup, and from inside th…`

**Link:** https://vcpeer.com?utm_source=hackernews&utm_medium=show_hn&utm_campaign=vcpeer_launch_w1

**Submit at:** https://news.ycombinator.com/submit

## r/SideProject — owner-gated (needs a real Reddit account)

**Title:** Built a tool after getting tired of Zoom capping free calls at 40
minutes, Meet needing a Google account, and Calendly/WeTransfer being
separate signups

**Body:**
For a while I kept running into this: Zoom caps free calls at 40 minutes,
Meet needs a Google account, Calendly and WeTransfer are separate signups,
and nobody wants four tools for one conversation.

I'm part of founders, remote agencies, recruiters, and small teams who host
client calls, so I ended up building VCPeer to fix it for myself first. One
link starts a call with no signup, and from inside that same call you can
send a large file (no size limit, no account) or book a follow-up meeting,
because Call + Send + Book + Live are one self-hosted suite instead of four
separate products.

It's up at https://vcpeer.com?utm_source=reddit&utm_medium=community_post&utm_campaign=vcpeer_launch_w1
if you want to poke at it — genuinely interested in whether this is a
problem other people here have too, or if I'm the only one who found it
this annoying.

**Submit at:** https://www.reddit.com/r/SideProject/submit

## X / Twitter thread — owner-gated (needs the product's real X account)

1. Shipping VCPeer today. https://vcpeer.com?utm_source=twitter&utm_medium=social&utm_campaign=vcpeer_launch_w1
2. The problem: Zoom caps free calls at 40 minutes, Meet needs a Google
   account, Calendly and WeTransfer are separate signups, and nobody wants
   four tools for one conversation.
3. Founders, remote agencies, recruiters, and small teams who host client
   calls deal with this constantly, usually by cobbling together
   workarounds.
4. What VCPeer does: one link starts a call with no signup, and from inside
   that same call you can send a large file (no size limit, no account) or
   book a follow-up meeting, because Call + Send + Book + Live are one
   self-hosted suite instead of four separate products.
5. It's built for founders, remote agencies, recruiters, and small teams who
   host client calls specifically — not a generic tool we bolted a landing
   page onto.
6. If that's you, give it a look at https://vcpeer.com?utm_source=twitter&utm_medium=social&utm_campaign=vcpeer_launch_w1.
   Feedback (especially the critical kind) is genuinely welcome.

## LinkedIn — owner-gated (needs the product's real LinkedIn account)

Shipped VCPeer.

The problem: Zoom caps free calls at 40 minutes, Meet needs a Google
account, Calendly and WeTransfer are separate signups, and nobody wants
four tools for one conversation.

One link starts a call with no signup, and from inside that same call you
can send a large file (no size limit, no account) or book a follow-up
meeting, because Call + Send + Book + Live are one self-hosted suite
instead of four separate products.

Built for founders, remote agencies, recruiters, and small teams who host
client calls. If that's you, I'd genuinely like your feedback — the good
and the bad.

https://vcpeer.com?utm_source=linkedin&utm_medium=social&utm_campaign=vcpeer_launch_w1

---

## Already submitted today (no account needed)

- **Uneed** (`https://www.uneed.best/submit-a-tool`) — real form submit done:
  name=VCPeer, url=`https://vcpeer.com?utm_source=uneed&utm_medium=launch_directory&utm_campaign=vcpeer_launch_w1`.
  Uneed auto-crawled vcpeer.com and started generating a listing at
  `uneed.best/tool/vcpeer` (description/category/logo). Their own UI then
  asks for a free account to finish *saving* the generated listing — that
  one click is the owner-gated step; everything up to it is done and does
  not require credentials we don't have.

## Checked, also account-gated despite the catalog listing them as open

Turbo0, Smol Launch, BetaList, and Findly Tools all redirected straight to a
login/signup page the moment their `/submit` URL was opened (confirmed live
on 2026-10-18, not assumed) — their "paste a URL" framing on their own
landing pages is marketing copy, the actual submit flow needs an account.
Treat those the same as Product Hunt/HN/Reddit above: real accounts needed,
owner-gated.

## Status tracking

Full directory/checklist/outreach/content state is tracked locally in
`~/.launchmaxxing/` via `launchmaxxing track "VCPeer"` and
`launchmaxxing report "VCPeer"` — not duplicated here since it changes as
more directories get submitted.
