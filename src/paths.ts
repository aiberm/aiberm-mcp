/**
 * Exact user-scoped GET paths. Anything else, including admin lists, is refused
 * before a request is sent.
 */
const EXACT_PATHS = new Set([
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
]);

const OWN_TOKEN_PATH = /^\/api\/token\/[1-9]\d*$/;

export function assertUserPath(path: string): string {
  const pathname = path.split("?")[0] ?? path;
  if (pathname !== path) {
    throw new Error("Query strings must be passed separately from the path");
  }
  if (EXACT_PATHS.has(pathname) || OWN_TOKEN_PATH.test(pathname)) {
    return pathname;
  }
  throw new Error(`Refusing path outside the user API allowlist: ${pathname}`);
}
