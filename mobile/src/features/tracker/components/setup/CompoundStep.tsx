/**
 * Step 1 — "What are you taking?" (ported from MamaMicaGlow CompoundStep):
 * FREE TEXT — any peptide or product, in the shop or not. Suggestions only
 * save typing (lib/name-suggestions.ts): names you already track, then the
 * store's products. A suggestion fills the NAME (and links the product for
 * "Reorder") — never a dose. The store team gets the store's product list.
 */
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useProducts } from "@/features/products/hooks";
import { useCatalog } from "@/features/shop/hooks";
import { useProtocols, useTrackerAccess } from "../../hooks";
import { INPUT_CAPS } from "../../lib/caps";
import { nameSuggestions, type NameOption } from "../../lib/name-suggestions";
import type { ProtocolForm } from "../../lib/protocol-form";
import { PROTOCOL_COLORS } from "../../lib/types";
import { TextField } from "../fields";
import { haptic, SectionHeader, TText } from "../kit";
import { TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme } from "../theme";

export const MAX_NAME = INPUT_CAPS.name;

type Props = { form: ProtocolForm; onChange: (patch: Partial<ProtocolForm>) => void };

/** The store's products: the shop catalog for customers, the product list for the team. */
function useShopNames(): { id: string; name: string }[] {
  const { team } = useTrackerAccess();
  const catalog = useCatalog();
  const products = useProducts({ enabled: team });
  return useMemo(
    () => (team ? (products.data?.products ?? []) : (catalog.data?.products ?? [])).map((p) => ({ id: p.id, name: p.name })),
    [team, products.data, catalog.data],
  );
}

function SuggestionRow({ option, icon, onPick }: { option: NameOption; icon: keyof typeof Ionicons.glyphMap; onPick: (o: NameOption) => void }) {
  const th = useTrackerTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Use ${option.name}`}
      onPress={() => {
        haptic("select");
        onPick(option);
      }}
      style={({ pressed }) => [styles.suggestion, { borderColor: th.line, backgroundColor: pressed ? th.surfaceAlt : th.surface }]}
    >
      <Ionicons name={icon} size={16} color={th.inkFaint} />
      <TText variant="body" numberOfLines={2} style={styles.fill}>
        {option.name}
      </TText>
      <Ionicons name="add" size={18} color={th.brandText} />
    </Pressable>
  );
}

export function CompoundStep({ form, onChange }: Props) {
  const th = useTrackerTheme();
  const shop = useShopNames();
  const { protocols } = useProtocols();
  const s = useMemo(() => nameSuggestions(form.name, protocols, shop), [form.name, protocols, shop]);
  const typed = form.name.trim();
  const pick = (o: NameOption) => onChange({ name: o.name.slice(0, MAX_NAME), catalogId: o.catalogId });

  return (
    <View style={styles.wrap}>
      <TextField
        label="Peptide or product name"
        value={form.name}
        onChangeText={(t) => onChange({ name: t.slice(0, MAX_NAME), catalogId: null })}
        placeholder="Type any name, e.g. BPC-157"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="next"
        maxLength={MAX_NAME}
      />
      {s.isCustom && typed ? (
        <View style={[styles.custom, { backgroundColor: th.brandSoft }]} accessible accessibilityLabel={`${typed} will be tracked as your own. It doesn't need to be in the shop.`}>
          <Ionicons name="checkmark-circle" size={18} color={th.brandText} />
          <TText variant="meta" color={th.brandText} style={styles.fill}>
            {`“${typed}” will be tracked as your own. It doesn't need to be in the shop.`}
          </TText>
        </View>
      ) : null}
      {s.mine.length > 0 ? (
        <View style={styles.list}>
          <SectionHeader title="Your peptides" />
          {s.mine.map((o) => (
            <SuggestionRow key={`mine:${o.name}`} option={o} icon="time-outline" onPick={pick} />
          ))}
        </View>
      ) : null}
      {s.shop.length > 0 ? (
        <View style={styles.list}>
          <SectionHeader title={typed ? "From the shop" : "Popular in the shop"} />
          {s.shop.map((o) => (
            <SuggestionRow key={`shop:${o.catalogId}`} option={o} icon="pricetag-outline" onPick={pick} />
          ))}
        </View>
      ) : null}
      <View style={styles.list}>
        <SectionHeader title="Colour" />
        <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="Colour">
          {PROTOCOL_COLORS.map((c, i) => {
            const isOn = form.color === c;
            return (
              <Pressable
                key={c}
                onPress={() => {
                  haptic("select");
                  onChange({ color: c });
                }}
                accessibilityRole="radio"
                accessibilityLabel={`Colour ${i + 1}`}
                accessibilityState={{ checked: isOn }}
                style={[styles.swatchHit]}
              >
                <View style={[styles.swatch, { backgroundColor: c, borderColor: isOn ? th.ink : "transparent" }]}>
                  {isOn ? <Ionicons name="checkmark" size={16} color={th.surface} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.xl },
  custom: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, paddingHorizontal: TSPACE.md, paddingVertical: TSPACE.sm, borderRadius: TRADIUS.md },
  fill: { flex: 1 },
  list: { gap: TSPACE.sm },
  suggestion: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: TOUCH_MIN + 4, paddingHorizontal: TSPACE.md, borderRadius: TRADIUS.md, borderWidth: StyleSheet.hairlineWidth },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: TSPACE.xs },
  swatchHit: { width: TOUCH_MIN, height: TOUCH_MIN, alignItems: "center", justifyContent: "center" },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: "center", justifyContent: "center" },
});
