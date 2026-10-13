'use strict';

// Brand
const brandDataKey = 'brandDataP2P';
const brandData = window.sessionStorage.getItem(brandDataKey);

// Html pages
const landingTitle = document.getElementById('landingTitle');
const newCallTitle = document.getElementById('newCallTitle');
const newCallRoomTitle = document.getElementById('newCallRoomTitle');
const newCallRoomDescription = document.getElementById('newCallRoomDescription');
const loginTitle = document.getElementById('loginTitle');
const loginHeading = document.getElementById('loginHeading');
const loginDescription = document.getElementById('loginDescription');
const loginButtonLabel = document.getElementById('loginButtonLabel');
const joinRoomTitle = document.getElementById('joinRoomTitle');
const joinRoomButtonLabel = document.getElementById('joinRoomButtonLabel');
const waitingRoomTitle = document.getElementById('waitingRoomTitle');
const waitingRoomHeading = document.getElementById('waitingRoomHeading');
const waitingRoomDescription = document.getElementById('waitingRoomDescription');
const waitingRoomStatus = document.getElementById('waitingStatus');
const waitingRoomHostLink = document.getElementById('waitingRoomHostLink');
const waitingRoomLoginLink = document.getElementById('waitingRoomLoginLink');
const privacyPolicyTitle = document.getElementById('privacyPolicyTitle');
const stunTurnTitle = document.getElementById('stunTurnTitle');
const clientTitle = document.getElementById('clientTitle');
const notFoundTitle = document.getElementById('stunTurnTitle');

const shortcutIcon = document.getElementById('shortcutIcon');
const appleTouchIcon = document.getElementById('appleTouchIcon');

const appTitle = document.getElementById('appTitle');
const appDescription = document.getElementById('appDescription');
const appJoinDescription = document.getElementById('appJoinDescription');
const customizeRoomBrandName = document.getElementById('customizeRoomBrandName');
const joinRoomBtn = document.getElementById('joinRoomButton');
const customizeRoomBtn = document.getElementById('customizeRoomButton');
const appJoinLastRoom = document.getElementById('appJoinLastRoom');

const topSponsors = document.getElementById('topSponsors');
const features = document.getElementById('features');
const browsers = document.getElementById('browsers');
const teams = document.getElementById('teams');
const tryEasier = document.getElementById('tryEasier');
const poweredBy = document.getElementById('poweredBy');
const sponsors = document.getElementById('sponsors');
const pastSponsors = document.getElementById('pastSponsors');
const advertisers = document.getElementById('advertisers');
const supportUs = document.getElementById('supportUs');
const footer = document.getElementById('footer');
//...

// Brand customizations...

let brand = {
    app: {
        language: 'en',
        translationMode: 'google',
        name: 'VCPeer',
        title: 'VCPeer<br />Free browser video calls. No signup, no download, no time limit.',
        description:
            'Start a video call in one click. No account, no download, no time limit. Calls are peer-to-peer and never recorded by us.',
        joinDescription: 'Pick a room name.<br />How about this one?',
        joinButtonLabel: 'JOIN ROOM',
        customizeRoomButtonLabel: 'CUSTOMIZE ROOM',
        joinLastLabel: 'Your recent room:',
    },
    site: {
        shortcutIcon: '../images/logo.svg',
        appleTouchIcon: '../images/logo.svg',
        landingTitle: 'VCPeer — Free P2P Video Calls, No Signup, No Time Limit',
        newCallTitle: 'VCPeer a Free Secure Video Calls, Chat & Screen Sharing.',
        newCallRoomTitle: 'Pick name. <br />Share URL. <br />Start conference.',
        newCallRoomDescription:
            "Each room has its disposable URL. Just pick a room name and share your custom URL. It's that easy.",
        loginTitle: 'VCPeer - Host Protected login required.',
        loginHeading: 'Welcome back',
        loginDescription: 'Enter your credentials to continue.',
        loginButtonLabel: 'Login',
        joinRoomTitle: 'Pick name.<br />Share URL.<br />Start conference.',
        joinRoomButtonLabel: 'JOIN ROOM',
        clientTitle: 'VCPeer WebRTC Video call, Chat Room & Screen Sharing.',
        privacyPolicyTitle: 'VCPeer - privacy and policy.',
        stunTurnTitle: 'Test Stun/Turn Servers.',
        notFoundTitle: 'VCPeer - 404 Page not found.',
        waitingRoomTitle: 'VCPeer - Waiting for host to start the meeting',
        waitingRoomHeading: 'Waiting for host...',
        waitingRoomDescription:
            "The meeting hasn't started yet.<br />You'll join automatically when the host opens the room.",
        waitingRoomStatus: 'Checking room status...',
        waitingRoomReady: 'Room is ready! Joining...',
        waitingRoomWaiting: 'Waiting for host to start the meeting...',
        waitingRoomHostLink: 'Are you the host?',
        waitingRoomLoginLink: 'Login here',
        waitingRoomElapsedJust: 'Just started waiting',
        waitingRoomElapsedMinutes: 'Waiting for {minutes}',
        waitingRoomSongUrl: '',
    },
    html: {
        topSponsors: false,
        features: true,
        teams: true, // please keep me always true ;)
        tryEasier: true,
        poweredBy: false,
        sponsors: false,
        pastSponsors: false,
        advertisers: false,
        supportUs: false,
        footer: true,
    },
    about: {
        imageUrl: '../images/mirotalk-logo.gif',
        title: 'VCPeer v1.0.0',
        html: `
            Author:<a
                id="linkedin-button"
                data-umami-event="Author link"
                href="https://vcpeer.com" target="_blank">
                VCPeer
            </a>
            <br /><br />
            Email:<a
                id="email-button"
                data-umami-event="Email button"
                href="mailto:hello@vcpeer.com?subject=VCPeer info">
                hello@vcpeer.com
            </a>
            <br /><br />
            Source code:<a
                id="source-code-button"
                data-umami-event="Source code link"
                href="https://github.com/caelum0x/vcpeer-mirotalk" target="_blank">
                github.com/caelum0x/vcpeer-mirotalk
            </a>
            <br /><br />
            <hr />
            <span>&copy; 2026 VCPeer, all rights reserved</span>
            <hr />
        `,
    },
    widget: {
        enabled: false,
        roomId: 'support-room',
        theme: 'dark',
        widgetState: 'minimized',
        widgetType: 'support',
        supportWidget: {
            position: 'top-right',
            expertImages: [
                'https://photo.cloudron.pocketsolution.net/uploads/original/95/7d/a5f7f7a2c89a5fee7affda5f013c.jpeg',
            ],
            buttons: {
                audio: true,
                video: true,
                screen: true,
                chat: true,
                join: true,
            },
            checkOnlineStatus: false,
            isOnline: true,
            customMessages: {
                heading: 'Need Help?',
                subheading: 'Get instant support from our expert team!',
                connectText: 'connect in < 5 seconds',
                onlineText: 'We are online',
                offlineText: 'We are offline',
                poweredBy: 'Powered by VCPeer',
            },
        },
    },
    //...
};

/**
 * Get started
 */
async function initBrand() {
    await getBrand();

    handleBrand();

    handleWidget();

    // Signal to i18n.js (and others) that brand config is resolved.
    document.dispatchEvent(new Event('brand:ready'));
}

/**
 * Get brand from server
 */
async function getBrand() {
    if (brandData) {
        setBrand(JSON.parse(brandData));
    } else {
        try {
            const response = await fetch('/brand', { timeout: 5000 });
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            const serverBrand = data.message;
            if (serverBrand) {
                setBrand(serverBrand);
                console.log('FETCH BRAND SETTINGS', {
                    serverBrand: serverBrand,
                    clientBrand: brand,
                });
                window.sessionStorage.setItem(brandDataKey, JSON.stringify(serverBrand));
            } else {
                console.warn('FETCH BRAND SETTINGS - DISABLED');
            }
        } catch (error) {
            console.error('FETCH GET BRAND ERROR', error.message);
        }
    }
}

/**
 * Set brand
 * @param {object} data
 */
function setBrand(data) {
    brand = mergeBrand(brand, data);
    console.log('Set Brand done');
}

/**
 * Deep merge two objects
 * @param {object} target target object
 * @param {object} source source object
 * @returns {object} merged object
 */
function mergeBrand(target, source) {
    if (typeof target !== 'object' || target === null) return source;
    if (typeof source !== 'object' || source === null) return source;
    const output = Array.isArray(target) ? target.slice() : { ...target };
    for (const key of Object.keys(source)) {
        const srcVal = source[key];
        const tgtVal = output[key];
        if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
            output[key] = mergeBrand(tgtVal || {}, srcVal);
        } else {
            output[key] = srcVal;
        }
    }
    return output;
}

/**
 * Handle Brand
 */
function handleBrand() {
    if (landingTitle && brand.site?.landingTitle) landingTitle.textContent = brand.site.landingTitle;

    if (newCallTitle && brand.site?.newCallTitle) newCallTitle.textContent = brand.site.newCallTitle;
    if (newCallRoomTitle && brand.site?.newCallRoomTitle) newCallRoomTitle.innerHTML = brand.site.newCallRoomTitle;
    if (newCallRoomDescription && brand.site?.newCallRoomDescription)
        newCallRoomDescription.textContent = brand.site.newCallRoomDescription;

    if (loginTitle && brand.site?.loginTitle) loginTitle.textContent = brand.site.loginTitle;
    if (loginHeading && brand.site?.loginHeading) loginHeading.textContent = brand.site.loginHeading;
    if (loginDescription && brand.site?.loginDescription) loginDescription.textContent = brand.site.loginDescription;
    if (loginButtonLabel && brand.site?.loginButtonLabel) loginButtonLabel.textContent = brand.site.loginButtonLabel;
    if (joinRoomTitle && brand.site?.joinRoomTitle) joinRoomTitle.innerHTML = brand.site.joinRoomTitle;
    if (joinRoomButtonLabel && brand.site?.joinRoomButtonLabel)
        joinRoomButtonLabel.textContent = brand.site.joinRoomButtonLabel;
    if (privacyPolicyTitle && brand.site?.privacyPolicyTitle)
        privacyPolicyTitle.textContent = brand.site.privacyPolicyTitle;
    if (stunTurnTitle && brand.site?.stunTurnTitle) stunTurnTitle.textContent = brand.site.stunTurnTitle;
    if (clientTitle && brand.site?.clientTitle) clientTitle.textContent = brand.site.clientTitle;
    if (notFoundTitle && brand.site?.notFoundTitle) notFoundTitle.textContent = brand.site.notFoundTitle;
    if (waitingRoomTitle && brand.site?.waitingRoomTitle) waitingRoomTitle.textContent = brand.site.waitingRoomTitle;
    if (waitingRoomHeading && brand.site?.waitingRoomHeading)
        waitingRoomHeading.textContent = brand.site.waitingRoomHeading;
    if (waitingRoomDescription && brand.site?.waitingRoomDescription)
        waitingRoomDescription.innerHTML = brand.site.waitingRoomDescription;
    if (waitingRoomStatus && brand.site?.waitingRoomStatus)
        waitingRoomStatus.textContent = brand.site.waitingRoomStatus;
    if (waitingRoomHostLink && brand.site?.waitingRoomHostLink)
        waitingRoomHostLink.textContent = brand.site.waitingRoomHostLink;
    if (waitingRoomLoginLink && brand.site?.waitingRoomLoginLink)
        waitingRoomLoginLink.textContent = brand.site.waitingRoomLoginLink;

    if (shortcutIcon && brand.site?.shortcutIcon) shortcutIcon.href = brand.site.shortcutIcon;
    if (appleTouchIcon && brand.site?.appleTouchIcon) appleTouchIcon.href = brand.site.appleTouchIcon;

    if (appTitle && brand.app?.title) appTitle.innerHTML = brand.app.title;
    if (appDescription && brand.app?.description) appDescription.textContent = brand.app.description;
    if (appJoinDescription && brand.app?.joinDescription) appJoinDescription.innerHTML = brand.app.joinDescription;
    if (customizeRoomBrandName && brand.app?.name) customizeRoomBrandName.textContent = brand.app.name;
    if (joinRoomBtn && brand.app?.joinButtonLabel) joinRoomBtn.innerText = brand.app.joinButtonLabel;
    if (customizeRoomBtn && brand.app?.customizeRoomButtonLabel)
        customizeRoomBtn.innerText = brand.app.customizeRoomButtonLabel;
    if (appJoinLastRoom && brand.app?.joinLastLabel) appJoinLastRoom.innerText = brand.app.joinLastLabel;

    // helper to toggle multiple elements
    const displayElements = (list) => list.forEach(([el, show]) => elementDisplay(el, !!show));

    displayElements([
        [topSponsors, brand.html?.topSponsors],
        [features, brand.html?.features],
        [teams, brand.html?.teams],
        [tryEasier, brand.html?.tryEasier],
        [poweredBy, brand.html?.poweredBy],
        [sponsors, brand.html?.sponsors],
        [pastSponsors, brand.html?.pastSponsors],
        [advertisers, brand.html?.advertisers],
        [supportUs, brand.html?.supportUs],
        [footer, brand.html?.footer],
    ]);
}

// WIDGET customize
function handleWidget() {
    if (brand.widget?.enabled) {
        const domain = window.location.host;
        const roomId = brand.widget?.roomId || 'support-room';
        const userName = 'guest-' + Math.floor(Math.random() * 10000);
        if (typeof MiroTalkWidget !== 'undefined') {
            new MiroTalkWidget(domain, roomId, userName, brand.widget);
        } else {
            console.warn('MiroTalkWidget is not defined. Please check widget.js loading.', {
                domain,
                roomId,
                userName,
                widget: brand.widget,
            });
        }
    }
}

/**
 * Handle Element display
 * @param {object} element
 * @param {boolean} display
 * @param {string} mode
 */
function elementDisplay(element, display, mode = 'block') {
    if (!element) return;
    element.style.display = display ? mode : 'none';
}

initBrand();
