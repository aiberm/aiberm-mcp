# aiberm-skill

Agent skill for an [Aiberm](https://aiberm.com) account. It reads the signed-in user's balance (余额), models (模型), tokens (令牌), usage (用量), pricing, and top-ups. The skill is a single [`SKILL.md`](skills/aiberm/SKILL.md) that teaches the agent to call the Aiberm API with curl.

Repository: https://github.com/aiberm/aiberm-skill

## Set the credentials

On [aiberm.com](https://aiberm.com), open 个人设置 (personal settings). The `ID` is shown at the top. Generate the system access token (系统访问令牌) on the same page. Export both where the agent runs:

```bash
export AIBERM_ACCESS_TOKEN="your-system-access-token"
export AIBERM_USER_ID="123"
```

Aiberm needs both on every account request, and they must belong to the same user. [`.env.example`](.env.example) lists them. `.env` is gitignored.

## Install

```bash
mkdir -p ~/.claude/skills
cp -R skills/aiberm ~/.claude/skills/aiberm
```

The same folder works under `~/.cursor/skills/`, `~/.codex/skills/`, or a project's `.claude/skills/`.

[`examples/self.sh`](examples/self.sh) is the profile request as a script.

## Security

The system access token can do everything your dashboard session can, including admin actions if the account is an admin. Prefer a regular account for agent use. `GET /api/user/token` resets the token; the skill tells the agent never to call it.
