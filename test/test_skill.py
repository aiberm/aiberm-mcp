"""Docs consistency and the thin New API GET helper. No MCP protocol."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "skills" / "aiberm" / "scripts" / "aiberm_get.py"
SKILL = ROOT / "skills" / "aiberm" / "SKILL.md"
README = ROOT / "README.md"

EXPECTED_PATHS = frozenset(
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

OUT_OF_SCOPE = (
    "`GET /api/channel/`",
    "`GET /api/user/`",
    "`GET /api/redemption/`",
    "`GET /api/option/`",
    "`POST /api/token/{id}/key`",
    "`POST /api/user/pay`",
)

BANNED_PRODUCT_STRINGS = (
    "mcpServers",
    "@modelcontextprotocol",
    "claude_desktop_config",
    "MCP_TRANSPORT",
    "dist/index.js",
    "aiberm-mcp",
)


def load_helper():
    spec = importlib.util.spec_from_file_location("aiberm_get", HELPER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {HELPER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


helper = load_helper()


class DocsTest(unittest.TestCase):
    def test_skill_frontmatter(self) -> None:
        text = SKILL.read_text()
        self.assertTrue(text.startswith("---\n"))
        end = text.find("\n---\n", 4)
        self.assertGreater(end, 4)
        frontmatter = text[4:end]
        self.assertIn("name: aiberm\n", frontmatter)
        self.assertIn("description:", frontmatter)
        self.assertIn("Aiberm", frontmatter)
        self.assertIn("New API", frontmatter)
        self.assertIn("balance", frontmatter)

    def test_every_user_path_is_documented(self) -> None:
        self.assertEqual(helper.USER_PATHS, EXPECTED_PATHS)
        for label, path in (("skill", SKILL), ("readme", README)):
            text = path.read_text()
            missing = [item for item in (*EXPECTED_PATHS, "/api/token/{id}") if not documents_path(text, item)]
            self.assertEqual(missing, [], f"{label} missing {missing}")

    def test_out_of_scope_is_documented(self) -> None:
        for path in (SKILL, README):
            text = path.read_text()
            for needle in OUT_OF_SCOPE:
                self.assertIn(needle, text, f"{path.name} missing {needle}")
            self.assertIn("payment", text.lower())
            self.assertIn("New-Api-User", text)
            self.assertIn("500000", text)

    def test_repo_is_a_skill_package(self) -> None:
        readme = README.read_text()
        self.assertIn("https://github.com/aiberm/aiberm-skill", readme)
        self.assertIn("aiberm-skill", readme)
        self.assertFalse((ROOT / "package.json").exists())
        self.assertFalse((ROOT / "src").exists())
        banned: list[str] = []
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [name for name in dirnames if name != ".git"]
            for name in filenames:
                rel = Path(dirpath, name).relative_to(ROOT).as_posix()
                if rel in {"package.json", "package-lock.json"} or rel.startswith("src/") or name == "mcp.json":
                    banned.append(rel)
                if rel == "test/test_skill.py":
                    continue
                if Path(name).suffix in {".md", ".py", ".sh", ".example"} or name == ".env.example":
                    text = Path(dirpath, name).read_text()
                    for bad in BANNED_PRODUCT_STRINGS:
                        if bad in text:
                            banned.append(f"{rel}: {bad}")
        self.assertEqual(banned, [])


class HelperTest(unittest.TestCase):
    def test_allowlist_rejects_admin_and_key_reveal(self) -> None:
        for path in (
            "/api/channel/",
            "/api/channel/1",
            "/api/user/",
            "/api/user/search",
            "/api/redemption/",
            "/api/option/",
            "/api/log/",
            "/api/log/stat",
            "/api/token/1/key",
            "/api/token/batch/keys",
            "/api/user/self/../../channel/",
            "/api/user/self?x=1",
            "https://evil.example/api/user/self",
            "/api/%2e%2e/channel",
        ):
            with self.assertRaises(helper.UserPathError):
                helper.normalize_user_path(path)
        self.assertEqual(helper.normalize_user_path("/api/token"), "/api/token/")
        self.assertEqual(helper.normalize_user_path("/api/token/15"), "/api/token/15")

    def test_redact_keeps_masked_keys(self) -> None:
        token = "dashboard-token-value"
        full_key = "sk-" + ("a" * 20)
        payload = {
            "success": True,
            "data": {
                "key": full_key,
                "masked": "sk-abc****wxyz",
                "note": f"leak {full_key} and {token}",
                "access_token": token,
                "items": [{"key": "sk-xyz****abcd"}],
            },
        }
        redacted = helper.redact_data(payload, token)
        self.assertEqual(redacted["data"]["key"], "***")
        self.assertEqual(redacted["data"]["masked"], "sk-abc****wxyz")
        self.assertEqual(redacted["data"]["items"][0]["key"], "sk-xyz****abcd")
        self.assertEqual(redacted["data"]["access_token"], "***")
        self.assertNotIn(token, json.dumps(redacted))
        self.assertNotIn(full_key, json.dumps(redacted))
        self.assertIn("sk-[redacted]", redacted["data"]["note"])
        masked_long = "sk-" + ("d" * 20) + "****wxyz"
        self.assertEqual(helper.redact_text(masked_long), masked_long)

    def test_quota_math(self) -> None:
        self.assertEqual(helper.quota_to_usd(500_000), 1)
        self.assertEqual(helper.quota_to_usd(2_500_000), 5)
        self.assertEqual(helper.quota_to_usd(1), 0.000002)
        self.assertEqual(helper.token_price_usd_per_million(1, 1, 500_000), 2)
        self.assertEqual(helper.token_price_usd_per_million(0.5, 2, 500_000), 2)
        self.assertEqual(helper.request_price_usd(0.1, 1.5), 0.15)

    def test_config_rejects_bad_values(self) -> None:
        good = {
            "NEW_API_ACCESS_TOKEN": "token",
            "NEW_API_USER_ID": "42",
        }
        helper.load_config(good)
        with self.assertRaises(helper.ConfigError):
            helper.load_config({**good, "NEW_API_USER_ID": "user"})
        with self.assertRaises(helper.ConfigError):
            helper.load_config({**good, "NEW_API_ACCESS_TOKEN": "tok\nen"})
        with self.assertRaises(helper.ConfigError):
            helper.load_config({**good, "NEW_API_BASE_URL": "https://user:pass@aiberm.com"})
        with self.assertRaises(helper.ConfigError):
            helper.load_config({**good, "NEW_API_BASE_URL": "https://aiberm.com/api"})
        with self.assertRaises(helper.ConfigError):
            helper.load_config({**good, "NEW_API_QUOTA_PER_UNIT": "0"})

    def test_dry_run_hides_token(self) -> None:
        token = "sk-" + ("c" * 24)
        env = {
            "NEW_API_BASE_URL": "https://aiberm.com",
            "NEW_API_ACCESS_TOKEN": token,
            "NEW_API_USER_ID": "7",
        }
        config = helper.load_config(env)
        text = helper.dry_run_text(config, "/api/user/self", {})
        self.assertIn("GET https://aiberm.com/api/user/self", text)
        self.assertIn("Authorization: Bearer [redacted]", text)
        self.assertIn("New-Api-User: 7", text)
        self.assertNotIn(token, text)
        code, stdout, stderr = run_cli(["--dry-run", "/api/channel/"], env)
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("allowlist", stderr)
        self.assertNotIn(token, stderr)

    def test_loopback_get_redacts_and_sends_headers(self) -> None:
        token = "loopback-access-token"
        full_key = "sk-" + ("b" * 20)
        seen: list[dict[str, str]] = []

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self) -> None:  # noqa: N802
                seen.append(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("Authorization", ""),
                        "user": self.headers.get("New-Api-User", ""),
                        "accept": self.headers.get("Accept", ""),
                        "ua": self.headers.get("User-Agent", ""),
                        "method": self.command,
                    }
                )
                if self.path.startswith("/api/user/models"):
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1/stolen")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if self.path.startswith("/api/pricing"):
                    body = json.dumps({"success": False, "message": "unauthorized"}).encode()
                    self.send_response(401)
                    self._write(body)
                    return
                if "fail=1" in self.path:
                    body = json.dumps({"success": False, "message": f"nope {full_key}"}).encode()
                    self.send_response(200)
                    self._write(body)
                    return
                body = json.dumps(
                    {
                        "success": True,
                        "data": {
                            "quota": 500000,
                            "key": full_key,
                            "masked": "sk-abc****wxyz",
                            "echo": self.headers.get("Authorization", ""),
                        },
                    }
                ).encode()
                self.send_response(200)
                self._write(body)

            def _write(self, body: bytes) -> None:
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, fmt: str, *args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def stop_server() -> None:
            server.shutdown()
            server.server_close()

        self.addCleanup(stop_server)
        port = server.server_address[1]
        env = {
            "NEW_API_BASE_URL": f"http://127.0.0.1:{port}",
            "NEW_API_ACCESS_TOKEN": token,
            "NEW_API_USER_ID": "42",
            "NEW_API_QUOTA_PER_UNIT": "500000",
        }

        code, stdout, stderr = run_cli(["/api/user/self"], env)
        self.assertEqual(stderr, "")
        self.assertEqual(code, 0)
        self.assertEqual(seen[-1]["method"], "GET")
        self.assertEqual(seen[-1]["authorization"], f"Bearer {token}")
        self.assertEqual(seen[-1]["user"], "42")
        self.assertEqual(seen[-1]["accept"], "application/json")
        self.assertEqual(seen[-1]["ua"], "aiberm-skill/1.0")
        payload = json.loads(stdout)
        self.assertEqual(payload["data"]["key"], "***")
        self.assertEqual(payload["data"]["masked"], "sk-abc****wxyz")
        self.assertEqual(payload["data"]["echo"], "Bearer [redacted]")
        self.assertNotIn(token, stdout)
        self.assertNotIn(full_key, stdout)

        code, stdout, stderr = run_cli(["/api/log/self", "p=1", "page_size=20", "type=2"], env)
        self.assertEqual(code, 0, stderr)
        self.assertIn("p=1", seen[-1]["path"])
        self.assertIn("page_size=20", seen[-1]["path"])
        self.assertIn("type=2", seen[-1]["path"])

        code, stdout, _stderr = run_cli(["/api/user/self", "fail=1"], env)
        self.assertEqual(code, 1)
        self.assertIn("nope", stdout)
        self.assertNotIn(full_key, stdout)
        self.assertIn("sk-[redacted]", stdout)

        code, stdout, _stderr = run_cli(["/api/pricing"], env)
        self.assertEqual(code, 1)
        self.assertIn("unauthorized", stdout)

        before = len(seen)
        code, stdout, stderr = run_cli(["/api/user/models"], env)
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("refusing redirect", stderr)
        self.assertNotIn(token, stderr)
        self.assertEqual(len(seen), before + 1)


def documents_path(text: str, path: str) -> bool:
    return f"`{path}`" in text or f"`GET {path}`" in text or f"`POST {path}`" in text


def run_cli(args: list[str], env: dict[str, str]) -> tuple[int, str, str]:
    import io
    from contextlib import redirect_stderr, redirect_stdout

    previous = os.environ.copy()
    os.environ.clear()
    os.environ.update(env)
    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = helper.main(args)
    finally:
        os.environ.clear()
        os.environ.update(previous)
    return code, stdout.getvalue(), stderr.getvalue()


if __name__ == "__main__":
    unittest.main()
