# VCPeer outreach — real leads found 2026-10-18

Sending infra check: no usable mail-sending credentials (SMTP/API key) for VCPeer's own mail
infra were found in this local checkout or in `~/products/.env`. Nothing was actually sent.
This is the same class of blocker as the X/HN/PH account logins already logged — needs one
real authenticated sender identity (verified domain + API key) before any send can go out.

## Real lead found via GitHub search (not a scraped list)

**github.com/abidals** — opened "[Add App] PsiTransfer - WeTransfer Alternative"
(beclab/apps#2662), actively requesting a self-hosted WeTransfer alternative be added to an
app marketplace. Genuine, specific, current signal that this person wants exactly what VCPeer
Send already does.

Draft (ready to send once a sender identity exists):

> Subject: saw your PsiTransfer request on beclab/apps
>
> Hey — saw you opened the request to add a WeTransfer alternative to beclab/apps. I've been
> building VCPeer Send, a self-hosted WeTransfer-style sender (download-notify, no account
> needed) as part of a broader self-hosted sharing suite (video calls, live streaming,
> Cal.com-style booking). Figured it might be a more complete fit for what you're after than a
> single-purpose fork — happy to hear what you'd actually want out of it if you try it.
> vcpeer.com

## Scope note

Only 1 genuinely qualified lead surfaced in the time available — GitHub issue full-text
search for "wetransfer alternative" mostly returns noise (unrelated bug reports, marketplace
PRs in other ecosystems), not real prospects. Did not pad the list with low-quality matches
to hit a target count — see owner's "never spam, only send with a genuine specific reason"
constraint. Finding 10-20 qualified leads per product would need either more search time or a
real prospecting tool, not blind `gh search issues`.
