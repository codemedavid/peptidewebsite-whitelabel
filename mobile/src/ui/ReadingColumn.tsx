import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { READING_MAX_WIDTH, isReadingRoute } from "./responsive";

/**
 * A single-column screen on a wide display: centred, no wider than
 * READING_MAX_WIDTH. On a phone the column is simply the full width.
 */
export function ReadingColumn({ children }: { children: ReactNode }) {
  return (
    <View style={styles.outer}>
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

/**
 * Navigator `screenLayout`: wraps Chats, Orders, Me and the screens they open
 * (isReadingRoute) in a ReadingColumn; grids, charts and media stay full width.
 */
export function readingScreenLayout({ route, children }: { route: { name: string }; children: ReactElement }): ReactElement {
  return isReadingRoute(route.name) ? <ReadingColumn>{children}</ReadingColumn> : children;
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: "center" },
  inner: { flex: 1, width: "100%", maxWidth: READING_MAX_WIDTH },
});
