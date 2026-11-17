import { useState } from "react";
import { Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { callAction } from "@/features/admin/account/data";
import { setupKeys, success } from "@/features/admin/setup/data";
import { ToggleRow } from "@/features/admin/setup/ui";
import { useOnline } from "@/ui/feedback";
import { Card } from "@/ui/primitives";

/**
 * Customers → "Members-only store" — the website's AdminMemberSignIn. On: every
 * visitor signs in or creates an account before the store renders. Saves the
 * moment it is flipped (a half-saved privacy setting is worse than none), via
 * the website's getAccountGateAction / setAccountGateAction. Hidden when the
 * read fails (no customer-accounts feature, or no "customers" grant), exactly
 * like the website.
 */

type Gate = { ok: true; enabled: boolean };

export function MembersOnlyCard() {
  const { scope } = useSignedIn();
  const online = useOnline();
  const qc = useQueryClient();
  const key = [...setupKeys.all(scope), "account-gate"];
  const gate = useQuery({ queryKey: key, queryFn: () => callAction<Gate>("getAccountGateAction"), retry: false });
  const [saving, setSaving] = useState(false);

  if (!gate.data) return null;
  const enabled = gate.data.enabled;

  async function flip(next: boolean) {
    setSaving(true);
    try {
      const res = await callAction<Gate>("setAccountGateAction", { enabled: next });
      qc.setQueryData<Gate>(key, res);
      success();
      Alert.alert(
        res.enabled ? "Members-only is ON" : "Members-only is OFF",
        res.enabled ? "Visitors sign in or create an account first." : "Your shop is open to everyone.",
      );
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Please sign in again and retry.");
    } finally {
      setSaving(false);
    }
  }

  const onChange = (next: boolean) => {
    if (!next) return void flip(false);
    Alert.alert(
      "Make the store members-only?",
      "Every visitor will need to sign in or create an account before they can see your shop.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Turn on", onPress: () => void flip(true) },
      ],
    );
  };

  return (
    <Card>
      <ToggleRow
        label="Members-only store"
        hint={
          enabled
            ? "On: visitors must sign in or create an account before they see your shop. New sign-ups appear in this list."
            : "Off: anyone with your link can browse. Turn on to make visitors sign in or create an account first."
        }
        value={enabled}
        disabled={saving || !online}
        onChange={onChange}
      />
    </Card>
  );
}
