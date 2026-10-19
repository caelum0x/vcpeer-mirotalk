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

## VCPeer Send: "Send a link" (WeTransfer-style upload-and-share)

Added 2026-10-14 alongside the live P2P "Send now" mode above. Original VCPeer
code — no code was copied from any third-party project.

Scope note for anyone reading the planning history: this feature's brief
originally named two reference projects — PairDrop (GPL-3.0) for a "Nearby
devices on the same network" panel, and timvisee/send (MPL-2.0) for a
fragment-key, zero-knowledge-encrypted link approach. The owner changed scope
before any code was written against either: the "Nearby" panel was dropped
entirely, and "Send a link" shipped instead as a direct WeTransfer clone —
files are uploaded to and decryptable by this server (encrypted at rest with
a server-held key, not end-to-end), which is what lets it generate zip
downloads and image/video/PDF previews. Because neither reference project's
code or core architecture was used, **no PairDrop or timvisee/send credit
applies here** — flagging this explicitly so the absence reads as a deliberate
decision, not an oversight.

New npm dependencies, both used server-side only (`app/src/transfers/`,
`app/src/storage/`):

- [archiver](https://github.com/archiverjs/node-archiver) — MIT License —
  streams the "Download all (.zip)" response without buffering the whole
  archive in memory.
- [aws4](https://github.com/mhart/aws4) — MIT License — signs the Cloudflare
  R2 (S3-compatible) requests used by the optional `R2Storage` backend
  (`SEND_LINK_STORAGE_DRIVER=r2`) with AWS Signature V4, without pulling in
  the much larger `@aws-sdk/client-s3`.
