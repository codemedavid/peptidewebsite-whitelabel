import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { EditorSheet, Hint, Section, ToggleRow } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { useGroupBuySetting } from "./hooks";
import { ButtonGroup } from "./parts";
import {
  GB_CONTENT_LIMITS,
  normalizeGroupBuyContent,
  renderGbCopy,
  setWayAcceptOrders,
  setWayVisible,
  wayAcceptsOrders,
  wayIsVisible,
  type GroupBuyContent,
  type TwoWaysMode,
  type WayKey,
} from "./model";

/**
 * The store-wide Group Buy settings above the rounds list on the website:
 * Ways to order (saveTwoWaysModeAction), the on-hand-during-a-round toggle
 * (saveGroupBuyAllowOnHandAction) and the storefront copy
 * (saveGroupBuyContentAction). Each saves on its own, optimistically, and
 * reverts if the server refuses.
 */

const WAY_ROWS: { key: WayKey; other: WayKey; label: string }[] = [
  { key: "onHand", other: "groupBuy", label: "On-Hand (ships now)" },
  { key: "groupBuy", other: "onHand", label: "Group Buy (ships after close)" },
];

/** Controlled: the screen owns `ways` because the on-hand toggle only shows while on-hand is open. */
export function WaysCard({ ways, setWays }: { ways: TwoWaysMode; setWays: (m: TwoWaysMode) => void }) {
  const save = useGroupBuySetting<{ ok: true; mode: TwoWaysMode }>("saveTwoWaysModeAction");

  const apply = (next: TwoWaysMode) => {
    const prev = ways;
    setWays(next);
    save.mutate(next, {
      // The server re-normalizes — show what it actually stored.
      onSuccess: (res) => setWays(res.mode),
      onError: () => setWays(prev),
    });
  };

  return (
    <Section
      title="Ways to order"
      hint="Two switches per order path. Visibility decides whether customers see the section at all — Hidden takes it off the storefront (you can't hide both). Accept orders decides whether they can buy: Disabled keeps the products and prices on show while nothing can be added to cart."
    >
      {WAY_ROWS.map((row) => {
        const state = ways[row.key];
        const visible = wayIsVisible(state);
        const wouldEmptyStore = !wayIsVisible(ways[row.other]);
        return (
          <View key={row.key} style={{ gap: SPACE.sm }}>
            <AppText variant="bodyStrong">{row.label}</AppText>
            <ButtonGroup
              label="Visibility"
              value={visible ? "visible" : "hidden"}
              disabled={save.isPending}
              options={[
                { key: "visible", label: "Visible" },
                { key: "hidden", label: "Hidden", blocked: wouldEmptyStore },
              ]}
              onChange={(k) => apply({ ...ways, [row.key]: setWayVisible(state, k === "visible") })}
            />
            <ButtonGroup
              label="Accept orders"
              value={wayAcceptsOrders(state) ? "on" : "off"}
              disabled={save.isPending || !visible}
              options={[
                { key: "on", label: "Enabled" },
                { key: "off", label: "Disabled" },
              ]}
              onChange={(k) => apply({ ...ways, [row.key]: setWayAcceptOrders(state, k === "on") })}
            />
            {wouldEmptyStore && visible ? <Hint>Your store needs at least one way to order.</Hint> : null}
            {!visible ? <Hint>Make this way visible first to change ordering.</Hint> : null}
            {row.key === "groupBuy" && visible && !wayAcceptsOrders(state) ? (
              <Hint>
                Customers can browse the group buy products and prices, and see a “Group Buy Currently Closed” notice.
                Nothing can be added to cart.
              </Hint>
            ) : null}
          </View>
        );
      })}
    </Section>
  );
}

export function AllowOnHandCard({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const save = useGroupBuySetting<{ ok: true; allowOnHand: boolean }>("saveGroupBuyAllowOnHandAction");
  return (
    <Section title="During a live group buy">
      <ToggleRow
        label="Allow on-hand purchases during an active group buy"
        hint="With this off, customers can only buy the group-buy products — everything else shows “Available after group buy” and can't be added to cart."
        value={on}
        disabled={save.isPending}
        onChange={(next) => {
          setOn(next);
          save.mutate(next, { onError: () => setOn(!next) });
        }}
      />
    </Section>
  );
}

export function CopyCard({ content, onEdit }: { content: GroupBuyContent; onEdit: () => void }) {
  return (
    <Section title="Storefront copy">
      <AppText variant="body" color="muted">
        {`“${content.howTitle}” — ${content.steps.length} step${content.steps.length === 1 ? "" : "s"} and the live-round terms line, shown on the store home and the group-buy page.`}
      </AppText>
      <Button label="Edit copy" variant="secondary" icon="create-outline" onPress={onEdit} />
    </Section>
  );
}

/** The website's Storefront copy modal. Clearing a field resets it to the default. */
export function ContentEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: GroupBuyContent;
  onClose: () => void;
  onSaved: (c: GroupBuyContent) => void;
}) {
  const t = useTheme();
  const save = useGroupBuySetting<{ ok: true; content: GroupBuyContent }>("saveGroupBuyContentAction");
  const [howTitle, setHowTitle] = useState(initial.howTitle);
  const [steps, setSteps] = useState<string[]>(initial.steps);
  const [terms, setTerms] = useState(initial.terms);

  const dirty = howTitle !== initial.howTitle || terms !== initial.terms || steps.join("\n") !== initial.steps.join("\n");
  const termsPreview = renderGbCopy(terms.trim() || normalizeGroupBuyContent(undefined).terms, "3–4 weeks after the group buy closes");

  return (
    <EditorSheet
      visible
      title="Storefront copy"
      saveLabel="Save copy"
      canSave
      dirty={dirty}
      saving={save.isPending}
      onCancel={onClose}
      onSave={() =>
        save.mutate(normalizeGroupBuyContent({ howTitle, steps, terms }), {
          onSuccess: (res) => onSaved(res.content),
        })
      }
    >
      <Hint>
        Shown on the store home and the group-buy page. Use {"{eta}"} anywhere to insert the live round&apos;s delivery ETA.
        Clear a field to reset it to the default copy.
      </Hint>
      <Field
        label="Section title"
        value={howTitle}
        maxLength={GB_CONTENT_LIMITS.maxTitleLen}
        placeholder="How group buys work"
        onChangeText={setHowTitle}
      />
      <View style={{ gap: SPACE.sm }}>
        <AppText variant="label" color="muted">
          Steps
        </AppText>
        {steps.map((s, i) => (
          <View key={i} style={styles.step}>
            <View style={{ flex: 1 }}>
              <Field
                label={`Step ${i + 1}`}
                value={s}
                multiline
                maxLength={GB_CONTENT_LIMITS.maxTextLen}
                onChangeText={(v) => setSteps((cur) => cur.map((x, j) => (j === i ? v : x)))}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove step ${i + 1}`}
              hitSlop={8}
              onPress={() => setSteps((cur) => cur.filter((_, j) => j !== i))}
              style={styles.remove}
            >
              <Ionicons name="close-circle-outline" size={24} color={t.tone("danger").fg} />
            </Pressable>
          </View>
        ))}
        {steps.length < GB_CONTENT_LIMITS.maxSteps ? (
          <Button label="Add step" variant="secondary" icon="add" onPress={() => setSteps((cur) => [...cur, ""])} />
        ) : null}
      </View>
      <Field
        label="Live-round terms line"
        value={terms}
        multiline
        maxLength={GB_CONTENT_LIMITS.maxTextLen}
        placeholder="Pay now to lock your slot. Ships {eta}. COA posted before shipping."
        onChangeText={setTerms}
        hint={`Preview: ${termsPreview}`}
      />
    </EditorSheet>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm },
  remove: { width: 44, height: 48, alignItems: "center", justifyContent: "center" },
});
