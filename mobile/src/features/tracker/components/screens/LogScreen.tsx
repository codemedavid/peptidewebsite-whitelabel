/**
 * LOG (TRACKER.md §4 "Log sheet — one tap to save"). Opened with:
 *   ?protocolId=&slot=ISO  a scheduled dose (Today "Adjust", a reminder tap)
 *   ?doseId=               an existing log (edit / delete)
 *   ?date=YYYY-MM-DD       back-dating from the calendar
 *   nothing                pick a protocol (as-needed / extra dose)
 * Everything starts pre-filled — dose, time "now", the vial in use and the
 * suggested site — so Save is one tap. Save is disabled only on an invalid
 * dose. Skip asks for a reason. No dose is ever suggested: the dose shown is
 * the user's own protocol dose.
 */
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { INPUT_CAPS } from "../../lib/caps";
import { draftDose, logDose, skipDose, undoLog, undoSkip, updateDose, useNow, useProtocols, useTrackerState } from "../../hooks";
import { parseAmount, unitLabel } from "../../lib/dose-math";
import { atTime, dayKey, isDayKey, timeKey } from "../../lib/ids";
import { typedAmounts } from "../../lib/quick-log";
import { siteLabel } from "../../lib/sites";
import { defaultTimeOn } from "../../lib/today";
import type { Protocol, SiteId } from "../../lib/types";
import { vialForDose, vialNumber, vialStatus } from "../../lib/vials";
import { BodyMap } from "../BodyMap";
import { confirm, notify } from "../dialog";
import { DateField, NumberField, TextField, TimeField, TIME_STEP_MIN } from "../fields";
import { clock, relativeDay, relativeDayInline } from "../format";
import { Chip, ChipRow, EmptyState, haptic, PressButton, SectionHeader, TText } from "../kit";
import { trackerHref } from "../routes";
import { SheetScreen, SHEET_DISMISS_IS_ASYNC } from "../sheets";
import { SkipSheet } from "../SkipSheet";
import { TSPACE } from "../theme";
import { showTrackerToast } from "../toast";

type Params = { protocolId?: string; slot?: string; at?: string; doseId?: string; date?: string };
type When = "now" | "m15" | "h1" | "custom";

const WHEN_CHIPS: { key: When; label: string; offsetMin: number }[] = [
  { key: "now", label: "Now", offsetMin: 0 },
  { key: "m15", label: "15 min ago", offsetMin: 15 },
  { key: "h1", label: "1 h ago", offsetMin: 60 },
  { key: "custom", label: "Earlier…", offsetMin: 0 },
];
const FUTURE_GRACE_MS = 60_000;
const MINUTE_MS = 60_000;

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.home());
}

/** After "now" (a minute's grace for clock drift). */
function isInFuture(at: Date): boolean {
  return at.getTime() > Date.now() + FUTURE_GRACE_MS;
}

function roundTo5(d: Date): Date {
  const step = TIME_STEP_MIN * MINUTE_MS;
  return new Date(Math.round(d.getTime() / step) * step);
}

export function LogScreen() {
  const params = useLocalSearchParams<Params>();
  const { isLoaded } = useTrackerState();
  if (isLoaded) return <LogForm params={params} />;
  return (
    <SheetScreen title={params.doseId ? "Edit dose" : "Log dose"} onClose={close}>
      <TText variant="body" color="soft">
        Opening your tracker…
      </TText>
    </SheetScreen>
  );
}

function LogForm({ params }: { params: Params }) {
  const now = useNow();
  const { data } = useTrackerState();
  const { protocols } = useProtocols();
  const editing = params.doseId ? data.doses.find((d) => d.id === params.doseId) : undefined;
  const active = protocols.filter((p) => p.status === "active");
  const today = dayKey(now);

  // Seeded once from whatever opened the sheet.
  const [initial] = useState(() => {
    const slotIso = params.slot ?? params.at;
    const scheduled = slotIso && Number.isFinite(Date.parse(slotIso)) ? new Date(slotIso) : null;
    const protocol = protocols.find((p) => p.id === (editing?.protocolId ?? params.protocolId)) ?? (editing ? null : (active[0] ?? null));
    let at: Date | null = null;
    if (editing) at = new Date(editing.takenAt);
    else if (isDayKey(params.date) && params.date !== today) at = defaultTimeOn(params.date, protocol);
    else if (scheduled && dayKey(scheduled) < today) at = scheduled;
    return { protocolId: protocol?.id ?? null, scheduled, at };
  });

  const [protocolId, setProtocolId] = useState<string | null>(initial.protocolId);
  const protocol = protocolId ? (protocols.find((p) => p.id === protocolId) ?? null) : null;
  const draft = useMemo(() => (protocolId && !editing ? draftDose(protocolId, initial.scheduled, new Date()) : null), [protocolId, editing, initial.scheduled]);

  const [doseText, setDoseText] = useState(() => String(editing?.dose.value ?? protocol?.dose.value ?? ""));
  const [when, setWhen] = useState<When>(initial.at ? "custom" : "now");
  const seedAt = roundTo5(initial.at ?? now);
  const [day, setDay] = useState(dayKey(seedAt));
  const [time, setTime] = useState(timeKey(seedAt));
  const [site, setSite] = useState<SiteId | null>(editing ? editing.site : (draft?.site ?? null));
  const [vialId, setVialId] = useState<string | null>(editing ? editing.vialId : (draft?.vialId ?? null));
  const [isVialTouched, setIsVialTouched] = useState(!!editing);
  const [note, setNote] = useState(editing?.note ?? "");
  const [isSkipping, setIsSkipping] = useState(false);
  const [closeAfterSheet, setCloseAfterSheet] = useState(false);

  if (!protocol) {
    return (
      <SheetScreen title="Log dose" onClose={close}>
        {active.length > 0 ? (
          <ProtocolChooser protocols={active} onPick={(p) => choose(p)} />
        ) : (
          <EmptyState
            icon="add-circle-outline"
            title="Add a protocol first"
            body="Set up what you take once, then logging is one tap."
            action={{ label: "Set up a protocol", onPress: () => router.replace(trackerHref.protocolEdit()) }}
          />
        )}
      </SheetScreen>
    );
  }

  function choose(p: Protocol) {
    setProtocolId(p.id);
    setDoseText(String(p.dose.value));
    const d = draftDose(p.id, null, new Date());
    setSite(d?.site ?? null);
    setVialId(d?.vialId ?? null);
    setIsVialTouched(false);
  }

  const value = parseAmount(doseText);
  const unit = editing?.dose.unit ?? protocol.dose.unit;
  const dose = value !== null && value > 0 ? { value, unit } : null;
  const takenAt = when === "custom" ? atTime(day, time) : new Date(now.getTime() - (WHEN_CHIPS.find((w) => w.key === when)?.offsetMin ?? 0) * MINUTE_MS);
  const injected = protocol.route === "injection" || protocol.route === "pen";
  const ownVials = data.vials.filter((v) => v.protocolId === protocol.id && v.status === "active" && !v.unopened);
  const autoVial = vialForDose(data.vials, protocol.id, takenAt)?.id ?? null;
  const chosenVialId = isVialTouched ? vialId : autoVial;
  const suggested = protocol.rotateSites && data.settings.suggestSites ? (draft?.site ?? null) : null;
  const scheduledIso = initial.scheduled && params.protocolId === protocol.id ? initial.scheduled.toISOString() : null;

  const save = () => {
    if (!dose) return;
    if (isInFuture(takenAt)) {
      notify("That’s in the future", "You can log up to now.");
      return;
    }
    const fields = {
      protocolId: protocol.id,
      name: protocol.name,
      takenAt: takenAt.toISOString(),
      dose,
      ...typedAmounts(dose),
      route: protocol.route,
      site: injected ? site : null,
      vialId: chosenVialId,
      note: note.trim() || null,
    };
    haptic("success");
    if (editing) {
      updateDose({ ...editing, ...fields });
      showTrackerToast({ message: `Updated ${protocol.name}` });
    } else {
      const logged = logDose({ ...fields, scheduledFor: scheduledIso });
      const where = fields.site ? ` · ${siteLabel(fields.site)}` : "";
      showTrackerToast({ message: `Logged ${protocol.name}${where}`, undo: () => undoLog(logged.id) });
    }
    close();
  };

  const remove = () => {
    if (!editing) return;
    confirm("Delete this dose?", "It comes off your history and your vial.", "Delete", () => {
      undoLog(editing.id);
      showTrackerToast({ message: `Deleted ${editing.name}`, icon: "trash-outline" });
      close();
    });
  };

  const pickWhen = (w: When) => {
    if (w === "custom" && when !== "custom") {
      const seed = roundTo5(takenAt);
      setDay(dayKey(seed));
      setTime(timeKey(seed));
    }
    setWhen(w);
  };

  return (
    <SheetScreen
      title={editing ? "Edit dose" : `Log ${protocol.name}`}
      subtitle={initial.scheduled && !editing ? `Scheduled ${relativeDayInline(initial.scheduled, now)} at ${clock(initial.scheduled)}` : undefined}
      onClose={close}
      footer={
        <>
          <PressButton label={editing ? "Save changes" : dose ? `Log ${doseText.trim()} ${unitLabel(unit)}` : "Log dose"} icon="checkmark-circle" hapticKind="none" isDisabled={!dose} onPress={save} accessibilityHint={dose ? undefined : "Enter a dose first"} />
          {!editing && scheduledIso ? <PressButton label="Skip this dose" tone="ghost" size="sm" onPress={() => setIsSkipping(true)} /> : null}
          {editing ? <PressButton label="Delete this dose" tone="danger" size="sm" icon="trash-outline" onPress={remove} /> : null}
        </>
      }
    >
      {!editing && !params.protocolId && active.length > 1 ? <ProtocolChooser protocols={active} selectedId={protocol.id} onPick={choose} /> : null}

      <View style={styles.block}>
        <NumberField
          label="Dose"
          isLarge
          value={doseText}
          onChangeText={setDoseText}
          placeholder="—"
          unit={unitLabel(unit)}
          isInvalid={!dose}
          hint={!dose ? "Enter the amount you took." : undefined}
        />
      </View>

      <View style={styles.block}>
        <SectionHeader title="When" right={<TText variant="bodyStrong" tabular>{`${relativeDay(takenAt, now)} · ${clock(takenAt)}`}</TText>} />
        <ChipRow label="When you took it">
          {WHEN_CHIPS.map((w) => (
            <Chip key={w.key} label={w.label} isSelected={when === w.key} onPress={() => pickWhen(w.key)} />
          ))}
        </ChipRow>
        {when === "custom" ? (
          <View style={styles.block}>
            <DateField label="Day taken" value={day} onChange={setDay} max={today} />
            <TimeField label="Time taken" value={time} onChange={setTime} />
          </View>
        ) : null}
      </View>

      {ownVials.length > 0 ? (
        <View style={styles.block}>
          <SectionHeader title="From vial" />
          <ChipRow label="Vial">
            {ownVials.map((v) => {
              const st = vialStatus(v, data.doses, protocol, now);
              const label = `Vial ${vialNumber(data.vials, v)} · ${st.pct <= 0 ? "empty" : `${st.pct}% left`}`;
              return (
                <Chip
                  key={v.id}
                  label={label}
                  icon="flask-outline"
                  isSelected={chosenVialId === v.id}
                  onPress={() => {
                    setVialId(v.id);
                    setIsVialTouched(true);
                  }}
                />
              );
            })}
            <Chip
              label="No vial"
              isSelected={chosenVialId === null}
              onPress={() => {
                setVialId(null);
                setIsVialTouched(true);
              }}
            />
          </ChipRow>
        </View>
      ) : null}

      {injected ? (
        <View style={styles.block}>
          <SectionHeader title="Site" right={site ? <TText variant="meta" color="brand" numberOfLines={1}>{siteLabel(site)}</TText> : <TText variant="meta" color="faint">Optional</TText>} />
          <BodyMap doses={editing ? data.doses.filter((d) => d.id !== editing.id) : data.doses} now={now} value={site} onChange={setSite} suggested={suggested} />
        </View>
      ) : null}

      <TextField label="Note" value={note} onChangeText={setNote} placeholder="Optional: how it went, anything to remember" multiline maxLength={INPUT_CAPS.note} />

      <SkipSheet
        title={isSkipping ? protocol.name : null}
        onClose={() => setIsSkipping(false)}
        onDismissed={() => {
          if (!closeAfterSheet) return;
          setCloseAfterSheet(false);
          close();
        }}
        onSkip={(reason, skipNote) => {
          if (!scheduledIso) return;
          const skip = skipDose({ protocolId: protocol.id, scheduledFor: scheduledIso, reason, note: skipNote });
          showTrackerToast({ message: `Skipped ${protocol.name}`, icon: "play-skip-forward", undo: () => undoSkip(skip.id) });
          setIsSkipping(false);
          if (SHEET_DISMISS_IS_ASYNC) setCloseAfterSheet(true);
          else close();
        }}
      />
    </SheetScreen>
  );
}

function ProtocolChooser({ protocols, selectedId, onPick }: { protocols: Protocol[]; selectedId?: string; onPick: (p: Protocol) => void }) {
  return (
    <View style={styles.block}>
      <SectionHeader title="What" />
      <ChipRow label="Protocol">
        {protocols.map((p) => (
          <Chip key={p.id} label={p.name} isSelected={p.id === selectedId} onPress={() => onPick(p)} />
        ))}
      </ChipRow>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: TSPACE.md },
});
