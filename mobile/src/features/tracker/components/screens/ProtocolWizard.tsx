/**
 * PROTOCOL SETUP (TRACKER.md §4): one step per screen with a progress bar —
 * Compound → Dose → Schedule → Reminders → Review. Opened with:
 *   ?id=        edit (opens on Review; each section jumps back to its step)
 *   ?guide=     an editable draft from the store's guide (labelled, never auto-saved)
 *   ?orderKey=  from a delivered order line: name + vial size prefilled; saving
 *               also adds that vial (unopened, or in use once water is entered)
 * Nothing schedules until Save. NO dose suggestions: the dose starts empty
 * unless the user's own protocol or the store's guide (labelled) says one.
 */
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { TrackerOrderVial, TrackerStoreGuide } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { INPUT_CAPS } from "../../lib/caps";
import { saveProtocol, saveVial, useOrderVials, useProtocols, useStoreGuides, useTrackerState } from "../../hooks";
import { parseAmount } from "../../lib/dose-math";
import { dayKey } from "../../lib/ids";
import { emptyForm, formDraw, formFromGuide, formFromProtocol, formToProtocol, routeOf, type ProtocolForm } from "../../lib/protocol-form";
import type { Protocol, TrackerSettings } from "../../lib/types";
import { vialFromOrder, withVialMix } from "../../lib/vials";
import { ensureTrackerNotificationPermission } from "../../reminders";
import { confirm } from "../dialog";
import { PressButton, TText } from "../kit";
import { trackerHref } from "../routes";
import { SheetScreen } from "../sheets";
import { CompoundStep } from "../setup/CompoundStep";
import { DoseStep } from "../setup/DoseStep";
import { GuideNotice, RemindersStep, ReviewStep, type SetupStep } from "../setup/ReviewStep";
import { ScheduleStep } from "../setup/ScheduleStep";
import { TSPACE, useTrackerTheme } from "../theme";
import { showTrackerToast } from "../toast";

type Params = { id?: string; guide?: string; orderKey?: string };

const STEPS: { key: SetupStep; title: string; subtitle: string }[] = [
  { key: "compound", title: "What are you taking?", subtitle: "Type a name or pick from the shop." },
  { key: "dose", title: "Your dose", subtitle: "Exactly as you and your clinician decided." },
  { key: "schedule", title: "When", subtitle: "How often and at what time." },
  { key: "reminders", title: "Reminders", subtitle: "A nudge at each dose time." },
  { key: "review", title: "Review", subtitle: "Check every number, then save." },
];

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.home());
}

export function ProtocolWizard() {
  const params = useLocalSearchParams<Params>();
  const { isLoaded, data } = useTrackerState();
  const { protocols } = useProtocols();
  const guides = useStoreGuides();
  const orders = useOrderVials(!!params.orderKey);
  const waitingGuide = !!params.guide && guides.isPending && guides.fetchStatus !== "idle";
  const waitingOrder = !!params.orderKey && orders.isPending;

  if (!isLoaded || waitingGuide || waitingOrder) {
    return (
      <SheetScreen title="Protocol" onClose={close} isFullScreen>
        <TText variant="body" color="soft">
          Getting things ready…
        </TText>
      </SheetScreen>
    );
  }
  const existing = params.id ? protocols.find((p) => p.id === params.id) : undefined;
  if (params.id && !existing) {
    return (
      <SheetScreen title="Protocol" onClose={close} isFullScreen>
        <TText variant="body" color="soft">
          This protocol isn’t on this phone any more.
        </TText>
      </SheetScreen>
    );
  }
  const guide = params.guide ? (guides.data ?? []).find((g) => g.name === params.guide) : undefined;
  const line = params.orderKey ? (orders.data ?? []).find((l) => l.key === params.orderKey) : undefined;
  return (
    <WizardForm
      existing={existing ? withVialMix(existing, data.vials) : undefined}
      guide={guide}
      line={line}
      settings={data.settings}
      protocolCount={protocols.length}
    />
  );
}

function initialForm(existing: Protocol | undefined, guide: TrackerStoreGuide | undefined, line: TrackerOrderVial | undefined, settings: TrackerSettings, count: number): ProtocolForm {
  if (existing) return formFromProtocol(existing, settings.defaultSyringe);
  const base = emptyForm(dayKey(new Date()), settings.defaultSyringe, count);
  if (guide) return formFromGuide(guide, base);
  if (line) {
    return {
      ...base,
      name: line.name.slice(0, INPUT_CAPS.name),
      catalogId: line.productId,
      ...(line.strength ? { vialAmount: String(line.strength.value), vialUnit: line.strength.unit } : {}),
      source: { kind: "order", key: line.key },
    };
  }
  return base;
}

type FormProps = {
  existing: Protocol | undefined;
  guide: TrackerStoreGuide | undefined;
  line: TrackerOrderVial | undefined;
  settings: TrackerSettings;
  protocolCount: number;
};

function WizardForm({ existing, guide, line, settings, protocolCount }: FormProps) {
  const th = useTrackerTheme();
  const { me } = useSignedIn();
  const [start] = useState(() => initialForm(existing, guide, line, settings, protocolCount));
  const [form, setForm] = useState<ProtocolForm>(start);
  const [index, setIndex] = useState(existing ? STEPS.length - 1 : 0);
  const [showMix, setShowMix] = useState(!!(start.vialAmount || start.waterMl));
  const step = STEPS[index];
  const patch = (next: Partial<ProtocolForm>) => setForm((f) => ({ ...f, ...next }));
  const effective = useMemo<ProtocolForm>(() => (showMix || form.routeGroup !== "vial" ? form : { ...form, vialAmount: "", waterMl: "" }), [form, showMix]);
  const reason = stepProblem(step.key, effective);
  const isLast = index === STEPS.length - 1;
  const route = routeOf(form);

  const leave = () => {
    if (JSON.stringify(form) === JSON.stringify(start)) return close();
    confirm(existing ? "Discard your changes?" : "Discard this protocol?", "Nothing has been saved yet.", "Discard", close);
  };

  const save = () => {
    const result = formToProtocol(effective);
    if (!result.ok) return;
    const today = dayKey(new Date());
    let saved: Protocol;
    if (existing) {
      saved = saveProtocol({ ...existing, ...result.protocol });
    } else if (line) {
      saved = saveProtocol({ ...result.protocol, status: "active" }, null);
      const vial = vialFromOrder(line, saved.id);
      const mix = result.protocol.mix;
      if (vial) saveVial(mix ? { ...vial, amount: mix.vialAmount, unit: mix.vialUnit, waterMl: mix.waterMl, mixedOn: today, unopened: false } : vial);
      else if (mix) saveVial({ protocolId: saved.id, amount: mix.vialAmount, unit: mix.vialUnit, waterMl: mix.waterMl, mixedOn: today, lot: null, status: "active" });
    } else {
      saved = saveProtocol({ ...result.protocol, status: "active" }, result.protocol.mix ? { mixedOn: today } : null);
    }
    if (saved.reminders && saved.schedule.kind !== "asNeeded") void ensureTrackerNotificationPermission();
    showTrackerToast({ message: existing ? `${saved.name} updated` : `${saved.name} added`, icon: "checkmark" });
    close();
  };

  const next = () => {
    if (reason) return;
    if (isLast) save();
    else setIndex((i) => i + 1);
  };

  return (
    <SheetScreen
      title={step.title}
      subtitle={`Step ${index + 1} of ${STEPS.length} · ${step.subtitle}`}
      onClose={leave}
      onBack={index > 0 ? () => setIndex((i) => i - 1) : undefined}
      progress={(index + 1) / STEPS.length}
      isFullScreen
      footer={
        <>
          {reason ? (
            <TText variant="meta" color={th.status.low.text} accessibilityLiveRegion="polite">
              {reason}
            </TText>
          ) : null}
          <PressButton
            label={isLast ? (existing ? "Save changes" : "Save protocol") : "Next"}
            icon={isLast ? "checkmark-circle" : undefined}
            trailingIcon={isLast ? undefined : "arrow-forward"}
            hapticKind={isLast ? "success" : "tap"}
            isDisabled={!!reason}
            onPress={next}
          />
        </>
      }
    >
      {form.source?.kind === "guide" && step.key !== "review" ? <GuideNotice storeName={me.store.name} /> : null}
      <View style={styles.body}>
        {step.key === "compound" ? <CompoundStep form={form} onChange={patch} /> : null}
        {step.key === "dose" ? <DoseStep form={form} onChange={patch} showMix={showMix} onShowMix={setShowMix} /> : null}
        {step.key === "schedule" ? <ScheduleStep form={form} onChange={patch} isInjected={route === "injection" || route === "pen"} /> : null}
        {step.key === "reminders" ? <RemindersStep form={form} onChange={patch} /> : null}
        {step.key === "review" ? <ReviewStep form={effective} storeName={me.store.name} onEdit={(k) => setIndex(STEPS.findIndex((s) => s.key === k))} /> : null}
      </View>
    </SheetScreen>
  );
}

/** Why "Next" is off on this step (null = good to go). */
function stepProblem(step: SetupStep, form: ProtocolForm): string | null {
  if (step === "compound") return form.name.trim() ? null : "Enter what you’re taking.";
  if (step === "dose") {
    const value = parseAmount(form.doseValue);
    if (value === null || value <= 0) return "Enter your dose.";
    const draw = formDraw(form);
    return draw.kind !== "empty" && draw.isBlocked ? "Check your numbers." : null;
  }
  if (step === "reminders") return null;
  const result = formToProtocol(form);
  return result.ok ? null : result.reason;
}

const styles = StyleSheet.create({
  body: { gap: TSPACE.xl },
});
