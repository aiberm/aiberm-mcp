#!/usr/bin/env python3
"""GET one New API user endpoint for the aiberm skill.

The script sends Authorization and New-Api-User, refuses paths outside the
user allowlist, and redacts the access token and full sk- keys on output.
Masked token keys that contain **** are left as returned.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_BASE_URL = "https://aiberm.com"
DEFAULT_QUOTA_PER_UNIT = 500_000
USER_AGENT = "aiberm-skill/1.0"
MAX_RESPONSE_BYTES = 20_000_000
TIMEOUT_SECONDS = 30

USER_PATHS = frozenset(
    {
        "/api/user/self",
        "/api/user/self/groups",
        "/api/user/models",
        "/api/user/aff",
        "/api/user/topup/info",
        "/api/user/topup/self",
        "/api/user/checkin",
        "/api/pricing",
        "/api/token/",
        "/api/token/search",
        "/api/token/auto-groups",
        "/api/log/self",
        "/api/log/self/stat",
        "/api/data/self",
        "/api/data/flow/self",
        "/api/subscription/self",
        "/api/subscription/plans",
        "/api/task/self",
        "/api/mj/self",
    }
)

TOKEN_ID_PATH = re.compile(r"^/api/token/[1-9]\d*$")
QUERY_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SK_SECRET = re.compile(r"sk-[A-Za-z0-9_-]{16,}")
USER_ID = re.compile(r"^[1-9]\d*$")

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

GET one New API user endpoint. Reads NEW_API_BASE_URL (default
https://aiberm.com), NEW_API_ACCESS_TOKEN, and NEW_API_USER_ID.
Refuses paths outside the user allowlist. Does not print the access token.
See SKILL.md in the parent of this scripts directory.
"""


class ConfigError(ValueError):
    """Missing or invalid local configuration."""


class UserPathError(ValueError):
    """The request is outside the user API allowlist or cannot be sent."""


@dataclass(frozen=True)
class Config:
    base_url: str
    access_token: str
    user_id: str
    quota_per_unit: float


def round_usd(value: float) -> float:
    return round(value, 6)


def quota_to_usd(quota: float, quota_per_unit: float = DEFAULT_QUOTA_PER_UNIT) -> float:
    """Convert a New API quota amount to USD. quota_per_unit quota units = $1."""
    if not math.isfinite(quota):
        raise ValueError("quota must be finite")
    if not math.isfinite(quota_per_unit) or quota_per_unit <= 0:
        raise ValueError("quota_per_unit must be positive")
    return round_usd(quota / quota_per_unit)


def token_price_usd_per_million(
    model_ratio: float,
    group_ratio: float = 1.0,
    quota_per_unit: float = DEFAULT_QUOTA_PER_UNIT,
) -> float:
    """USD per 1M input tokens: model_ratio * group_ratio * (1000000 / quota_per_unit)."""
    if not math.isfinite(quota_per_unit) or quota_per_unit <= 0:
        raise ValueError("quota_per_unit must be positive")
    return round_usd(model_ratio * group_ratio * (1_000_000 / quota_per_unit))


def request_price_usd(model_price: float, group_ratio: float = 1.0) -> float:
    """USD per request for quota_type 1 models: model_price * group_ratio."""
    return round_usd(model_price * group_ratio)


def redact_text(value: str, access_token: str | None = None) -> str:
    if access_token:
        value = value.replace(access_token, "[redacted]")

    def repl(match: re.Match[str]) -> str:
        start, end = match.span()
        # A masked New API key contains ****. Leave that whole key alone,
        # including a long visible prefix that would otherwise match.
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


def format_body(text: str, access_token: str | None) -> tuple[str, bool]:
    """Return redacted body text and whether New API reported success=false."""
    stripped = text.strip()
    if not stripped:
        return "", False
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        return redact_text(stripped, access_token), False
    failed = isinstance(payload, dict) and payload.get("success") is False
    rendered = json.dumps(redact_data(payload, access_token), ensure_ascii=False, indent=2)
    return rendered, failed


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


def parse_base_url(value: str | None) -> str:
    raw = (value or "").strip() or DEFAULT_BASE_URL
    if any(char.isspace() for char in raw):
        raise ConfigError("NEW_API_BASE_URL must not contain whitespace")
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        raise ConfigError("NEW_API_BASE_URL must be an http(s) origin")
    if parsed.username or parsed.password:
        raise ConfigError("NEW_API_BASE_URL must not include credentials")
    if parsed.path not in ("", "/"):
        raise ConfigError("NEW_API_BASE_URL must be an origin without a path")
    if parsed.query or parsed.fragment:
        raise ConfigError("NEW_API_BASE_URL must not include a query or hash")
    return f"{parsed.scheme}://{parsed.netloc}"


def load_config(env: Mapping[str, str]) -> Config:
    token = env.get("NEW_API_ACCESS_TOKEN", "")
    if token == "" or token != token.strip() or any(char in token for char in "\r\n") or len(token) > 4096:
        raise ConfigError("NEW_API_ACCESS_TOKEN is missing or invalid")
    user_id = env.get("NEW_API_USER_ID", "").strip()
    if not USER_ID.fullmatch(user_id):
        raise ConfigError("NEW_API_USER_ID must be the numeric user id")
    quota_raw = env.get("NEW_API_QUOTA_PER_UNIT", "").strip()
    if quota_raw == "":
        quota_per_unit = float(DEFAULT_QUOTA_PER_UNIT)
    else:
        try:
            quota_per_unit = float(quota_raw)
        except ValueError as exc:
            raise ConfigError("NEW_API_QUOTA_PER_UNIT must be a positive number") from exc
        if not math.isfinite(quota_per_unit) or quota_per_unit <= 0:
            raise ConfigError("NEW_API_QUOTA_PER_UNIT must be a positive number")
    return Config(
        base_url=parse_base_url(env.get("NEW_API_BASE_URL")),
        access_token=token,
        user_id=user_id,
        quota_per_unit=quota_per_unit,
    )


def build_url(base_url: str, path: str, query: Mapping[str, str]) -> str:
    url = base_url.rstrip("/") + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    return url


def dry_run_text(config: Config, path: str, query: Mapping[str, str]) -> str:
    url = redact_text(build_url(config.base_url, path, query), config.access_token)
    return "\n".join(
        [
            f"GET {url}",
            "Accept: application/json",
            "Authorization: Bearer [redacted]",
            f"New-Api-User: {config.user_id}",
            f"User-Agent: {USER_AGENT}",
        ]
    )


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


def perform_get(
    config: Config,
    path: str,
    query: Mapping[str, str],
    opener: urllib.request.OpenerDirector | None = None,
) -> tuple[int, str]:
    request = urllib.request.Request(
        build_url(config.base_url, path, query),
        method="GET",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {config.access_token}",
            "New-Api-User": config.user_id,
            "User-Agent": USER_AGENT,
        },
    )
    client = opener or urllib.request.build_opener(_RefuseRedirect)
    try:
        with client.open(request, timeout=TIMEOUT_SECONDS) as response:
            raw = _read_limited(response)
            status = getattr(response, "status", 200)
    except urllib.error.HTTPError as exc:
        try:
            raw = _read_limited(exc)
        except UserPathError as err:
            return 1, redact_text(str(err), config.access_token)
        text, _failed = format_body(raw.decode("utf-8", "replace"), config.access_token)
        return 1, text or f"HTTP {exc.code}"
    except UserPathError:
        raise
    except Exception as exc:
        return 1, redact_text(f"{exc.__class__.__name__}: {exc}", config.access_token)
    text, failed = format_body(raw.decode("utf-8", "replace"), config.access_token)
    if status < 200 or status >= 300 or failed:
        return 1, text or f"HTTP {status}"
    return 0, text


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
    token_for_errors = os.environ.get("NEW_API_ACCESS_TOKEN")
    try:
        config = load_config(os.environ)
        path = normalize_user_path(path_arg)
        query = parse_query(query_args)
    except (ConfigError, UserPathError) as exc:
        print(redact_text(str(exc), token_for_errors), file=sys.stderr)
        return 2
    if dry_run:
        print(dry_run_text(config, path, query))
        return 0
    try:
        code, body = perform_get(config, path, query)
    except UserPathError as exc:
        print(redact_text(str(exc), config.access_token), file=sys.stderr)
        return 2
    if body:
        print(body)
    return code


if __name__ == "__main__":
    sys.exit(main())
