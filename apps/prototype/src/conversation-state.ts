export type ConversationScreen =
  | "research_progress"
  | "company_assessment"
  | "evidence_inspection";

export type ConversationState = {
  screen: ConversationScreen;
  shortlisted: boolean;
};

export type ConversationAction =
  | { type: "research_completed" }
  | { type: "evidence_opened" }
  | { type: "evidence_closed" }
  | { type: "shortlist_toggled" }
  | { type: "research_restarted" };

export function createInitialConversationState(): ConversationState {
  return { screen: "research_progress", shortlisted: false };
}

export function reduceConversationState(
  state: ConversationState,
  action: ConversationAction
): ConversationState {
  switch (action.type) {
    case "research_completed":
      return { ...state, screen: "company_assessment" };
    case "evidence_opened":
      return { ...state, screen: "evidence_inspection" };
    case "evidence_closed":
      return { ...state, screen: "company_assessment" };
    case "shortlist_toggled":
      return { ...state, shortlisted: !state.shortlisted };
    case "research_restarted":
      return { screen: "research_progress", shortlisted: false };
  }
}
