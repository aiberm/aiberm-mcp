#!/usr/bin/env python3
"""GET one Aiberm account endpoint.

Callers set AIBERM_ACCESS_TOKEN only. The host is https://aiberm.com.
The script reads the numeric account id from GET /api/user/self (data.id).
When Aiberm requires an account header, that id is sent as New-Api-User.
That header name is an Aiberm HTTP header, not a product name.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping

BASE_URL = "https://aiberm.com"
QUOTA_PER_USD = 500_000
USER_AGENT = "aiberm-skill/1.0"
# Aiberm account header. The value is data.id from GET /api/user/self.
ACCOUNT_HEADER = "New-Api-User"
MAX_RESPONSE_BYTES = 20_000_000
TIMEOUT_SECONDS = 30

USER_PATHS = frozenset(
    {
        "/api/user/self",
        "/api/user/self/groups",
        "/api/user/models",
        "/api/user/topup/info",
        "/api/user/topup/self",
        "/api/pricing",
        "/api/token/",
        "/api/token/search",
        "/api/token/auto-groups",
        "/api/log/self",
        "/api/log/self/stat",
        "/api/data/self",
        "/api/data/flow/self",
    }
)

TOKEN_ID_PATH = re.compile(r"^/api/token/[1-9]\d*$")
QUERY_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SK_SECRET = re.compile(r"sk-[A-Za-z0-9_-]{16,}")
ACCOUNT_ID = re.compile(r"^[1-9]\d*$")

SECRET_FIELDS = frozenset(
    {
        "key",
        "access_token",
        "refresh_token",
        "password",
        "passwd",
        "secret",
        "api_key",
        "authorization",
    }
)

USAGE = """\
usage: aiberm_get.py [--dry-run] PATH [key=value ...]

GET one Aiberm account endpoint on https://aiberm.com.
Reads AIBERM_ACCESS_TOKEN (dashboard 系统访问令牌).
The account id comes from GET /api/user/self. Refuses paths outside
the signed-in user's allowlist. Does not print the access token.
"""


class ConfigError(ValueError):
    """Missing or invalid local configuration."""


class UserPathError(ValueError):
    """The request is outside the account allowlist or cannot be sent."""


def round_usd(value: float) -> float:
    return round(value, 6)


def quota_to_usd(quota: float) -> float:
    """Aiberm balance units to USD. 500000 quota = $1."""
    if not math.isfinite(quota):
        raise ValueError("quota must be finite")
    return round_usd(quota / QUOTA_PER_USD)


def token_price_usd_per_million(model_ratio: float, group_ratio: float = 1.0) -> float:
    """USD per 1M input tokens: model_ratio * group_ratio * (1000000 / 500000)."""
    return round_usd(model_ratio * group_ratio * (1_000_000 / QUOTA_PER_USD))


def request_price_usd(model_price: float, group_ratio: float = 1.0) -> float:
    """USD per request when quota_type is 1: model_price * group_ratio."""
    return round_usd(model_price * group_ratio)


def redact_text(value: str, access_token: str | None = None) -> str:
    if access_token:
        value = value.replace(access_token, "[redacted]")

    def repl(match: re.Match[str]) -> str:
        start, end = match.span()
        nearby = value[max(0, start - 8) : end + 8]
        if "****" in nearby:
            return match.group(0)
        return "sk-[redacted]"

    return SK_SECRET.sub(repl, value)


def redact_data(value: object, access_token: str | None = None) -> object:
    if isinstance(value, str):
        return redact_text(value, access_token)
    if isinstance(value, list):
        return [redact_data(item, access_token) for item in value]
    if isinstance(value, dict):
        redacted: dict[object, object] = {}
        for key, child in value.items():
            if (
                isinstance(key, str)
                and isinstance(child, str)
                and key.lower() in SECRET_FIELDS
                and "****" not in child
            ):
                redacted[key] = "***"
                continue
            redacted[key] = redact_data(child, access_token)
        return redacted
    return value


def format_body(text: str, access_token: str | None) -> tuple[str, object, bool]:
    """Return redacted text, parsed JSON (or None), and whether success is false."""
    stripped = text.strip()
    if not stripped:
        return "", None, False
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        return redact_text(stripped, access_token), None, False
    failed = isinstance(payload, dict) and payload.get("success") is False
    rendered = json.dumps(redact_data(payload, access_token), ensure_ascii=False, indent=2)
    return rendered, payload, failed


def normalize_user_path(path: str) -> str:
    if not isinstance(path, str) or path == "":
        raise UserPathError("path is required")
    if path != path.strip() or any(ord(char) < 32 for char in path):
        raise UserPathError("path is invalid")
    if "?" in path or "#" in path:
        raise UserPathError("pass query parameters as key=value arguments")
    if "%" in path:
        raise UserPathError("path must not be percent-encoded")
    if not path.startswith("/") or "\\" in path or "//" in path:
        raise UserPathError("path must be an absolute API path")
    if any(part in (".", "..") for part in path.split("/")):
        raise UserPathError("path must not contain . or ..")
    if path == "/api/token":
        path = "/api/token/"
    if path in USER_PATHS or TOKEN_ID_PATH.fullmatch(path):
        return path
    raise UserPathError(f"refusing path outside the user API allowlist: {path}")


def parse_query(args: list[str]) -> dict[str, str]:
    query: dict[str, str] = {}
    for arg in args:
        if arg.startswith("-") or "=" not in arg:
            raise ConfigError("expected key=value query arguments")
        key, value = arg.split("=", 1)
        if not QUERY_NAME.fullmatch(key):
            raise ConfigError("invalid query name")
        if len(value) > 500 or any(ord(char) < 32 for char in value):
            raise ConfigError("invalid query value")
        query[key] = value
    return query


def load_token(env: Mapping[str, str]) -> str:
    token = env.get("AIBERM_ACCESS_TOKEN", "")
    if token == "" or token != token.strip() or any(char in token for char in "\r\n") or len(token) > 4096:
        raise ConfigError("AIBERM_ACCESS_TOKEN is missing or invalid")
    return token


def build_url(path: str, query: Mapping[str, str], base_url: str = BASE_URL) -> str:
    url = base_url.rstrip("/") + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    return url


def account_header_required(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    message = payload.get("message")
    return isinstance(message, str) and ACCOUNT_HEADER in message


def account_id_from_payload(payload: object) -> str | None:
    if not isinstance(payload, dict) or payload.get("success") is False:
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    user_id = data.get("id")
    if isinstance(user_id, bool):
        return None
    if isinstance(user_id, int) and user_id > 0:
        return str(user_id)
    if isinstance(user_id, str) and ACCOUNT_ID.fullmatch(user_id):
        return user_id
    return None


def account_id_from_token(token: str) -> str | None:
    """Read id, user_id, uid, or sub from a JWT payload. Opaque tokens return None."""
    parts = token.split(".")
    if len(parts) != 3 or not parts[1]:
        return None
    padded = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(decoded.decode("utf-8"))
    except (ValueError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    for key in ("id", "user_id", "uid", "sub"):
        value = payload.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int) and value > 0:
            return str(value)
        if isinstance(value, str) and ACCOUNT_ID.fullmatch(value):
            return value
    return None


def dry_run_text(token: str, path: str, query: Mapping[str, str]) -> str:
    url = redact_text(build_url(path, query), token)
    lines = [
        f"GET {url}",
        "Accept: application/json",
        "Authorization: Bearer [redacted]",
        "User-Agent: " + USER_AGENT,
    ]
    if path != "/api/user/self":
        lines.append("account id: read from GET /api/user/self before this call")
    return "\n".join(lines)


def _read_limited(response: object) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(65536)  # type: ignore[attr-defined]
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_RESPONSE_BYTES:
            raise UserPathError("response exceeds 20MB")
        chunks.append(chunk)
    return b"".join(chunks)


class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        fp.close()
        raise UserPathError(f"refusing redirect ({code})")


def _opener(opener: urllib.request.OpenerDirector | None) -> urllib.request.OpenerDirector:
    return opener or urllib.request.build_opener(_RefuseRedirect)


def raw_get(
    token: str,
    path: str,
    query: Mapping[str, str],
    *,
    account_id: str | None,
    base_url: str,
    opener: urllib.request.OpenerDirector | None,
) -> tuple[int, str, object]:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": USER_AGENT,
    }
    if account_id:
        headers[ACCOUNT_HEADER] = account_id
    request = urllib.request.Request(
        build_url(path, query, base_url),
        method="GET",
        headers=headers,
    )
    try:
        with _opener(opener).open(request, timeout=TIMEOUT_SECONDS) as response:
            raw = _read_limited(response)
            status = getattr(response, "status", 200)
    except urllib.error.HTTPError as exc:
        try:
            raw = _read_limited(exc)
        except UserPathError as err:
            return 1, redact_text(str(err), token), None
        text, payload, _failed = format_body(raw.decode("utf-8", "replace"), token)
        return 1, text or f"HTTP {exc.code}", payload
    except UserPathError:
        raise
    except Exception as exc:
        return 1, redact_text(f"{exc.__class__.__name__}: {exc}", token), None
    text, payload, failed = format_body(raw.decode("utf-8", "replace"), token)
    if status < 200 or status >= 300 or failed:
        return 1, text or f"HTTP {status}", payload
    return 0, text, payload


def resolve_account_id(
    token: str,
    *,
    base_url: str,
    opener: urllib.request.OpenerDirector | None,
) -> tuple[str | None, int, str, object]:
    """Return (account id, status, redacted body, payload) for GET /api/user/self.

    Bearer-only is tried first. If Aiberm asks for the account header and the
    token is a JWT carrying the id, one retry sends that id.
    """
    code, text, payload = raw_get(token, "/api/user/self", {}, account_id=None, base_url=base_url, opener=opener)
    account_id = account_id_from_payload(payload)
    if account_id or not account_header_required(payload):
        return account_id, code, text, payload
    guessed = account_id_from_token(token)
    if not guessed:
        return None, code, text, payload
    code, text, payload = raw_get(
        token,
        "/api/user/self",
        {},
        account_id=guessed,
        base_url=base_url,
        opener=opener,
    )
    return account_id_from_payload(payload) or guessed, code, text, payload


def execute(
    token: str,
    path: str,
    query: Mapping[str, str] | None = None,
    *,
    base_url: str = BASE_URL,
    opener: urllib.request.OpenerDirector | None = None,
) -> tuple[int, str]:
    path = normalize_user_path(path)
    query = dict(query or {})
    if path == "/api/user/self" and not query:
        _account_id, code, text, _payload = resolve_account_id(token, base_url=base_url, opener=opener)
        return code, text
    account_id, probe_code, probe_text, _payload = resolve_account_id(token, base_url=base_url, opener=opener)
    if account_id is None and probe_code != 0:
        return probe_code or 1, probe_text
    code, text, _payload = raw_get(
        token,
        path,
        query,
        account_id=account_id,
        base_url=base_url,
        opener=opener,
    )
    return code, text


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] in ("-h", "--help"):
        print(USAGE, end="")
        return 0
    dry_run = False
    if args and args[0] == "--dry-run":
        dry_run = True
        args = args[1:]
    if not args or args[0].startswith("-"):
        print(USAGE, end="", file=sys.stderr)
        return 2
    path_arg, query_args = args[0], args[1:]
    token_for_errors = os.environ.get("AIBERM_ACCESS_TOKEN")
    try:
        token = load_token(os.environ)
        path = normalize_user_path(path_arg)
        query = parse_query(query_args)
    except (ConfigError, UserPathError) as exc:
        print(redact_text(str(exc), token_for_errors), file=sys.stderr)
        return 2
    if dry_run:
        print(dry_run_text(token, path, query))
        return 0
    try:
        code, body = execute(token, path, query)
    except UserPathError as exc:
        print(redact_text(str(exc), token), file=sys.stderr)
        return 2
    if body:
        print(body)
    return code


if __name__ == "__main__":
    sys.exit(main())
