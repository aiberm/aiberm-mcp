# aiberm-skill

Agent skill for an [Aiberm](https://aiberm.com) account. It reads the signed-in user's balance (余额), models (模型), tokens (令牌), usage (用量), pricing, and top-ups, and can create, edit, enable, disable, or delete the user's API tokens. The skill is a single [`SKILL.md`](skills/aiberm/SKILL.md) that teaches the agent to call the Aiberm API with curl.

Repository: https://github.com/aiberm/aiberm-skill

## Set the credentials

On [aiberm.com](https://aiberm.com), open 个人设置 (personal settings). The `ID` is shown at the top. Generate the system access token (系统访问令牌) on the same page. Export both where the agent runs:

```bash
export AIBERM_ACCESS_TOKEN="your-system-access-token"
export AIBERM_USER_ID="123"
```

Aiberm needs both on every account request, and they must belong to the same user. [`.env.example`](.env.example) lists them. `.env` is gitignored.

## Install

Paste this prompt into Claude Code, Codex, Grok Build, or another agent, and let it install the Skill:

```text
Install the Aiberm Skill from https://github.com/aiberm/aiberm-skill: copy its skills/aiberm folder into the folder you load Skills from.
```

Then start a new session. Call it directly with `/aiberm` in Claude Code and Grok Build, or `$aiberm` in Codex. To update, send the same prompt again.

[`examples/self.sh`](examples/self.sh) is the profile request as a script.

## Security

The system access token can do everything your dashboard session can, including admin actions if the account is an admin. Prefer a regular account for agent use. The skill tells the agent to confirm every token change with you first, and never to call `GET /api/user/token`, which resets the system access token.
