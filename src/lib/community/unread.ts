// Server-side read markers (CommunityRead) → unread badges that agree across
// devices. Pure (npm run test:community-core).

/**
 * Messages after this instant count as unread. A member who never opened a
 * thread starts from the moment they joined — not the whole history — and a
 * stale marker from before joining (e.g. after a re-approval) is lifted too.
 */
export function readBaseline(lastReadAt: Date | null, joinedAt: Date | null): Date {
  const join = joinedAt?.getTime() ?? 0;
  const read = lastReadAt?.getTime() ?? 0;
  if (lastReadAt && read >= join) return lastReadAt;
  return joinedAt ?? new Date(0);
}

/**
 * Where a "mark read up to `requested`" leaves the marker: never backwards,
 * never past now. Null = the request carried no usable time (ignore it).
 */
export function nextReadMarker(current: Date | null, requested: Date, now: Date): Date | null {
  if (Number.isNaN(requested.getTime())) return null;
  const target = requested.getTime() > now.getTime() ? now : requested;
  if (current && current.getTime() >= target.getTime()) return current;
  return target;
}

/** The Chats tab badge: how many threads have anything unread. */
export function countUnreadChats(channels: Array<{ unread: number }>, conversations: Array<{ unread: number }>): number {
  return [...channels, ...conversations].filter((t) => t.unread > 0).length;
}
