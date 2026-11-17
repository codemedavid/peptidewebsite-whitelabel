// Whose tracker a request reads and writes (docs/mobile-admin/TRACKER.md §5). Pure.
//
// Every signed-in account keeps its OWN tracker: a customer, the store owner,
// and each staff member. `subject` is the row key — the same string the app
// session stores (lib/mobile/sessions.ts encodeSubject) — and customerId /
// staffId mirror it so deleting that account cascades its tracker rows.

export type TrackerAccount = { kind: "owner" } | { kind: "staff"; id: string } | { kind: "customer"; id: string };

export type TrackerOwner = {
  subject: string;
  customerId: string | null;
  staffId: string | null;
};

export function trackerOwnerOf(account: TrackerAccount): TrackerOwner {
  switch (account.kind) {
    case "owner":
      return { subject: "owner", customerId: null, staffId: null };
    case "staff":
      return { subject: `staff:${account.id}`, customerId: null, staffId: account.id };
    case "customer":
      return { subject: `customer:${account.id}`, customerId: account.id, staffId: null };
  }
}
