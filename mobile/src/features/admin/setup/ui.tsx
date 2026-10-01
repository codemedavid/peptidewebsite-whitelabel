import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useNavigation } from "expo-router";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { AppText, Button, Card, type IconName } from "@/ui/primitives";

/**
 * Building blocks shared by the Store setup editors (app/(app)/manage/*):
 * the page scaffold, the sticky save bar + unsaved-changes guard, the item
 * editor sheet, and the form controls the website's <select>/<checkbox>
 * fields become on a phone.
 */

const tap = () => void Haptics.selectionAsync().catch(() => undefined);
const SAVED_FLASH_MS = 2200; // how long "Saved" shows, as on the website

// ── page scaffold ────────────────────────────────────────────────────────────

/** Loading / error states for a screen that needs the brand first. */
export function Loadable<T>({
  query,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown };
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) {
    return <ErrorState message={query.error?.message ?? "Please try again."} onRetry={() => void query.refetch()} />;
  }
  return <SkeletonList rows={4} />;
}

/** Keyboard-safe scrolling form with an optional footer that rides above the keyboard. */
export function FormPage({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    // keyboard-controller's view measures itself, so no header offset is needed.
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {children}
      </ScrollView>
      {footer}
    </KeyboardAvoidingView>
  );
}

/**
 * A list editor page: intro + "Add" button, the rows, and the website's empty
 * state ("No couriers yet. + Add your first courier"). Pull to refresh.
 */
export function ListPage({
  intro,
  addLabel,
  onAdd,
  isEmpty,
  empty,
  refreshing,
  onRefresh,
  toolbar,
  children,
}: {
  intro?: string;
  addLabel: string;
  onAdd: () => void;
  isEmpty: boolean;
  empty: { icon: IconName; title: string; action?: string };
  refreshing: boolean;
  onRefresh: () => void;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const t = useTheme();
  const online = useOnline();
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand.link} />}
      >
        {intro ? (
          <AppText variant="body" color="muted">
            {intro}
          </AppText>
        ) : null}
        <Button label={addLabel} icon="add" disabled={!online} onPress={onAdd} />
        {toolbar}
        {isEmpty ? (
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            action={empty.action && online ? { label: empty.action, onPress: onAdd } : undefined}
          />
        ) : (
          children
        )}
      </ScrollView>
    </View>
  );
}

/** A titled group of fields (the website's form cards). */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card style={{ gap: SPACE.lg }}>
      <View style={{ gap: 4 }}>
        <AppText variant="overline" color="link" accessibilityRole="header">
          {title.toUpperCase()}
        </AppText>
        {hint ? (
          <AppText variant="caption" color="muted">
            {hint}
          </AppText>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

export function Hint({ children, tone }: { children: ReactNode; tone?: "warning" | "danger" }) {
  const t = useTheme();
  return (
    <AppText variant="caption" color={tone ? t.tone(tone).fg : "faint"}>
      {children}
    </AppText>
  );
}

// ── save bar + unsaved-changes guard ────────────────────────────────────────

/**
 * Confirm before leaving with unsaved edits (back button, swipe, Android back).
 * Returns `allowLeave()` for a deliberate exit that should skip the prompt.
 */
export function useDiscardGuard(dirty: boolean, body = "Your changes haven't been saved.") {
  const navigation = useNavigation();
  const leaving = useRef(false);
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty });
    const sub = navigation.addListener("beforeRemove", (e) => {
      if (!dirty || leaving.current) return;
      e.preventDefault();
      Alert.alert("Discard changes?", body, [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return sub;
  }, [navigation, dirty, body]);
  return () => {
    leaving.current = true;
  };
}

/** Flash "Saved" after a successful save, cleared by the next edit. */
export function useSavedFlash(): [boolean, () => void, () => void] {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flash = () => {
    setShown(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), SAVED_FLASH_MS);
  };
  return [shown, flash, () => setShown(false)];
}

/** Sticky footer: unsaved/saved status + the Save button. Disabled offline. */
export function SaveBar({
  dirty,
  saving,
  saved,
  disabled,
  onSave,
  label = "Save",
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  disabled?: boolean;
  onSave: () => void;
  label?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const ok = t.tone("success");
  const status = !online ? "Reconnect to save" : saved ? "Saved" : dirty ? "Unsaved changes" : "No changes";
  return (
    <View
      style={[
        styles.saveBar,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border, paddingBottom: Math.max(insets.bottom, SPACE.md) },
      ]}
    >
      <View style={styles.saveStatus} accessibilityLiveRegion="polite">
        {saved ? <Ionicons name="checkmark-circle" size={18} color={ok.fg} /> : null}
        <AppText variant="label" color={saved ? ok.fg : dirty ? "text" : "muted"}>
          {status}
        </AppText>
      </View>
      <Button
        label={saving ? "Saving…" : label}
        icon="save-outline"
        loading={saving}
        disabled={!online || !!disabled}
        onPress={onSave}
        style={{ minWidth: 132 }}
      />
    </View>
  );
}

// ── controls ────────────────────────────────────────────────────────────────

/** The website's checkbox rows, as a labelled switch. */
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
    <View style={styles.toggle}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        {hint ? (
          <AppText variant="caption" color="muted">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: t.brand.primary, false: t.colors.border }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export type Choice<K extends string> = { key: K; label: string; hint?: string };

/** A <select> as wrapping, single-select pills — every option visible, no hidden menu. */
export function ChoicePills<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly Choice<K>[];
  value: K | "";
  onChange: (k: K) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.pills}>
        {options.map((o) => {
          const active = o.key === value;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
              onPress={() => {
                if (active) return;
                tap();
                onChange(o.key);
              }}
              style={({ pressed }) => [
                styles.pill,
                o.hint ? styles.pillTall : null,
                {
                  borderColor: active ? t.colors.text : t.colors.border,
                  backgroundColor: active ? t.colors.text : t.colors.surface,
                },
                pressed && !active ? { opacity: 0.7 } : null,
              ]}
            >
              <AppText variant="label" color={active ? t.colors.bg : "text"}>
                {o.label}
              </AppText>
              {o.hint ? (
                <AppText variant="caption" color={active ? t.colors.bg : "muted"}>
                  {o.hint}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** − value + for a bounded range (the website's sliders / number spinners). */
export function Stepper({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  const t = useTheme();
  const btn = (icon: IconName, delta: number, name: string) => {
    const next = Math.min(max, Math.max(min, value + delta));
    const off = next === value;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} ${label}`}
        disabled={off}
        onPress={() => {
          tap();
          onChange(next);
        }}
        style={[styles.stepBtn, { borderColor: t.colors.border, opacity: off ? 0.4 : 1 }]}
      >
        <Ionicons name={icon} size={20} color={t.colors.text} />
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      <View style={styles.stepper} accessible accessibilityLabel={`${label}: ${display}`}>
        {btn("remove", -step, "Decrease")}
        <AppText variant="bodyStrong" style={styles.stepValue}>
          {display}
        </AppText>
        {btn("add", step, "Increase")}
      </View>
    </View>
  );
}

// ── item editor sheet ───────────────────────────────────────────────────────

/**
 * The website's add/edit modal for one list row, as a page sheet. Cancelling a
 * dirty form asks first; Save stays disabled until the web's required fields
 * are filled (`canSave`) and while offline.
 */
export function EditorSheet({
  visible,
  title,
  saveLabel = "Save",
  canSave,
  dirty,
  saving,
  onCancel,
  onSave,
  children,
}: {
  visible: boolean;
  title: string;
  saveLabel?: string;
  canSave: boolean;
  dirty: boolean;
  saving?: boolean;
  onCancel: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const cancel = () => {
    if (!dirty) return onCancel();
    Alert.alert("Discard changes?", "What you entered here hasn't been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onCancel },
    ]);
  };
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={cancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <View
          style={[
            styles.sheetBar,
            { borderColor: t.colors.border, backgroundColor: t.colors.surface, paddingTop: Platform.OS === "android" ? insets.top + SPACE.sm : SPACE.md },
          ]}
        >
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={10} onPress={cancel} style={styles.sheetSide}>
            <AppText variant="bodyStrong" color="link">
              Cancel
            </AppText>
          </Pressable>
          <AppText variant="heading" numberOfLines={1} accessibilityRole="header" style={styles.sheetTitle}>
            {title}
          </AppText>
          <View style={[styles.sheetSide, { alignItems: "flex-end" }]} />
        </View>
        <FormPage
          footer={
            <View style={[styles.sheetFooter, { borderColor: t.colors.border, backgroundColor: t.colors.surface, paddingBottom: Math.max(insets.bottom, SPACE.md) }]}>
              <Button label={saveLabel} loading={saving} disabled={!canSave || !online} onPress={onSave} />
            </View>
          }
        >
          {children}
        </FormPage>
      </View>
    </Modal>
  );
}

// ── list rows ───────────────────────────────────────────────────────────────

/** One list entry: tap to edit, an Active switch, and a delete button. */
export function ItemCard({
  title,
  lines,
  badges,
  active,
  onToggle,
  onEdit,
  onDelete,
  leading,
  disabled,
}: {
  title: string;
  lines?: (string | null | false | undefined)[];
  badges?: ReactNode;
  active?: boolean;
  onToggle?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  leading?: ReactNode;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Card padded={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${title}`}
        onPress={onEdit}
        style={({ pressed }) => [styles.item, pressed ? { backgroundColor: t.colors.surfaceAlt } : null]}
      >
        {leading}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {title}
          </AppText>
          {lines
            ?.filter((l): l is string => typeof l === "string" && l.length > 0)
            .map((l, i) => (
              <AppText key={i} variant="caption" color="muted" numberOfLines={2}>
                {l}
              </AppText>
            ))}
          {badges ? <View style={styles.badges}>{badges}</View> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
      </Pressable>
      <View style={[styles.itemActions, { borderColor: t.colors.border }]}>
        {onToggle ? (
          <View style={styles.itemToggle}>
            <Switch
              accessibilityLabel={`${title} active`}
              value={!!active}
              disabled={disabled}
              onValueChange={onToggle}
              trackColor={{ true: t.brand.primary, false: t.colors.border }}
              thumbColor="#FFFFFF"
            />
            <AppText variant="label" color={active ? "text" : "muted"}>
              {active ? "Active" : "Inactive"}
            </AppText>
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${title}`}
          disabled={disabled}
          hitSlop={8}
          onPress={onDelete}
          style={({ pressed }) => [styles.delete, pressed ? { opacity: 0.6 } : null, disabled ? { opacity: 0.4 } : null]}
        >
          <Ionicons name="trash-outline" size={18} color={t.tone("danger").fg} />
          <AppText variant="label" color={t.tone("danger").fg}>
            Delete
          </AppText>
        </Pressable>
      </View>
    </Card>
  );
}

/** "Delete this payment method?" — the website's confirm(), then `run`. */
export function confirmDelete(question: string, run: () => void) {
  Alert.alert(question, undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: run },
  ]);
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  saveBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveStatus: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  toggle: { flexDirection: "row", alignItems: "center", gap: SPACE.md, minHeight: TOUCH },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  pill: {
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    justifyContent: "center",
  },
  pillTall: { borderRadius: RADIUS.md, minWidth: 128 },
  stepper: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  stepBtn: { width: TOUCH, height: TOUCH, borderRadius: RADIUS.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepValue: { minWidth: 72, textAlign: "center", fontVariant: ["tabular-nums"] },
  sheetBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetSide: { width: 72, minHeight: 32, justifyContent: "center" },
  sheetTitle: { flex: 1, textAlign: "center" },
  sheetFooter: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  item: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.lg },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemToggle: { flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  delete: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, paddingHorizontal: SPACE.sm },
});
