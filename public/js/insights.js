'use strict';

// Railyard Insights — free, cookieless analytics (insights.ereboslab.com).
// Site: vcpeer.com (self-serve signup done 2026-10-14, see deploy/.env.insights
// for the private dashboard link, gitignored — never commit the token).
//
// This file just loads the tag. The room_created custom event is fired from
// public/js/client.js (window.railyard.track('room_created', ...)) at the
// point a peer's room/signaling connection is confirmed by the server.
(function () {
    var s = document.createElement('script');
    s.defer = true;
    s.src = 'https://insights.ereboslab.com/s.js';
    s.setAttribute('data-site', 's_dB_i-b3G-CB9Mh3zymWa2Tlx');
    document.head.appendChild(s);
})();

// Cloudflare Web Analytics — a "Web Analytics" site (site_tag
// 70d9cb26bc774c34a441460116f69da1) was created for vcpeer.com back on
// 2026-03-27 with auto_install + the zone ruleset both enabled, but every
// vcpeer.com DNS record (apex, www, book/live/share/watch) is "DNS only"
// (proxied: false) — traffic never passes through Cloudflare's edge, so
// Cloudflare's automatic beacon-injection ruleset can never actually inject
// the <script> tag into any response (confirmed: zero beacon script in the
// live HTML of every page checked on 2026-10-18, matching Cloudflare's
// dashboard showing 0 visits/0 page views despite real traffic — 94
// visitors / 104 page views / 3 room_created events in the last 7 days per
// Railyard Insights above). Loading the beacon manually here, independent
// of proxy status, is the standard fallback install method and the fix:
// the token below is a public, non-secret analytics site identifier (it is
// always visible in rendered page source to every visitor by design, same
// as the Railyard tag above), never a credential.
(function () {
    var s = document.createElement('script');
    s.type = 'module';
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', '{"token": "310840942fb042d8afecf08efd40f9ff"}');
    document.head.appendChild(s);
})();
