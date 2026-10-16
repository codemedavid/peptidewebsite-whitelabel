// The Verified Resellers Hub: a channel every member sees, split into two
// topics. Its General topic is "On hand" — verified resellers post the stock
// they have ready. Its other topics ("Looking for") are where any member posts
// what they need. Who may post where lives in rules.ts; this is the shape and
// the wording. Pure (npm run test:community-core).

export const HUB_AUDIENCE = "hub";

export const HUB_TOPICS = {
  onHand: { name: "On hand", emoji: "🏷️" },
  lookingFor: { name: "Looking for", emoji: "🙋" },
} as const;

export const HUB_ON_HAND_ONLY = "Only verified resellers post their on-hand stock here. Post what you need in Looking for.";

export function isHub(channel: { audience: string }): boolean {
  return channel.audience === HUB_AUDIENCE;
}

/** The composer's placeholder in a hub topic; null everywhere else. */
export function hubComposerHint(channel: { audience: string }, topic: { isGeneral: boolean }): string | null {
  if (!isHub(channel)) return null;
  return topic.isGeneral ? "What do you have on hand? Product, qty, price" : "What are you looking for?";
}
