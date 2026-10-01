import { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import {
  MAX_NOTICE_DELIVERY_LINES,
  MAX_NOTICE_PARAGRAPHS,
  NOTICE_TITLE_MAX,
  normalizeNoticeModal,
  toLines,
  toParagraphs,
  type NoticeModal,
} from "@/features/admin/rules/content";
import { NoticeModalPreview } from "@/features/admin/rules/previews";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { Pill } from "@/ui/primitives";

/**
 * The website's Notice Modal (AdminNoticeModal → saveNoticeModalAction): the
 * pop-up every customer sees when they open the store until they tap agree.
 * The operator grants the feature (showAdminNotice); the owner switches it on
 * and writes every line. The server keeps the grant and sanitizes the copy.
 */
export default function NoticeScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Notice modal" }} />
      <Loadable query={brand}>
        {(b) =>
          b.showAdminNotice === true ? (
            <Editor brand={b} />
          ) : (
            <EmptyState
              icon="lock-closed-outline"
              title="Notice Modal isn't available"
              body="Your provider hasn't switched the storefront notice on for this store yet."
            />
          )
        }
      </Loadable>
    </>
  );
}

type Draft = {
  enabled: boolean;
  title: string;
  subtitle: string;
  body: string;
  warningTitle: string;
  warningBody: string;
  deliveryTitle: string;
  deliveryLines: string;
  agreeLabel: string;
  footerNote: string;
};

const draftFrom = (n: NoticeModal): Draft => ({
  enabled: n.enabled,
  title: n.title,
  subtitle: n.subtitle,
  body: n.bodyParagraphs.join("\n\n"),
  warningTitle: n.warningTitle,
  warningBody: n.warningBody,
  deliveryTitle: n.deliveryTitle,
  deliveryLines: n.deliveryLines.join("\n"),
  agreeLabel: n.agreeLabel,
  footerNote: n.footerNote,
});

/** Exactly what the website form sends — the server normalizes it. */
const payloadOf = (d: Draft) => ({
  enabled: d.enabled,
  title: d.title,
  subtitle: d.subtitle,
  bodyParagraphs: toParagraphs(d.body),
  warningTitle: d.warningTitle,
  warningBody: d.warningBody,
  deliveryTitle: d.deliveryTitle,
  deliveryLines: toLines(d.deliveryLines),
  agreeLabel: d.agreeLabel,
  footerNote: d.footerNote,
});

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState(() => normalizeNoticeModal(brand.noticeModal));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved));
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveNoticeModalAction");

  // The config as it will persist, so the preview and the dirty check match what ships.
  // operatorEnabled is forced on only so it renders; the server keeps the real grant.
  const preview = normalizeNoticeModal({ ...payloadOf(draft), operatorEnabled: true });
  const dirty = JSON.stringify({ ...preview, operatorEnabled: false }) !== JSON.stringify({ ...saved, operatorEnabled: false });
  useDiscardGuard(dirty);

  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => {
    hideSaved();
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const paragraphs = toParagraphs(draft.body).filter((p) => p.trim()).length;
  const lines = toLines(draft.deliveryLines).filter((l) => l.trim()).length;

  function onSave() {
    save.mutate(payloadOf(draft), {
      onSuccess: () => {
        setSaved(preview);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  const titleField = (key: "title" | "subtitle" | "warningTitle" | "deliveryTitle" | "agreeLabel" | "footerNote", label: string, placeholder: string, hint?: string) => (
    <Field label={label} value={draft[key]} onChangeText={set(key)} maxLength={NOTICE_TITLE_MAX} placeholder={placeholder} hint={hint} />
  );

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} onSave={onSave} />}>
      <Section
        title="Storefront notice"
        hint="A pop-up shown to every customer each time they open your store. Use it for a disclaimer, delivery cut-offs or any must-read note."
      >
        <Pill
          tone={draft.enabled ? "success" : "neutral"}
          icon={draft.enabled ? "eye-outline" : "eye-off-outline"}
          label={draft.enabled ? "Shown to customers" : "Hidden from customers"}
        />
        <ToggleRow
          label="Show the notice modal on my storefront"
          hint="When on, the notice appears on every visit until the customer taps the agree button. Turn it off to hide it without losing your copy."
          value={draft.enabled}
          onChange={set("enabled")}
        />
      </Section>

      <Section title="Header & body">
        {titleField("title", "Title", "Important Notice")}
        {titleField("subtitle", "Subtitle", "Please read before continuing")}
        <Field
          label="Body"
          value={draft.body}
          onChangeText={set("body")}
          multiline
          placeholder="One paragraph per block. Separate paragraphs with a blank line."
          hint={`Separate paragraphs with a blank line. ${paragraphs}/${MAX_NOTICE_PARAGRAPHS} paragraphs.`}
          error={paragraphs > MAX_NOTICE_PARAGRAPHS ? `Only the first ${MAX_NOTICE_PARAGRAPHS} paragraphs are kept.` : null}
        />
      </Section>

      <Section title="Warning callout" hint="Leave both blank to hide this red callout.">
        {titleField("warningTitle", "Warning title", "NO MEET UPS · NO PICK UPS · NO RUSH ORDERS")}
        <Field
          label="Warning body"
          value={draft.warningBody}
          onChangeText={set("warningBody")}
          multiline
          placeholder="Orders are processed and shipped in the order received."
        />
      </Section>

      <Section title="Delivery cut-off" hint="Leave the lines blank to hide this box.">
        {titleField("deliveryTitle", "Section title", "DELIVERY CUT-OFF TIMES")}
        <Field
          label="Lines"
          value={draft.deliveryLines}
          onChangeText={set("deliveryLines")}
          multiline
          placeholder={"J&T Express: Cut-off 3:00 PM.\nSame-Day: booking starts 2:00 PM."}
          hint={`One line per entry. ${lines}/${MAX_NOTICE_DELIVERY_LINES} lines.`}
          error={lines > MAX_NOTICE_DELIVERY_LINES ? `Only the first ${MAX_NOTICE_DELIVERY_LINES} lines are kept.` : null}
        />
      </Section>

      <Section title="Footer">
        {titleField("agreeLabel", "Agree button label", "I Understand & Agree")}
        {titleField("footerNote", "Footer note", "This notice is shown on every visit to the storefront.")}
      </Section>

      <Section
        title="Preview"
        hint={draft.enabled ? "What customers see when they open your store." : "Currently hidden from customers — this is how it would look."}
      >
        <NoticeModalPreview config={preview} />
        <Hint>{"The live pop-up uses your storefront's colours and fonts."}</Hint>
      </Section>
    </FormPage>
  );
}
