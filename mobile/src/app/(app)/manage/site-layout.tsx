import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import type { AdminBrand } from "@/features/admin/bridge";
import { brandCategories } from "@/features/admin/catalog/model";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { FormPage, Loadable, SaveBar, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import type { IntlLocalConfig } from "@/features/admin/site-layout/config";
import { DEFAULT_INTL_LOCAL } from "@/features/admin/site-layout/defaults";
import type { LayoutEnv } from "@/features/admin/site-layout/fields";
import { buildLinkContext } from "@/features/admin/site-layout/links";
import { normalizeIntlLocalConfig } from "@/features/admin/site-layout/normalize";
import { FooterPanel } from "@/features/admin/site-layout/panels-footer";
import { HeroPanel, MarketsPanel, type IntlSwitch } from "@/features/admin/site-layout/panels-home";
import { SectionsPanel } from "@/features/admin/site-layout/panels-sections";
import { GeneralPanel, HeaderPanel, type PanelProps } from "@/features/admin/site-layout/panels-site";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Button, Card, Pill } from "@/ui/primitives";

/**
 * The website's Website Layout editor (site-builder/AdminSiteBuilder.tsx →
 * saveIntlLocalAction): the Intl & Local template's text, menus, images,
 * colours and sections, in the web's six tabs. Nothing reaches the live site
 * until Save; "Use this layout" switches the store's home onto the template
 * (and switching off restores the layout it had before). The International
 * switch saves on its own, right away (saveIntlMarketAction), as on the web.
 * The web's live preview is replaced by a short summary of what's on.
 */
export default function SiteLayoutScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Website Layout" }} />
      <Loadable query={brand}>{(b) => <Editor brand={b} />}</Loadable>
    </>
  );
}

const TABS = [
  { id: "general", label: "General" },
  { id: "header", label: "Header & menu" },
  { id: "hero", label: "Hero" },
  { id: "markets", label: "Markets" },
  { id: "sections", label: "Sections" },
  { id: "footer", label: "Footer" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const intlEnabledOf = (brand: AdminBrand): boolean => {
  const m = brand.intlMarket;
  return !(m && typeof m === "object" && (m as Record<string, unknown>).enabled === false);
};

function Editor({ brand }: { brand: AdminBrand }) {
  const [initial] = useState(() => normalizeIntlLocalConfig(brand.intlLocal ?? DEFAULT_INTL_LOCAL));
  const [draft, setDraft] = useState<IntlLocalConfig>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [tab, setTab] = useState<Tab>("general");
  const [homeLayout, setHomeLayout] = useState(() => (typeof brand.homeLayout === "string" ? brand.homeLayout : "classic"));
  const [intlEnabled, setIntlEnabled] = useState(() => intlEnabledOf(brand));
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveIntlLocalAction");
  const saveIntl = useSetupSave("saveIntlMarketAction");

  const active = homeLayout === "intl-local";
  const dirty = JSON.stringify(draft) !== baseline;
  useDiscardGuard(dirty);

  const update: PanelProps["update"] = (fn) => {
    hideSaved();
    setDraft((cur) => fn(cur));
  };

  const env = useMemo<LayoutEnv>(
    () => ({
      // dualMarket also needs the layout to be live — the server's rule.
      ctx: buildLinkContext(brand, draft.infoPages, intlEnabled && active),
      infoPages: draft.infoPages,
      categories: brandCategories(brand).filter((c) => c.id !== "all"),
    }),
    [brand, draft.infoPages, intlEnabled, active],
  );

  const intl: IntlSwitch = {
    enabled: intlEnabled,
    busy: saveIntl.isPending,
    setEnabled: (enabled) =>
      saveIntl.mutate(
        { enabled },
        {
          onSuccess: () => {
            setIntlEnabled(enabled);
            Alert.alert(enabled ? "International shop is on" : "International shop is off");
          },
          onError: (e) => Alert.alert("Couldn't save", e.message),
        },
      ),
  };

  function onSave(activate?: boolean) {
    const clean = normalizeIntlLocalConfig(draft);
    save.mutate(
      { config: clean, ...(activate === undefined ? {} : { activate }) },
      {
        onSuccess: (res) => {
          setDraft(clean);
          setBaseline(JSON.stringify(clean));
          const next = (res as { homeLayout?: unknown }).homeLayout;
          if (typeof next === "string") setHomeLayout(next);
          if (activate === true) Alert.alert("Your store now uses this layout");
          else if (activate === false) Alert.alert("Switched back to your previous layout");
          else showSaved();
        },
        onError: (e) => Alert.alert("Couldn't save", e.message || "Please check your connection and try again."),
      },
    );
  }

  function confirmReset() {
    Alert.alert(
      "Restore defaults?",
      "Replace everything with the template's default text, colours and menus? Nothing changes on your site until you save.",
      [
        { text: "Keep editing", style: "cancel" },
        { text: "Restore defaults", style: "destructive", onPress: () => update(() => normalizeIntlLocalConfig(DEFAULT_INTL_LOCAL)) },
      ],
    );
  }

  const props: PanelProps = { cfg: draft, update, env, brand: { ...brand, homeLayout } };
  const busy = save.isPending;

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={busy} saved={flash} onSave={() => onSave()} />}>
      <Card style={{ gap: SPACE.md }}>
        <View style={styles.statusRow}>
          <AppText variant="heading" style={{ flex: 1 }}>
            Intl & Local layout
          </AppText>
          <Pill tone={active ? "success" : "neutral"} icon={active ? "checkmark-circle" : "remove-circle-outline"} label={active ? "Live on your store" : "Not in use"} size="sm" />
        </View>
        <AppText variant="caption" color="muted">
          A storefront with a mega-menu, local and international market cards, learn cards, and community and newsletter bands. Every word, link, image
          and colour below is yours to change. Your products, cart and checkout stay exactly as they are.
        </AppText>
        <Summary cfg={draft} />
        <View style={styles.actions}>
          {active ? (
            <Button label="Stop using this layout" variant="secondary" disabled={busy} onPress={() => onSave(false)} />
          ) : (
            <Button label={dirty ? "Save & use this layout" : "Use this layout on my store"} disabled={busy} onPress={() => onSave(true)} />
          )}
          <Button label="Restore defaults" variant="ghost" icon="refresh" onPress={confirmReset} />
        </View>
      </Card>

      <TabStrip tab={tab} onTab={setTab} />

      {tab === "general" ? <GeneralPanel {...props} /> : null}
      {tab === "header" ? <HeaderPanel {...props} /> : null}
      {tab === "hero" ? <HeroPanel {...props} /> : null}
      {tab === "markets" ? <MarketsPanel {...props} intl={intl} /> : null}
      {tab === "sections" ? <SectionsPanel {...props} /> : null}
      {tab === "footer" ? <FooterPanel {...props} /> : null}
    </FormPage>
  );
}

/** What the template will show — the native stand-in for the web's live preview. */
function Summary({ cfg }: { cfg: IntlLocalConfig }) {
  const on = (show: boolean) => (show ? "on" : "off");
  const lines = [
    `Menu: ${cfg.nav.filter((n) => n.show).length} of ${cfg.nav.length} menus shown`,
    `Hero ${on(cfg.hero.show)} · Markets ${on(cfg.markets.show)} (${cfg.markets.cards.filter((c) => c.show).length} cards) · Learn ${on(cfg.learn.show)} (${cfg.learn.cards.filter((c) => c.show).length} cards)`,
    `Community ${on(cfg.community.show)} · Newsletter ${on(cfg.newsletter.show)} · ${cfg.customSections.length} custom section${cfg.customSections.length === 1 ? "" : "s"}`,
    `Footer ${on(cfg.footer.show)} · Contact button ${on(cfg.fab.show)} · ${cfg.infoPages.filter((p) => p.body.trim()).length} info page(s) written`,
  ];
  return (
    <View style={{ gap: 2 }}>
      {lines.map((l) => (
        <AppText key={l} variant="caption">
          {l}
        </AppText>
      ))}
    </View>
  );
}

function TabStrip({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
      {TABS.map((x) => {
        const selected = x.id === tab;
        return (
          <Pressable
            key={x.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onTab(x.id)}
            style={[styles.tab, { borderColor: selected ? t.colors.text : t.colors.border, backgroundColor: selected ? t.colors.text : t.colors.surface }]}
          >
            <AppText variant="label" color={selected ? t.colors.bg : "text"}>
              {x.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  tabs: { gap: SPACE.sm, paddingVertical: 2 },
  tab: { minHeight: 40, paddingHorizontal: 16, borderRadius: RADIUS.pill, borderWidth: 1, justifyContent: "center" },
});
