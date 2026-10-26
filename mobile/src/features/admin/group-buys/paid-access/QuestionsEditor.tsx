import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { ChoicePills, Hint, ToggleRow, type Choice } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { Button } from "@/ui/primitives";
import type { PaidAccessQuestion, PaidAccessQuestionKind } from "./model";

/** The application form's questions (settings.form.questions). Limits mirror core/settings.ts. */

const MAX_QUESTIONS = 20;
const KINDS: readonly Choice<PaidAccessQuestionKind>[] = [
  { key: "short", label: "Short answer" },
  { key: "long", label: "Paragraph" },
  { key: "choice", label: "Pick one" },
];

const newQuestion = (n: number): PaidAccessQuestion => ({ id: `q${Date.now().toString(36)}${n}`, label: "", kind: "short", required: true, options: [] });

type Props = {
  questions: PaidAccessQuestion[];
  onChange: (next: PaidAccessQuestion[]) => void;
  errorFor: (path: string) => string | null;
};

export function QuestionsEditor({ questions, onChange, errorFor }: Props) {
  const update = (i: number, patch: Partial<PaidAccessQuestion>) => onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const listError = errorFor("form.questions");
  return (
    <View style={{ gap: SPACE.md }}>
      {questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          index={i}
          question={q}
          error={errorFor(`form.questions.${i}`)}
          onChange={(patch) => update(i, patch)}
          onRemove={() => onChange(questions.filter((_, j) => j !== i))}
        />
      ))}
      {listError && !questions.length ? <Hint tone="danger">{listError}</Hint> : null}
      {questions.length < MAX_QUESTIONS ? (
        <Button label="Add a question" icon="add" variant="secondary" onPress={() => onChange([...questions, newQuestion(questions.length)])} />
      ) : (
        <Hint>The form can have at most {MAX_QUESTIONS} questions.</Hint>
      )}
    </View>
  );
}

type CardProps = {
  index: number;
  question: PaidAccessQuestion;
  error: string | null;
  onChange: (patch: Partial<PaidAccessQuestion>) => void;
  onRemove: () => void;
};

function QuestionCard({ index, question, error, onChange, onRemove }: CardProps) {
  const t = useTheme();
  // Typed text is kept as-is so a new line isn't swallowed mid-typing.
  const [optionsText, setOptionsText] = useState(question.options.join("\n"));
  return (
    <View style={[styles.card, { borderColor: error ? t.tone("danger").fg : t.colors.border, backgroundColor: t.colors.bg }]}>
      <Field
        label={`Question ${index + 1}`}
        value={question.label}
        onChangeText={(label) => onChange({ label })}
        placeholder="e.g. Have you ordered from us before?"
        maxLength={200}
        multiline
      />
      <ChoicePills label="Answer type" options={KINDS} value={question.kind} onChange={(kind) => onChange({ kind })} />
      {question.kind === "choice" ? (
        <Field
          label="Options (one per line)"
          value={optionsText}
          onChangeText={(text) => {
            setOptionsText(text);
            onChange({ options: text.split("\n").map((o) => o.trim()).filter(Boolean) });
          }}
          placeholder={"Yes\nNo"}
          multiline
        />
      ) : null}
      <ToggleRow label="Required" value={question.required} onChange={(required) => onChange({ required })} />
      {error ? <Hint tone="danger">{error}</Hint> : null}
      <Button label="Remove question" icon="trash-outline" variant="ghost" onPress={onRemove} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, borderWidth: 1 },
});
