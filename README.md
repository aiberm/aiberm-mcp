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

Copy `skills/aiberm` into your agent's Skills folder, then start a new session:

```bash
git clone https://github.com/aiberm/aiberm-skill.git

# Claude Code
mkdir -p ~/.claude/skills && cp -R aiberm-skill/skills/aiberm ~/.claude/skills/

# Codex
mkdir -p ~/.agents/skills && cp -R aiberm-skill/skills/aiberm ~/.agents/skills/

# Grok Build
mkdir -p ~/.grok/skills && cp -R aiberm-skill/skills/aiberm ~/.grok/skills/
```

Run only the lines for the agents you use. Call it directly with `/aiberm` in Claude Code and Grok Build, or `$aiberm` in Codex. To update, run `git pull` in `aiberm-skill` and copy the folder again.

[`examples/self.sh`](examples/self.sh) is the profile request as a script.

## Security

The system access token can do everything your dashboard session can, including admin actions if the account is an admin. Prefer a regular account for agent use. The skill tells the agent to confirm every token change with you first, and never to call `GET /api/user/token`, which resets the system access token.
