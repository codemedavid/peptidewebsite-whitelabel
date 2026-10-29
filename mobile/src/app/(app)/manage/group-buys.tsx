import { useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { useCatalogProducts } from "@/features/admin/catalog/hooks";
import { useAdminBrand } from "@/features/admin/setup/data";
import { Loadable } from "@/features/admin/setup/ui";
import { useGroupBuyList, useRoundAction } from "@/features/admin/group-buys/hooks";
import {
  effectiveGroupBuyStatus,
  moneyOf,
  normalizeGroupBuyContent,
  normalizeGroupBuyLiveBanner,
  normalizeHeroCountdown,
  normalizeTwoWaysMode,
  roundsAwaitingReport,
  type GroupBuy,
  type GroupBuyContent,
  type GroupBuyLiveBanner,
  type HeroCountdownConfig,
  type ListResult,
} from "@/features/admin/group-buys/model";
import { CommunityShareCard } from "@/features/admin/group-buys/CommunityShareCard";
import { PricingTab } from "@/features/admin/group-buys/PricingTab";
import { ReportSheet } from "@/features/admin/group-buys/ReportSheet";
import { RoundCard } from "@/features/admin/group-buys/RoundCard";
import { RoundEditor } from "@/features/admin/group-buys/RoundEditor";
import {
  AllowOnHandCard,
  ContentEditor,
  CopyCard,
  HeroCountdownCard,
  HeroCountdownEditor,
  LiveBannerCard,
  LiveBannerEditor,
  WaysCard,
} from "@/features/admin/group-buys/StoreSettings";
import { InvoiceCard, InvoiceEditor, confirmSendInvoices, useSendInvoices } from "@/features/admin/group-buys/InvoiceSettings";
import { normalizeGroupBuyInvoice, type GroupBuyInvoiceConfig } from "@/features/admin/group-buys/invoice";
import { PaymentModeCard } from "@/features/admin/group-buys/PaymentModeCard";
import { gbPaymentModeFor, normalizeGbPaymentMode, type GbPaymentMode } from "@/features/admin/group-buys/payment-mode";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { Segmented } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * The website's Group Buys admin (AdminGroupBuys + AdminGroupBuyPricing), native.
 * Rounds: ways to order, the on-hand toggle, storefront copy, and the rounds
 * list with create / edit / duplicate / archive / report. Pricing: per-product
 * group-buy prices. Tapping a round opens its dashboard. Every write is the
 * website's own action; buttons follow the plan's groupbuy.* capabilities.
 */
export default function GroupBuysScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Group buys",
          // Paid Access join flows: the join queue + per-round Join settings (manage/join-requests).
          headerRight: (brand.data as { groupBuyCaps?: { paidAccess?: boolean } } | undefined)?.groupBuyCaps?.paidAccess
            ? () => <Button label="Join requests" variant="ghost" icon="people-outline" onPress={() => router.push("/manage/join-requests")} />
            : undefined,
        }}
      />
      <Loadable query={brand}>{(b) => <GroupBuys brand={b} />}</Loadable>
    </>
  );
}

const dashboardRoute = (gb: GroupBuy): Href =>
  `/manage/group-buys-detail?id=${encodeURIComponent(gb.id)}&name=${encodeURIComponent(gb.name)}` as Href;

function GroupBuys({ brand }: { brand: AdminBrand }) {
  const t = useTheme();
  const online = useOnline();
  const list = useGroupBuyList();
  const products = useCatalogProducts(brand);
  const currency = typeof brand.currency === "string" && brand.currency ? brand.currency : "₱";
  const money = moneyOf(currency);

  const [tab, setTab] = useState<"rounds" | "pricing">("rounds");
  const [ways, setWays] = useState(() => normalizeTwoWaysMode(brand.twoWaysMode));
  const [contentOverride, setContentOverride] = useState<GroupBuyContent | null>(null);
  const [editingContent, setEditingContent] = useState(false);
  // Tied to the list snapshot it was made against: a refetch (the save's own
  // invalidation, or another admin's edit) brings the server's value back.
  const [liveBannerOverride, setLiveBannerOverride] = useState<{ base: unknown; value: GroupBuyLiveBanner } | null>(null);
  const [editingLiveBanner, setEditingLiveBanner] = useState(false);
  const [countdownOverride, setCountdownOverride] = useState<{ base: unknown; value: HeroCountdownConfig } | null>(null);
  const [editingCountdown, setEditingCountdown] = useState(false);
  const [invoiceOverride, setInvoiceOverride] = useState<{ base: unknown; value: GroupBuyInvoiceConfig } | null>(null);
  const [payModeOverride, setPayModeOverride] = useState<{ base: unknown; value: GbPaymentMode } | null>(null);
  const [editingInvoice, setEditingInvoice] = useState(false);
  const sendInvoices = useSendInvoices();
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<{ round: GroupBuy | null } | null>(null);
  const [reporting, setReporting] = useState<GroupBuy | null>(null);

  const save = useRoundAction("saveGroupBuyAction");
  const duplicate = useRoundAction("duplicateGroupBuyAction");
  const archive = useRoundAction("setGroupBuyArchivedAction");
  const busy = duplicate.isPending || archive.isPending;

  const data = list.data;
  const caps = data?.caps;
  const content = contentOverride ?? data?.content ?? normalizeGroupBuyContent(brand.groupBuyContent);
  const liveBanner =
    liveBannerOverride && liveBannerOverride.base === data?.liveBanner
      ? liveBannerOverride.value
      : normalizeGroupBuyLiveBanner(data?.liveBanner ?? brand.groupBuyLiveBanner);
  const overrideLiveBanner = (value: GroupBuyLiveBanner) => setLiveBannerOverride({ base: data?.liveBanner, value });
  const countdown =
    countdownOverride && countdownOverride.base === data?.heroCountdown
      ? countdownOverride.value
      : normalizeHeroCountdown(data?.heroCountdown);
  const overrideCountdown = (value: HeroCountdownConfig) => setCountdownOverride({ base: data?.heroCountdown, value });
  const invoice =
    invoiceOverride && invoiceOverride.base === data?.invoice ? invoiceOverride.value : normalizeGroupBuyInvoice(data?.invoice);
  const overrideInvoice = (value: GroupBuyInvoiceConfig) => setInvoiceOverride({ base: data?.invoice, value });
  // Absent on a server that predates the setting: the invoice switch is the mode there.
  const hasPayMode = data?.paymentMode !== undefined;
  const payMode =
    payModeOverride && payModeOverride.base === data?.paymentMode
      ? payModeOverride.value
      : (normalizeGbPaymentMode(data?.paymentMode) ?? gbPaymentModeFor({ groupBuyInvoice: invoice }));
  const overridePayMode = (value: GbPaymentMode) => setPayModeOverride({ base: data?.paymentMode, value });
  const previewRound = useMemo(() => {
    const live = data?.groupBuys.find((gb) => effectiveGroupBuyStatus(gb, data.caps.scheduled) === "active");
    return live ?? { name: "GB #1", description: "", deliveryEta: "" };
  }, [data]);
  const rowsById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data?.rows]);

  // Auto report on close (groupbuy.reports.auto_on_close): pop the first finished
  // round's report once per visit. The "Reports ready" badge stays regardless.
  const [autoHandled, setAutoHandled] = useState(false);
  const autoRound =
    !autoHandled && data && data.caps.reports.autoOnClose && data.caps.supplierReports
      ? (roundsAwaitingReport(data.groupBuys, data.caps.scheduled)[0] ?? null)
      : null;
  const shownReport = reporting ?? autoRound;
  const closeReport = () => {
    setAutoHandled(true);
    setReporting(null);
  };

  const fail = (title: string) => (e: Error) => Alert.alert(title, e.message);

  const confirmArchive = (gb: GroupBuy) => {
    const archived = gb.status === "archived";
    const run = () => archive.mutate([gb.id, !archived], { onError: fail(archived ? "Couldn't restore" : "Couldn't archive") });
    if (archived) return run();
    Alert.alert(`Archive "${gb.name}"?`, "Its orders and reports are kept.", [
      { text: "Cancel", style: "cancel" },
      { text: "Archive", style: "destructive", onPress: run },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching}
            onRefresh={() => {
              void list.refetch();
              void products.refetch();
            }}
            tintColor={t.brand.link}
          />
        }
      >
        <Segmented
          segments={[
            { key: "rounds", label: "Rounds" },
            { key: "pricing", label: "Pricing" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {list.isError ? (
          <ErrorState message={list.error?.message ?? "Please try again."} onRetry={() => void list.refetch()} />
        ) : !data || !caps ? (
          <SkeletonList rows={4} />
        ) : tab === "pricing" ? (
          products.data ? (
            <PricingTab brand={brand} caps={caps} groupBuys={data.groupBuys} products={products.data} />
          ) : products.isError ? (
            <ErrorState message={products.error?.message ?? "Couldn't load products."} onRetry={() => void products.refetch()} />
          ) : (
            <SkeletonList rows={4} />
          )
        ) : (
          <>
            <CommunityShareCard />
            <WaysCard ways={ways} setWays={setWays} />
            {caps.productAssignment && ways.onHand === "open" ? <AllowOnHandCard initial={brand.groupBuyAllowOnHand !== false} /> : null}
            <CopyCard content={content} onEdit={() => setEditingContent(true)} />
            <LiveBannerCard
              value={liveBanner}
              setValue={overrideLiveBanner}
              round={previewRound}
              onEdit={() => setEditingLiveBanner(true)}
            />
            {/* Absent on a server that predates the hero countdown. */}
            {data.heroCountdown !== undefined ? (
              <HeroCountdownCard
                value={countdown}
                setValue={overrideCountdown}
                roundName={previewRound.name}
                onEdit={() => setEditingCountdown(true)}
              />
            ) : null}
            {hasPayMode ? <PaymentModeCard value={payMode} setValue={overridePayMode} onInvoice={overrideInvoice} /> : null}
            {/* With the payment-mode card above, the invoice card only edits
                the pay-after-close details — its switch IS that card's choice. */}
            {data.invoice !== undefined && (!hasPayMode || payMode === "pay_later") ? (
              <InvoiceCard
                value={invoice}
                setValue={overrideInvoice}
                currency={currency}
                onEdit={() => setEditingInvoice(true)}
                showSwitch={!hasPayMode}
              />
            ) : null}
            <RoundsList
              data={data}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((v) => !v)}
              online={online}
              busy={busy}
              money={money}
              rowsById={rowsById}
              onCreate={() => setEditor({ round: null })}
              onOpen={(gb) => router.push(dashboardRoute(gb))}
              onReport={(gb) => {
                setAutoHandled(true);
                setReporting(gb);
              }}
              onDuplicate={(gb) => duplicate.mutate([gb.id], { onError: fail("Couldn't duplicate") })}
              onEdit={(gb) => setEditor({ round: gb })}
              onArchive={confirmArchive}
              onSendInvoices={
                invoice.enabled
                  ? (gb) => confirmSendInvoices(gb.name, () => sendInvoices.mutate(gb.id))
                  : undefined
              }
              sendingInvoices={sendInvoices.isPending}
            />
          </>
        )}
      </ScrollView>

      {editor && data ? (
        <RoundEditor
          key={editor.round?.id ?? "new"}
          initial={editor.round}
          caps={data.caps}
          settings={data.settings}
          products={(products.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
          groupBuyOnly={ways.onHand === "hidden"}
          saving={save.isPending}
          onCancel={() => setEditor(null)}
          onSave={(patch) => save.mutate([patch], { onSuccess: () => setEditor(null), onError: fail("Couldn't save the group buy") })}
        />
      ) : null}
      {editingContent ? (
        <ContentEditor
          initial={content}
          onClose={() => setEditingContent(false)}
          onSaved={(c) => {
            setContentOverride(c);
            setEditingContent(false);
          }}
        />
      ) : null}
      {editingLiveBanner ? (
        <LiveBannerEditor
          initial={liveBanner}
          round={previewRound}
          onClose={() => setEditingLiveBanner(false)}
          onSaved={(v) => {
            overrideLiveBanner(v);
            setEditingLiveBanner(false);
          }}
        />
      ) : null}
      {editingCountdown ? (
        <HeroCountdownEditor
          initial={countdown}
          roundName={previewRound.name}
          onClose={() => setEditingCountdown(false)}
          onSaved={(v) => {
            overrideCountdown(v);
            setEditingCountdown(false);
          }}
        />
      ) : null}
      {editingInvoice ? (
        <InvoiceEditor
          initial={invoice}
          currency={currency}
          roundName={previewRound.name}
          onClose={() => setEditingInvoice(false)}
          onSaved={(v) => {
            overrideInvoice(v);
            setEditingInvoice(false);
          }}
        />
      ) : null}
      {shownReport && data ? <ReportSheet groupBuy={shownReport} caps={data.caps} currency={currency} onClose={closeReport} /> : null}
    </View>
  );
}

function RoundsList({
  data,
  showArchived,
  onToggleArchived,
  online,
  busy,
  money,
  rowsById,
  onCreate,
  onOpen,
  onReport,
  onDuplicate,
  onEdit,
  onArchive,
  onSendInvoices,
  sendingInvoices,
}: {
  data: ListResult;
  showArchived: boolean;
  onToggleArchived: () => void;
  online: boolean;
  busy: boolean;
  money: (n: number) => string;
  rowsById: Map<string, ListResult["rows"][number]>;
  onCreate: () => void;
  onOpen: (gb: GroupBuy) => void;
  onReport: (gb: GroupBuy) => void;
  onDuplicate: (gb: GroupBuy) => void;
  onEdit: (gb: GroupBuy) => void;
  onArchive: (gb: GroupBuy) => void;
  /** Set on pay-after-close stores: offered on closed rounds. */
  onSendInvoices?: (gb: GroupBuy) => void;
  sendingInvoices: boolean;
}) {
  const { caps, groupBuys } = data;
  const visible = groupBuys.filter((gb) => (showArchived ? gb.status === "archived" : gb.status !== "archived"));
  const archivedCount = groupBuys.filter((gb) => gb.status === "archived").length;
  const awaiting = new Set(caps.supplierReports ? roundsAwaitingReport(groupBuys, caps.scheduled).map((gb) => gb.id) : []);
  const canCreate = caps.canCreate && !showArchived;

  return (
    <View style={{ gap: SPACE.md }}>
      <View style={styles.head}>
        <AppText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {showArchived ? "Archived rounds" : "Rounds"}
        </AppText>
        {archivedCount > 0 ? (
          <Button
            label={showArchived ? "Back to list" : `Archived (${archivedCount})`}
            variant="ghost"
            icon={showArchived ? "arrow-back" : "archive-outline"}
            onPress={onToggleArchived}
          />
        ) : null}
      </View>
      {canCreate ? <Button label="New Group Buy" icon="add" disabled={!online} onPress={onCreate} /> : null}
      {awaiting.size > 0 && !showArchived ? (
        <AppText variant="caption" color="muted">
          {`${awaiting.size} finished round${awaiting.size === 1 ? " has" : "s have"} reports ready — archive a round once you're done with it.`}
        </AppText>
      ) : null}
      {visible.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={showArchived ? "Nothing archived." : "No group buys yet."}
          action={canCreate && online ? { label: "Open your first group buy", onPress: onCreate } : undefined}
        />
      ) : (
        visible.map((gb) => (
          <RoundCard
            key={gb.id}
            gb={gb}
            row={rowsById.get(gb.id)}
            effective={effectiveGroupBuyStatus(gb, caps.scheduled)}
            caps={caps}
            awaitingReport={awaiting.has(gb.id)}
            busy={busy || !online || sendingInvoices}
            money={money}
            onOpen={() => onOpen(gb)}
            onReport={() => onReport(gb)}
            onDuplicate={() => onDuplicate(gb)}
            onEdit={() => onEdit(gb)}
            onArchive={() => onArchive(gb)}
            onSendInvoices={
              onSendInvoices && effectiveGroupBuyStatus(gb, caps.scheduled) === "closed"
                ? () => onSendInvoices(gb)
                : undefined
            }
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
});
