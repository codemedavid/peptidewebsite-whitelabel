# MCP connector authentication — TDD evidence

**Source plan:** none. Journeys derived from a live failure: the ChatGPT
"Pepweb Admin" connector repeatedly returned `Invalid or missing MCP admin
token.` while attempting to create the `mstomato` tenant, after the operator had
already removed the stray quotes from the hosted `MCP_ADMIN_TOKEN` value.

## User journeys

1. As a platform operator, I want my ChatGPT connector to authenticate even when
   ChatGPT only offers **No authentication**, so that I can create and rebrand
   tenants without an OAuth flow.
2. As a platform operator, I want a rejected call to tell me *why* it was
   rejected, so that I stop guessing between "wrong value", "not sent at all",
   and "wrong deployment".
3. As a platform operator, I want a token pasted with its `.env` quotes to still
   work, so that a copy/paste artifact does not silently break the connector.

## Task report

**Diagnosis.** `requireMcpAuth` in `src/app/api/mcp/route.ts` read the token only
from an `Authorization: Bearer` header or an `adminToken` tool argument. Both
failure branches were distinguishable — the operator's message was the *mismatch*
branch, not the *unset* branch, proving `MCP_ADMIN_TOKEN` was present on the
server and that the value arriving from the connector did not match it (or that
nothing arrived at all). The old code could not tell those two apart.

Live probing was not possible from the operator's machine: `pepweb.store`
resolves to `223.25.3.16` (a Whalebone DNS sinkhole, answering `307` to
`redirect.whalebone.io/passthrough`) and `app.pepweb.store` resolves to
`10.29.0.241`, a private LAN address. Neither is Vercel. The fix therefore makes
the endpoint self-diagnosing rather than relying on a probe.

**Change.** Auth moved to `src/lib/mcp/auth.ts` (`checkMcpAuth`), which:
- reads the token from the `Authorization` header, a `?token=` /`?adminToken=` /
  `?key=` parameter on the connector URL, or the `adminToken` argument;
- strips surrounding quotes and whitespace from both the supplied and the stored
  value;
- compares with `timingSafeEqual`;
- on rejection, reports which of the three sources were present, the supplied
  length, and an 8-hex SHA-256 fingerprint of both supplied and expected values.

**Validation commands run**

| Stage | Command | Result |
|---|---|---|
| RED | `npm run test:mcp-auth` | `Error: Cannot find module '../src/lib/mcp/auth'` — compile-time RED, the intended signal |
| GREEN | `npm run test:mcp-auth` | `10 passed, 0 failed` |
| Regression | `npm run test:branding-update` | `All tenant branding update checks passed` |
| Typecheck | `npx tsc --noEmit` (filtered to touched files) | clean |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An unset server token reports misconfiguration, not a bad credential | `scripts/test-mcp-auth.ts:reports a server misconfiguration when no token is set` | unit | PASS |
| 2 | A matching bearer header authorizes | `…:accepts a matching Authorization: Bearer header` | unit | PASS |
| 3 | A server token stored with quotes or whitespace still authorizes | `…:tolerates a server token that was pasted with surrounding quotes` | unit | PASS |
| 4 | `?token=`, `?adminToken=`, `?key=` on the connector URL authorize with no header | `…:accepts a token carried on the connector URL when no header is sent` | unit | PASS |
| 5 | A wrong URL token is rejected | `…:rejects a wrong token supplied on the connector URL` | unit | PASS |
| 6 | The `adminToken` argument fallback still works | `…:still accepts the adminToken tool argument fallback` | unit | PASS |
| 7 | The original rejection wording is preserved as a prefix | `…:keeps the original rejection wording for existing callers` | unit | PASS |
| 8 | A rejection names all three lookup sites | `…:names every place it looked so a silent connector is diagnosable` | unit | PASS |
| 9 | A mismatch fingerprints sent vs expected and reports length | `…:fingerprints a mismatch so two deployments can be told apart` | unit | PASS |
| 10 | Neither secret is ever echoed to an unauthenticated caller | `…:never echoes either secret back to an unauthenticated caller` | unit | PASS |

## Coverage and known gaps

`checkMcpAuth` is fully covered by the ten cases above. Deliberate gaps:

- **The original root cause is still unconfirmed.** The change makes the next
  failure self-explaining rather than proving which of the candidate causes was
  responsible. The `mstomato` tenant has not been created.
- No end-to-end test drives a real ChatGPT connector; the JSON-RPC wrapper in
  `route.ts` is exercised only through `requireMcpAuth`'s delegation.
- The token can now appear in a URL, so it may be recorded in access logs. That
  is an accepted tradeoff for connectors with no header support; rotate the
  token if the URL is ever shared.
