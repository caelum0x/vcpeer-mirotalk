# Notice

VCPeer is a fork of [MiroTalk P2P](https://github.com/miroslavpejic85/mirotalk) by
Miroslav Pejic, licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

- Upstream project: https://github.com/miroslavpejic85/mirotalk
- Upstream author: Miroslav Pejic
- License: AGPL-3.0 (see `LICENSE`)

VCPeer keeps the same license. Per AGPL-3.0 Section 13, the complete corresponding
source code for the exact version running in production is always available at:

https://github.com/caelum0x/vcpeer-mirotalk

This link is also shown in the app's footer and About dialog. When deploying a new
version, update that link (and the one in `app/src/config.template.js` /
`public/js/brand.js`) to point at the exact commit or tag being deployed — see
`deploy/README.md`.

All branding, copy, and UI changes in this fork are original to VCPeer. No upstream
trademarks, sponsor names, or social accounts are used in the live product.

## VCPeer Send

VCPeer Send (`/send`) is original VCPeer code. It reuses this project's existing
signaling server as-is (the `join` / `addPeer` / `relaySDP` / `relayICE` Socket.IO
events already used for calls) — no new backend service was added for the WebRTC
handshake.

The chunked-transfer-with-backpressure approach (slicing files into fixed-size
chunks and pausing sends on `RTCDataChannel.bufferedAmount` until
`bufferedamountlow` fires) follows the same pattern popularized by:

- [PairDrop](https://github.com/schlagmichdoch/PairDrop) — MIT License
- [ShareDrop](https://github.com/cowbell/sharedrop) — MIT License (itself a fork
  of Snapdrop, also MIT)

No code was copied from either project; the technique is independently
implemented in `public/js/send/sender.js` / `receiver.js` / `chunker.js`.

Third-party libraries loaded by `/send` (same CDN-script pattern already used
elsewhere in this project — see `public/views/customizeRoom.html`,
`public/views/client.html`):

- [hash-wasm](https://github.com/Daninet/hash-wasm) — MIT License — incremental
  SHA-256 for the optional per-file integrity check.
- [qrcodejs](https://github.com/davidshimjs/qrcodejs) — MIT License — QR code
  rendering for the share link.
