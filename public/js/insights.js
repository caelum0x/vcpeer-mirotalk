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
