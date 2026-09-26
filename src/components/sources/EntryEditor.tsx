"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Flashcard, QuizQuestion } from "@/lib/types";
import type { FlaggableEntry, FlaggableMode } from "@/lib/sources/flags";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Edits one card or quiz question by hand. For choice questions, ticking
// more than one correct option makes it a "select all that apply".
export function EntryEditor({
  mode,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  mode: FlaggableMode;
  initial: FlaggableEntry;
  busy?: boolean;
  onSave: (entry: FlaggableEntry) => void;
  onCancel: () => void;
}) {
  if (mode === "flashcards") {
    return <CardEditor initial={initial as Flashcard} busy={busy} onSave={onSave} onCancel={onCancel} />;
  }
  return <QuestionEditor initial={initial as QuizQuestion} busy={busy} onSave={onSave} onCancel={onCancel} />;
}

function Actions({ busy, disabled, onSave, onCancel }: { busy?: boolean; disabled: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" disabled={busy || disabled} onClick={onSave}>
        Save
      </Button>
    </div>
  );
}

function CardEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Flashcard;
  busy?: boolean;
  onSave: (entry: Flashcard) => void;
  onCancel: () => void;
}) {
  const [front, setFront] = useState(initial.front);
  const [back, setBack] = useState(initial.back);
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label>Front</Label>
        <Textarea rows={2} value={front} onChange={(e) => setFront(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Back</Label>
        <Textarea rows={3} value={back} onChange={(e) => setBack(e.target.value)} />
      </div>
      <Actions
        busy={busy}
        disabled={!front.trim() || !back.trim()}
        onSave={() => onSave({ ...initial, front, back })}
        onCancel={onCancel}
      />
    </div>
  );
}

function QuestionEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: QuizQuestion;
  busy?: boolean;
  onSave: (entry: QuizQuestion) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(initial.question);
  const [explanation, setExplanation] = useState(initial.explanation);
  const [modelAnswer, setModelAnswer] = useState(initial.type === "short_answer" ? initial.modelAnswer : "");
  const [options, setOptions] = useState(initial.type === "short_answer" ? [] : initial.options);
  const [correct, setCorrect] = useState<number[]>(
    initial.type === "mcq" ? [initial.correctIndex] : initial.type === "multi_select" ? initial.correctIndices : []
  );
  const isChoice = initial.type !== "short_answer";

  function build(): QuizQuestion {
    const base = { question, explanation, ...(initial.concept && { concept: initial.concept }) };
    if (!isChoice) return { ...base, type: "short_answer", modelAnswer };
    return correct.length === 1
      ? { ...base, type: "mcq", options, correctIndex: correct[0] }
      : { ...base, type: "multi_select", options, correctIndices: [...correct].sort((a, b) => a - b) };
  }

  const valid =
    question.trim() &&
    (isChoice ? options.length >= 2 && options.every((o) => o.trim()) && correct.length >= 1 : modelAnswer.trim());

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label>Question</Label>
        <Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
      </div>
      {isChoice ? (
        <div className="space-y-1.5">
          <Label>Options — tick the correct ones</Label>
          {options.map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              <Checkbox
                aria-label={`Option ${i + 1} is correct`}
                checked={correct.includes(i)}
                onCheckedChange={() => setCorrect((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}
              />
              <Input value={option} onChange={(e) => setOptions((o) => o.map((x, j) => (j === i ? e.target.value : x)))} />
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove option ${i + 1}`}
                disabled={options.length <= 2}
                onClick={() => {
                  setOptions((o) => o.filter((_, j) => j !== i));
                  setCorrect((c) => c.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
                }}
              >
                <X />
              </Button>
            </div>
          ))}
          {options.length < 6 && (
            <Button size="xs" variant="ghost" onClick={() => setOptions((o) => [...o, ""])}>
              <Plus className="size-3.5" />
              Add option
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <Label>Model answer</Label>
          <Textarea rows={3} value={modelAnswer} onChange={(e) => setModelAnswer(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label>Explanation</Label>
        <Textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </div>
      <Actions busy={busy} disabled={!valid} onSave={() => onSave(build())} onCancel={onCancel} />
    </div>
  );
}
