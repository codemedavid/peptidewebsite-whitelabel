import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OrderStatus } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { Chips } from "@/ui/kit";
import { AppText, Button } from "@/ui/primitives";
import { STATUS_META, STATUS_ORDER } from "./status";

/**
 * The web Orders screen's bulk bar for select mode: Select all, change the
 * selection's status, move it to the trash, or move EVERY order in this list
 * to the trash. The screen owns the confirmations and the writes.
 */
type Props = {
  selected: number;
  allSelected: boolean;
  isSelectingAll: boolean;
  isWorking: boolean;
  onToggleAll: () => void;
  onChangeStatus: (status: OrderStatus) => void;
  onTrashSelected: () => void;
  onTrashAll: () => void;
};

const STATUS_CHOICES = STATUS_ORDER.map((s) => ({ key: s, label: STATUS_META[s].label }));

export function SelectBar({
  selected,
  allSelected,
  isSelectingAll,
  isWorking,
  onToggleAll,
  onChangeStatus,
  onTrashSelected,
  onTrashAll,
}: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [target, setTarget] = useState<OrderStatus>("confirmed");
  const none = selected === 0;

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, SPACE.md), backgroundColor: t.colors.surface, borderTopColor: t.colors.border },
      ]}
    >
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={{ flex: 1 }} accessibilityRole="text">
          {`${selected.toLocaleString()} selected`}
        </AppText>
        <Button
          label={allSelected ? "Clear selection" : "Select all"}
          variant="ghost"
          icon={allSelected ? "close-circle-outline" : "checkmark-done-outline"}
          loading={isSelectingAll}
          disabled={isWorking}
          accessibilityHint={allSelected ? undefined : "Selects every order in this list, including ones not loaded yet"}
          onPress={onToggleAll}
        />
      </View>
      <Chips options={STATUS_CHOICES} value={target} onChange={setTarget} label="Status to change the selected orders to" />
      <View style={styles.row}>
        <Button
          label={`Change to ${STATUS_META[target].label}`}
          icon="swap-vertical"
          disabled={none || isSelectingAll}
          loading={isWorking}
          onPress={() => onChangeStatus(target)}
          style={{ flex: 1 }}
        />
        <Button
          label="Trash"
          icon="trash-outline"
          variant="secondary"
          disabled={none || isWorking || isSelectingAll}
          accessibilityHint="Moves the selected orders to the trash"
          onPress={onTrashSelected}
        />
      </View>
      <Button
        label="Move ALL to trash"
        variant="ghost"
        icon="trash-bin-outline"
        disabled={isWorking || isSelectingAll}
        accessibilityHint="Moves every order in this list to the trash. You can restore them from Trash"
        onPress={onTrashAll}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, gap: SPACE.sm, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
