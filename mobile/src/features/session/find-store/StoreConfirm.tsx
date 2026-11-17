import { StyleSheet, View } from "react-native";
import type { StorePreview } from "@contract";
import { withAlpha } from "@/features/community/lib/color";
import {
  Banner,
  PrimaryCta,
  SecondaryCta,
  StoreLogo,
  TextLink,
  type AuthAccent,
} from "@/features/session/sign-in/parts";
import { SheetHeading } from "@/features/session/sign-in/StoreSteps";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { storeDoor, type FindStoreNext } from "./rules";

const LOGO_SIZE = 64;

interface StoreConfirmProps {
  store: StorePreview;
  accent: AuthAccent;
  /** The screen the shopper was heading to — that door is the primary one. */
  next: FindStoreNext | null;
  /** A follow-up is running (linking, opening the website). */
  busy: boolean;
  onCreateAccount: () => void;
  onSignIn: () => void;
  /** Shop now, account later — shown only when the store allows guests. */
  onGuest: () => void;
  onOpenWebsite: () => void;
  onRetry: () => void;
}

/**
 * "Is this your store?" — the store the code found, and the ways in.
 * A store that hasn't opened its app to shoppers says so plainly and points at
 * its website; its team can still sign in.
 */
export function StoreConfirm({
  store,
  accent,
  next,
  busy,
  onCreateAccount,
  onSignIn,
  onGuest,
  onOpenWebsite,
  onRetry,
}: StoreConfirmProps) {
  const t = useTheme();
  const open = storeDoor(store) === "shopper";

  return (
    <View style={{ gap: SPACE.xl }}>
      <SheetHeading
        lead="Is this your "
        emphasis="store?"
        body={open ? "Check the name and logo, then choose how to continue." : "We found it, but there's a catch."}
        accent={accent}
      />

      <View
        accessible
        accessibilityLabel={`${store.name}, ${store.address}`}
        style={[
          styles.card,
          {
            backgroundColor: t.colors.surface,
            borderColor: accent.link,
            boxShadow: `0 10px 28px -16px ${withAlpha(t.colors.text, 0.4)}`,
          },
        ]}
      >
        <StoreLogo choice={store} size={LOGO_SIZE} />
        <View style={styles.cardText}>
          <AppText variant="heading" brandFont numberOfLines={2}>
            {store.name}
          </AppText>
          <AppText variant="caption" color="muted" numberOfLines={1}>
            {store.address}
          </AppText>
        </View>
      </View>

      {open ? (
        <View style={{ gap: SPACE.md }}>
          {next === "sign-in" ? (
            <>
              <PrimaryCta label="Sign in" icon="log-in-outline" accent={accent} loading={busy} onPress={onSignIn} />
              <SecondaryCta label="Create an account" icon="person-add-outline" onPress={onCreateAccount} />
            </>
          ) : (
            <>
              <PrimaryCta label="Create an account" accent={accent} loading={busy} onPress={onCreateAccount} />
              <SecondaryCta label="I already have an account" icon="log-in-outline" onPress={onSignIn} />
            </>
          )}
          {store.guestShopping ? (
            <TextLink
              label="Continue as guest (sign up later)"
              color={accent.link}
              onPress={onGuest}
              disabled={busy}
              style={styles.center}
            />
          ) : null}
        </View>
      ) : (
        <View style={{ gap: SPACE.md }}>
          <Banner
            tone="info"
            icon="time-outline"
            text={`${store.name} hasn't opened its app to shoppers yet. You can still shop on their website.`}
          />
          <PrimaryCta
            label="Shop on the website"
            icon="open-outline"
            accent={accent}
            loading={busy}
            onPress={onOpenWebsite}
          />
          <TextLink
            label={`On the ${store.name} team? Sign in`}
            color={accent.link}
            onPress={onSignIn}
            disabled={busy}
            style={styles.center}
          />
        </View>
      )}

      <TextLink
        label="Not your store? Try another code"
        color={t.colors.textMuted}
        onPress={onRetry}
        disabled={busy}
        style={styles.center}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.lg,
    padding: SPACE.lg,
    borderRadius: RADIUS.lg + 8,
    borderWidth: 1.5,
  },
  cardText: { flex: 1, gap: 2 },
  center: { alignSelf: "center" },
});
