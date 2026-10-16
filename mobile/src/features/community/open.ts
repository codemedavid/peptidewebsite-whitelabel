import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";

/** Open an http(s) link or shared document in the in-app browser (it previews PDFs and Office files). */
export async function openLink(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Alert.alert("Couldn't open that", "Check your connection and try again.");
  }
}

/** Play a shared video full screen (the in-app browser's native player). */
export async function openVideo(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    Alert.alert("Can't play this video here", "It plays once it's uploaded to the store's media.");
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Alert.alert("Couldn't play that", "Check your connection and try again.");
  }
}
