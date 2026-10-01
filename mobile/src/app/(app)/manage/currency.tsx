import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation } from "@tanstack/react-query";
import { useSession } from "@/auth/SessionProvider";
import { adminBridge, unwrap, type AdminBrand } from "@/features/admin/bridge";
import { Notice, successTap, useDiscardGuard } from "@/features/admin/catalog/components";
import { CURRENCIES, formatMoney, normalizeCurrency } from "@/features/admin/catalog/currency";
import { useAdminBrand, useCatalogRefresh } from "@/features/admin/catalog/hooks";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE, TOUCH } from "@/theme/tokens";
import { ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button, Card, Divider, SectionLabel } from "@/ui/primitives";

/**
 * The currency the shop trades in (AdminCurrency → saveCurrencyAction). It
 * relabels prices, it never converts them, and it isn't limited to the list:
 * "Something else…" takes any code or symbol, exactly like the website.
 */

const SAMPLE = 1500;
const CUSTOM = "custom";

export default function CurrencyScreen() {
  const brandQ = useAdminBrand();
  if (brandQ.isPending) return <><Stack.Screen options={{ title: "Currency" }} /><SkeletonList rows={3} /></>;
  if (brandQ.isError) {
    return (
      <>
        <Stack.Screen options={{ title: "Currency" }} />
        <ErrorState message={brandQ.error.message} onRetry={() => void brandQ.refetch()} />
      </>
    );
  }
  return <CurrencyEditor brand={brandQ.data} />;
}

function CurrencyEditor({ brand }: { brand: AdminBrand }) {
  const t = useTheme();
  const online = useOnline();
  const refresh = useCatalogRefresh();
  const { reloadMe } = useSession();
  const current = normalizeCurrency(brand.currency);
  // A registry currency selects itself; anything else opens in "custom" with the stored value kept.
  const known = CURRENCIES.some((c) => c.code === current.code);
  const [choice, setChoice] = useState(known ? current.code : CUSTOM);
  const [custom, setCustom] = useState(known ? "" : current.symbol);

  const picked = choice === CUSTOM ? custom : choice;
  const draft = normalizeCurrency(picked);
  const changed = draft.symbol !== current.symbol;
  const customBlank = choice === CUSTOM && !custom.trim();
  const allowLeave = useDiscardGuard(changed, "Your currency change hasn't been saved.");

  const save = useMutation({
    mutationFn: async () => unwrap(await adminBridge.call<{ ok: true } | { error: string }>("saveCurrencyAction", picked)),
    onSuccess: () => {
      // Every money figure in the app follows the store currency — refetch it all.
      refresh({ everything: true });
      void reloadMe();
      successTap();
      allowLeave();
      Alert.alert(`Now selling in ${draft.label}`, "Your prices kept their numbers — only the currency beside them changed.");
      router.back();
    },
    onError: (e) => Alert.alert("Couldn't save the currency", e.message),
  });

  const options = [...CURRENCIES.map((c) => ({ key: c.code, label: c.label, symbol: c.symbol })), { key: CUSTOM, label: "Something else…", symbol: "" }];

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Currency" }} />
      <OfflineBanner />
      <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" bottomOffset={SPACE.xl}>
        <View style={{ gap: SPACE.xs }}>
          <AppText variant="title">{`Your shop sells in ${current.label}`}</AppText>
          <AppText variant="body" color="muted">
            Shown on every product card, in the cart, at checkout, and across your dashboard and order records.
          </AppText>
        </View>

        <Card style={{ gap: SPACE.sm }}>
          <AppText variant="caption" color="muted">
            {`A product priced ${SAMPLE.toLocaleString()} in your catalog:`}
          </AppText>
          <View style={styles.preview}>
            <AppText variant="stat" color="faint" style={changed ? { textDecorationLine: "line-through" } : null}>
              {formatMoney(SAMPLE, current.symbol)}
            </AppText>
            {changed ? <Ionicons name="arrow-forward" size={18} color={t.colors.textMuted} /> : null}
            {changed ? <AppText variant="stat">{formatMoney(SAMPLE, draft.symbol)}</AppText> : null}
          </View>
          {changed ? (
            <Notice tone="info">
              {`Your prices do not change. A product priced ${SAMPLE.toLocaleString()} stays ${SAMPLE.toLocaleString()} — only the currency beside it changes, on every product you already have. If your prices should be different numbers, edit them in Manage Products after saving.`}
            </Notice>
          ) : null}
        </Card>

        <View>
          <SectionLabel>Currency</SectionLabel>
          <Card padded={false}>
            {options.map((o, i) => {
              const selected = choice === o.key;
              return (
                <View key={o.key}>
                  {i > 0 ? <Divider inset={SPACE.lg} /> : null}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={o.symbol ? `${o.label}, ${o.symbol}` : o.label}
                    onPress={() => setChoice(o.key)}
                    style={({ pressed }) => [styles.option, pressed ? { backgroundColor: t.colors.surfaceAlt } : null]}
                  >
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? t.brand.link : t.colors.textFaint} />
                    <AppText variant={selected ? "bodyStrong" : "body"} style={{ flex: 1 }}>
                      {o.label}
                    </AppText>
                    {o.symbol ? (
                      <AppText variant="label" color="muted">
                        {o.symbol}
                      </AppText>
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </View>

        {choice === CUSTOM ? (
          <Field
            label="Code or symbol"
            value={custom}
            onChangeText={setCustom}
            maxLength={8}
            placeholder="e.g. ZMW"
            autoCapitalize="characters"
            autoCorrect={false}
            hint="A three-letter code (ZMW, NGN) or a symbol (₸). Whatever you type is what customers see beside every price."
            error={customBlank ? "Type a currency code or symbol first." : null}
          />
        ) : null}

        <Button label="Save currency" loading={save.isPending} disabled={!online || !changed || customBlank || save.isPending} onPress={() => save.mutate()} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  preview: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.md },
  option: { minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm },
});
