import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "expo-router";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityTagDesign, CommunityTagRole, CommunityTags } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useCommunityTags, useSaveCommunityTags } from "../hooks/useCommunityData";
import {
  DEFAULT_TAGS,
  TAG_ICONS,
  TAG_LABEL_MAX,
  TAG_SHAPES,
  TAG_STYLES,
  TAG_SWATCHES,
  changedTags,
  hexFromInput,
  isSwatch,
  readableInk,
  tagProblem,
} from "../lib/tagLook";
import { CHAT, GUTTER, INTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { Avatar } from "./Avatar";
import { ChatButton } from "./ChatKit";
import { ChatText } from "./ChatText";
import { Field, FormError } from "./Form";
import { NavBar } from "./Headers";
import { RoleBadge } from "./RoleBadge";

const SAVED_FLASH_MS = 1800;
const ROLE_CAPTION: Record<CommunityTagRole, string> = { admin: "Community admins", reseller: "Verified resellers" };

/** Asks before leaving with unsaved edits — a native alert, or the browser's confirm on web. */
function useDiscardGuard(dirty: boolean) {
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty });
    return navigation.addListener("beforeRemove", (e) => {
      if (!dirty) return;
      e.preventDefault();
      const leave = () => navigation.dispatch(e.data.action);
      if (Platform.OS === "web") {
        if (globalThis.confirm?.("Discard your tag changes?")) leave();
        return;
      }
      Alert.alert("Discard changes?", "Your tag changes haven't been saved.", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: leave },
      ]);
    });
  }, [navigation, dirty]);
}

function Group({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginLeft: 2 }}>
        <ChatText variant="overline" accessibilityRole="header">
          {title}
        </ChatText>
        {value ? <ChatText variant="caption">{value}</ChatText> : null}
      </View>
      {children}
    </View>
  );
}

/** A choice shown as the thing itself (the tag in that style / shape), not a word. */
function OptionTile({ selected, label, onPress, children }: { selected: boolean; label: string; onPress: () => void; children: ReactNode }) {
  const b = useChatBrand();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 84,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        borderRadius: RADII.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? b.brand : CHAT.hairline,
        backgroundColor: pressed ? CHAT.surfacePressed : selected ? b.brandTint : CHAT.surface,
        paddingVertical: 12,
        paddingHorizontal: 6,
      })}
    >
      {children}
      <ChatText variant="caption" color={selected ? b.brandText : CHAT.inkMuted} style={{ fontFamily: selected ? INTER.semibold : INTER.medium, textAlign: "center" }}>
        {label}
      </ChatText>
    </Pressable>
  );
}

/** Both tags side by side: pick which one to edit, and see both at a glance. */
function RolePicker({ value, draft, edited, onChange }: { value: CommunityTagRole; draft: CommunityTags; edited: Partial<CommunityTags>; onChange: (r: CommunityTagRole) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }} accessibilityRole="radiogroup">
      {(["admin", "reseller"] as const).map((r) => (
        <OptionTile key={r} selected={value === r} label={`${ROLE_CAPTION[r]}${edited[r] ? " · edited" : ""}`} onPress={() => onChange(r)}>
          <RoleBadge role={r} design={draft[r]} size="md" />
        </OptionTile>
      ))}
    </View>
  );
}

/** The tag where members will meet it: the profile band and a member row. */
function Preview({ role, design }: { role: CommunityTagRole; design: CommunityTagDesign }) {
  const b = useChatBrand();
  const { me } = useSignedIn();
  const name = me.account.displayName;
  const hue = me.community.profile?.avatarHue ?? 0;
  return (
    <View style={[{ borderRadius: RADII.lg, overflow: "hidden", backgroundColor: CHAT.surface }, SHADOWS.card]} accessibilityLabel={`Preview of the ${design.label} tag`}>
      <LinearGradient colors={[b.brand, b.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ borderWidth: 2, borderColor: "rgba(255,255,255,0.85)", borderRadius: 30 }}>
          <Avatar name={name} hue={hue} imageUrl={me.account.avatarUrl} size={52} />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <ChatText variant="headline" color={b.onBrand} numberOfLines={1}>
            {name}
          </ChatText>
          <RoleBadge role={role} design={design} surface="brand" />
        </View>
        <ChatText variant="caption" color={b.onBrand} style={{ opacity: 0.85 }}>
          Profile
        </ChatText>
      </LinearGradient>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
        <Avatar name={name} hue={hue} imageUrl={me.account.avatarUrl} size={40} />
        <View style={{ flex: 1, gap: 4 }}>
          <ChatText variant="bodyStrong" numberOfLines={1}>
            {name}
          </ChatText>
          <RoleBadge role={role} design={design} />
        </View>
        <ChatText variant="caption">Members</ChatText>
      </View>
    </View>
  );
}

function Swatch({ color, selected, label, onPress, children }: { color: string; selected: boolean; label: string; onPress: () => void; children?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: selected ? CHAT.ink : "transparent", opacity: pressed ? 0.75 : 1 })}
    >
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: color, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(15,17,21,0.08)" }}>
        {selected ? <Ionicons name="checkmark" size={18} color={readableInk(color)} /> : children}
      </View>
    </Pressable>
  );
}

function ColorPicker({ color, onChange }: { color: string | null; onChange: (c: string | null) => void }) {
  const b = useChatBrand();
  const custom = !isSwatch(color);
  const [open, setOpen] = useState(custom);
  const [hex, setHex] = useState(custom && color ? color : "");
  const typed = hexFromInput(hex);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }} accessibilityRole="radiogroup">
        {TAG_SWATCHES.map((s) => (
          <Swatch
            key={s.name}
            color={s.value ?? b.brand}
            selected={!open && color === s.value}
            label={s.name}
            onPress={() => {
              setOpen(false);
              onChange(s.value);
            }}
          >
            {s.value === null ? <Ionicons name="storefront" size={14} color={readableInk(b.brand)} /> : null}
          </Swatch>
        ))}
        <Swatch color={open && typed ? typed : CHAT.surfaceAlt} selected={open} label="Custom colour" onPress={() => setOpen(true)}>
          <Ionicons name="color-palette-outline" size={17} color={CHAT.inkSoft} />
        </Swatch>
      </View>
      {open ? (
        <Field
          label="Custom colour"
          value={hex}
          onChangeText={(t) => {
            setHex(t);
            const next = hexFromInput(t);
            if (next) onChange(next);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          icon="color-fill-outline"
          placeholder="#7C3AED"
          hint={hex && !typed ? "Six letters or numbers, like #7C3AED." : "Text on the tag stays readable on any colour."}
        />
      ) : null}
    </View>
  );
}

function IconPicker({ icon, color, onChange }: { icon: CommunityTagDesign["icon"]; color: string; onChange: (i: CommunityTagDesign["icon"]) => void }) {
  const b = useChatBrand();
  const cell = (key: string, selected: boolean, label: string, onPress: () => void, body: ReactNode) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: "18%",
        aspectRatio: 1,
        borderRadius: RADII.md,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? b.brand : CHAT.hairline,
        backgroundColor: pressed ? CHAT.surfacePressed : selected ? b.brandTint : CHAT.surface,
      })}
    >
      {body}
    </Pressable>
  );
  return (
    // 15 cells (no icon + 14) → an even 5 × 3 grid.
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 }} accessibilityRole="radiogroup">
      {cell("none", icon === null, "No icon", () => onChange(null), <ChatText variant="subhead" color={CHAT.inkMuted}>Aa</ChatText>)}
      {TAG_ICONS.map((name) => cell(name, icon === name, name.replace(/-/g, " "), () => onChange(name), <Ionicons name={name} size={20} color={icon === name ? color : CHAT.inkSoft} />))}
    </View>
  );
}

/** Member tags: the team or a community admin picks how Admin and Verified reseller look. */
export function TagStudio() {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const saved = useCommunityTags();
  const save = useSaveCommunityTags();
  const [draft, setDraft] = useState<CommunityTags>(saved);
  const [role, setRole] = useState<CommunityTagRole>("admin");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const design = draft[role];
  const edited = changedTags(draft, saved);
  const editedCount = Object.keys(edited).length;
  const dirty = editedCount > 0;
  useDiscardGuard(dirty && !save.isPending);

  const patch = (next: Partial<CommunityTagDesign>) => {
    setError(null);
    setFlash(false);
    setDraft((d) => ({ ...d, [role]: { ...d[role], ...next } }));
  };
  const onSave = () => {
    const problem = (["admin", "reseller"] as const).map((r) => tagProblem(draft[r])).find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    save.mutate(edited, {
      onSuccess: (res) => {
        setDraft(res.tags);
        setFlash(true);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setFlash(false), SAVED_FLASH_MS);
      },
      onError: (e) => setError(e.message),
    });
  };
  const isDefault = changedTags({ ...draft, [role]: design }, { ...draft, [role]: DEFAULT_TAGS[role] })[role] === undefined;
  const swatchName = TAG_SWATCHES.find((s) => s.value === design.color)?.name ?? design.color ?? "";

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <NavBar title="Member tags" subtitle="How Admin and Verified reseller look" />
      <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 24, paddingBottom: 132 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <RolePicker value={role} draft={draft} edited={edited} onChange={setRole} />
        <Preview role={role} design={design} />

        <Field
          label="Tag name"
          value={design.label}
          onChangeText={(t) => patch({ label: t })}
          maxLength={TAG_LABEL_MAX}
          counter
          icon="pricetag-outline"
          placeholder={DEFAULT_TAGS[role].label}
        />

        <Group title="Colour" value={swatchName}>
          <ColorPicker key={role} color={design.color} onChange={(c) => patch({ color: c })} />
        </Group>

        <Group title="Style">
          <View style={{ flexDirection: "row", gap: 10 }} accessibilityRole="radiogroup">
            {TAG_STYLES.map((s) => (
              <OptionTile key={s.value} selected={design.style === s.value} label={s.label} onPress={() => patch({ style: s.value })}>
                <RoleBadge role={role} design={{ ...design, style: s.value }} />
              </OptionTile>
            ))}
          </View>
        </Group>

        <Group title="Bubble">
          <View style={{ flexDirection: "row", gap: 10 }} accessibilityRole="radiogroup">
            {TAG_SHAPES.map((s) => (
              <OptionTile key={s.value} selected={design.shape === s.value} label={s.label} onPress={() => patch({ shape: s.value })}>
                <RoleBadge role={role} design={{ ...design, shape: s.value }} />
              </OptionTile>
            ))}
          </View>
        </Group>

        <Group title="Icon">
          <IconPicker icon={design.icon} color={design.color ?? b.brand} onChange={(i) => patch({ icon: i })} />
        </Group>

        {isDefault ? null : (
          <Pressable onPress={() => patch(DEFAULT_TAGS[role])} accessibilityRole="button" hitSlop={8} style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 }}>
            <Ionicons name="refresh" size={15} color={CHAT.inkMuted} />
            <ChatText variant="subhead" color={CHAT.inkMuted}>
              Reset this tag to the original look
            </ChatText>
          </Pressable>
        )}
      </ScrollView>

      <View style={[{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: CHAT.surface, borderTopWidth: 1, borderTopColor: CHAT.hairline, gap: 8 }, SHADOWS.float]}>
        <FormError message={error} />
        <ChatButton
          label={flash ? "Saved" : dirty ? (editedCount === 2 ? "Save both tags" : "Save changes") : "No changes yet"}
          icon={flash ? "checkmark-circle" : undefined}
          size="lg"
          loading={save.isPending}
          disabled={!dirty}
          onPress={onSave}
        />
        <ChatText variant="caption" style={{ textAlign: "center" }}>
          Every member sees the new look right away.
        </ChatText>
      </View>
    </View>
  );
}
