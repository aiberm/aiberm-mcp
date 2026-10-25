---
name: aiberm
description: >-
  Look up the signed-in user's Aiberm account at aiberm.com: balance (余额),
  models (模型), pricing, tokens (令牌), usage (用量), and top-ups, and create,
  edit, enable, disable, or delete the user's API tokens. Use when the user
  asks about their Aiberm 余额, 模型, 令牌, 用量, or billing, or wants a new
  Aiberm API key. Calls the Aiberm API with AIBERM_ACCESS_TOKEN (系统访问令牌)
  and AIBERM_USER_ID.
---

# Aiberm account

用户问 Aiberm 的余额、模型、令牌、用量或充值，或者要创建、修改、删除 API 令牌时，用 curl 调用 https://aiberm.com 的接口。

## Credentials

- `AIBERM_ACCESS_TOKEN`: the system access token (系统访问令牌) from 个人设置 (personal settings).
- `AIBERM_USER_ID`: the numeric `ID` shown at the top of 个人设置.

If either is missing, ask the user to export it. Never print the token. Do not use `curl -v` or `set -x`.

## Call the API

Every request sends both headers. Aiberm rejects account routes without `New-Api-User`, and the ID must belong to the token's user.

```bash
curl -sS -G "https://aiberm.com/api/log/self" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  -H "New-Api-User: $AIBERM_USER_ID" \
  --data-urlencode "p=1" --data-urlencode "type=2"
```

Responses are `{"success": true, "message": "", "data": ...}`. `"success": false` is a failure even on HTTP 200. If the message mentions `New-Api-User`, `AIBERM_USER_ID` is wrong. `access token 无效` means the token is wrong or was reset.

Paginated `data` is `{page, page_size, total, items}`. The page parameter is `p` (from 1). `page_size` defaults to 10, max 100. Timestamps are unix seconds.

| Question | Request | Notes |
| --- | --- | --- |
| Profile, balance (余额) | `GET /api/user/self` | `quota` is the remaining balance, `used_quota` is total spent |
| Usable groups | `GET /api/user/self/groups` | `data` keyed by group: `{ratio, desc}`. `auto` has ratio `自动` |
| Callable models (模型) | `GET /api/user/models` | list of model names |
| Prices | `GET /api/pricing` | ~40 KB; filter by model name, for example with `jq` |
| Tokens (令牌) | `GET /api/token/` | `p`, `page_size`. Items include the **full** key |
| Search tokens | `GET /api/token/search` | `keyword` (name) or `token` (key); exact unless it has `%` |
| One token | `GET /api/token/{id}` | |
| Usage logs (用量) | `GET /api/log/self` | `p`, `page_size`, `type`, `start_timestamp`, `end_timestamp`, `model_name`, `token_name`, `group` |
| Usage total | `GET /api/log/self/stat` | same filters; sums consume logs only. `rpm`/`tpm` are the last 60 s |
| Hourly usage by model | `GET /api/data/self` | `start_timestamp` and `end_timestamp` required, at most 30 days apart |
| Top-up records | `GET /api/user/topup/self` | `p`, `page_size`, `keyword` (trade number) |
| Top-up options | `GET /api/user/topup/info` | read-only |

Log `type`: `0` all, `1` top-up, `2` consume, `3` manage, `4` system, `5` error, `6` refund.

## Money

`USD = quota / 500000`. This applies to every quota field: `quota`, `used_quota`, `aff_quota`, a token's `remain_quota`, and log `quota`. Do not subtract `used_quota` from `quota`.

Pricing rows from `/api/pricing`:

- `quota_type` 0: input USD per 1M tokens = `model_ratio * group_ratio * 2`. Output = input × `completion_ratio`.
- `quota_type` 1: USD per request = `model_price * group_ratio`.
- `official_input` / `official_output`: the vendor's list price in USD per 1M tokens, when set.

`/api/pricing` ignores the access token, so its `group_ratio` is the anonymous view. Use the user's ratio from `/api/user/self/groups`. A model is available in the groups listed in its `enable_groups`.

## Manage tokens

The user may ask you to create, edit, enable, disable, or delete their API tokens (令牌). Before every write, tell the user exactly what you will send (name, quota in USD, expiry, group, model limits, or which token to delete) and wait for them to confirm.

Writes send JSON, for example:

```bash
curl -sS -X POST "https://aiberm.com/api/token/" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  -H "New-Api-User: $AIBERM_USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app", "unlimited_quota": true, "remain_quota": -1, "expired_time": -1, "group": "auto"}'
```

| Action | Request | Body |
| --- | --- | --- |
| Create | `POST /api/token/` | the fields below |
| Edit | `PUT /api/token/` | the whole token, with `id` |
| Enable or disable | `PUT /api/token/?status_only=true` | `{"id": 12, "status": 1}` (1 enabled, 2 disabled) |
| Delete | `DELETE /api/token/{id}` | none |

Token fields:

- `name`: at most 50 characters.
- `unlimited_quota`: `true` for no cap. Otherwise `remain_quota` is the cap in quota units: $5 is `2500000`.
- `expired_time`: unix seconds, or `-1` for never.
- `group`: a group from `GET /api/user/self/groups`. Without one from the user, use `auto` if it is listed, else `""` (the user's own group).
- `model_limits_enabled` and `model_limits`: to allow only some models, `true` and a comma-separated list of names from `GET /api/user/models`.
- `allow_ips`: allowed client IPs, one per line. `""` allows any.

Without other instructions, create tokens like the console does: unlimited quota and no expiry.

Create returns no key. Afterwards, `GET /api/token/?p=1` lists the newest token first. Find it by name and give the user the full key, which is `sk-` followed by `key`.

Edit replaces every field. `GET /api/token/{id}` first, change only what the user asked, and send the whole object back. A missing `expired_time` or `remain_quota` becomes `0`, which expires the token or empties it.

An expired or exhausted token cannot be enabled until its `expired_time` or quota is changed. Delete cannot be undone, and apps using that key stop working.

## Secrets

- Token responses contain full model keys. Show the full key (`sk-` + `key`) only for a token you just created. Elsewhere show `sk-` plus the first and last four characters, like `sk-abcd****wxyz`. To list tokens without keys: `| jq 'del(.data.items[].key)'`.
- The profile's `setting` can hold a webhook secret or Gotify token. Do not repeat those either.

## Do not call

- `GET /api/user/token`: it **resets** the system access token, and the current one stops working.
- Admin routes such as `/api/channel/`, `/api/option/`, `/api/redemption/`, `/api/log/`, and the user list `/api/user/`.
- Any other write: payments, top-up codes, affiliate transfers, and changes to the account itself. Send the user to the Aiberm dashboard for those.
