import type { CommunityMessage } from "@contract";
import { isSameDay } from "./format";

/** Consecutive messages from one sender within this window render as a run. */
export const RUN_WINDOW_MS = 5 * 60_000;

type GroupableMessage = Pick<CommunityMessage, "id" | "kind" | "sender" | "createdAt">;

export type ThreadRow<M extends GroupableMessage = CommunityMessage> =
  | { type: "message"; message: M; startsGroup: boolean; endsGroup: boolean }
  | { type: "day"; id: string; iso: string };

const standalone = (m: GroupableMessage) => m.kind === "drop" || m.kind === "system" || m.kind === "order";

function sameRun(newer: GroupableMessage | undefined, older: GroupableMessage | undefined): boolean {
  if (!newer || !older) return false;
  if (standalone(newer) || standalone(older)) return false;
  if (!newer.sender || !older.sender || newer.sender.key !== older.sender.key) return false;
  if (!isSameDay(newer.createdAt, older.createdAt)) return false;
  return Date.parse(newer.createdAt) - Date.parse(older.createdAt) < RUN_WINDOW_MS;
}

/**
 * Rows for an inverted list (index 0 = newest). Each message knows whether it
 * opens a run (name, rounded top) or closes one (avatar, tail). A day pill
 * follows the oldest message of each day, so it renders above that day.
 */
export function buildThreadRows<M extends GroupableMessage>(messages: M[]): ThreadRow<M>[] {
  const rows: ThreadRow<M>[] = [];
  messages.forEach((message, i) => {
    const newer = messages[i - 1];
    const older = messages[i + 1];
    rows.push({ type: "message", message, startsGroup: !sameRun(message, older), endsGroup: !sameRun(newer, message) });
    if (!older || !isSameDay(older.createdAt, message.createdAt)) {
      rows.push({ type: "day", id: `day-${message.id}`, iso: message.createdAt });
    }
  });
  return rows;
}
