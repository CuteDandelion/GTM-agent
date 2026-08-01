import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { GtmConversationScreen } from "./GtmConversationScreen";

describe("GtmConversationScreen", () => {
  it("renders the canonical research-progress conversation by default", async () => {
    const screen = await render(<GtmConversationScreen />);

    screen.getByText("Analyze acme.ai");
    screen.getByText("Researching Acme");
    screen.getByText("ICP and opportunity analysis");
    screen.getByText("Terra · Running");
  });

  it("renders the company assessment from the shared fixture", async () => {
    const screen = await render(<GtmConversationScreen initialState="assessment" />);

    screen.getByText("Here’s what I found about Acme.");
    screen.getByText("82");
    screen.getByText("Support Triage Agent");
    screen.getByText(/Modern stack & AI native/);
    screen.getByText(/Pricing not transparent/);
  });

  it("opens and closes the evidence drawer from the conversation", async () => {
    const screen = await render(<GtmConversationScreen initialState="assessment" />);

    await fireEvent.press(screen.getByRole("button", { name: "Evidence" }));
    screen.getByText("Key sources and facts supporting this analysis.");
    screen.getByText("Acme – Homepage");
    screen.getByText("Acme – Pricing");
    screen.getByText("Acme – Blog: Roadmap Update");

    await fireEvent.press(screen.getByRole("button", { name: "Close evidence" }));
    expect(screen.queryByText("Key sources and facts supporting this analysis.")).toBeNull();
  });

  it("submits a typed company domain through the conversational composer", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({
      runId: "run-1",
      status: "queued",
      interactiveObject: { id: "progress-run-1", type: "workflow_progress", version: 1, title: "Researching example.com", status: "running", steps: [] },
    }), { status: 202 }));
    const screen = await render(<GtmConversationScreen
      apiBaseUrl="https://api.example.com"
      conversationId="11111111-1111-4111-8111-111111111111"
      fetcher={fetcher as typeof fetch}
    />);

    await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), "Analyze example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    await waitFor(() => screen.getByText("Analyze example.com"));
  });
});
