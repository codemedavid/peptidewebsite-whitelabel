import { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import type { ShopCatalog } from "@shop-contract";
import { ApiError } from "@/api/client";
import { useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { AppText, Button } from "@/ui/primitives";
import { useCartRows, useCatalog, usePlaceOrder, useQuote } from "../hooks";
import { buyableLines } from "../lib/cart";
import {
  checkoutError,
  emptyForm,
  newAttemptId,
  orderRequest,
  pickCourier,
  proofRequired,
  quoteRequest,
  withDefaults,
  type CheckoutForm,
} from "../lib/checkout";
import { money } from "../lib/money";
import { useShop } from "../ShopProvider";
import { ContactSection, DeliverySection, NoteSection, PromoSection } from "./CheckoutSections";
import { OrderSummary } from "./OrderSummary";
import { PaymentSection } from "./PaymentSection";
import { CatalogError, ClosedBanner } from "./ShopStates";
import { FormSection, Notice } from "./ShopUI";

/** Checkout (signed-in customers): contact, delivery, payment, promo, note, the server's totals, Place order. */
export function CheckoutScreen() {
  const t = useTheme();
  const q = useCatalog();
  const title = <Stack.Screen options={{ title: "Checkout" }} />;
  if (q.isPending) return <View style={{ flex: 1, backgroundColor: t.colors.bg }}>{title}<SkeletonList rows={4} /></View>;
  if (q.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {title}
        <CatalogError error={q.error} storeName={t.brand.name} onRetry={() => void q.refetch()} />
      </View>
    );
  }
  return (
    <>
      {title}
      <CheckoutBody catalog={q.data} />
    </>
  );
}

function CheckoutBody({ catalog }: { catalog: ShopCatalog }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const { me } = useSignedIn();
  const shop = useShop();
  const rows = useCartRows(catalog);
  const lines = useMemo(() => buyableLines(rows), [rows]);
  const checkout = catalog.checkout;
  const currency = catalog.store.currency;
  const [draft, setForm] = useState<CheckoutForm>(() => emptyForm({ name: me.actor.displayName, email: me.actor.email }));
  // The only courier / area / method is pre-picked — derived, so a catalog
  // refresh under an open checkout keeps the picks valid.
  const form = withDefaults(draft, checkout);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // One idempotency key for this checkout: every retry of "Place order" reuses it.
  const attemptId = useRef(newAttemptId());
  const place = usePlaceOrder();
  const quote = useQuote(lines.length > 0 ? quoteRequest(lines, form) : null);

  const set = (patch: Partial<CheckoutForm>) => {
    setSubmitError(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  if (lines.length === 0 && !place.isSuccess) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <EmptyState icon="bag-outline" title="Nothing to check out" body="Your cart is empty, or its items can't be ordered right now." action={{ label: "Back to cart", onPress: () => router.back() }} />
      </View>
    );
  }

  const formError = checkoutError(form, checkout);
  const quoteError = quote.isError ? quote.error.message : null;
  const promoError = form.promoCode && quoteError ? quoteError : null;
  const canPlace = catalog.open && online && !formError && !!quote.data && !quote.isStale && !quoteError && !place.isPending;

  function submit() {
    if (!quote.data || formError) {
      setSubmitError(formError);
      return;
    }
    setSubmitError(null);
    place.mutate(orderRequest(attemptId.current, lines, form, checkout, quote.data), {
      onSuccess: ({ order }) => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        shop.clear();
        router.replace({ pathname: "/order-placed", params: { number: order.orderNumber } });
      },
      onError: (e) => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        const offline = e instanceof ApiError && (e.code === "network" || e.code === "timeout");
        setSubmitError(offline ? `${e.message} Tap Place order again — you won't be charged twice.` : e.message);
        // Fees or stock may have moved: refresh the numbers the shopper sees.
        void quote.refetch();
      },
    });
  }

  const buttonLabel = quote.data && !quote.isStale ? `Place order · ${money(quote.data.total, currency)}` : "Place order";
  const hint = !catalog.open ? "The shop is closed right now." : !online ? "You're offline." : formError;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <OfflineBanner />
      <KeyboardAwareScrollView bottomOffset={SPACE.xl} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {!catalog.open ? <ClosedBanner message={catalog.closedMessage} /> : null}
        {checkout.title || checkout.note ? (
          <View style={[styles.note, { backgroundColor: t.colors.surfaceAlt }]}>
            {checkout.title ? <AppText variant="heading">{checkout.title}</AppText> : null}
            {checkout.note ? <AppText variant="body" color="muted">{checkout.note}</AppText> : null}
          </View>
        ) : null}
        <ContactSection form={form} set={set} />
        <DeliverySection form={form} set={set} onCourier={(id) => { setSubmitError(null); setForm((f) => pickCourier(withDefaults(f, checkout), checkout, id)); }} checkout={checkout} currency={currency} />
        <PaymentSection
          checkout={checkout}
          methodId={form.paymentMethodId}
          onMethod={(paymentMethodId) => set({ paymentMethodId })}
          proofUrl={form.proofUrl}
          onProof={(proofUrl) => set({ proofUrl })}
          proofRequired={proofRequired(checkout)}
        />
        <PromoSection applied={form.promoCode} error={promoError} onApply={(promoCode) => set({ promoCode })} />
        {checkout.customerNoteEnabled ? (
          <NoteSection label={checkout.customerNoteLabel} value={form.customerNote} onChange={(customerNote) => set({ customerNote })} />
        ) : null}
        <FormSection title="Order summary">
          {quote.data ? (
            <OrderSummary totals={quote.data} currency={currency} updating={quote.isStale} shippingPending={checkout.couriers.length > 0 && !form.courierId} />
          ) : quoteError ? null : (
            <AppText variant="body" color="muted">Working out your total…</AppText>
          )}
          {quoteError && !promoError ? <Notice tone="danger" icon="alert-circle">{quoteError}</Notice> : null}
          {promoError ? <Notice tone="danger" icon="pricetag-outline">{`Promo code: ${promoError}`}</Notice> : null}
        </FormSection>
      </KeyboardAwareScrollView>
      <View style={[styles.bar, { paddingBottom: insets.bottom + SPACE.md, backgroundColor: t.colors.surface, borderTopColor: t.colors.border }]}>
        {submitError ? (
          <Notice tone="danger" icon="alert-circle">{submitError}</Notice>
        ) : hint ? (
          <View accessibilityLiveRegion="polite"><AppText variant="caption" color="muted">{hint}</AppText></View>
        ) : null}
        <Button label={buttonLabel} icon="lock-closed-outline" loading={place.isPending} disabled={!canPlace} onPress={submit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  note: { padding: SPACE.lg, borderRadius: RADIUS.lg, gap: SPACE.xs },
  bar: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth, gap: SPACE.sm },
});
