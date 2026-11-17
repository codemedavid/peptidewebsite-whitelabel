// Alerts that also work in the web build (react-native-web's Alert.alert is a
// no-op there): ported from MamaMicaGlow components/tracker/dialog.ts.
import { Alert, Platform } from "react-native";

const WEB = Platform.OS === "web";

/** Tell the user something (an error, a heads-up). */
export function notify(title: string, message?: string): void {
  if (WEB) {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/** Ask before doing something; `onConfirm` runs only on yes. */
export function confirm(title: string, message: string, actionLabel: string, onConfirm: () => void, isDestructive = true): void {
  if (WEB) {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: actionLabel, style: isDestructive ? "destructive" : "default", onPress: onConfirm },
  ]);
}
