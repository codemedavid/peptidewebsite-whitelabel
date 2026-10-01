import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, FlatList, Modal, Pressable, StyleSheet, Switch, View } from "react-native";
import { useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText, Card, Divider, type IconName } from "@/ui/primitives";

/** Form building blocks shared by the catalog screens (product editor, categories, currency). */

export const successTap = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);

// ── A titled card: one section of a long form ────────────────────────────────

export function FormSection({ title, hint, children, trailing }: { title: string; hint?: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <Card style={styles.section}>
      <View style={styles.sectionHead}>
        <AppText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </AppText>
        {trailing}
      </View>
      {hint ? (
        <AppText variant="caption" color="muted">
          {hint}
        </AppText>
      ) : null}
      {children}
    </Card>
  );
}

// ── Inline notes: a rule failure (blocks save) or a heads-up (doesn't) ───────

export function Notice({ tone, children }: { tone: "danger" | "warning" | "info"; children: string }) {
  const t = useTheme();
  const c = t.tone(tone);
  const icon = tone === "danger" ? "alert-circle" : tone === "warning" ? "warning-outline" : "information-circle-outline";
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: c.bg }]}>
      <Ionicons name={icon} size={16} color={c.fg} style={{ marginTop: 2 }} />
      <AppText variant="caption" color={c.fg} style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

// ── A labelled switch row (the website's checkboxes) ─────────────────────────

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[styles.toggle, disabled ? { opacity: 0.55 } : null]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        {hint ? (
          <AppText variant="caption" color="muted">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.brand.primary, false: t.colors.border }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

// ── A select: a field that opens a sheet of options ──────────────────────────

export type SelectOption = { value: string; label: string; detail?: string };

export function SelectField({
  label,
  hint,
  value,
  options,
  onChange,
  placeholder = "Choose…",
}: {
  label: string;
  hint?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        accessibilityHint="Opens the list of choices"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.select,
          { backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <AppText variant="body" color={current ? "text" : "faint"} numberOfLines={1} style={{ flex: 1 }}>
          {current?.label ?? placeholder}
        </AppText>
        <Ionicons name="chevron-down" size={18} color={t.colors.textFaint} />
      </Pressable>
      {hint ? (
        <AppText variant="caption" color="faint">
          {hint}
        </AppText>
      ) : null}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close" style={[styles.backdrop, { backgroundColor: t.colors.overlay }]} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: t.colors.surface, paddingBottom: insets.bottom + SPACE.md }]}>
          <View style={styles.sheetHead}>
            <AppText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
              {label}
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => setOpen(false)}>
              <Ionicons name="close" size={24} color={t.colors.textMuted} />
            </Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value || "__none"}
            ItemSeparatorComponent={() => <Divider inset={SPACE.lg} />}
            renderItem={({ item }) => {
              const selected = item.value === value;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={item.label}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => undefined);
                    onChange(item.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.option, pressed ? { backgroundColor: t.colors.surfaceAlt } : null]}
                >
                  <View style={{ flex: 1 }}>
                    <AppText variant={selected ? "bodyStrong" : "body"}>{item.label}</AppText>
                    {item.detail ? (
                      <AppText variant="caption" color="muted">
                        {item.detail}
                      </AppText>
                    ) : null}
                  </View>
                  {selected ? <Ionicons name="checkmark" size={20} color={t.brand.link} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

// ── Small icon button (row actions: remove, move) ────────────────────────────

export function IconButton({
  icon,
  label,
  onPress,
  tone = "neutral",
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: "neutral" | "danger";
  disabled?: boolean;
}) {
  const t = useTheme();
  const color = tone === "danger" ? t.tone("danger").fg : t.colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconBtn,
        { backgroundColor: pressed ? t.colors.surfaceAlt : "transparent", opacity: disabled ? 0.35 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

// ── Unsaved-changes guard ────────────────────────────────────────────────────

/**
 * Confirm before leaving with unsaved edits (same guard as the tracking sheet).
 * Call the returned `allowLeave()` right before a deliberate exit, e.g. after a save.
 */
export function useDiscardGuard(dirty: boolean, message: string): () => void {
  const navigation = useNavigation();
  const leaving = useRef(false);
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty });
    return navigation.addListener("beforeRemove", (e) => {
      if (!dirty || leaving.current) return;
      e.preventDefault();
      Alert.alert("Discard changes?", message, [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
  }, [navigation, dirty, message]);
  return () => {
    leaving.current = true;
  };
}

const styles = StyleSheet.create({
  section: { gap: SPACE.md },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  notice: { flexDirection: "row", gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.md },
  toggle: { flexDirection: "row", alignItems: "center", gap: SPACE.md, minHeight: TOUCH },
  select: {
    minHeight: TOUCH + 4,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    paddingHorizontal: SPACE.lg,
  },
  backdrop: { flex: 1 },
  sheet: { maxHeight: "70%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: SPACE.md },
  sheetHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACE.lg, paddingBottom: SPACE.md },
  option: { minHeight: TOUCH + 4, flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  iconBtn: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
});
