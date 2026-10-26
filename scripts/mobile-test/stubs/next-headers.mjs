// Test stub for next/headers: a fixed client IP so the login rate limiter keys consistently.
export async function headers() {
  // A test may set globalThis.__testClientIp to spread logins across "clients",
  // and globalThis.__testHeaders to add request headers (e.g. x-tenant-host for
  // the storefront's own server actions).
  return new Headers({ "x-forwarded-for": globalThis.__testClientIp ?? "203.0.113.7", ...(globalThis.__testHeaders ?? {}) });
}
// Cookies are dropped unless a test opts in with globalThis.__testCookieJar = new Map()
// (one Map = one browser), so suites that never thought about cookies are unchanged.
export async function cookies() {
  const jar = globalThis.__testCookieJar;
  if (!(jar instanceof Map)) return { get: () => undefined, set: () => undefined, delete: () => undefined };
  return {
    get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (nameOrOpts, value) => {
      if (typeof nameOrOpts === "string") jar.set(nameOrOpts, value);
      else jar.set(nameOrOpts.name, nameOrOpts.value);
    },
    delete: (name) => void jar.delete(typeof name === "string" ? name : name?.name),
  };
}
