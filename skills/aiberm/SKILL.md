---
name: aiberm
description: >-
  Look up the signed-in user's Aiberm / New API account at aiberm.com:
  balance and quota, groups, models, pricing, masked API tokens, usage
  logs and stats, top-ups, subscription, affiliate code, check-in status,
  async tasks, and drawings. Use when the user asks about their Aiberm
  or New API balance, models, tokens, usage, or billing. Call the user
  HTTP API with the dashboard system access token and New-Api-User.
  Refuse admin channels, all-user lists, redemptions, system options,
  key reveal, and payment creation.
---

# Aiberm user API

Call the signed-in user's New API dashboard endpoints yourself with `curl` or `fetch`. The account on [aiberm.com](https://aiberm.com) is the usual host. Another New API origin works through `NEW_API_BASE_URL`.

This skill is read-only. It covers the signed-in user's own data. Admin and payment routes are out of scope below.

## 1. Load credentials

Read these from the environment. Ask the user for any that are missing. Do not invent them, and do not write them into the repo, shell history, commits, or logs.

| Variable | Required | Meaning |
| --- | --- | --- |
| `NEW_API_BASE_URL` | no | Origin only. Default `https://aiberm.com`. No path, query, or embedded credentials. |
| `NEW_API_ACCESS_TOKEN` | yes | Dashboard **system access token** (系统访问令牌) from personal settings → security. |
| `NEW_API_USER_ID` | yes | Numeric user id. This is `data.id`, not a username. |
| `NEW_API_QUOTA_PER_UNIT` | no | Quota units per 1 USD. Default `500000`. |

The access token is not a relay API key. Relay keys start with `sk-` and authenticate `https://aiberm.com/v1` model calls. This skill does not call the relay and does not reveal `sk-` keys. If the user wants the full relay key, they copy it from the dashboard token page.

Do not run the shell with trace (`set -x`) and do not add `curl -v`. Both print the access token.

## 2. Send both headers on every request

Every request is `GET` and carries both headers:

```bash
curl -sS "$NEW_API_BASE_URL/api/user/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

`New-Api-User` must be the integer user id. A username returns a format error. The id has to match the access token's user.

URL-encode query values. With curl, use `-G` and `--data-urlencode` so the request stays a GET:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/log/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20" \
  --data-urlencode "type=2"
```

A JSON object with `"success": false` is a failure even when HTTP status is 200. Show `message` after redaction. Do not retry a refused admin or payment route.

Successful JSON is usually:

```json
{"success": true, "message": "", "data": {}}
```

Paginated `data` uses `page`, `page_size`, `total`, and `items`. The page query parameter is `p` (not `page`). `page_size` defaults to 20 and the maximum you should send is 100. Timestamps are unix seconds.

## 3. Read quota as USD

`quota` on the user is the **remaining balance** in quota units. `used_quota` is cumulative consumption. Do not subtract `used_quota` from `quota`.

```text
USD = quota / NEW_API_QUOTA_PER_UNIT
```

Round USD to 6 decimal places. With the default `500000`, a `quota` of `2500000` is $5 remaining. The same divisor applies to `used_quota`, `remain_quota`, `aff_quota`, and `aff_history_quota`.

On `GET /api/log/self/stat`, `quota` is consumption inside the filter, not the wallet balance.

A token's `remain_quota` is that token's own allowance, separate from the user's `quota`.

### Model prices

`GET /api/pricing` returns model rows in `data` and `group_ratio` on the same object. The payload is large. Filter it before you answer. If the user named a model, keep rows whose `model_name` contains that string, case-insensitively. Otherwise summarize and show at most 25 rows. Keep a row for a group when `enable_groups` contains that group or `all`, or when `enable_groups` is empty.

- `quota_type` 0, USD per 1M input tokens = `model_ratio * group_ratio * (1000000 / quota_per_unit)`
- Output USD per 1M tokens = that input price times `completion_ratio`
- `quota_type` 1, USD per request = `model_price * group_ratio`

Pass a group when the user cares about that group's ratio. When they do not, use `group_ratio` 1 and include the `group_ratio` map so the numbers can be scaled. When `cache_ratio`, `create_cache_ratio`, or `image_ratio` are present, multiply them by the input USD price.

`scripts/aiberm_get.py` implements the same rounding as `quota_to_usd`, `token_price_usd_per_million`, and `request_price_usd`.

## 4. Pick one user GET

| Question | Request |
| --- | --- |
| Who am I, balance, group, affiliate quota | `GET /api/user/self` |
| Groups the user can use | `GET /api/user/self/groups` |
| Model names the user can call | `GET /api/user/models` |
| Model prices | `GET /api/pricing` |
| The user's relay tokens | `GET /api/token/` |
| Search those tokens by name | `GET /api/token/search` |
| One token by id | `GET /api/token/{id}` |
| Auto groups a token may use | `GET /api/token/auto-groups` |
| Usage logs | `GET /api/log/self` |
| Quota sum, RPM, TPM | `GET /api/log/self/stat` |
| Quota by day | `GET /api/data/self` |
| Quota flow in a range | `GET /api/data/flow/self` |
| Top-up records | `GET /api/user/topup/self` |
| Top-up display info | `GET /api/user/topup/info` |
| Current subscription | `GET /api/subscription/self` |
| Visible plans | `GET /api/subscription/plans` |
| Affiliate code | `GET /api/user/aff` |
| Check-in status | `GET /api/user/checkin` |
| Async tasks (video, music) | `GET /api/task/self` |
| Midjourney drawings | `GET /api/mj/self` |

`GET /api/user/self` fields to report: `id`, `username`, `display_name`, `group`, `status`, `role`, `request_count`, `quota`, `used_quota`, `aff_code`, `aff_count`, `aff_quota`, `aff_history_quota`. `data` on `GET /api/user/self/groups` is an object keyed by group name.

`GET /api/user/models` returns model names in `data`. Optional query `group` limits the list to one usable group. `group=auto` asks for the auto-group set.

List tokens with the trailing slash (`GET /api/token/`). A token payload includes `id`, `name`, a masked `key`, `status`, and quota fields. Search with `keyword` on `GET /api/token/search`. `GET /api/token/{id}` is the same shape for one id the user owns. `GET /api/token/auto-groups` lists auto groups the user may assign and the max selection count.

Log filters, all optional: `type`, `start_timestamp`, `end_timestamp`, `model_name`, `token_name`, `group`, `request_id`, `upstream_request_id`. Log `type`: `0` all, `1` top-up, `2` consume, `3` manage, `4` system, `5` error, `6` refund. Do not send `channel` or `username`. When both timestamps are set, `end_timestamp` must be greater than or equal to `start_timestamp`. The instance can reject a range longer than its log window.

`GET /api/data/self` takes the same timestamp pair. `GET /api/data/flow/self` requires both timestamps.

`GET /api/user/topup/self` accepts `p`, `page_size`, and `keyword`. `GET /api/user/topup/info` is display info such as enabled amounts. It does not create a payment.

`GET /api/subscription/plans` lists plans visible to the user and does not buy one. `GET /api/user/checkin` is status only.

Read `aff_code` from `GET /api/user/self` first. Call `GET /api/user/aff` only when that code is empty. On current New API, `data` from `GET /api/user/aff` is the code string, and the GET can generate a code when the user does not have one yet.

`GET /api/task/self` accepts `p`, `page_size`, `platform`, `task_id`, `status`, `action`, `start_timestamp`, and `end_timestamp`. `GET /api/mj/self` accepts `p`, `page_size`, and `mj_id`.

### Example curls

Balance and profile:

```bash
curl -sS "$NEW_API_BASE_URL/api/user/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Groups:

```bash
curl -sS "$NEW_API_BASE_URL/api/user/self/groups" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Models for one group:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/user/models" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "group=default"
```

Pricing catalog:

```bash
curl -sS "$NEW_API_BASE_URL/api/pricing" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Token list:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/token/" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

Token search:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/token/search" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "keyword=prod" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

One token. Replace `{id}` with the numeric id:

```bash
curl -sS "$NEW_API_BASE_URL/api/token/{id}" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Token auto groups:

```bash
curl -sS "$NEW_API_BASE_URL/api/token/auto-groups" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Usage logs:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/log/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20" \
  --data-urlencode "type=2" \
  --data-urlencode "model_name=gpt-4o"
```

Usage stats:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/log/self/stat" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "type=2"
```

Daily usage:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/data/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "start_timestamp=1711929600" \
  --data-urlencode "end_timestamp=1714521600"
```

Usage flow:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/data/flow/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "start_timestamp=1711929600" \
  --data-urlencode "end_timestamp=1714521600"
```

Top-ups:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/user/topup/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

Top-up info:

```bash
curl -sS "$NEW_API_BASE_URL/api/user/topup/info" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Subscription:

```bash
curl -sS "$NEW_API_BASE_URL/api/subscription/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Plans:

```bash
curl -sS "$NEW_API_BASE_URL/api/subscription/plans" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Affiliate code, only when `aff_code` from `GET /api/user/self` is empty:

```bash
curl -sS "$NEW_API_BASE_URL/api/user/aff" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Check-in status:

```bash
curl -sS "$NEW_API_BASE_URL/api/user/checkin" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Tasks:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/task/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

Drawings:

```bash
curl -sS -G "$NEW_API_BASE_URL/api/mj/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

## 5. Redact before you answer

- Replace `NEW_API_ACCESS_TOKEN` with `[redacted]` if it appears in output or errors.
- Replace a full relay key (`sk-` plus a long unmasked secret) with `sk-[redacted]`.
- Leave New API masked token keys as returned. They contain `****` (for example `sk-abc****wxyz`).
- Do not call a key-reveal route to fill in a masked key.
- Do not echo the access token in the chat.

## 6. Refuse out of scope

These are admin or secret-revealing surfaces. Do not call them, and do not draft a client config that calls them:

- Channels: `GET /api/channel/` and the rest of `/api/channel/`
- All users: `GET /api/user/` and `GET /api/user/search`
- Redemptions: `GET /api/redemption/` and the rest of `/api/redemption/`
- System options: `GET /api/option/` and `PUT /api/option/`
- Key reveal: `POST /api/token/{id}/key` and `POST /api/token/batch/keys`
- Payment creation: `POST /api/user/pay`, `POST /api/user/stripe/pay`, and other `/api/user/*/pay` or `/api/subscription/*/pay` routes

Also stay inside the GET catalog above. Creating, updating, or deleting tokens, `POST /api/user/topup`, `POST /api/user/checkin`, and buying a subscription are outside this skill.

If the user asks for an out-of-scope action, say so and stop. Offer the matching read from the catalog when one exists (top-up info, check-in status, masked tokens, subscription state).

## Optional wrapper

`scripts/aiberm_get.py` next to this file is a thin GET wrapper. It checks the allowlist, sends the two headers, and redacts stdout. From a checkout of [aiberm-skill](https://github.com/aiberm/aiberm-skill) the same file is `skills/aiberm/scripts/aiberm_get.py`.

```bash
python3 scripts/aiberm_get.py --dry-run /api/user/self
python3 scripts/aiberm_get.py /api/user/self
python3 scripts/aiberm_get.py /api/log/self p=1 page_size=20 type=2
```

`--dry-run` prints the URL and header names with the token replaced by `[redacted]`. Exit `0` is success, `1` is an upstream failure, `2` is local configuration or a refused path.
