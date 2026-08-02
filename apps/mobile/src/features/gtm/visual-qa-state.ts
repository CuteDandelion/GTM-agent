export type VisualQaState = "empty" | "progress" | "assessment" | "evidence";

export function resolveVisualQaState(
  requestedState: string | undefined,
  nodeEnv: string | undefined,
): VisualQaState | undefined {
  if (nodeEnv === "production") return undefined;
  return requestedState === "empty" || requestedState === "progress" || requestedState === "assessment" || requestedState === "evidence"
    ? requestedState
    : undefined;
}
