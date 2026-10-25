# aiberm-skill

Agent skill for an [Aiberm](https://aiberm.com) account. It reads the signed-in user's balance (余额), models (模型), tokens (令牌), and usage (用量).

Repository: https://github.com/aiberm/aiberm-skill

Full request list, query parameters, and response fields: [`skills/aiberm/SKILL.md`](skills/aiberm/SKILL.md). The skill `name` is `aiberm`.

## Set the access token

The only credential is `AIBERM_ACCESS_TOKEN`.

| Variable | Required | Meaning |
| --- | --- | --- |
| `AIBERM_ACCESS_TOKEN` | yes | Dashboard system access token (系统访问令牌). |

On [aiberm.com](https://aiberm.com), open personal settings → security → system access token (系统访问令牌), then export it in the environment the agent runs in:

```bash
export AIBERM_ACCESS_TOKEN="your-system-access-token"
```

Copy [`.env.example`](.env.example) and fill it in outside git. `.env` is gitignored.

A model key starts with `sk-` and calls `https://aiberm.com/v1`. This skill does not call the relay and does not reveal those keys.

## Install

Install the skill directory so the agent can read `SKILL.md`:

```bash
mkdir -p ~/.cursor/skills
cp -R skills/aiberm ~/.cursor/skills/aiberm
```

The same folder works at `.cursor/skills/aiberm`, `.agents/skills/aiberm`, `~/.claude/skills/aiberm`, or `~/.codex/skills/aiberm`.

## Use the skill

Each catalog entry is a `GET` against `https://aiberm.com` with `Authorization: Bearer <access_token>`. The account id comes from `GET /api/user/self` (`data.id`). If Aiberm requires its account header, the helper sends that id and retries. You only set `AIBERM_ACCESS_TOKEN`.

Redact the access token and any full `sk-` key before showing a response. Leave masked token keys that contain `****` as returned.

`quota` on `GET /api/user/self` is the remaining balance. `used_quota` is cumulative consumption. Do not subtract `used_quota` from `quota`. USD = `quota / 500000`, rounded to 6 decimal places. A `quota` of `2500000` is $5.00 remaining. A `used_quota` of `500000` is $1.00 spent.

Per-token input USD per 1M tokens is `model_ratio * group_ratio * (1000000 / 500000)`. Per-request models (`quota_type` 1) use `model_price * group_ratio`.

### Example curls

Profile and remaining balance:

```bash
curl -sS "https://aiberm.com/api/user/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN"
```

Recent consume logs (`type=2`). The page parameter is `p`.

```bash
curl -sS -G "https://aiberm.com/api/log/self" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  --data-urlencode "p=1" \
  --data-urlencode "page_size=20" \
  --data-urlencode "type=2"
```

[`examples/self.sh`](examples/self.sh) is the profile request as a script. Do not add `curl -v` or shell trace; those print the access token.

[`skills/aiberm/SKILL.md`](skills/aiberm/SKILL.md) has a curl for every account endpoint. The helper `skills/aiberm/scripts/aiberm_get.py` sends the same GET, resolves the account id, refuses anything outside the allowlist, and redacts stdout:

```bash
python3 skills/aiberm/scripts/aiberm_get.py /api/user/self
python3 skills/aiberm/scripts/aiberm_get.py /api/log/self p=1 page_size=20 type=2
```

## Account endpoints

| Purpose | Request |
| --- | --- |
| Profile and balance (余额) | `GET /api/user/self` |
| Usable groups | `GET /api/user/self/groups` |
| Model names (模型) | `GET /api/user/models` |
| Pricing | `GET /api/pricing` |
| Model tokens (令牌), keys masked | `GET /api/token/` |
| Search own tokens | `GET /api/token/search` |
| One token | `GET /api/token/{id}` |
| Token auto groups | `GET /api/token/auto-groups` |
| Usage logs (用量) | `GET /api/log/self` |
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

- Send the system access token only in the `Authorization` header. The helper obtains the account id from the profile response.
- Do not log, commit, or paste `AIBERM_ACCESS_TOKEN`.
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

The tests check the allowlist, redaction, balance math, a loopback HTTP call, account-id resolution, and that the README and skill name the same account paths.
