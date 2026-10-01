import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import type { NoticeModal, TrackNote } from "./content";

/**
 * Native stand-ins for the storefront cards the website editors preview live
 * (components/NoticeModal NoticeModalCard, components/TrackNoteCard). Same
 * sections, same show/hide rules, painted in the store's app palette — the live
 * site uses its own theme tokens.
 */

export function NoticeModalPreview({ config }: { config: NoticeModal }) {
  const t = useTheme();
  const danger = t.tone("danger");
  const info = t.tone("info");
  const warn = t.tone("warning");
  const showWarn = !!(config.warningTitle || config.warningBody);
  const showDelivery = !!(config.deliveryTitle || config.deliveryLines.length > 0);
  return (
    <View
      style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
      accessible
      accessibilityLabel={`Notice preview: ${config.title}`}
    >
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: warn.bg }]}>
          <Ionicons name="warning-outline" size={20} color={warn.fg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="heading">{config.title}</AppText>
          {config.subtitle ? (
            <AppText variant="caption" color="muted">
              {config.subtitle}
            </AppText>
          ) : null}
        </View>
      </View>

      {config.bodyParagraphs.map((p, i) => (
        <AppText key={i} variant="caption">
          {p}
        </AppText>
      ))}

      {showWarn ? (
        <View style={[styles.callout, { backgroundColor: danger.bg }]}>
          {config.warningTitle ? (
            <AppText variant="label" color={danger.fg} style={{ fontWeight: "700" }}>
              {`✕ ${config.warningTitle}`}
            </AppText>
          ) : null}
          {config.warningBody ? (
            <AppText variant="caption" color={danger.fg}>
              {config.warningBody}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {showDelivery ? (
        <View style={[styles.callout, { backgroundColor: info.bg }]}>
          {config.deliveryTitle ? (
            <AppText variant="label" color={info.fg} style={{ fontWeight: "700" }}>
              {config.deliveryTitle}
            </AppText>
          ) : null}
          {config.deliveryLines.map((line, i) => (
            <AppText key={i} variant="caption" color={info.fg}>
              {line}
            </AppText>
          ))}
        </View>
      ) : null}

      <View style={[styles.agree, { backgroundColor: t.brand.primary }]}>
        <Ionicons name="shield-checkmark-outline" size={16} color={t.brand.onPrimary} />
        <AppText variant="label" color={t.brand.onPrimary}>
          {config.agreeLabel}
        </AppText>
      </View>
      {config.footerNote ? (
        <AppText variant="caption" color="faint" style={{ textAlign: "center" }}>
          {config.footerNote}
        </AppText>
      ) : null}
    </View>
  );
}

export function TrackNotePreview({ config }: { config: TrackNote }) {
  const t = useTheme();
  const empty = !config.title && !config.subtitle && config.rows.length === 0 && !config.footnote;
  if (empty) {
    return (
      <AppText variant="caption" color="faint">
        Nothing to show yet — add a title or at least one row.
      </AppText>
    );
  }
  return (
    <View
      style={[styles.card, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
      accessible
      accessibilityLabel={`Delivery note preview: ${config.title || "Delivery estimates"}`}
    >
      {config.title || config.subtitle ? (
        <View style={styles.trackHead}>
          <Ionicons name="car-outline" size={18} color={t.brand.link} />
          {config.title ? <AppText variant="bodyStrong">{config.title}</AppText> : null}
          {config.subtitle ? (
            <AppText variant="caption" color="muted">
              {`· ${config.subtitle}`}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {config.rows.length > 0 ? (
        <View style={styles.grid}>
          {config.rows.map((row, i) => (
            <View key={i} style={[styles.cell, { borderColor: t.colors.border }]}>
              <AppText variant="caption" color="muted">
                {row.region}
              </AppText>
              <AppText variant="label">{row.estimate}</AppText>
            </View>
          ))}
        </View>
      ) : null}
      {config.footnote ? (
        <AppText variant="caption" color="faint">
          {config.footnote}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: SPACE.md, padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: 1 },
  head: { flexDirection: "row", gap: SPACE.md, alignItems: "center" },
  icon: { width: 36, height: 36, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
  callout: { gap: 4, padding: SPACE.md, borderRadius: RADIUS.md },
  agree: {
    flexDirection: "row",
    gap: SPACE.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: SPACE.md,
    borderRadius: RADIUS.md,
  },
  trackHead: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: SPACE.sm },
  cell: { width: "50%", paddingRight: SPACE.sm, gap: 2 },
});
