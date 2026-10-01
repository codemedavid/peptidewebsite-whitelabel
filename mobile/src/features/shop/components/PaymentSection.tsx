import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopCheckoutConfig, ShopPaymentMethod } from "@shop-contract";
import { ApiError } from "@/api/client";
import { useReducedMotion } from "@/features/community/hooks/useMotion";
import { askPhotoSource, PhotoError, pickPhotos } from "@/features/admin/catalog/images";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText, Button } from "@/ui/primitives";
import { useUploadProof } from "../hooks";
import { ChoiceRow, FormSection, Notice } from "./ShopUI";

/**
 * Payment: pick one of the store's methods, see where to send the money
 * (account, number to copy, QR to enlarge), then attach a photo of the payment.
 */
export function PaymentSection({
  checkout,
  methodId,
  onMethod,
  proofUrl,
  onProof,
  proofRequired,
}: {
  checkout: ShopCheckoutConfig;
  methodId: string;
  onMethod: (id: string) => void;
  proofUrl: string;
  onProof: (url: string) => void;
  proofRequired: boolean;
}) {
  const method = checkout.paymentMethods.find((m) => m.id === methodId) ?? null;
  if (checkout.paymentMethods.length === 0) {
    return (
      <FormSection title="Payment">
        <AppText variant="body" color="muted">
          No upfront payment needed — the store will tell you how to pay.
        </AppText>
      </FormSection>
    );
  }
  return (
    <FormSection title="Payment" hint={proofRequired ? "Pay first, then attach a screenshot of your payment." : undefined}>
      <View accessibilityRole="radiogroup" style={{ gap: SPACE.sm }}>
        {checkout.paymentMethods.map((m) => (
          <ChoiceRow
            key={m.id}
            selected={m.id === methodId}
            onPress={() => onMethod(m.id)}
            title={m.name}
            detail={m.qrph ? "QR PH · a processing fee applies" : undefined}
            icon="wallet-outline"
          />
        ))}
      </View>
      {method ? <PayTo method={method} /> : null}
      {method ? <ProofPicker url={proofUrl} onChange={onProof} required={proofRequired} /> : null}
    </FormSection>
  );
}

function PayTo({ method }: { method: ShopPaymentMethod }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(method.number);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View style={[styles.payTo, { backgroundColor: t.colors.surfaceAlt }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="overline" color="muted">{`SEND TO ${method.name.toUpperCase()}`}</AppText>
        {method.account ? <AppText variant="bodyStrong">{method.account}</AppText> : null}
        {method.number ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Account number ${method.number}. Copy`}
            accessibilityHint="Copies the number"
            onPress={() => void copy()}
            style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.6 : 1 }]}
          >
            <AppText variant="stat" selectable>{method.number}</AppText>
            <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={t.brand.link} />
            <AppText variant="label" color="link">{copied ? "Copied" : "Copy"}</AppText>
          </Pressable>
        ) : null}
      </View>
      {method.qrImage ? (
        <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${method.name} QR code. Enlarge`} onPress={() => setEnlarged(true)}>
          <Image source={{ uri: method.qrImage }} style={[styles.qr, { backgroundColor: "#FFFFFF" }]} contentFit="contain" />
          <AppText variant="caption" color="link" style={{ textAlign: "center" }}>Tap to enlarge</AppText>
        </Pressable>
      ) : null}
      {method.qrImage ? <QrModal visible={enlarged} uri={method.qrImage} title={method.name} onClose={() => setEnlarged(false)} /> : null}
    </View>
  );
}

function QrModal({ visible, uri, title, onClose }: { visible: boolean; uri: string; title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal visible={visible} animationType={reduced ? "none" : "fade"} transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.modal, { paddingTop: insets.top + SPACE.lg, paddingBottom: insets.bottom + SPACE.lg }]}>
        <AppText variant="heading" color="#FFFFFF" style={{ textAlign: "center" }}>{`Scan to pay · ${title}`}</AppText>
        <Image source={{ uri }} style={styles.qrLarge} contentFit="contain" accessibilityLabel={`${title} QR code`} />
        <Button label="Close" variant="secondary" onPress={onClose} style={{ alignSelf: "stretch" }} />
      </View>
    </Modal>
  );
}

type UploadState = { status: "idle" } | { status: "uploading"; uri: string } | { status: "error"; uri: string; message: string };

function ProofPicker({ url, onChange, required }: { url: string; onChange: (url: string) => void; required: boolean }) {
  const t = useTheme();
  const upload = useUploadProof();
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function choose() {
    const source = await askPhotoSource("Proof of payment");
    if (!source) return;
    let photo;
    try {
      photo = (await pickPhotos(source))?.[0];
    } catch (e) {
      Alert.alert("Couldn't use that photo", e instanceof PhotoError ? e.message : "Please try another photo.");
      return;
    }
    if (!photo) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ status: "uploading", uri: photo.uri });
    try {
      const res = await upload.mutateAsync({ file: photo, signal: controller.signal });
      setState({ status: "idle" });
      onChange(res.url);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.code === "aborted") return;
      setState({ status: "error", uri: photo.uri, message: e instanceof Error ? e.message : "Upload failed — please try again." });
    }
  }

  const preview = state.status !== "idle" ? state.uri : url;
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="label" color="muted">{required ? "Proof of payment (required)" : "Proof of payment (optional)"}</AppText>
      {preview ? (
        <View style={[styles.proof, { borderColor: t.colors.border }]}>
          <Image source={{ uri: preview }} style={styles.proofImage} contentFit="cover" accessibilityLabel="Your payment screenshot" />
          <View style={{ flex: 1, gap: SPACE.xs }}>
            {state.status === "uploading" ? (
              <View style={styles.inline} accessibilityLiveRegion="polite">
                <ActivityIndicator color={t.brand.link} />
                <AppText variant="label">Uploading…</AppText>
              </View>
            ) : state.status === "error" ? (
              <AppText variant="label" color={t.tone("danger").fg}>{state.message}</AppText>
            ) : (
              <View style={styles.inline}>
                <Ionicons name="checkmark-circle" size={18} color={t.tone("success").fg} />
                <AppText variant="label" color={t.tone("success").fg}>Attached</AppText>
              </View>
            )}
            {state.status === "uploading" ? (
              <Button label="Cancel" variant="ghost" onPress={() => { abort.current?.abort(); setState({ status: "idle" }); }} style={styles.small} />
            ) : (
              <Button label={state.status === "error" ? "Try another photo" : "Replace photo"} variant="ghost" onPress={() => void choose()} style={styles.small} />
            )}
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach proof of payment"
          accessibilityHint="Take a photo or choose a screenshot"
          onPress={() => void choose()}
          style={({ pressed }) => [styles.drop, { borderColor: t.brand.link, backgroundColor: pressed ? t.colors.surfaceAlt : "transparent" }]}
        >
          <Ionicons name="cloud-upload-outline" size={24} color={t.brand.link} />
          <AppText variant="bodyStrong" color="link">Attach a screenshot</AppText>
        </Pressable>
      )}
      {required && !url && state.status === "idle" ? (
        <Notice tone="info" icon="information-circle">The store checks your payment before confirming the order.</Notice>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  payTo: { flexDirection: "row", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.md, alignItems: "center" },
  copy: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, flexWrap: "wrap" },
  qr: { width: 96, height: 96, borderRadius: RADIUS.sm },
  modal: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", paddingHorizontal: SPACE.xl, gap: SPACE.xl, justifyContent: "center", alignItems: "center" },
  qrLarge: { width: "100%", aspectRatio: 1, backgroundColor: "#FFFFFF", borderRadius: RADIUS.lg },
  proof: { flexDirection: "row", gap: SPACE.md, padding: SPACE.sm, borderRadius: RADIUS.md, borderWidth: 1, alignItems: "center" },
  proofImage: { width: 72, height: 96, borderRadius: RADIUS.sm },
  inline: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  small: { minHeight: TOUCH, alignSelf: "flex-start", paddingHorizontal: 0 },
  drop: { minHeight: 88, borderRadius: RADIUS.md, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: SPACE.xs },
});
