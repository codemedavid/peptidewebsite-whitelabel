/**
 * A customer's "Promos & events" switch (server: lib/mobile/promo-push.ts).
 *
 * OFF until the customer turns it on — App Store 4.5.4 allows promotional
 * pushes only with explicit consent and an easy way out. Turning it on also
 * makes sure this phone can receive notifications (asks if it hasn't yet);
 * the choice itself is saved on the ACCOUNT, so it covers every phone they
 * sign in on. Shown only when the store offers promo notifications.
 */
import { useState } from "react";
import { Alert, Switch, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { promoApi } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { enablePush } from "@/notifications/push";
import { ChatText } from "@/features/community/components/ChatText";
import { CHAT } from "@/features/community/theme";

type PromoOptIn = {
  /** The store offers promo notifications and this is a customer. */
  isAvailable: boolean;
  isOn: boolean;
  isBusy: boolean;
  set: (on: boolean) => Promise<void>;
};

export function usePromoOptIn(): PromoOptIn {
  const { me } = useSignedIn();
  const { reloadMe } = useSession();
  const [pending, setPending] = useState<boolean | null>(null);
  const isAvailable = me.mode === "customer" && me.promoPush?.enabled === true;
  const store = me.store.name;

  const set = async (on: boolean) => {
    setPending(on);
    try {
      if (on) {
        const push = await enablePush({ newOrders: false, storeName: store });
        if (!push.ok) {
          Alert.alert("Notifications are off", push.message);
          return;
        }
      }
      await promoApi.setOptIn(on);
      await reloadMe();
      if (on) Alert.alert("You're in", `${store} will let you know about promos and events. Turn this off any time here.`);
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof ApiError ? e.message : "Check your connection and try again.");
    } finally {
      setPending(null);
    }
  };

  return { isAvailable, isOn: pending ?? me.promoPush?.optedIn === true, isBusy: pending !== null, set };
}

/** A settings row with a switch, styled like the Me screen's ListRow. Renders nothing when unavailable. */
export function PromoOptInRow({ last = false }: { last?: boolean }) {
  const promo = usePromoOptIn();
  const { me } = useSignedIn();
  if (!promo.isAvailable) return null;
  const label = "Promos & events";
  const detail = `Sales, drops and events from ${me.store.name}`;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, backgroundColor: CHAT.surface }}>
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: "#D9467A", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="megaphone" size={16} color="#fff" />
      </View>
      <View
        style={{
          flex: 1,
          minHeight: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingRight: 14,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: CHAT.hairline,
        }}
      >
        <View style={{ flex: 1 }}>
          <ChatText color={CHAT.ink}>{label}</ChatText>
          <ChatText variant="footnote">{detail}</ChatText>
        </View>
        <Switch
          value={promo.isOn}
          disabled={promo.isBusy}
          onValueChange={(v) => void promo.set(v)}
          accessibilityLabel={`${label}: ${detail}`}
          accessibilityHint={promo.isOn ? "Stops promo notifications" : "Sends you a notification when there's a promo or event"}
        />
      </View>
    </View>
  );
}
