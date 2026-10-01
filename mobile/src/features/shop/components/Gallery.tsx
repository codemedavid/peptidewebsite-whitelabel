import { useCallback, useState } from "react";
import { FlatList, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { ProductImage } from "./ShopUI";

/**
 * Swipeable product photos with page dots. Re-keyed by the first image by the
 * caller, so choosing a variation with its own photo shows that photo first.
 */
export function Gallery({ images, width, name }: { images: string[]; width: number; name: string }) {
  const t = useTheme();
  const [index, setIndex] = useState(0);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex((prev) => (prev === i ? prev : i));
    },
    [width],
  );

  if (images.length === 0) {
    return <ProductImage uri={null} width={width} style={{ width, height: width }} label={`${name}, no photo`} />;
  }

  return (
    <View>
      <FlatList
        data={images}
        keyExtractor={(src, i) => `${i}:${src}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index: i }) => (
          <ProductImage
            uri={item}
            width={width}
            style={{ width, height: width }}
            label={`${name}, photo ${i + 1} of ${images.length}`}
          />
        )}
      />
      {images.length > 1 ? (
        <View style={styles.dots} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          {images.map((src, i) => (
            <View
              key={`${i}:${src}`}
              style={[
                styles.dot,
                { backgroundColor: i === index ? t.brand.primary : t.colors.border, width: i === index ? 18 : 7 },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: SPACE.md },
  dot: { height: 7, borderRadius: 4 },
});
