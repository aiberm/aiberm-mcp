---
name: aiberm
description: >-
  Look up the signed-in user's Aiberm account at aiberm.com: balance (余额),
  groups, models (模型), pricing, masked tokens (令牌), usage (用量),
  top-ups, subscription, affiliate code, check-in status, tasks, and
  drawings. Use when the user asks about their Aiberm 余额, 模型, 令牌,
  用量, or billing. Call https://aiberm.com with AIBERM_ACCESS_TOKEN, the
  dashboard system access token (系统访问令牌). Refuse admin channels,
  all-user lists, redemptions, system options, key reveal, and payment
  creation.
---

# Aiberm account

用户问 Aiberm 的余额、模型、令牌、用量、充值或订阅时，按本技能调用 https://aiberm.com。只设置 `AIBERM_ACCESS_TOKEN`（控制台「系统访问令牌」）。不要向用户索要数字 id。

This skill reads the signed-in user's own Aiberm account: balance, models, tokens, and usage. It does not administer the site, reveal full model keys, or create payments.

## 1. Credential

| Variable | Required | Meaning |
| --- | --- | --- |
| `AIBERM_ACCESS_TOKEN` | yes | Dashboard **system access token** (系统访问令牌) from personal settings → security on [aiberm.com](https://aiberm.com). |

The host is always `https://aiberm.com`. There is no base-URL override and no second variable for an account id.

A model key starts with `sk-` and calls `https://aiberm.com/v1`. This skill does not call the model relay and does not reveal `sk-` keys. If the user needs the full model key, they copy it from the Aiberm token page.

Do not invent the token. Do not write it into the repo, commits, or logs. Do not run the shell with trace (`set -x`) and do not add `curl -v`.

The helper reads the numeric account id from `GET /api/user/self` (`data.id`) using only this token. Prefer the helper when you run commands. Direct curls below send the bearer token only.

## 2. Call Aiberm

Every request is `GET` `https://aiberm.com` with:

```bash
curl -sS "https://aiberm.com/api/user/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

From this skill directory:

```bash
python3 scripts/aiberm_get.py /api/user/self
python3 scripts/aiberm_get.py /api/log/self p=1 page_size=20 type=2
```

From a checkout of [aiberm-skill](https://github.com/aiberm/aiberm-skill) the helper is `skills/aiberm/scripts/aiberm_get.py`.

URL-encode query values. With curl, use `-G` and `--data-urlencode` so the request stays a GET. A JSON object with `"success": false` is a failure even when HTTP status is 200. Show `message` after redaction.

Successful JSON is usually:

```json
{"success": true, "message": "", "data": {}}
```

Paginated `data` uses `page`, `page_size`, `total`, and `items`. The page query parameter is `p` (not `page`). `page_size` defaults to 20 and the maximum you should send is 100. Timestamps are unix seconds.

### How the account id is obtained

1. `GET /api/user/self` with `Authorization: Bearer $AIBERM_ACCESS_TOKEN`.
2. The account id is `data.id` in that response.
3. If Aiberm requires its account header, the helper sends `data.id` on that header and retries once. A JWT system token can supply the same id when the profile call asks for the header before it returns a body. Opaque tokens use the profile response.
4. Do not ask the user for a numeric id, and do not invent one.

## 3. Read balance as USD

`quota` on the profile is the **remaining balance (余额)** in Aiberm units. `used_quota` is cumulative consumption. Do not subtract `used_quota` from `quota`.

```text
USD = quota / 500000
```

Round to 6 decimal places. `500000` quota is $1. A `quota` of `2500000` is $5 remaining. A `used_quota` of `500000` is $1 spent. The same divisor applies to `remain_quota`, `aff_quota`, and `aff_history_quota`.

On `GET /api/log/self/stat`, `quota` is consumption inside the filter, not the wallet balance.

A token's `remain_quota` is that token's own allowance, separate from the account balance.

### Model prices

`GET /api/pricing` returns model rows in `data` and `group_ratio` on the same object. The payload is large. If the user named a model, keep rows whose `model_name` contains that string, case-insensitively, and show at most 25 rows otherwise. Keep a row for a group when `enable_groups` contains that group or `all`, or when `enable_groups` is empty.

- `quota_type` 0, USD per 1M input tokens = `model_ratio * group_ratio * (1000000 / 500000)`
- Output USD per 1M tokens = that input price times `completion_ratio`
- `quota_type` 1, USD per request = `model_price * group_ratio`

When the user names a group, use that group's ratio. Otherwise use ratio 1 and include the `group_ratio` map. When `cache_ratio`, `create_cache_ratio`, or `image_ratio` are present, multiply them by the input USD price.

`scripts/aiberm_get.py` implements the same rounding as `quota_to_usd`, `token_price_usd_per_million`, and `request_price_usd`.

## 4. Pick one account GET

| Question | Request |
| --- | --- |
| Who am I, balance (余额), group, affiliate quota | `GET /api/user/self` |
| Groups the user can use | `GET /api/user/self/groups` |
| Model names (模型) the user can call | `GET /api/user/models` |
| Model prices | `GET /api/pricing` |
| The user's model tokens (令牌) | `GET /api/token/` |
| Search those tokens by name | `GET /api/token/search` |
| One token by id | `GET /api/token/{id}` |
| Auto groups a token may use | `GET /api/token/auto-groups` |
| Usage logs (用量) | `GET /api/log/self` |
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

Log filters, all optional: `type`, `start_timestamp`, `end_timestamp`, `model_name`, `token_name`, `group`, `request_id`, `upstream_request_id`. Log `type`: `0` all, `1` top-up, `2` consume, `3` manage, `4` system, `5` error, `6` refund. Do not send `channel` or `username`. When both timestamps are set, `end_timestamp` must be greater than or equal to `start_timestamp`. Aiberm can reject a range longer than its log window.

`GET /api/data/self` takes the same timestamp pair. `GET /api/data/flow/self` requires both timestamps.

`GET /api/user/topup/self` accepts `p`, `page_size`, and `keyword`. `GET /api/user/topup/info` is display info such as enabled amounts. It does not create a payment.

`GET /api/subscription/plans` lists plans visible to the user and does not buy one. `GET /api/user/checkin` is status only.

Read `aff_code` from `GET /api/user/self` first. Call `GET /api/user/aff` only when that code is empty. `data` from `GET /api/user/aff` is the code string, and that GET can generate a code when the user does not have one yet.

`GET /api/task/self` accepts `p`, `page_size`, `platform`, `task_id`, `status`, `action`, `start_timestamp`, and `end_timestamp`. `GET /api/mj/self` accepts `p`, `page_size`, and `mj_id`.

### Example curls

Profile and balance:

```bash
curl -sS "https://aiberm.com/api/user/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Groups:

```bash
curl -sS "https://aiberm.com/api/user/self/groups" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Models for one group:

```bash
curl -sS -G "https://aiberm.com/api/user/models" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "group=default"
```

Pricing catalog:

```bash
curl -sS "https://aiberm.com/api/pricing" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Token list:

```bash
curl -sS -G "https://aiberm.com/api/token/" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

Token search:

```bash
curl -sS -G "https://aiberm.com/api/token/search" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "keyword=prod" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

One token. Replace `{id}` with the numeric id:

```bash
curl -sS "https://aiberm.com/api/token/{id}" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Token auto groups:

```bash
curl -sS "https://aiberm.com/api/token/auto-groups" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Usage logs:

```bash
curl -sS -G "https://aiberm.com/api/log/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20" \
  --data-urlencode "type=2" \
  --data-urlencode "model_name=gpt-4o"
```

Usage stats:

```bash
curl -sS -G "https://aiberm.com/api/log/self/stat" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "type=2"
```

Daily usage:

```bash
curl -sS -G "https://aiberm.com/api/data/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "start_timestamp=1711929600" \
  --data-urlencode "end_timestamp=1714521600"
```

Usage flow:

```bash
curl -sS -G "https://aiberm.com/api/data/flow/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "start_timestamp=1711929600" \
  --data-urlencode "end_timestamp=1714521600"
```

Top-ups:

```bash
curl -sS -G "https://aiberm.com/api/user/topup/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

Top-up info:

```bash
curl -sS "https://aiberm.com/api/user/topup/info" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Subscription:

```bash
curl -sS "https://aiberm.com/api/subscription/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Plans:

```bash
curl -sS "https://aiberm.com/api/subscription/plans" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Affiliate code, only when `aff_code` from `GET /api/user/self` is empty:

```bash
curl -sS "https://aiberm.com/api/user/aff" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Check-in status:

```bash
curl -sS "https://aiberm.com/api/user/checkin" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Tasks:

```bash
curl -sS -G "https://aiberm.com/api/task/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

Drawings:

```bash
curl -sS -G "https://aiberm.com/api/mj/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20"
```

## 5. Redact before you answer

- Replace `AIBERM_ACCESS_TOKEN` with `[redacted]` if it appears in output or errors.
- Replace a full model key (`sk-` plus a long unmasked secret) with `sk-[redacted]`.
- Leave masked token keys as returned. They contain `****` (for example `sk-abc****wxyz`).
- Do not call a key-reveal route to fill in a masked key.
- Do not echo the access token in the chat.

## 6. Refuse out of scope

These are admin or secret-revealing surfaces. Do not call them:

- Channels: `GET /api/channel/` and the rest of `/api/channel/`
- All users: `GET /api/user/` and `GET /api/user/search`
- Redemptions: `GET /api/redemption/` and the rest of `/api/redemption/`
- System options: `GET /api/option/` and `PUT /api/option/`
- Key reveal: `POST /api/token/{id}/key` and `POST /api/token/batch/keys`
- Payment creation: `POST /api/user/pay`, `POST /api/user/stripe/pay`, and other `/api/user/*/pay` or `/api/subscription/*/pay` routes

Also stay inside the GET catalog above. Creating, updating, or deleting tokens, `POST /api/user/topup`, `POST /api/user/checkin`, and buying a subscription are outside this skill.

If the user asks for an out-of-scope action, say so and stop. Offer the matching read from the catalog when one exists (top-up info, check-in status, masked tokens, subscription state).

## Helper exit codes

`scripts/aiberm_get.py` checks the allowlist, sends the bearer token, resolves the account id, and redacts stdout. `--dry-run` prints the URL and `Authorization: Bearer [redacted]` and does not call Aiberm. Exit `0` is success, `1` is an upstream failure, `2` is local configuration or a refused path.
