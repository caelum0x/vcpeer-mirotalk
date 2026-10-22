# CoTURN Setup Guide

Set up `CoTURN` with Docker for NAT traversal and media relay in WebRTC applications.

---

## Installation Steps

### 1. Prepare Docker Compose

1. Copy the template:
    ```bash
    cp docker-compose.template.yml docker-compose.yml
    ```
2. Edit `docker-compose.yml` to fit your environment.
3. Use Let's Encrypt and Certbot for SSL certificates. Replace `YOUR.DOMAIN` in `docker-compose.yml` with your actual domain name.
    - Learn more about Let's Encrypt: [Click here](https://letsencrypt.org/).
    - Learn more about Certbot: [Click here](https://certbot.eff.org/).

### 2. Configure TURN Server

1. Copy the template:
    ```bash
    cp turnserver.template.conf turnserver.conf
    ```
2. Edit `turnserver.conf`:
    - Replace `YOUR.DOMAIN.NAME` with your domain.
    - Replace `YOUR.USERNAME` and `YOUR.PASSWORD` with your credentials.

    Example:

    ```text
    server-name=example.com
    realm=example.com
    user=username:password
    ```

### 3. Verify Files

Ensure `turnserver.conf` and `docker-compose.yml` are in the same directory.

### 4. Start the Server

Run:

```bash
docker-compose up -d
```

### 5. Check Logs (Optional)

Check logs to verify the server:

```bash
docker-compose logs -f <service_name>
```

---

## Notes

- Open ports (e.g., 3478, 5349 for TURN) on your firewall.
- Use secure credentials.
- Test with a WebRTC application.

For more, visit the [official documentation](https://docs.mirotalk.com/coturn/installation/).

---

## Live deployment notes (vcpeer.com, 2026-10-22, self-hosted — not a 3rd-party signup)

Deployed on the same Oracle Cloud box that serves vcpeer.com (`130.61.180.42`), using
`network_mode: host` so coturn binds directly to the host's ports/interfaces — no
container port mapping. Config omits `tls-listening-port`/`cert`/`pkey` (`no-tls`,
`no-dtls`): this box terminates all public TLS in Caddy already, and a plain
`turn:` listener on UDP/TCP 3478 is sufficient to fix the real problem (symmetric
NAT / strict-firewall peers silently failing to connect) without needing to wire
coturn into Caddy's cert material. A `turns:`/5349 listener on port 443 (to blend in
with HTTPS traffic for ultra-restrictive corporate networks) is a real future
upgrade, not required for the NAT-traversal fix itself.

**The one non-obvious gotcha that cost real debugging time:** on a cloud VM, the
public IP is *not* bound to any local network interface — it's a 1:1 NAT handled by
the cloud provider's network fabric, invisible to the guest OS (`ip -4 addr show`
only shows the private IP, e.g. `10.0.0.191`). Setting `listening-ip`/`relay-ip` to
the *public* IP makes coturn try to `bind()` a UDP relay socket to an address the
kernel has never heard of — it fails for every port in the relay range
(`errno=99`/`EADDRNOTAVAIL`), silently rejecting every real Allocate request with a
`508 Insufficient Capacity` STUN/TURN error. The fix: bind to the **private** IP,
and only tell coturn about the public one via the NAT-translation form of
`external-ip`:

```
listening-ip=10.0.0.191        # the box's actual NIC IP (ip -4 addr show)
relay-ip=10.0.0.191             # must match — this is what coturn binds relay sockets to
external-ip=130.61.180.42/10.0.0.191   # PUBLIC/PRIVATE — what coturn tells peers
```

**How this was actually verified** (port-open checks are not enough — a UDP `nc -zuv`
"succeeded" is a false positive; UDP has no handshake, it just means the local
`sendto()` didn't error):

1. Raw STUN Binding Request (no auth) over UDP to confirm the server responds at all.
2. Full TURN Allocate flow: unauthenticated request → 401 with `REALM`/`NONCE` →
   resend with `USERNAME`/`REALM`/`NONCE`/`MESSAGE-INTEGRITY` (HMAC-SHA1 over
   `MD5(username:realm:password)`) → confirm `0x0103` Allocate Success with a
   `XOR-RELAYED-ADDRESS` attribute decoding to the real public IP and a port inside
   the configured relay range.
3. Confirmed the running Node process's computed `iceServers` array (what's actually
   sent to real browsers on room join) includes the TURN entry with live credentials.

**Firewall: two layers, both had to be opened.** `ufw` on the guest OS is necessary
but not sufficient — this box's Oracle Cloud subnet security list is a separate,
stricter allow-list (TCP ports individually enumerated: 22/80/443/25/1935/8889; only
one UDP port, 8189, was open before this). Adding a `ufw allow` rule alone leaves
traffic dropped upstream at the cloud network layer with no guest-visible error.
Fixed via the OCI Python SDK already vendored at `infra-box/oracle/.venv` (no `oci`
CLI needed, no OCI console click-through) — added ingress rules for TCP 3478, UDP
3478, and UDP 49152-49452 (the relay range) to the subnet's security list.

Credentials and the real `turnserver.conf`/`docker-compose.yml` live only on the box
(both are gitignored — see repo-root `.gitignore`); this repo keeps only the
templates. The box's `.env` has `TURN_SERVER_ENABLED=true` and real
`TURN_SERVER_URL`/`TURN_SERVER_USERNAME`/`TURN_SERVER_CREDENTIAL` values pointing at
this self-hosted server, not the Cloudflare Calls / metered.ca placeholders
mentioned in `.env.template`.
