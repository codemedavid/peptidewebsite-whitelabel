import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { adminBridge } from "@/features/admin/bridge";
import { accountKeys, callAction, useRefreshAdmin, useUpgradeContext } from "@/features/admin/account/data";
import {
  BUSINESS_FEATURES,
  STARTER_COMBOS,
  STARTER_DOWNGRADE_PRODUCT_CAP,
  fmtPesos,
  isHostedUrl,
  moduleLabel,
  trialOf,
  type UpgradeContext,
} from "@/features/admin/account/rules";
import { MoneyLine, Notice, RadioRow, Thumb } from "@/features/admin/account/ui";
import { success, useAdminBrand } from "@/features/admin/setup/data";
import { ImageField } from "@/features/admin/setup/ImageField";
import { FormPage, Hint, Loadable, Section } from "@/features/admin/setup/ui";
import { useOnline } from "@/ui/feedback";
import { AppText, Button, Pill } from "@/ui/primitives";

/**
 * The website's Upgrade to Business (AdminUpgrade) — where a locked module
 * lands — plus, once a trial has ended, its "Choose how to continue" screen
 * (TrialPlansScreen): Business, or Starter with one combo via
 * downgradeToStarterAction. The order summary is server-computed
 * (getUpgradeContextAction); payment is manual proof → a PENDING request the
 * platform approves. Nothing here changes the plan by itself.
 */
export default function UpgradeScreen() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const ctx = useUpgradeContext();
  const brand = useAdminBrand();
  const expired = brand.data ? trialOf(brand.data)?.expired === true : false;
  const [step, setStep] = useState<"plans" | "pay" | null>(null);
  const current = step ?? (expired ? "plans" : "pay");

  return (
    <>
      <Stack.Screen options={{ title: current === "plans" ? "Choose your plan" : "Upgrade to Business" }} />
      <Loadable query={ctx}>
        {(c) => (
          <FormPage>
            <LockedIntro view={typeof view === "string" ? view : undefined} />
            {current === "plans" ? <Plans ctx={c} onUpgrade={() => setStep("pay")} /> : <Pay ctx={c} />}
          </FormPage>
        )}
      </Loadable>
    </>
  );
}

/** "Sales Analytics is a Business feature" — named from the server's own menu. */
function LockedIntro({ view }: { view?: string }) {
  const { scope } = useSignedIn();
  const menu = useQuery({ queryKey: accountKeys.menu(scope), queryFn: adminBridge.menu, enabled: !!view });
  if (!view || view === "upgrade") return null;
  const item = menu.data?.groups.flatMap((g) => g.items).find((i) => i.view === view);
  const label = item?.label ?? moduleLabel(view);
  if (!label) return null;
  return (
    <Notice tone="info" icon="lock-closed-outline">
      <View style={{ gap: 2 }}>
        <AppText variant="bodyStrong">{`${label} is a Business feature`}</AppText>
        <AppText variant="caption" color="muted">
          {item?.hint ? `${item.hint}. ` : ""}Upgrade to unlock it, along with every Business exclusive.
        </AppText>
      </View>
    </Notice>
  );
}

// ── Choose how to continue (trial expired) ───────────────────────────────────

function Plans({ ctx, onUpgrade }: { ctx: UpgradeContext; onUpgrade: () => void }) {
  const t = useTheme();
  const online = useOnline();
  const { reloadMe } = useSession();
  const refreshAdmin = useRefreshAdmin();
  const [combo, setCombo] = useState<string>(STARTER_COMBOS[0].id);

  const downgrade = useMutation({
    mutationFn: () => callAction("downgradeToStarterAction", combo),
    onSuccess: () => {
      success();
      refreshAdmin();
      void reloadMe();
      Alert.alert("You're on Starter", "Your storefront is live again.", [{ text: "OK", onPress: () => router.back() }]);
    },
    onError: (e) => Alert.alert("Couldn't switch plans", e.message),
  });

  const confirmDowngrade = () => {
    const chosen = STARTER_COMBOS.find((c) => c.id === combo);
    Alert.alert(
      "Downgrade to Starter?",
      `You'll keep ${chosen?.title ?? "one combination"}, limited to ${STARTER_DOWNGRADE_PRODUCT_CAP} products. Everything else stays locked.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Downgrade", style: "destructive", onPress: () => downgrade.mutate() },
      ],
    );
  };

  return (
    <>
      <AppText variant="body" color="muted">
        Reactivate your storefront instantly — keep everything with Business, or keep it simple with Starter.
      </AppText>

      <Section title="Business">
        <Pill tone="success" size="sm" icon="star-outline" label="Recommended" />
        <MoneyLine label="Per month" value={fmtPesos(ctx.quote.businessCents)} strong />
        {ctx.quote.creditCents > 0 ? (
          <Notice tone="success" icon="pricetag-outline">
            {`Your ${fmtPesos(ctx.quote.creditCents)} trial payment is deducted — pay only ${fmtPesos(ctx.quote.dueTodayCents)} today`}
          </Notice>
        ) : null}
        <View style={{ gap: SPACE.sm }}>
          {BUSINESS_FEATURES.map((f) => (
            <View key={f.text} style={styles.feature}>
              <Ionicons name="checkmark" size={18} color={t.tone("success").fg} />
              <AppText variant="body" style={{ flex: 1 }}>
                {f.text}
              </AppText>
              {f.exclusive ? <Pill tone="info" size="sm" label="Exclusive" /> : null}
            </View>
          ))}
        </View>
        <Hint>Always growing: every new feature we launch is added to Business as an exclusive — at no extra cost.</Hint>
        <Button label="Upgrade to Business" icon="arrow-up-circle-outline" onPress={onUpgrade} />
      </Section>

      <Section title="Starter" hint="Pick one combination — the rest stays locked">
        <MoneyLine label="Per month" value={fmtPesos(ctx.starterCents)} strong />
        <View accessibilityRole="radiogroup" accessibilityLabel="Starter combination" style={{ gap: SPACE.sm }}>
          {STARTER_COMBOS.map((c) => (
            <RadioRow key={c.id} selected={combo === c.id} title={c.title} sub={c.sub} onPress={() => setCombo(c.id)} />
          ))}
        </View>
        <Notice tone="warning" icon="alert-circle-outline">
          {`Limited to ${STARTER_DOWNGRADE_PRODUCT_CAP} products in your catalog.`}
        </Notice>
        <Hint>No sales analytics, no card customization, and other tools stay locked on Starter.</Hint>
        <Button
          label={downgrade.isPending ? "Switching…" : "Downgrade to Starter"}
          variant="secondary"
          loading={downgrade.isPending}
          disabled={downgrade.isPending || !online}
          onPress={confirmDowngrade}
        />
      </Section>
    </>
  );
}

// ── Upgrade to Business (payment) ────────────────────────────────────────────

function Pay({ ctx }: { ctx: UpgradeContext }) {
  const online = useOnline();
  const refreshAdmin = useRefreshAdmin();
  const [method, setMethod] = useState(ctx.methods[0]?.method ?? "");
  const [proofUrl, setProofUrl] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = useMutation({
    mutationFn: () => callAction("submitUpgradeRequestAction", { payMethod: method, proofUrl }),
    onSuccess: () => {
      success();
      setSubmitted(true);
      refreshAdmin();
      Alert.alert("Upgrade submitted", "We're reviewing your payment.");
    },
    onError: (e) => Alert.alert("Couldn't submit", e.message),
  });

  if (submitted || ctx.pendingRequest) {
    return (
      <Notice tone="success" icon="hourglass-outline">
        <View style={{ gap: 2 }}>
          <AppText variant="bodyStrong">Your upgrade is in review.</AppText>
          <AppText variant="caption" color="muted">
            {"We're confirming your payment — your Business plan (and your storefront, if it's paused) activates the moment it's approved."}
          </AppText>
        </View>
      </Notice>
    );
  }

  const noMethods = ctx.methods.length === 0;
  return (
    <>
      <Section title="Order summary">
        <MoneyLine label="Business Package · monthly" value={fmtPesos(ctx.quote.businessCents)} />
        {ctx.quote.creditCents > 0 ? (
          <MoneyLine label="Trial payment credit" value={`− ${fmtPesos(ctx.quote.creditCents)}`} tone="success" />
        ) : null}
        <MoneyLine label="Due today" value={fmtPesos(ctx.quote.dueTodayCents)} strong />
        <Hint>
          {`Then ${fmtPesos(ctx.quote.businessCents)}/month. Your storefront reactivates as soon as we confirm your payment. All features unlock, including Sales Analytics, Product Card Customization, Checkout Fee and Delivery Note — and every new feature we release.`}
        </Hint>
      </Section>

      <Section title="Payment">
        {noMethods ? (
          <Notice tone="warning" icon="alert-circle-outline">
            No payment methods are configured yet — contact support to complete your upgrade.
          </Notice>
        ) : (
          <View accessibilityRole="radiogroup" accessibilityLabel="Payment method" style={{ gap: SPACE.sm }}>
            {ctx.methods.map((m) => {
              const selected = method === m.method;
              const sub = [m.account, m.number && `· ${m.number}`, m.note && `— ${m.note}`].filter(Boolean).join(" ");
              return (
                <RadioRow key={m.id} selected={selected} title={m.method} sub={sub || undefined} onPress={() => setMethod(m.method)}>
                  {selected && m.qrUrl ? <Thumb uri={m.qrUrl} label={`${m.method} QR`} size={160} /> : null}
                </RadioRow>
              );
            })}
          </View>
        )}
        <ImageField
          label="Proof of payment"
          value={proofUrl}
          onChange={(url) => setProofUrl(url)}
          validate={(url) => (isHostedUrl(url) ? null : "This store can't host images yet, so the receipt can't be attached.")}
          previewAspect={3 / 4}
        />
        <Button
          label={submit.isPending ? "Submitting…" : `Submit payment · ${fmtPesos(ctx.quote.dueTodayCents)}`}
          icon="send-outline"
          loading={submit.isPending}
          disabled={submit.isPending || !proofUrl || noMethods || !online}
          onPress={() => submit.mutate()}
        />
        <Hint>Reviewed by the platform team · usually within a day</Hint>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  feature: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
