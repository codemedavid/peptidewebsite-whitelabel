/**
 * Two sheet shapes:
 *  - BottomSheet  — an in-screen sheet over a scrim (skip reasons, pickers,
 *                   "from my orders"). Slides up; fades under Reduce motion.
 *  - SheetScreen  — the frame for a route presented as a modal / formSheet
 *                   (log, protocol setup, onboarding): title, close, an
 *                   optional progress bar, a keyboard-aware body and a pinned footer.
 *
 * iOS drops a navigation or modal started while a Modal is still animating
 * away, so BottomSheet calls `onDismissed` once it is really gone — run any
 * follow-up navigation there.
 */
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton, TText } from "./kit";
import { ProgressBar } from "./ProgressRing";
import { TRADIUS, TSPACE, useTrackerTheme } from "./theme";
import { READING_MAX_WIDTH } from "@/ui/responsive";

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** After the close animation (iOS: Modal onDismiss). Navigate from here. */
  onDismissed?: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the body (the confirm button). */
  footer?: ReactNode;
};

export function BottomSheet({ visible, onClose, onDismissed, title, subtitle, children, footer }: BottomSheetProps) {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType={reduced ? "fade" : "slide"}
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={[styles.fill, { backgroundColor: th.scrim }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: th.bg, paddingBottom: Math.max(insets.bottom, TSPACE.lg) }]}>
          <View style={[styles.grabber, { backgroundColor: th.line }]} />
          <View style={styles.sheetHead}>
            <View style={styles.fill}>
              <TText variant="title" accessibilityRole="header">
                {title}
              </TText>
              {subtitle ? (
                <TText variant="meta" color="soft">
                  {subtitle}
                </TText>
              ) : null}
            </View>
            <IconButton icon="close" label="Close" tone="alt" onPress={onClose} />
          </View>
          <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetBodyContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Android fires no onDismiss: callers on Android can run follow-ups right after onClose.
export const SHEET_DISMISS_IS_ASYNC = Platform.OS === "ios";

type SheetScreenProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeLabel?: string;
  /** "close" (✕, top-right) for modals; "back" (‹, top-left) inside a wizard step. */
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 0–1: a progress bar under the header (wizards). */
  progress?: number;
  /** Full-screen modals need the top inset; formSheets don't. */
  isFullScreen?: boolean;
  right?: ReactNode;
};

export function SheetScreen({ title, subtitle, onClose, closeLabel = "Close", onBack, children, footer, progress, isFullScreen, right }: SheetScreenProps) {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { backgroundColor: th.bg, paddingTop: isFullScreen ? insets.top : 0 }]}>
      {!isFullScreen ? <View style={[styles.grabber, { backgroundColor: th.line }]} /> : null}
      <View style={styles.screenHead}>
        {onBack ? <IconButton icon="chevron-back" label="Back" tone="alt" onPress={onBack} /> : null}
        <View style={styles.fill}>
          <TText variant="title" accessibilityRole="header" numberOfLines={2}>
            {title}
          </TText>
          {subtitle ? (
            <TText variant="meta" color="soft">
              {subtitle}
            </TText>
          ) : null}
        </View>
        {right}
        <IconButton icon="close" label={closeLabel} tone="alt" onPress={onClose} />
      </View>
      {progress !== undefined ? (
        <View style={styles.progress}>
          <ProgressBar progress={progress} label={`${Math.round(progress * 100)} percent done`} />
        </View>
      ) : null}
      <KeyboardAwareScrollView contentContainerStyle={styles.screenBody} keyboardShouldPersistTaps="handled" bottomOffset={TSPACE.xl} showsVerticalScrollIndicator={false}>
        {children}
      </KeyboardAwareScrollView>
      {footer ? (
        <View style={[styles.screenFooter, { paddingBottom: Math.max(insets.bottom, TSPACE.md), borderTopColor: th.line, backgroundColor: th.bg }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { maxHeight: "88%", borderTopLeftRadius: TRADIUS.xl, borderTopRightRadius: TRADIUS.xl, paddingTop: TSPACE.sm, width: "100%", maxWidth: READING_MAX_WIDTH, alignSelf: "center" },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginTop: TSPACE.sm },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: TSPACE.md, paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.md, paddingBottom: TSPACE.sm },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { paddingHorizontal: TSPACE.gutter, paddingBottom: TSPACE.md, gap: TSPACE.lg },
  sheetFooter: { paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.sm, gap: TSPACE.sm },
  screenHead: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.md, paddingBottom: TSPACE.sm, width: "100%", maxWidth: READING_MAX_WIDTH, alignSelf: "center" },
  progress: { paddingHorizontal: TSPACE.gutter, paddingBottom: TSPACE.sm, width: "100%", maxWidth: READING_MAX_WIDTH, alignSelf: "center" },
  screenBody: { paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.sm, paddingBottom: TSPACE.xxl, gap: TSPACE.xl, width: "100%", maxWidth: READING_MAX_WIDTH, alignSelf: "center" },
  screenFooter: { paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.md, borderTopWidth: StyleSheet.hairlineWidth, gap: TSPACE.sm, width: "100%", maxWidth: READING_MAX_WIDTH, alignSelf: "center" },
});
