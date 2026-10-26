import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { EditorSheet, Hint, Section, ToggleRow } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { LiveStripView } from "@/features/shop/components/group-buy/LiveGroupBuyStrip";
import { useGroupBuySetting } from "./hooks";
import { ButtonGroup } from "./parts";
import {
  GB_CONTENT_LIMITS,
  GB_LIVE_BANNER_LIMITS,
  HERO_COUNTDOWN_AUTO_HEADING,
  HERO_COUNTDOWN_LIMITS,
  normalizeHeroCountdown,
  normalizeGroupBuyContent,
  normalizeGroupBuyLiveBanner,
  renderGbCopy,
  renderGroupBuyLiveBanner,
  setWayAcceptOrders,
  setWayVisible,
  wayAcceptsOrders,
  wayIsVisible,
  type GroupBuyContent,
  type GroupBuyLiveBanner,
  type HeroCountdownConfig,
  type TwoWaysMode,
  type WayKey,
} from "./model";

/**
 * The store-wide Group Buy settings above the rounds list on the website:
 * Ways to order (saveTwoWaysModeAction), the on-hand-during-a-round toggle
 * (saveGroupBuyAllowOnHandAction) and the storefront copy
 * (saveGroupBuyContentAction) — plus the app-only live strip
 * (saveGroupBuyLiveBannerAction) and the website hero's countdown
 * (saveHeroCountdownAction). Each saves on its own, optimistically, and
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

// ── Live banner (the customer app's strip above the tab bar) ────────────────

type PreviewRound = { name: string; description: string; deliveryEta: string };

function StripPreview({ config, round }: { config: GroupBuyLiveBanner; round: PreviewRound }) {
  const text = renderGroupBuyLiveBanner({ ...config, enabled: true }, round);
  if (!text) return null;
  return (
    <View style={styles.preview}>
      <LiveStripView {...text} statusLabel="Closes in 3 days" tone="soon" a11y={`Preview: ${text.headline}. ${text.message}`} />
    </View>
  );
}

/** Controlled: the screen owns the value so the editor and the switch share it. */
export function LiveBannerCard({
  value,
  setValue,
  round,
  onEdit,
}: {
  value: GroupBuyLiveBanner;
  setValue: (v: GroupBuyLiveBanner) => void;
  round: PreviewRound;
  onEdit: () => void;
}) {
  const save = useGroupBuySetting<{ ok: true; liveBanner: GroupBuyLiveBanner }>("saveGroupBuyLiveBannerAction");
  return (
    <Section
      title="Live banner (app)"
      hint="A strip above the tab bar on every screen of your customer app while a group buy is open. Tapping it opens the group buy. It hides itself when ordering is paused or the round closes."
    >
      <ToggleRow
        label="Show the live banner"
        value={value.enabled}
        disabled={save.isPending}
        onChange={(enabled) => {
          const prev = value;
          setValue({ ...value, enabled });
          save.mutate({ ...value, enabled }, { onSuccess: (res) => setValue(res.liveBanner), onError: () => setValue(prev) });
        }}
      />
      {value.enabled ? (
        <>
          <StripPreview config={value} round={round} />
          <Button label="Edit banner text" variant="secondary" icon="create-outline" onPress={onEdit} />
        </>
      ) : (
        <Hint>Customers won&apos;t see a banner. The group buy is still on the Shop tab.</Hint>
      )}
    </Section>
  );
}

/** Headline, message, button label — blank = automatic text from the live round. */
export function LiveBannerEditor({
  initial,
  round,
  onClose,
  onSaved,
}: {
  initial: GroupBuyLiveBanner;
  round: PreviewRound;
  onClose: () => void;
  onSaved: (v: GroupBuyLiveBanner) => void;
}) {
  const save = useGroupBuySetting<{ ok: true; liveBanner: GroupBuyLiveBanner }>("saveGroupBuyLiveBannerAction");
  const [headline, setHeadline] = useState(initial.headline);
  const [message, setMessage] = useState(initial.message);
  const [ctaLabel, setCtaLabel] = useState(initial.ctaLabel);
  const draft = normalizeGroupBuyLiveBanner({ enabled: initial.enabled, headline, message, ctaLabel });
  const dirty = draft.headline !== initial.headline || draft.message !== initial.message || draft.ctaLabel !== initial.ctaLabel;

  return (
    <EditorSheet
      visible
      title="Live banner"
      saveLabel="Save banner"
      canSave
      dirty={dirty}
      saving={save.isPending}
      onCancel={onClose}
      onSave={() => save.mutate(draft, { onSuccess: (res) => onSaved(res.liveBanner) })}
    >
      <Hint>
        Leave a field blank to use automatic text from the live round. Use {"{name}"} for the round&apos;s name and {"{eta}"} for its
        delivery ETA.
      </Hint>
      <StripPreview config={draft} round={round} />
      <Field
        label="Headline"
        value={headline}
        maxLength={GB_LIVE_BANNER_LIMITS.headline}
        placeholder={`${round.name} is live`}
        onChangeText={setHeadline}
      />
      <Field
        label="Message"
        value={message}
        multiline
        maxLength={GB_LIVE_BANNER_LIMITS.message}
        placeholder={round.description.trim() || "Lock your slot at the group price."}
        onChangeText={setMessage}
      />
      <Field
        label="Button label"
        value={ctaLabel}
        maxLength={GB_LIVE_BANNER_LIMITS.ctaLabel}
        placeholder="Join now"
        onChangeText={setCtaLabel}
      />
    </EditorSheet>
  );
}

// ── Hero countdown (the website's "opens in / closes in" timer) ─────────────

const PREVIEW_UNITS = [
  { label: "Days", value: "2" },
  { label: "Hours", value: "04" },
  { label: "Mins", value: "11" },
  { label: "Secs", value: "09" },
] as const;

/** A still of the website's countdown tiles, in the store's own colours. */
function CountdownPreview({ heading }: { heading: string | null }) {
  const t = useTheme();
  return (
    <View
      style={[styles.countdown, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
      accessibilityLabel={`Preview: ${heading ?? "countdown without text"}`}
    >
      {heading ? (
        <AppText variant="overline" style={{ color: t.brand.primary }}>
          {heading}
        </AppText>
      ) : null}
      <View style={styles.countdownRow}>
        {PREVIEW_UNITS.map((u) => (
          <View key={u.label} style={[styles.countdownUnit, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
            <AppText variant="heading" style={{ color: t.brand.primary, fontVariant: ["tabular-nums"] }}>
              {u.value}
            </AppText>
            <AppText variant="caption" color="muted">
              {u.label}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const headingFor = (typed: string, auto: string, round: string) => (typed || auto).split("{name}").join(round || "Group buy");

/** Controlled: the screen owns the value so the editor and the switches share it. */
export function HeroCountdownCard({
  value,
  setValue,
  roundName,
  onEdit,
}: {
  value: HeroCountdownConfig;
  setValue: (v: HeroCountdownConfig) => void;
  roundName: string;
  onEdit: () => void;
}) {
  const save = useGroupBuySetting<{ ok: true; countdown: HeroCountdownConfig }>("saveHeroCountdownAction");
  const apply = (next: HeroCountdownConfig) => {
    const prev = value;
    setValue(next);
    save.mutate(next, { onSuccess: (res) => setValue(res.countdown), onError: () => setValue(prev) });
  };
  const heading = value.showHeading ? headingFor(value.closingHeading, HERO_COUNTDOWN_AUTO_HEADING.closing, roundName) : null;

  return (
    <Section
      title="Hero countdown (website)"
      hint="A live timer in your website's hero. While a round is open it counts down to its end date. Between rounds it counts down to the next scheduled round's start date. It hides itself when no round has a date."
    >
      <ToggleRow label="Show the countdown" value={value.enabled} disabled={save.isPending} onChange={(enabled) => apply({ ...value, enabled })} />
      {value.enabled ? (
        <>
          <ToggleRow
            label="Text on top of the countdown"
            value={value.showHeading}
            disabled={save.isPending}
            onChange={(showHeading) => apply({ ...value, showHeading })}
          />
          <CountdownPreview heading={heading} />
          {value.showHeading ? (
            <Button label="Edit countdown text" variant="secondary" icon="create-outline" onPress={onEdit} />
          ) : null}
        </>
      ) : (
        <Hint>Customers won&apos;t see a countdown on your website.</Hint>
      )}
    </Section>
  );
}

/** The two heading texts — blank = the automatic text for that phase. */
export function HeroCountdownEditor({
  initial,
  roundName,
  onClose,
  onSaved,
}: {
  initial: HeroCountdownConfig;
  roundName: string;
  onClose: () => void;
  onSaved: (v: HeroCountdownConfig) => void;
}) {
  const save = useGroupBuySetting<{ ok: true; countdown: HeroCountdownConfig }>("saveHeroCountdownAction");
  const [closingHeading, setClosingHeading] = useState(initial.closingHeading);
  const [openingHeading, setOpeningHeading] = useState(initial.openingHeading);
  const draft = normalizeHeroCountdown({ ...initial, closingHeading, openingHeading });
  const dirty = draft.closingHeading !== initial.closingHeading || draft.openingHeading !== initial.openingHeading;

  return (
    <EditorSheet
      visible
      title="Countdown text"
      saveLabel="Save text"
      canSave
      dirty={dirty}
      saving={save.isPending}
      onCancel={onClose}
      onSave={() => save.mutate(draft, { onSuccess: (res) => onSaved(res.countdown) })}
    >
      <Hint>
        The line shown on top of the countdown. Use {"{name}"} for the round&apos;s name. Leave a field blank to use the default
        text shown in it.
      </Hint>
      <Field
        label="While a round is open"
        value={closingHeading}
        maxLength={HERO_COUNTDOWN_LIMITS.heading}
        placeholder={HERO_COUNTDOWN_AUTO_HEADING.closing}
        onChangeText={setClosingHeading}
      />
      <CountdownPreview heading={headingFor(draft.closingHeading, HERO_COUNTDOWN_AUTO_HEADING.closing, roundName)} />
      <Field
        label="Before a round opens"
        value={openingHeading}
        maxLength={HERO_COUNTDOWN_LIMITS.heading}
        placeholder={HERO_COUNTDOWN_AUTO_HEADING.opening}
        onChangeText={setOpeningHeading}
      />
      <CountdownPreview heading={headingFor(draft.openingHeading, HERO_COUNTDOWN_AUTO_HEADING.opening, roundName)} />
    </EditorSheet>
  );
}

const styles = StyleSheet.create({
  preview: { borderRadius: 14, overflow: "hidden" },
  step: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm },
  remove: { width: 44, height: 48, alignItems: "center", justifyContent: "center" },
  countdown: { alignItems: "center", gap: SPACE.sm, padding: SPACE.md, borderRadius: 14, borderWidth: 1 },
  countdownRow: { flexDirection: "row", gap: SPACE.sm },
  countdownUnit: { minWidth: 58, alignItems: "center", paddingVertical: SPACE.sm, borderRadius: 12, borderWidth: 1 },
});
