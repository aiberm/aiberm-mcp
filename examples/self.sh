#!/usr/bin/env bash
# Profile and remaining quota for the signed-in user.
# Do not add curl -v or set -x; those print NEW_API_ACCESS_TOKEN.
set -euo pipefail
: "${NEW_API_BASE_URL:=https://aiberm.com}"
: "${NEW_API_ACCESS_TOKEN:?export NEW_API_ACCESS_TOKEN (dashboard system access token)}"
: "${NEW_API_USER_ID:?export NEW_API_USER_ID (numeric user id)}"

curl -sS "${NEW_API_BASE_URL}/api/user/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer ${NEW_API_ACCESS_TOKEN}" \
  -H "New-Api-User: ${NEW_API_USER_ID}"
