/**
 * "Skip with a reason" (ported from MamaMicaGlow SkipSheet). A skip neither
 * helps nor hurts consistency. Open while `title` is set.
 */
import { useState } from "react";
import { INPUT_CAPS } from "../lib/caps";
import { SKIP_REASON_LABEL, SKIP_REASONS, type SkipReason } from "../lib/types";
import { TextField } from "./fields";
import { Chip, ChipRow, PressButton, TText } from "./kit";
import { BottomSheet } from "./sheets";

type Props = {
  /** What's being skipped ("BPC-157"); null = closed. */
  title: string | null;
  onClose: () => void;
  onSkip: (reason: SkipReason, note: string | null) => void;
  onDismissed?: () => void;
};

export function SkipSheet({ title, onClose, onSkip, onDismissed }: Props) {
  const [reason, setReason] = useState<SkipReason>("rest");
  const [note, setNote] = useState("");

  return (
    <BottomSheet
      visible={!!title}
      onClose={onClose}
      onDismissed={onDismissed}
      title={`Skip ${title ?? "dose"}`}
      footer={
        <PressButton
          label="Skip this dose"
          tone="secondary"
          icon="play-skip-forward-outline"
          onPress={() => {
            onSkip(reason, note.trim() || null);
            setNote("");
            setReason("rest");
          }}
        />
      }
    >
      <TText variant="meta" color="soft">
        Skips don’t count for or against your consistency.
      </TText>
      <ChipRow label="Reason">
        {SKIP_REASONS.map((r) => (
          <Chip key={r} label={SKIP_REASON_LABEL[r]} isSelected={reason === r} onPress={() => setReason(r)} />
        ))}
      </ChipRow>
      <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="Anything to remember…" maxLength={INPUT_CAPS.note} />
    </BottomSheet>
  );
}
