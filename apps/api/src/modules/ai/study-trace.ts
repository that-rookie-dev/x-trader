/** Progress events emitted while STUDY runs (SSE to the desk). */
export type StudyTrace =
  | { kind: "phase"; label: string; detail?: string }
  | {
      kind: "prompt";
      system: string;
      prompt: string;
      model?: string | null;
      provider?: string | null;
    }
  | { kind: "llm"; delta: string }
  | { kind: "raw"; text: string }
  | { kind: "parsed"; ok: boolean; detail?: string };

export type StudyTraceHandler = (event: StudyTrace) => void;
