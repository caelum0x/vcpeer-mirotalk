#!/usr/bin/env bash
# Post-deploy smoke test for VCPeer. Run after a real deploy, not in CI
# (CI has no live box to hit). Usage: deploy/smoke-test.sh https://vcpeer.com
set -euo pipefail

BASE_URL="${1:-https://vcpeer.com}"
FAIL=0

check_200() {
    local path="$1"
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}${path}")
    if [ "$code" = "200" ]; then
        echo "OK   200 ${path}"
    else
        echo "FAIL ${code} ${path} (expected 200)"
        FAIL=1
    fi
}

check_301_to_home() {
    local path="$1"
    local code location
    code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}${path}")
    location=$(curl -s -o /dev/null -w '%{redirect_url}' "${BASE_URL}${path}")
    if [ "$code" = "301" ] && { [ "$location" = "/" ] || [ "$location" = "${BASE_URL}/" ]; }; then
        echo "OK   301 ${path} -> ${location}"
    else
        echo "FAIL ${code} ${path} -> '${location}' (expected 301 -> /)"
        FAIL=1
    fi
}

echo "== core pages =="
check_200 "/"
check_200 "/newcall"
check_200 "/privacy"
check_200 "/sitemap.xml"
check_200 "/robots.txt"

echo "== SEO pages =="
check_200 "/free-video-call"
check_200 "/video-call-no-time-limit"
check_200 "/video-call-link"
check_200 "/group-video-call-free"
check_200 "/screen-share-no-signup"

echo "== Launchboard =="
check_200 "/launchboard"
check_200 "/api/v1/launchboard/listings"

echo "== legacy 301 redirects (old vcpeer.com VC-investor URLs) =="
check_301_to_home "/vcs/anything"
check_301_to_home "/fresh-funding"
check_301_to_home "/tools"
check_301_to_home "/pricing"
check_301_to_home "/support"

if [ "$FAIL" -ne 0 ]; then
    echo
    echo "SMOKE TEST FAILED"
    exit 1
fi

echo
echo "SMOKE TEST PASSED"
