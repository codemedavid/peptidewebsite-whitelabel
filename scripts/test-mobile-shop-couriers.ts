/**
 * App checkout couriers must match the website's.
 *
 * Grounding — vrjonina (2026-10-01): the store saved three shipping locations
 * (Metro Manila / Luzon / VisMin, ₱100) linked to courier "c2" but never saved a
 * `couriers` list. The website falls back to SEED_COURIERS (c2 = J&T Express),
 * so its checkout offered J&T + the three areas; the app read config only,
 * found no couriers, and dropped the locations too — no courier or shipping
 * pick at all in the app checkout.
 *
 * Run: npm run test:mobile-shop-couriers
 */
import assert from "node:assert/strict";
import { readShipping } from "@/lib/mobile/shop-checkout";

const VRJ_LOCATIONS = [
  { id: "s4", code: "JNT_METRO_MANILA", name: "Metro Manila", price: 100, active: true, courierId: "c2" },
  { id: "s5", code: "JNT_LUZON", name: "Luzon (Provincial)", price: 100, active: true, courierId: "c2" },
  { id: "s6", code: "JNT_VISMIN", name: "Visayas & Mindanao", price: 100, active: true, courierId: "c2" },
];

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test("no saved couriers → falls back to the website's default couriers", () => {
  const { couriers, shippingLocations } = readShipping({ shippingLocations: VRJ_LOCATIONS });
  assert.deepEqual(couriers, [{ id: "c2", name: "J&T Express", needsLocation: true }]);
  assert.deepEqual(shippingLocations.map((l) => [l.id, l.fee]), [["s4", 100], ["s5", 100], ["s6", 100]]);
});

test("default couriers without a location are not offered", () => {
  const { couriers } = readShipping({ shippingLocations: VRJ_LOCATIONS });
  assert.ok(!couriers.some((c) => c.id === "c1"), "LBC has no location, so it is not offered");
});

test("nothing saved at all → no couriers (checkout stays courier-free)", () => {
  assert.deepEqual(readShipping({}), { couriers: [], shippingLocations: [] });
});

test("a saved couriers list wins over the defaults, even an empty one", () => {
  const saved = readShipping({ couriers: [{ id: "c2", name: "J&T (own)", active: true }], shippingLocations: VRJ_LOCATIONS });
  assert.equal(saved.couriers[0].name, "J&T (own)");
  assert.deepEqual(readShipping({ couriers: [], shippingLocations: VRJ_LOCATIONS }).couriers, []);
});

console.log(`\n${passed} passed`);
