import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { GroupBuyJoinState, ShopPaymentMethod } from "@shop-contract";
import { ApiError, type UploadFile } from "@/api/client";
import { askPhotoSource, PhotoError, pickPhotos } from "@/features/admin/catalog/images";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { shopApi } from "../../api";
import { useGroupBuyJoinActions } from "../../hooks";
import { FormSection, Notice } from "../ShopUI";

/**
 * The Paid Access payment step: where to send the money, then the proof (photo +
 * reference + method) — or the provider's checkout when the store takes
 * online payments. The amount is never sent; the server prices the step.
 */

const REFERENCE_MIN = 4; // core/input.ts parseProofSubmission

const haptic = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function PayStep({ state, roundId }: { state: GroupBuyJoinState; roundId: string }) {
  const { payOnline } = useGroupBuyJoinActions(roundId);
  const rejected = state.proof?.rejectReason;
  return (
    <View style={{ gap: SPACE.md }}>
      {rejected ? (
        <Notice tone="danger" icon="close-circle-outline">
          {`Your last proof wasn't accepted: ${rejected}. Please send it again.`}
        </Notice>
      ) : null}
      {state.amountMode === "deposit" ? (
        <Notice tone="info" icon="information-circle-outline">
          {`${state.amountLabel} is a deposit — it's credited to your group-buy order at checkout.`}
        </Notice>
      ) : null}

      {state.paymentOptions.online ? (
        <FormSection title="Pay online" hint="You'll finish paying in your browser. Come back here when you're done — it updates once the payment arrives.">
          {payOnline.error ? (
            <Notice tone="danger" icon="alert-circle-outline">
              {errorText(payOnline.error, "Couldn't start the payment.")}
            </Notice>
          ) : null}
          <Button label={`Pay ${state.amountLabel} online`} icon="card-outline" loading={payOnline.isPending} onPress={() => payOnline.mutate()} />
        </FormSection>
      ) : null}

      {state.paymentOptions.manual ? (
        <>
          <PayTo methods={state.paymentAccounts} amount={state.amountLabel} />
          <ReceiptForm roundId={roundId} methods={state.paymentAccounts} />
        </>
      ) : null}
    </View>
  );
}

function PayTo({ methods, amount }: { methods: ShopPaymentMethod[]; amount: string }) {
  const t = useTheme();
  const [copied, setCopied] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async (m: ShopPaymentMethod) => {
    await Clipboard.setStringAsync(m.number).catch(() => undefined);
    haptic();
    setCopied(m.id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 1600);
  };
  return (
    <FormSection title={`Send exactly ${amount} to`}>
      {methods.length === 0 ? (
        <AppText variant="body" color="muted">
          The store hasn&apos;t listed a payment account yet — message them for where to pay.
        </AppText>
      ) : (
        methods.map((m) => (
          <View key={m.id} style={[styles.method, { backgroundColor: t.colors.bg, borderColor: t.colors.border }]}>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <AppText variant="bodyStrong">{m.name}</AppText>
              {m.account ? (
                <AppText variant="caption" color="muted">
                  {m.account}
                </AppText>
              ) : null}
              {m.number ? (
                <View style={styles.numberRow}>
                  <AppText variant="bodyStrong" style={styles.number} selectable>
                    {m.number}
                  </AppText>
                  <Pressable
                    onPress={() => void copy(m)}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${m.name} number`}
                    hitSlop={10}
                    style={({ pressed }) => [styles.copy, { borderColor: t.brand.link, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <AppText variant="caption" color="link">
                      {copied === m.id ? "Copied" : "Copy"}
                    </AppText>
                  </Pressable>
                </View>
              ) : null}
            </View>
            {m.qrImage ? <Image source={{ uri: m.qrImage }} style={styles.qr} contentFit="cover" accessibilityLabel={`${m.name} QR code`} /> : null}
          </View>
        ))
      )}
    </FormSection>
  );
}

function ReceiptForm({ roundId, methods }: { roundId: string; methods: ShopPaymentMethod[] }) {
  const t = useTheme();
  const { sendReceipt } = useGroupBuyJoinActions(roundId);
  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState(methods[0]?.name ?? "");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function choose() {
    const source = await askPhotoSource("Proof of payment");
    if (!source) return;
    try {
      const picked = (await pickPhotos(source))?.[0];
      if (picked) setPhoto(picked);
    } catch (e) {
      Alert.alert("Couldn't use that photo", e instanceof PhotoError ? e.message : "Please try another photo.");
    }
  }

  function submit() {
    if (!photo) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    sendReceipt.mutate({ file: photo, reference: reference.trim(), method: method || undefined, signal: controller.signal }, { onSuccess: haptic });
  }

  const aborted = sendReceipt.error instanceof ApiError && sendReceipt.error.code === "aborted";
  const error = sendReceipt.error && !aborted ? sendReceipt.error : null;
  return (
    <FormSection title="Send your proof of payment" hint="A screenshot from GCash or your bank app is perfect.">
      <Pressable
        onPress={() => void choose()}
        accessibilityRole="button"
        accessibilityLabel={photo ? "Change payment screenshot" : "Add payment screenshot"}
        style={({ pressed }) => [styles.drop, { borderColor: photo ? t.colors.border : t.brand.link, backgroundColor: t.colors.bg, opacity: pressed ? 0.85 : 1 }]}
      >
        {photo ? (
          <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="contain" accessibilityLabel="Your payment screenshot" />
        ) : (
          <>
            <Ionicons name="receipt-outline" size={26} color={t.brand.link} />
            <AppText variant="label" color="link" style={{ textAlign: "center" }}>
              Add a screenshot of your payment
            </AppText>
          </>
        )}
      </Pressable>
      <Field
        label="Reference number"
        value={reference}
        onChangeText={setReference}
        placeholder="e.g. 1023 4567 8901"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={64}
      />
      {methods.length > 1 ? (
        <View style={{ gap: SPACE.xs }}>
          <AppText variant="label" color="muted">
            Paid with
          </AppText>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {methods.map((m) => {
              const on = m.name === method;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setMethod(m.name)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [
                    styles.chip,
                    { borderColor: on ? t.brand.primary : t.colors.border, backgroundColor: on ? t.brand.primary : t.colors.surface, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <AppText variant="label" color={on ? "onPrimary" : "text"}>
                    {m.name}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {error ? (
        <Notice tone="danger" icon="alert-circle-outline">
          {errorText(error, "Couldn't send your proof.")}
        </Notice>
      ) : null}
      <Button
        label="Send proof"
        icon="send-outline"
        loading={sendReceipt.isPending}
        disabled={!photo || reference.trim().length < REFERENCE_MIN}
        onPress={submit}
      />
    </FormSection>
  );
}

/** What the member already sent (payment review, or waiting for approval after paying). */
export function ProofSent({ state, roundId }: { state: GroupBuyJoinState; roundId: string }) {
  const [opening, setOpening] = useState(false);
  const proof = state.proof;
  if (!proof) return null;
  const open = async () => {
    setOpening(true);
    try {
      const { url } = await shopApi.groupBuyReceiptUrl(roundId);
      if (/^https:\/\//i.test(url)) await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Couldn't open your proof", errorText(e, "Please try again."));
    } finally {
      setOpening(false);
    }
  };
  const rows: [string, string][] = [["Amount", state.amountLabel]];
  if (proof.reference) rows.push(["Reference", proof.reference]);
  if (proof.method) rows.push(["Paid with", proof.method]);
  if (proof.submittedAt) rows.push(["Sent", new Date(proof.submittedAt).toLocaleString()]);
  return (
    <FormSection title="Your payment">
      {rows.map(([k, v]) => (
        <View key={k} style={styles.fact}>
          <AppText variant="body" color="muted">
            {k}
          </AppText>
          <AppText variant="bodyStrong" style={{ flexShrink: 1, textAlign: "right" }} selectable>
            {v}
          </AppText>
        </View>
      ))}
      {proof.hasReceipt ? <Button label="View my proof" variant="ghost" icon="image-outline" loading={opening} onPress={() => void open()} /> : null}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  method: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth },
  numberRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.sm, marginTop: SPACE.xs },
  number: { fontVariant: ["tabular-nums"], letterSpacing: 0.3 },
  copy: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SPACE.sm, paddingVertical: 2, minHeight: 24, justifyContent: "center" },
  qr: { width: 76, height: 76, borderRadius: RADIUS.md, backgroundColor: "#fff" },
  drop: { minHeight: 132, borderRadius: RADIUS.lg, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: SPACE.sm, padding: SPACE.sm },
  preview: { width: "100%", height: 220, borderRadius: RADIUS.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  chip: { minHeight: TOUCH, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md },
});
