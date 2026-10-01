// Test stub for next/headers: a fixed client IP so the login rate limiter keys consistently.
export async function headers() {
  // A test may set globalThis.__testClientIp to spread logins across "clients".
  return new Headers({ "x-forwarded-for": globalThis.__testClientIp ?? "203.0.113.7" });
}
export async function cookies() {
  return { get: () => undefined, set: () => undefined, delete: () => undefined };
}
