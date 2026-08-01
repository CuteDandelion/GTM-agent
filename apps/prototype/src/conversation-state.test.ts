import { describe, expect, it } from "vitest";

async function loadStateModule() {
  return import("./conversation-state.js").catch(() => ({}));
}

describe("canonical conversation state", () => {
  it("moves from live research to the completed company assessment", async () => {
    const stateModule = await loadStateModule();
    const createInitialConversationState = Reflect.get(stateModule, "createInitialConversationState");
    const reduceConversationState = Reflect.get(stateModule, "reduceConversationState");

    expect(typeof createInitialConversationState).toBe("function");
    expect(typeof reduceConversationState).toBe("function");

    const initialState = createInitialConversationState();
    const completedState = reduceConversationState(initialState, { type: "research_completed" });

    expect(initialState.screen).toBe("research_progress");
    expect(completedState.screen).toBe("company_assessment");
  });

  it("opens evidence and returns to the assessment without losing shortlist state", async () => {
    const stateModule = await loadStateModule();
    const createInitialConversationState = Reflect.get(stateModule, "createInitialConversationState");
    const reduceConversationState = Reflect.get(stateModule, "reduceConversationState");

    expect(typeof createInitialConversationState).toBe("function");
    expect(typeof reduceConversationState).toBe("function");

    const initialState = createInitialConversationState();
    const assessment = reduceConversationState(initialState, { type: "research_completed" });
    const shortlisted = reduceConversationState(assessment, { type: "shortlist_toggled" });
    const evidence = reduceConversationState(shortlisted, { type: "evidence_opened" });
    const returned = reduceConversationState(evidence, { type: "evidence_closed" });

    expect(evidence.screen).toBe("evidence_inspection");
    expect(returned).toEqual({ screen: "company_assessment", shortlisted: true });
  });
});
