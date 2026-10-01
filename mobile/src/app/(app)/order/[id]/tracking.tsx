import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import * as Haptics from "expo-haptics";
import { OrderConflict, useOrder, useUpdateOrder } from "@/features/orders/hooks";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * Courier, tracking number and the note the customer sees. Opened from
 * "Mark as shipped" (`ship=1`) it saves the details AND the status in one
 * write; otherwise it only edits the details. Unsaved edits are guarded.
 */
export default function TrackingSheet() {
  const t = useTheme();
  const navigation = useNavigation();
  const online = useOnline();
  const { id, ship } = useLocalSearchParams<{ id: string; ship?: string }>();
  const { data: order } = useOrder(id ?? "");
  const update = useUpdateOrder(id ?? "");
  const shipping = ship === "1";
  // Set right before a deliberate exit (saved / conflict) so the guard lets it through.
  const leaving = useRef(false);

  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (order && !loaded) {
      setCourier(order.courier);
      setTracking(order.trackingNumber);
      setNote(order.shippingNote);
      setLoaded(true);
    }
  }, [order, loaded]);

  const dirty = !!order && loaded && (courier !== order.courier || tracking !== order.trackingNumber || note !== order.shippingNote);

  // Guard unsaved edits: block the swipe-down and confirm any other exit.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty });
    const sub = navigation.addListener("beforeRemove", (e) => {
      if (!dirty || leaving.current) return;
      e.preventDefault();
      Alert.alert("Discard changes?", "Your courier and tracking details haven't been saved.", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return sub;
  }, [navigation, dirty]);

  if (!order) return <ActivityIndicator style={{ margin: SPACE.xxl }} color={t.brand.link} />;

  async function save() {
    if (!online) {
      Alert.alert("You're offline", "Reconnect to save. Nothing was changed.");
      return;
    }
    try {
      await update.mutateAsync({
        courier: courier.trim(),
        trackingNumber: tracking.trim(),
        shippingNote: note,
        ...(shipping ? { status: "shipped" as const } : {}),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      leaving.current = true;
      router.back();
    } catch (e) {
      if (e instanceof OrderConflict) {
        Alert.alert("This order just changed", "Someone else updated it. Review the latest version, then try again.", [
          {
            text: "OK",
            onPress: () => {
              leaving.current = true;
              router.back();
            },
          },
        ]);
      } else {
        Alert.alert("Couldn't save", e instanceof Error ? e.message : "Please try again.");
      }
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <AppText variant="title" accessibilityRole="header">
          {shipping ? "Ship this order" : "Delivery details"}
        </AppText>
        <AppText variant="body" color="muted">
          {shipping
            ? `Add how ${order.orderNumber} is being sent. The customer can use the tracking number to follow it.`
            : `Order ${order.orderNumber}`}
        </AppText>
        <Field label="Courier" value={courier} onChangeText={setCourier} placeholder="e.g. LBC, J&T, Lalamove" maxLength={120} autoCapitalize="words" returnKeyType="next" />
        <Field
          label="Tracking number"
          value={tracking}
          onChangeText={setTracking}
          placeholder="Optional"
          maxLength={120}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Field
          label="Note for the customer"
          value={note}
          onChangeText={setNote}
          placeholder="Optional — e.g. arriving Friday afternoon"
          hint="Shown to the customer when they track their order."
          maxLength={500}
          multiline
        />
        <Button
          label={shipping ? "Mark as shipped" : "Save"}
          icon={shipping ? "paper-plane" : "checkmark"}
          loading={update.isPending}
          disabled={!online || (!shipping && !dirty)}
          onPress={() => void save()}
        />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.xl, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
});
