import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { StoreChoice } from "@contract";
import { withAlpha } from "@/features/community/lib/color";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { StoreLogo, TextLink, type AuthAccent } from "./parts";

/** Big serif title with the brand-coloured italic word, plus a lede. */
export function SheetHeading({
  lead,
  emphasis,
  body,
  accent,
}: {
  lead: string;
  emphasis: string;
  body: string;
  accent: AuthAccent;
}) {
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="display" accessibilityRole="header" style={styles.title}>
        {lead}
        <AppText variant="display" italic color={accent.link} style={styles.title}>
          {emphasis}
        </AppText>
      </AppText>
      <AppText variant="body" color="muted">
        {body}
      </AppText>
    </View>
  );
}

/** Same login, several stores: pick the one to open. */
export function StorePicker({
  choices,
  busy,
  accent,
  onPick,
  onBack,
}: {
  choices: StoreChoice[];
  busy: string | null;
  accent: AuthAccent;
  onPick: (slug: string) => void;
  onBack: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: SPACE.xl }}>
      <SheetHeading
        lead="Which "
        emphasis="store?"
        body={`This login opens ${choices.length} stores. You can switch any time by signing out.`}
        accent={accent}
      />
      <View style={{ gap: SPACE.sm }}>
        {choices.map((c) => {
          const isBusy = busy === c.slug;
          return (
            <Pressable
              key={c.slug}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.name}`}
              accessibilityState={{ busy: isBusy, disabled: !!busy }}
              disabled={!!busy}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => undefined);
                onPick(c.slug);
              }}
              style={({ pressed }) => [
                styles.store,
                {
                  backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
                  borderColor: isBusy ? accent.link : t.colors.border,
                  opacity: busy && !isBusy ? 0.5 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                  boxShadow: `0 6px 18px -12px ${withAlpha(t.colors.text, 0.35)}`,
                },
              ]}
            >
              <StoreLogo choice={c} size={48} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {c.name}
                </AppText>
                <AppText variant="caption" color="muted" numberOfLines={1}>
                  {c.address}
                </AppText>
              </View>
              <View style={[styles.chevron, { backgroundColor: t.colors.surfaceAlt }]}>
                <Ionicons
                  name={isBusy ? "hourglass-outline" : "chevron-forward"}
                  size={16}
                  color={isBusy ? accent.link : t.colors.textMuted}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
      <TextLink
        label="Use a different account"
        color={accent.link}
        onPress={onBack}
        disabled={!!busy}
        style={styles.centered}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 38, lineHeight: 42 },
  centered: { alignSelf: "center" },
  store: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    padding: SPACE.md,
    minHeight: 72,
    borderRadius: RADIUS.lg + 6,
    borderWidth: 1,
  },
  chevron: { width: 30, height: 30, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
});
