// Opaque message cursors. Pure (npm run test:community-core).
//
//   page cursor  "<createdAt ISO>|<id>"           — older pages (?before=)
//   poll cursor  "<createdAt ISO>|<id>|<at ISO>"  — ?after= : newer messages,
//                plus edits/deletes made since `at` (when the poll was served)

export type Cursor = { createdAt: Date; id: string };
export type PollCursor = Cursor & { at: Date };

const MAX_RAW = 300;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function parts(raw: string | null | undefined, n: number): string[] | null {
  if (!raw || raw.length > MAX_RAW) return null;
  const p = Buffer.from(raw, "base64url").toString("utf8").split("|");
  return p.length === n ? p : null;
}

function date(iso: string): Date | null {
  const d = new Date(iso);
  return /^\d{4}-\d{2}-\d{2}T/.test(iso) && !Number.isNaN(d.getTime()) ? d : null;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  const p = parts(raw, 2);
  if (!p) return null;
  const createdAt = date(p[0]);
  return createdAt && ID_RE.test(p[1]) ? { createdAt, id: p[1] } : null;
}

export function encodePollCursor(c: PollCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}|${c.at.toISOString()}`, "utf8").toString("base64url");
}

export function decodePollCursor(raw: string | null | undefined): PollCursor | null {
  const p = parts(raw, 3);
  if (!p) return null;
  const createdAt = date(p[0]);
  const at = date(p[2]);
  return createdAt && at && ID_RE.test(p[1]) ? { createdAt, id: p[1], at } : null;
}
