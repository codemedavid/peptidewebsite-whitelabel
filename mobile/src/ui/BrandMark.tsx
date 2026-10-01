import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./primitives";

/**
 * The store's mark: its logo when it has one, otherwise a monogram in the
 * brand colour. A logo that fails to load falls back to the monogram too.
 */
export function BrandMark({ size = 36 }: { size?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const initials = t.brand.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  if (t.brand.logoUrl && !failed) {
    return (
      <Image
        source={{ uri: t.brand.logoUrl }}
        accessibilityLabel={`${t.brand.name} logo`}
        contentFit="contain"
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: size * 0.22 }}
      />
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={t.brand.name}
      style={[styles.mono, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: t.brand.primary }]}
    >
      <AppText variant="label" color="onPrimary" brandFont style={{ fontSize: size * 0.4, lineHeight: size * 0.5 }}>
        {initials || "·"}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { alignItems: "center", justifyContent: "center" },
});
