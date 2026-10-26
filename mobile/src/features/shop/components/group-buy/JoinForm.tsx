import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { GroupBuyJoinQuestion } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { FormSection, Notice } from "../ShopUI";

/**
 * The round's application form (Paid Access form step). Answers are keyed by
 * question id; the server re-checks required answers, lengths and choices
 * (core/input.ts parseFormAnswers) — the checks here only save a round trip.
 */

const ANSWER_MAX = { short: 200, long: 2000, choice: 80 } as const;

type Props = {
  questions: GroupBuyJoinQuestion[];
  submitting: boolean;
  error: Error | null;
  onSubmit: (answers: Record<string, string>) => void;
};

export function JoinForm({ questions, submitting, error, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const set = (id: string, v: string) => setAnswers((prev) => ({ ...prev, [id]: v }));
  const missing = questions.filter((q) => q.required && !(answers[q.id] ?? "").trim());

  const submit = () => {
    const clean = Object.fromEntries(
      questions.map((q) => [q.id, (answers[q.id] ?? "").trim()] as const).filter(([, v]) => v.length > 0),
    );
    onSubmit(clean);
  };

  return (
    <FormSection title="Your application" hint="The store reads this before letting you in.">
      {questions.map((q) =>
        q.kind === "choice" ? (
          <ChoiceQuestion key={q.id} question={q} value={answers[q.id] ?? ""} onChange={(v) => set(q.id, v)} />
        ) : (
          <Field
            key={q.id}
            label={q.required ? q.label : `${q.label} (optional)`}
            value={answers[q.id] ?? ""}
            onChangeText={(v) => set(q.id, v)}
            multiline={q.kind === "long"}
            maxLength={ANSWER_MAX[q.kind]}
          />
        ),
      )}
      {error ? (
        <Notice tone="danger" icon="alert-circle-outline">
          {error.message || "Couldn't send your application."}
        </Notice>
      ) : null}
      <Button
        label="Send application"
        icon="send-outline"
        loading={submitting}
        disabled={missing.length > 0}
        accessibilityHint={missing.length ? "Answer every required question first" : undefined}
        onPress={submit}
      />
    </FormSection>
  );
}

function ChoiceQuestion({ question, value, onChange }: { question: GroupBuyJoinQuestion; value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  const label = question.required ? question.label : `${question.label} (optional)`;
  return (
    <View style={{ gap: SPACE.xs }}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {question.options.map((o) => {
          const on = o === value;
          return (
            <Pressable
              key={o}
              onPress={() => onChange(on && !question.required ? "" : o)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                styles.option,
                { borderColor: on ? t.brand.primary : t.colors.border, backgroundColor: on ? t.brand.primary : t.colors.surface, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <AppText variant="label" color={on ? "onPrimary" : "text"}>
                {o}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  option: { minHeight: TOUCH, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: "center", justifyContent: "center", maxWidth: "100%" },
});
