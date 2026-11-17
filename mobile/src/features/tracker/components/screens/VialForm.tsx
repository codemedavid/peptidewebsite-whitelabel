/**
 * ADD / EDIT A VIAL (sheet). Opened with:
 *   ?id=           edit (status, mix, dates, lot, note; mark finished; delete)
 *   ?orderKey=     from a delivered order line (strength prefilled, unopened)
 *   ?protocolId=   a new vial for that protocol (its mix prefilled, in use)
 * Inventory only: no syringe picture or units/mL draw (App Store 1.4.2; the
 * units/mL converter is a later feature behind `mobile.tracker.converter`).
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { TrackerOrderVial } from "@contract";
import { INPUT_CAPS } from "../../lib/caps";
import { deleteVial, saveVial, useOrderVials, useProtocols, useTrackerState, type VialDraft } from "../../hooks";
import { parseAmount, unitLabel } from "../../lib/dose-math";
import { dayKey, formatDay } from "../../lib/ids";
import type { Protocol, RecordSource, Vial, VialUnit } from "../../lib/types";
import { activeVial } from "../../lib/vials";
import { confirm, notify } from "../dialog";
import { DateField, NumberField, TextField } from "../fields";
import { Chip, ChipRow, EmptyState, PressButton, SectionHeader, SegmentedControl, TText } from "../kit";
import { trackerHref } from "../routes";
import { SheetScreen } from "../sheets";
import { TSPACE, useTrackerTheme } from "../theme";
import { showTrackerToast } from "../toast";
import { defaultExpiry, lineDetail, protocolForLine, type VialNote, type VialPhase } from "../vial-model";

type Params = { id?: string; orderKey?: string; protocolId?: string };

const VIAL_UNITS: readonly VialUnit[] = ["mg", "mcg", "iu"];
const MAX_WATER_ML = INPUT_CAPS.waterMl;
const MAX_LOT = INPUT_CAPS.lot;
const MAX_NOTE = INPUT_CAPS.note;
const PHASES = [
  { key: "sealed", label: "Unopened" },
  { key: "inUse", label: "In use" },
  { key: "done", label: "Finished" },
] as const satisfies readonly { key: VialPhase; label: string }[];

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.vials());
}

export function VialForm() {
  const params = useLocalSearchParams<Params>();
  const { isLoaded, data } = useTrackerState();
  const orders = useOrderVials(!!params.orderKey);
  const waitingOrder = !!params.orderKey && orders.isPending && orders.fetchStatus !== "idle";
  const title = params.id ? "Edit vial" : "Add vial";

  if (!isLoaded || waitingOrder) {
    return (
      <SheetScreen title={title} onClose={close}>
        <TText variant="body" color="soft">
          Opening your tracker…
        </TText>
      </SheetScreen>
    );
  }
  const existing = params.id ? data.vials.find((v) => v.id === params.id) : undefined;
  if (params.id && !existing) {
    return (
      <SheetScreen title={title} onClose={close}>
        <EmptyState icon="help-circle-outline" title="Not found" body="This vial isn’t on this phone any more." />
      </SheetScreen>
    );
  }
  const line = params.orderKey ? (orders.data ?? []).find((l) => l.key === params.orderKey) : undefined;
  return <Form existing={existing} line={line} protocolId={params.protocolId ?? null} vials={data.vials} />;
}

type FormState = {
  protocolId: string | null;
  amount: string;
  unit: VialUnit;
  water: string;
  phase: VialPhase;
  mixedOn: string;
  /** null = the default (mixed + 28 days), or no date for an unopened vial. */
  expiresOn: string | null;
  lot: string;
  note: string;
};

function initial(existing: Vial | undefined, line: TrackerOrderVial | undefined, protocolId: string | null, protocols: readonly Protocol[], today: string): FormState {
  if (existing) {
    return {
      protocolId: existing.protocolId,
      amount: String(existing.amount),
      unit: existing.unit,
      water: existing.waterMl ? String(existing.waterMl) : "",
      phase: existing.status === "finished" ? "done" : existing.unopened ? "sealed" : "inUse",
      mixedOn: existing.mixedOn ?? today,
      expiresOn: existing.expiresOn ?? null,
      lot: existing.lot ?? "",
      note: (existing as VialNote).note ?? "",
    };
  }
  const base: FormState = { protocolId, amount: "", unit: "mg", water: "", phase: "inUse", mixedOn: today, expiresOn: null, lot: "", note: "" };
  if (line) {
    return {
      ...base,
      protocolId: protocolForLine(line, protocols)?.id ?? null,
      amount: line.strength ? String(line.strength.value) : "",
      unit: line.strength?.unit ?? "mg",
      phase: "sealed",
    };
  }
  const p = protocols.find((x) => x.id === protocolId);
  if (p?.mix) return { ...base, amount: String(p.mix.vialAmount), unit: p.mix.vialUnit, water: String(p.mix.waterMl) };
  return base;
}

type FormProps = { existing: Vial | undefined; line: TrackerOrderVial | undefined; protocolId: string | null; vials: readonly Vial[] };

function Form({ existing, line, protocolId, vials }: FormProps) {
  const th = useTrackerTheme();
  const { protocols, byId } = useProtocols();
  const today = dayKey(new Date());
  const [start] = useState(() => initial(existing, line, protocolId, protocols, today));
  const [form, setForm] = useState<FormState>(start);
  const patch = (next: Partial<FormState>) => setForm((f) => ({ ...f, ...next }));

  const protocol = form.protocolId ? (byId.get(form.protocolId) ?? null) : null;
  const choices = protocols.filter((p) => p.status !== "archived" || p.id === form.protocolId);
  const amount = parseAmount(form.amount);
  const water = form.water.trim() ? parseAmount(form.water) : null;
  const isMixed = form.phase !== "sealed";
  const expiry = isMixed ? (form.expiresOn ?? defaultExpiry(form.mixedOn)) : form.expiresOn;
  const isDefaultExpiry = isMixed && (form.expiresOn === null || form.expiresOn === defaultExpiry(form.mixedOn));

  const reason = !protocol
    ? "Choose what this vial is for."
    : amount === null || amount <= 0
      ? "Enter what the vial contains (from its label)."
      : form.water.trim() && (water === null || water <= 0 || water > MAX_WATER_ML)
        ? `Enter the water added in mL (up to ${MAX_WATER_ML}).`
        : null;

  // Opening a vial finishes the one in use (store.saveVial): say so before it happens.
  const inUse = protocol ? activeVial(vials, protocol.id) : null;
  const willFinish = form.phase === "inUse" && inUse && inUse.id !== existing?.id ? inUse : null;

  const build = (phase: VialPhase): VialDraft & VialNote => {
    const mixed = phase !== "sealed";
    const source: RecordSource | null = existing?.source ?? (line ? { kind: "order", key: line.key } : null);
    return {
      ...(existing ?? {}),
      protocolId: protocol?.id ?? "",
      amount: amount ?? 0,
      unit: form.unit,
      waterMl: water && water > 0 ? water : null,
      mixedOn: mixed ? form.mixedOn : null,
      lot: form.lot.trim() || null,
      status: phase === "done" ? "finished" : "active",
      unopened: phase === "sealed",
      expiresOn: mixed ? (isDefaultExpiry ? null : form.expiresOn) : form.expiresOn,
      source,
      note: form.note.trim().slice(0, MAX_NOTE) || null,
    };
  };

  const save = (phase: VialPhase = form.phase) => {
    if (reason || !protocol) return;
    try {
      saveVial(build(phase));
    } catch {
      notify("Couldn’t save the vial", "This phone couldn’t save it. Free up some space and try again.");
      return;
    }
    const verb = existing ? (phase === "done" && existing.status !== "finished" ? "finished" : "updated") : "added";
    showTrackerToast({ message: `${protocol.name} vial ${verb}`, icon: phase === "done" ? "checkmark-done" : "flask" });
    close();
  };

  const leave = () => {
    if (JSON.stringify(form) === JSON.stringify(start)) return close();
    confirm(existing ? "Discard your changes?" : "Discard this vial?", "Nothing has been saved yet.", "Discard", close);
  };

  const remove = () => {
    if (!existing) return;
    confirm("Delete this vial?", "Doses logged against it stay in your history; they just won’t count down a vial any more.", "Delete", () => {
      deleteVial(existing.id);
      showTrackerToast({ message: "Vial deleted", icon: "trash-outline" });
      close();
    });
  };

  if (protocols.length === 0) {
    return (
      <SheetScreen title="Add vial" onClose={close}>
        <EmptyState
          icon="list-outline"
          title="Add a protocol first"
          body={line ? `Set up ${line.name}: name, dose and schedule. Its vial is added for you.` : "A vial belongs to a protocol, so its doses can count it down."}
          action={{ label: "Set up a protocol", icon: "add", onPress: () => router.replace(trackerHref.protocolEdit(line ? { orderKey: line.key } : {})) }}
        />
      </SheetScreen>
    );
  }

  const footer = (
    <>
      {reason ? (
        <TText variant="meta" color={th.status.low.text} accessibilityLiveRegion="polite">
          {reason}
        </TText>
      ) : null}
      <PressButton label={existing ? "Save changes" : "Save vial"} icon="checkmark-circle" hapticKind="success" isDisabled={!!reason} onPress={() => save()} />
    </>
  );

  return (
    <SheetScreen title={existing ? "Edit vial" : "Add vial"} subtitle={line ? lineDetail(line) : undefined} onClose={leave} closeLabel={existing ? "Close without saving" : "Cancel"} footer={footer}>
      <View style={styles.group}>
        <SectionHeader title="For" />
        <ChipRow label="Protocol">
          {choices.map((p) => (
            <Chip key={p.id} label={p.name} isSelected={p.id === form.protocolId} onPress={() => patch({ protocolId: p.id })} />
          ))}
        </ChipRow>
        {line && !form.protocolId ? (
          <PressButton label={`Start a protocol for ${line.name}`} icon="add" tone="ghost" size="sm" onPress={() => router.replace(trackerHref.protocolEdit({ orderKey: line.key }))} />
        ) : null}
      </View>

      <View style={styles.group}>
        <SectionHeader title="Status" />
        <SegmentedControl label="Vial status" options={PHASES} value={form.phase} onChange={(phase) => patch({ phase })} />
        {willFinish ? (
          <TText variant="meta" color="soft">
            {`Saving marks the ${protocol?.name ?? ""} vial in use${willFinish.mixedOn ? ` (mixed ${formatDay(willFinish.mixedOn)})` : ""} as finished.`}
          </TText>
        ) : null}
      </View>

      <View style={styles.group}>
        <NumberField label="Vial contains" hint="From the vial label." value={form.amount} onChangeText={(amount) => patch({ amount })} placeholder="5" maxLength={10} unit={unitLabel(form.unit)} />
        <ChipRow label="Vial unit">
          {VIAL_UNITS.map((u) => (
            <Chip key={u} label={unitLabel(u)} isSelected={form.unit === u} onPress={() => patch({ unit: u })} />
          ))}
        </ChipRow>
        <NumberField
          label={isMixed ? "Bacteriostatic water added" : "Water to add (optional)"}
          value={form.water}
          onChangeText={(w) => patch({ water: w })}
          placeholder="2"
          maxLength={6}
          unit="mL"
          isInvalid={!!form.water.trim() && (water === null || water <= 0 || water > MAX_WATER_ML)}
        />
      </View>

      {isMixed ? (
        <View style={styles.group}>
          <TText variant="meta" color="soft">
            Mixed on
          </TText>
          <DateField label="Mixed on" value={form.mixedOn} max={today} onChange={(mixedOn) => patch({ mixedOn, expiresOn: isDefaultExpiry ? null : form.expiresOn })} />
        </View>
      ) : null}

      <View style={styles.group}>
        <TText variant="meta" color="soft">
          {isMixed ? "Use by" : "Use by (optional)"}
        </TText>
        {expiry ? (
          <DateField label="Use by" value={expiry} min={isMixed ? form.mixedOn : undefined} onChange={(expiresOn) => patch({ expiresOn })} />
        ) : (
          <PressButton label="Add a use-by date" icon="calendar-outline" tone="secondary" size="sm" onPress={() => patch({ expiresOn: today })} />
        )}
        {isMixed ? (
          <View style={styles.row}>
            <TText variant="meta" color="faint" style={styles.fill}>
              {isDefaultExpiry ? "28 days after mixing. Check your product’s storage guidance." : "Your own date."}
            </TText>
            {!isDefaultExpiry ? <Chip label="Use 28 days" role="button" isSelected={false} onPress={() => patch({ expiresOn: null })} /> : null}
          </View>
        ) : form.expiresOn ? (
          <Chip label="Remove date" role="button" isSelected={false} onPress={() => patch({ expiresOn: null })} />
        ) : null}
      </View>

      <TextField label="Lot number (optional)" value={form.lot} onChangeText={(lot) => patch({ lot })} placeholder="A1234" autoCapitalize="characters" maxLength={MAX_LOT} />
      <TextField label="Note (optional)" value={form.note} onChangeText={(note) => patch({ note })} placeholder="Where it’s stored, batch details…" multiline maxLength={MAX_NOTE} />

      {existing ? (
        <View style={styles.group}>
          {form.phase === "inUse" && existing.status !== "finished" ? (
            <PressButton label="Mark finished" icon="checkmark-done" tone="secondary" size="md" isDisabled={!!reason} onPress={() => save("done")} accessibilityHint="Saves and moves it to Finished" />
          ) : null}
          <PressButton label="Delete vial" icon="trash-outline" tone="danger" size="md" onPress={remove} />
        </View>
      ) : null}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  group: { gap: TSPACE.sm },
  row: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, flexWrap: "wrap" },
});
