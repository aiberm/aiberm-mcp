#!/usr/bin/env bash
# Aiberm profile and remaining balance (余额).
# Do not add curl -v or set -x; those print AIBERM_ACCESS_TOKEN.
set -euo pipefail
: "${AIBERM_ACCESS_TOKEN:?export AIBERM_ACCESS_TOKEN (系统访问令牌)}"

curl -sS "https://aiberm.com/api/user/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer ${AIBERM_ACCESS_TOKEN}"
