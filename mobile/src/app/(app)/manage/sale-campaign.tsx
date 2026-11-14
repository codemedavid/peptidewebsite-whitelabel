import { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import {
  CAMPAIGN_NAME_MAX,
  campaignDateErrors,
  campaignDraftError,
  campaignDraftFrom,
  campaignPayload,
  freeShippingDraftError,
  freeShippingDraftFrom,
  freeShippingPayload,
  promoEngineGrants,
  savedCampaignStatus,
  type CampaignDraft,
  type FreeShippingDraft,
} from "@/features/admin/setup/promo-engine";
import { currencyOf } from "@/features/admin/setup/rules";
import { FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { Pill } from "@/ui/primitives";

/**
 * The website's promo-engine cards (AdminPromoEngine, at the top of Promo
 * Codes): the Sale Campaign (one start/end window with a teaser + live
 * countdown bar) and free shipping over a minimum. Each section shows only
 * with its operator grant, and saves through the website's own action.
 */
export default function SaleCampaignScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Sale campaign & shipping" }} />
      <Loadable query={brand}>
        {(b) => {
          const grants = promoEngineGrants(b);
          if (!grants.campaign && !grants.freeShipping) {
            return (
              <EmptyState
                icon="lock-closed-outline"
                title="Not enabled for your store yet"
                body="Ask your platform admin to turn on Sale campaign or Free shipping over a minimum."
              />
            );
          }
          return <Editor brand={b} campaignOn={grants.campaign} freeShippingOn={grants.freeShipping} />;
        }}
      </Loadable>
    </>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Editor({ brand, campaignOn, freeShippingOn }: { brand: AdminBrand; campaignOn: boolean; freeShippingOn: boolean }) {
  const currency = currencyOf(brand);
  const [savedCampaign, setSavedCampaign] = useState(() => campaignDraftFrom(brand.saleCampaign));
  const [savedShip, setSavedShip] = useState(() => freeShippingDraftFrom(brand.freeShippingThreshold));
  const [campaign, setCampaign] = useState<CampaignDraft>(savedCampaign);
  const [ship, setShip] = useState<FreeShippingDraft>(savedShip);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const saveCampaign = useSetupSave("saveSaleCampaignAction");
  const saveShip = useSetupSave("saveFreeShippingThresholdAction");

  const campaignDirty = campaignOn && !same(campaign, savedCampaign);
  const shipDirty = freeShippingOn && !same(ship, savedShip);
  const dirty = campaignDirty || shipDirty;
  useDiscardGuard(dirty);

  const dateErrors = campaignDateErrors(campaign);
  const error = (campaignDirty ? campaignDraftError(campaign) : null) ?? (shipDirty ? freeShippingDraftError(ship) : null);
  const saving = saveCampaign.isPending || saveShip.isPending;

  const editCampaign = (patch: Partial<CampaignDraft>) => {
    hideSaved();
    setCampaign((d) => ({ ...d, ...patch }));
  };
  const editShip = (patch: Partial<FreeShippingDraft>) => {
    hideSaved();
    setShip((d) => ({ ...d, ...patch }));
  };

  async function onSave() {
    if (error) return Alert.alert("Can't save yet", error);
    try {
      // Two website actions, each replacing only its own key.
      if (campaignDirty) {
        await saveCampaign.mutateAsync(campaignPayload(campaign));
        setSavedCampaign(campaign);
      }
      if (shipDirty) {
        await saveShip.mutateAsync(freeShippingPayload(ship));
        setSavedShip(ship);
      }
      showSaved();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Please try again.");
    }
  }

  const status = savedCampaignStatus(brand.saleCampaign);

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={saving} saved={flash} disabled={!!error} onSave={() => void onSave()} />}>
      {campaignOn ? (
        <Section
          title="Sale campaign"
          hint="One start and end time for an 11.11-style sale. Sale prices and promo codes marked “Only during the sale” switch on and off by themselves, with a countdown across the top of your store and app."
        >
          <Pill tone={status === "Live now" ? "success" : status === "Teaser showing" ? "info" : "neutral"} icon="flash-outline" label={status} />
          <ToggleRow label="Campaign on" value={campaign.enabled} onChange={(enabled) => editCampaign({ enabled })} />
          <Field
            label="Sale name"
            value={campaign.name}
            onChangeText={(name) => editCampaign({ name })}
            placeholder="11.11 Mega Sale"
            maxLength={CAMPAIGN_NAME_MAX}
          />
          <Field
            label="Starts"
            value={campaign.startsAt}
            onChangeText={(startsAt) => editCampaign({ startsAt })}
            placeholder="2026-11-11 00:00"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            error={dateErrors.startsAt}
          />
          <Field
            label="Ends"
            value={campaign.endsAt}
            onChangeText={(endsAt) => editCampaign({ endsAt })}
            placeholder="2026-11-12 00:00"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            error={dateErrors.endsAt}
          />
          <Hint>Times are in this phone&apos;s time zone.</Hint>
          <ToggleRow
            label="Show the countdown bar on the store"
            value={campaign.showBar}
            onChange={(showBar) => editCampaign({ showBar })}
          />
          <ToggleRow
            label="Tease it before it starts"
            hint="Shows “starts in …” for the days below."
            value={campaign.teaser}
            disabled={!campaign.showBar}
            onChange={(teaser) => editCampaign({ teaser })}
          />
          <Field
            label="Teaser days (1–30)"
            value={campaign.teaserDays}
            onChangeText={(v) => editCampaign({ teaserDays: v.replace(/[^0-9]/g, "") })}
            keyboardType="number-pad"
            editable={campaign.showBar && campaign.teaser}
          />
        </Section>
      ) : null}

      {freeShippingOn ? (
        <Section
          title="Free shipping over a minimum"
          hint={`Orders whose items reach the minimum ship free. Shoppers below it see “Add ${currency}X more for free shipping” in their cart.`}
        >
          <ToggleRow label="Free shipping on" value={ship.enabled} onChange={(enabled) => editShip({ enabled })} />
          <Field
            label={`Minimum order (${currency})`}
            value={ship.minSubtotal}
            onChangeText={(v) => editShip({ minSubtotal: v.replace(/[^0-9.]/g, "") })}
            placeholder="e.g. 1500"
            keyboardType="decimal-pad"
          />
          {brand.dualMarket === true ? (
            <Field
              label="International minimum (USD)"
              value={ship.usdMinSubtotal}
              onChangeText={(v) => editShip({ usdMinSubtotal: v.replace(/[^0-9.]/g, "") })}
              placeholder="Blank = not for International"
              keyboardType="decimal-pad"
            />
          ) : null}
          {campaignOn ? (
            <ToggleRow
              label="Only during the sale campaign"
              value={ship.campaignOnly}
              onChange={(campaignOnly) => editShip({ campaignOnly })}
            />
          ) : null}
        </Section>
      ) : null}
      {error ? <Hint tone="danger">{error}</Hint> : null}
    </FormPage>
  );
}
