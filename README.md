# aiberm-skill

User-side agent skill for a [New API](https://github.com/QuantumNous/new-api) account on [aiberm.com](https://aiberm.com).

An agent loads [`skills/aiberm/SKILL.md`](skills/aiberm/SKILL.md) and calls the signed-in user's HTTP API with `curl` or `fetch`. The skill covers balance, groups, models, pricing, masked tokens, usage, top-ups, subscription, affiliate, check-in status, tasks, and drawings.

Repository: https://github.com/aiberm/aiberm-skill

The MCP server in [PR #1](https://github.com/aiberm/aiberm-skill/pull/1) was abandoned. Install this skill and call the user API directly.

## How an agent uses it

1. Install the skill directory so the agent can read `SKILL.md`.
2. Export the environment variables below in the environment the agent runs in.
3. Follow the skill. Each catalog entry is a `GET` with `Authorization: Bearer <access_token>` and `New-Api-User: <numeric user id>`.
4. Redact the access token and any full `sk-` key before showing the response. Leave masked token keys that contain `****` as returned.

Install into an agent skills directory (Cursor, Claude, Codex, or another Agent Skills host):

```bash
mkdir -p ~/.cursor/skills
cp -R skills/aiberm ~/.cursor/skills/aiberm
```

The same folder works at `.cursor/skills/aiberm`, `.agents/skills/aiberm`, `~/.claude/skills/aiberm`, or `~/.codex/skills/aiberm`. The skill `name` is `aiberm`.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `NEW_API_BASE_URL` | no | Origin only. Default `https://aiberm.com`. |
| `NEW_API_ACCESS_TOKEN` | yes | Dashboard system access token (系统访问令牌). |
| `NEW_API_USER_ID` | yes | Numeric user id sent as `New-Api-User`. |
| `NEW_API_QUOTA_PER_UNIT` | no | Quota units per 1 USD. Default `500000`. |

Copy [`.env.example`](.env.example) and fill it in outside git. `.env` is gitignored.

The access token comes from the dashboard: personal settings → security → system access token (系统访问令牌). It is a different credential from a relay key. Relay keys start with `sk-` and call `https://aiberm.com/v1`. This skill does not call the relay and does not reveal those keys.

`quota` on `GET /api/user/self` is the remaining balance. `used_quota` is cumulative consumption. Do not subtract `used_quota` from `quota`. USD = `quota / NEW_API_QUOTA_PER_UNIT`, rounded to 6 decimal places. A `quota` of `2500000` at the default `500000` is $5.00 remaining. A `used_quota` of `500000` is $1.00 spent.

Per-token input USD per 1M tokens is `model_ratio * group_ratio * (1000000 / quota_per_unit)`. Per-request models (`quota_type` 1) use `model_price * group_ratio`.

## Example curls

Profile and remaining balance:

```bash
curl -sS "$NEW_API_BASE_URL/api/user/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID"
```

Recent consume logs (`type=2`). The page parameter is `p`.

```bash
curl -sS -G "$NEW_API_BASE_URL/api/log/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $NEW_API_ACCESS_TOKEN" \
  -H "New-Api-User: $NEW_API_USER_ID" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20" \
  --data-urlencode "type=2"
```

[`examples/self.sh`](examples/self.sh) is the profile request as a script. Do not add `curl -v` or shell trace; those print the access token.

[`skills/aiberm/SKILL.md`](skills/aiberm/SKILL.md) has a curl for every user endpoint, the query parameters, and the quota rules. The optional wrapper `skills/aiberm/scripts/aiberm_get.py` sends the same GET, refuses anything outside the allowlist, and redacts stdout:

```bash
python3 skills/aiberm/scripts/aiberm_get.py /api/user/self
python3 skills/aiberm/scripts/aiberm_get.py /api/log/self p=1 page_size=20 type=2
```

## User endpoints

| Purpose | Request |
| --- | --- |
| Profile and balance | `GET /api/user/self` |
| Usable groups | `GET /api/user/self/groups` |
| Model names | `GET /api/user/models` |
| Pricing | `GET /api/pricing` |
| Relay tokens (masked keys) | `GET /api/token/` |
| Search own tokens | `GET /api/token/search` |
| One token | `GET /api/token/{id}` |
| Token auto groups | `GET /api/token/auto-groups` |
| Usage logs | `GET /api/log/self` |
| Usage sum, RPM, TPM | `GET /api/log/self/stat` |
| Usage by day | `GET /api/data/self` |
| Usage flow | `GET /api/data/flow/self` |
| Top-up records | `GET /api/user/topup/self` |
| Top-up display info | `GET /api/user/topup/info` |
| Subscription | `GET /api/subscription/self` |
| Plans | `GET /api/subscription/plans` |
| Affiliate code | `GET /api/user/aff` |
| Check-in status | `GET /api/user/checkin` |
| Async tasks | `GET /api/task/self` |
| Drawings | `GET /api/mj/self` |

## Security

- Send the system access token only in the `Authorization` header. `New-Api-User` is the numeric id and must match that token.
- Do not log, commit, or paste `NEW_API_ACCESS_TOKEN`.
- Redact full `sk-` keys if a response contains one. A masked token key contains `****` and stays as returned.
- `GET /api/user/aff` can create an affiliate code when the user does not have one. Read `aff_code` from `GET /api/user/self` first.
- Treat `"success": false` as a failure even on HTTP 200.

## Out of scope

Do not call admin or payment routes:

- Channels: `GET /api/channel/`
- All users: `GET /api/user/` and `GET /api/user/search`
- Redemptions: `GET /api/redemption/`
- System options: `GET /api/option/` and `PUT /api/option/`
- Key reveal: `POST /api/token/{id}/key` and `POST /api/token/batch/keys`
- Payment creation: `POST /api/user/pay`, `POST /api/user/stripe/pay`, and other pay routes under `/api/user/` or `/api/subscription/`

Token create, update, and delete, `POST /api/user/topup`, `POST /api/user/checkin`, and subscription purchase are outside the skill. The read that matches a question (masked tokens, top-up info, check-in status, subscription state) is in the table above.

## Tests

```bash
python3 -m unittest discover -s test -v
```

The tests check the GET allowlist, redaction, a loopback HTTP call, and that the README and skill name the same user paths.
