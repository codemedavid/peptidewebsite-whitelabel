import { useMemo, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap, type AdminBrand } from "@/features/admin/bridge";
import { IconButton } from "@/features/admin/catalog/components";
import { useCatalogProducts } from "@/features/admin/catalog/hooks";
import {
  EXPERIENCE_LEVELS,
  NONE_OF_THE_ABOVE,
  normalizeAssessmentConfig,
  recommendProducts,
  type AssessmentConfig,
} from "@/features/admin/content/assessment";
import { setupKeys, success, useAdminBrand } from "@/features/admin/setup/data";
import { confirmDelete, FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { EmptyState } from "@/ui/feedback";
import { Field, Segmented } from "@/ui/inputs";
import { AppText, Button, Card, Pill } from "@/ui/primitives";

/**
 * The website's Assessments manager (AdminAssessments.tsx): the customer quiz's
 * submissions (follow up, archive, delete) and its settings (copy, on/off, the
 * goal → product keyword map). Submissions hold self-reported medical history,
 * so the module is its own staff grant; the server re-checks it every call.
 */
export default function AssessmentsScreen() {
  const [tab, setTab] = useState<"submissions" | "settings">("submissions");
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Assessments" }} />
      <View style={styles.tabs}>
        <Segmented
          segments={[
            { key: "submissions", label: "Submissions" },
            { key: "settings", label: "Quiz settings" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {tab === "submissions" ? <Submissions /> : <Loadable query={brand}>{(b) => <Settings brand={b} />}</Loadable>}
    </>
  );
}

// ── submissions ─────────────────────────────────────────────────────────────

type Status = "new" | "contacted" | "archived";
type Row = {
  id: string;
  fullName: string;
  email: string;
  ageRange: string;
  location: string;
  conditions: string[];
  goals: string[];
  experience: string;
  frequency: string;
  status: Status;
  createdAt: string;
};
type Fail = { error: string };
type Filter = Status | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const experienceLabel = (id: string) => EXPERIENCE_LEVELS.find((l) => l.id === id)?.label ?? id;

function Submissions() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const key = [...setupKeys.all(scope), "assessments"];
  const rows = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await adminBridge.call<{ ok: true; responses: Row[] } | Fail>("listAssessmentResponsesAction")).responses,
  });
  const [filter, setFilter] = useState<Filter>("new");
  const [open, setOpen] = useState<string | null>(null);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) =>
      unwrap(await adminBridge.call<{ ok: true } | Fail>("updateAssessmentStatusAction", id, status)),
    onSuccess: (_d, { id, status }) => {
      success();
      qc.setQueryData<Row[]>(key, (prev) => prev?.map((r) => (r.id === id ? { ...r, status } : r)));
    },
    onError: (e: Error) => Alert.alert("Couldn't update", e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await adminBridge.call<{ ok: true } | Fail>("deleteAssessmentResponseAction", id)),
    onSuccess: (_d, id) => {
      success();
      qc.setQueryData<Row[]>(key, (prev) => prev?.filter((r) => r.id !== id));
    },
    onError: (e: Error) => Alert.alert("Couldn't delete", e.message),
  });

  return (
    <Loadable query={rows}>
      {(list) => {
        const count = (f: Filter) => (f === "all" ? list.length : list.filter((r) => r.status === f).length);
        const shown = filter === "all" ? list : list.filter((r) => r.status === filter);
        const busy = setStatus.isPending || remove.isPending;
        return (
          <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={rows.isRefetching} onRefresh={() => void rows.refetch()} />}>
            <Segmented segments={FILTERS.map((f) => ({ ...f, count: count(f.key) }))} value={filter} onChange={setFilter} />
            {shown.length === 0 ? (
              <EmptyState
                icon="clipboard-outline"
                title={list.length ? "Nothing here" : "No submissions yet"}
                body={list.length ? "Try another filter." : "When a customer completes your assessment, their answers appear here."}
              />
            ) : (
              shown.map((r) => (
                <SubmissionCard
                  key={r.id}
                  row={r}
                  open={open === r.id}
                  busy={busy}
                  onToggle={() => setOpen(open === r.id ? null : r.id)}
                  onStatus={(status) => setStatus.mutate({ id: r.id, status })}
                  onDelete={() => confirmDelete(`Delete ${r.fullName}'s submission? This can't be undone.`, () => remove.mutate(r.id))}
                />
              ))
            )}
          </ScrollView>
        );
      }}
    </Loadable>
  );
}

function SubmissionCard({
  row: r,
  open,
  busy,
  onToggle,
  onStatus,
  onDelete,
}: {
  row: Row;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onStatus: (s: Status) => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const flagged = r.conditions.filter((c) => c !== NONE_OF_THE_ABOVE);
  const detail: [string, string][] = [
    ["Age range", r.ageRange],
    ["Location", r.location || "—"],
    ["Medical history", r.conditions.join(", ") || "—"],
    ["Experience", experienceLabel(r.experience)],
    ["Frequency", r.frequency || "—"],
  ];
  return (
    <Card style={{ gap: SPACE.md, opacity: r.status === "archived" ? 0.7 : 1 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={{ gap: 4 }}>
        <AppText variant="bodyStrong">{r.fullName}</AppText>
        <AppText variant="caption" color="muted">
          {`${r.email} · ${when(r.createdAt)}`}
        </AppText>
        <View style={styles.chips}>
          {r.goals.map((g) => (
            <Pill key={g} size="sm" tone="neutral" label={g} />
          ))}
          {flagged.length ? <Pill size="sm" tone="warning" icon="warning-outline" label={`${flagged.length} health flag${flagged.length > 1 ? "s" : ""}`} /> : null}
        </View>
        <AppText variant="caption" color="link">
          {open ? "Hide answers" : "Show answers"}
        </AppText>
      </Pressable>
      {open ? (
        <View style={[styles.detail, { borderColor: t.colors.border }]}>
          {detail.map(([k, v]) => (
            <View key={k} style={styles.detailRow}>
              <AppText variant="caption" color="muted" style={{ width: 120 }}>
                {k}
              </AppText>
              <AppText variant="body" style={{ flex: 1 }}>
                {v}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button label="Email" icon="mail-outline" variant="secondary" onPress={() => void Linking.openURL(`mailto:${r.email}`)} />
        {r.status !== "contacted" ? <Button label="Mark contacted" variant="secondary" disabled={busy} onPress={() => onStatus("contacted")} /> : null}
        {r.status !== "archived" ? (
          <Button label="Archive" variant="ghost" disabled={busy} onPress={() => onStatus("archived")} />
        ) : (
          <Button label="Restore" variant="ghost" disabled={busy} onPress={() => onStatus("new")} />
        )}
        {open ? <Button label="Delete submission" icon="trash-outline" variant="danger" disabled={busy} onPress={onDelete} /> : null}
      </View>
    </Card>
  );
}

// ── settings ────────────────────────────────────────────────────────────────

type GoalDraft = { label: string; keywords: string };
const PREVIEW_MATCHES = 6;

function Settings({ brand }: { brand: AdminBrand }) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const products = useCatalogProducts(brand);
  const [savedCfg, setSavedCfg] = useState(() => normalizeAssessmentConfig(brand.assessment));
  const [cfg, setCfg] = useState<AssessmentConfig>(savedCfg);
  const [goals, setGoals] = useState<GoalDraft[]>(() => savedCfg.goals.map((g) => ({ label: g.label, keywords: g.keywords.join(", ") })));
  const [flash, showSaved, hideSaved] = useSavedFlash();

  // Exactly what will persist — the same normalizer the server runs.
  const draft = useMemo(
    () => normalizeAssessmentConfig({ ...cfg, goals: goals.map((g) => ({ label: g.label, keywords: g.keywords.split(",") })) }),
    [cfg, goals],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedCfg);
  useDiscardGuard(dirty);

  const save = useMutation({
    mutationFn: async () => unwrap(await adminBridge.call<{ ok: true; config: AssessmentConfig } | Fail>("saveAssessmentConfigAction", draft)).config,
    onSuccess: (config) => {
      success();
      setSavedCfg(config);
      showSaved();
      void qc.invalidateQueries({ queryKey: setupKeys.brand(scope) });
    },
    onError: (e: Error) => Alert.alert("Couldn't save", e.message),
  });

  const set = (patch: Partial<AssessmentConfig>) => {
    hideSaved();
    setCfg((prev) => ({ ...prev, ...patch }));
  };
  const patchGoal = (i: number, patch: Partial<GoalDraft>) => {
    hideSaved();
    setGoals((prev) => prev.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  };

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} onSave={() => save.mutate()} label="Save settings" />}>
      <Section title="Quiz">
        <ToggleRow
          label="Show the assessment on my store"
          hint="Off hides the page and its links; past submissions stay here."
          value={cfg.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <Field label="Title" value={cfg.title} onChangeText={(title) => set({ title })} maxLength={120} />
        <Field label="Intro" value={cfg.intro} onChangeText={(intro) => set({ intro })} maxLength={600} multiline />
        <Field label="Terms customers must accept" value={cfg.consentText} onChangeText={(consentText) => set({ consentText })} maxLength={1000} multiline />
        <Field label="Note under the results" value={cfg.disclaimer} onChangeText={(disclaimer) => set({ disclaimer })} maxLength={1000} multiline />
      </Section>

      <Section
        title="Goals & matching products"
        hint={`Each goal recommends products whose name (or description) contains one of its keywords. Separate keywords with commas. The first goal a customer picks fills their "Core picks".`}
      >
        {goals.map((g, i) => {
          const goal = draft.goals.find((x) => x.label === g.label.trim());
          const matches = goal ? recommendProducts(products.data ?? [], [goal.label], draft).primary : [];
          const preview = matches
            .slice(0, PREVIEW_MATCHES)
            .map((p) => p.name)
            .join(" · ");
          return (
            <View key={i} style={styles.goal}>
              <View style={styles.goalHead}>
                <View style={{ flex: 1 }}>
                  <Field label="Goal" value={g.label} maxLength={60} placeholder="e.g. Weight Loss" onChangeText={(label) => patchGoal(i, { label })} />
                </View>
                <View style={{ paddingTop: 26 }}>
                  <IconButton
                    icon="close"
                    tone="danger"
                    label={`Remove ${g.label || "goal"}`}
                    onPress={() => {
                      hideSaved();
                      setGoals((prev) => prev.filter((_, j) => j !== i));
                    }}
                  />
                </View>
              </View>
              <Field label="Keywords" value={g.keywords} placeholder="Tirzepatide, Retatrutide, AOD" onChangeText={(keywords) => patchGoal(i, { keywords })} />
              <Hint>{matches.length ? `Recommends: ${preview}` : "No products match these keywords yet."}</Hint>
            </View>
          );
        })}
        <Button
          label="Add goal"
          icon="add"
          variant="secondary"
          onPress={() => {
            hideSaved();
            setGoals((prev) => [...prev, { label: "", keywords: "" }]);
          }}
        />
      </Section>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md },
  page: { padding: SPACE.lg, gap: SPACE.md, paddingBottom: SPACE.xxxl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  detail: { gap: 6, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  detailRow: { flexDirection: "row", gap: SPACE.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  goal: { gap: SPACE.sm, paddingBottom: SPACE.md },
  goalHead: { flexDirection: "row", gap: SPACE.sm, alignItems: "flex-start" },
});
