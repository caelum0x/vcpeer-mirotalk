#!/usr/bin/env node
/**
 * IndexNow ping for vcpeer.com (Bing, Yandex, Seznam, Naver and other
 * IndexNow engines share submissions).
 *
 * Fetches the live sitemap.xml, then POSTs every URL on the canonical host
 * to https://api.indexnow.org/indexnow. The key file must already be live at
 * https://vcpeer.com/<key>.txt (public/<key>.txt), so run this only after a
 * deploy that includes it.
 *
 * Usage:
 *   node scripts/indexnow-ping.mjs            # submit
 *   node scripts/indexnow-ping.mjs --dry-run  # list URLs only
 */

const SITE = (process.env.INDEXNOW_SITE || 'https://vcpeer.com').replace(/\/+$/, '');
const KEY = process.env.INDEXNOW_KEY || '61b534e6f06d2f677b032ce38d77baa2';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH_SIZE = 10_000;
const DRY_RUN = process.argv.includes('--dry-run');

function extractUrls(xml) {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  return [...new Set(urls)].filter((url) => {
    try {
      return new URL(url).host === new URL(SITE).host;
    } catch {
      return false;
    }
  });
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'vcpeer-indexnow-ping' } });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const keyFile = await fetchText(`${SITE}/${KEY}.txt`);
  if (keyFile.trim() !== KEY) throw new Error('key file not served correctly at site root');

  const sitemapXml = await fetchText(`${SITE}/sitemap.xml`);
  const urls = extractUrls(sitemapXml);
  if (urls.length === 0) throw new Error('no URLs found in sitemap');

  console.log(`Found ${urls.length} URLs on ${new URL(SITE).host}.`);
  if (DRY_RUN) {
    console.log(urls.join('\n'));
    return;
  }

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const body = { host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: batch };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const ok = res.status === 200 || res.status === 202;
    console.log(`Submitted ${batch.length} URLs: HTTP ${res.status}${ok ? '' : ' (NOT accepted)'}`);
    if (!ok) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('indexnow.failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
