import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { GtmConversationScreen } from "./GtmConversationScreen";

describe("GtmConversationScreen", () => {
  it("opens a new conversation empty instead of rendering demo content", async () => {
    const screen = await render(<GtmConversationScreen initialState="empty" />);

    screen.getByText("Start a new GTM conversation");
    screen.getByText("Ask me to analyze a company domain, compare startups, or explore an opportunity.");
    expect(screen.queryByText("Analyze acme.ai")).toBeNull();
    expect(screen.queryByText("Here’s what I found about Acme.")).toBeNull();
    expect(screen.queryByText("Support Triage Agent")).toBeNull();
  });

  it("renders the agent's actual domain-free answer without inventing a research acknowledgement", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({
      kind: "answer",
      message: "Start with your strongest proof point, then we can define a target ICP.",
      usedTools: [],
      interactiveObjects: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const screen = await render(<GtmConversationScreen
      initialState="empty"
      apiBaseUrl="https://api.example.com"
      accessToken="access-token"
      fetcher={fetcher as typeof fetch}
    />);

    await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), "How should I begin?");
    await fireEvent.press(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => screen.getByText("Start with your strongest proof point, then we can define a target ICP."));
    screen.getByLabelText("Agent response");
    expect(screen.queryByText(/On it\. I’ll research/)).toBeNull();
    expect(screen.queryByLabelText("Waiting for agent response")).toBeNull();
  });

  it("collects and persists the seller profile through a conversation", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      ...JSON.parse(String(init?.body)),
      updatedAt: "2026-08-02T09:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const screen = await render(<GtmConversationScreen
      initialState="onboarding"
      apiBaseUrl="https://api.example.com"
      accessToken="supabase-access-token"
      fetcher={fetcher as typeof fetch}
    />);

    const reply = async (text: string) => {
      await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), text);
      await fireEvent.press(screen.getByRole("button", { name: "Send message" }));
    };

    screen.getByText("Before we research companies, what should I call your business?");
    await reply("Dandelion AI");
    screen.getByText("What AI or agent automation work do you sell?");
    await reply("AI and agent automation for operational teams");
    screen.getByText("List your strongest capabilities, separated by commas.");
    await reply("Agent orchestration, Workflow automation");
    screen.getByText("What proof points should I use when positioning you?");
    await reply("Production agent deployments");

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.example.com/api/v1/seller-profile");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
      businessName: "Dandelion AI",
      offerSummary: "AI and agent automation for operational teams",
      capabilities: ["Agent orchestration", "Workflow automation"],
      proofPoints: ["Production agent deployments"],
      constraints: { externalWritesRequireApproval: true },
    });
    await waitFor(() => screen.getByText("Your seller profile is saved. Which company should we analyze first?"));
  });

  it("renders the canonical research-progress visual QA state explicitly", async () => {
    const screen = await render(<GtmConversationScreen initialState="progress" />);

    screen.getByText("Analyze acme.ai");
    screen.getByText("On it. I’ll research Acme and surface high-leverage GTM opportunities.");
    screen.getByText("Researching Acme");
    screen.getByText("Research");
    screen.getByText("· Luna");
    screen.getByText("In progress");
    screen.getByLabelText("Research phase in progress");
    expect(screen.queryByLabelText("Waiting for agent response")).toBeNull();
  });

  it("renders the company assessment from the shared fixture", async () => {
    const screen = await render(<GtmConversationScreen initialState="assessment" />);

    screen.getByText("Here’s what I found about Acme.");
    screen.getByText("82");
    screen.getByText("Support Triage Agent");
    screen.getByText(/Modern stack & AI native/);
    screen.getByText(/Pricing not transparent/);
  });

  it("renders every live interactive-object schema from conversation state", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const common = { conversationId, version: 1 } as const;
    const screen = await render(<GtmConversationScreen initialState="assessment" interactiveObjects={[
      { ...common, id: "progress-1", type: "workflow_progress", title: "Researching Nova", live: false, steps: [{ id: "done", label: "Critical review", agent: "Sol", status: "completed" }] },
      { ...common, id: "profile-1", type: "company_profile", company: "Nova", domain: "nova.example", summary: "Automation platform for finance teams", facts: [{ label: "Model", value: "B2B SaaS" }], pros: ["Fast-growing team"], cons: ["Sparse integrations"] },
      { ...common, id: "icp-1", type: "icp_score", company: "Nova", score: 91, band: "high", reasons: ["Clear workflow pain"], gaps: ["Budget unknown"] },
      { ...common, id: "opportunity-1", type: "opportunity", company: "Nova", title: "Invoice Exception Agent", summary: "Resolve invoice exceptions with human approval.", impact: "high", value: "high", effort: "medium", fit: "high", status: "research" },
      { ...common, id: "evidence-1", type: "evidence_collection", title: "Nova evidence", subtitle: "Current sources", items: [{ id: "source-1", title: "Nova homepage", url: "https://nova.example", excerpt: "Finance automation for scaling teams.", classification: "fact", confidence: 4 }] },
      { ...common, id: "comparison-1", type: "company_comparison", title: "Target priority", entries: [{ company: "Nova", domain: "nova.example", rank: 1, score: 91, status: "pursue", rationale: "Best evidence-backed fit" }] },
    ]} />);

    screen.getByText("Researching Nova");
    screen.getByLabelText("Workflow progress");
    screen.getByText("Automation platform for finance teams");
    expect(screen.getAllByText("91")).toHaveLength(2);
    screen.getByText("Invoice Exception Agent");
    screen.getByText("Target priority");
    screen.getByText("Best evidence-backed fit");
    await fireEvent.press(screen.getByRole("button", { name: "Evidence" }));
    screen.getByText("Nova evidence");
    screen.getByText("Nova homepage");
  });

  it("uses an agent-authored interaction prompt to clarify the next turn", async () => {
    const screen = await render(<GtmConversationScreen initialState="empty" interactiveObjects={[{
      id: "prompt-1",
      conversationId: "11111111-1111-4111-8111-111111111111",
      version: 1,
      type: "interaction_prompt",
      purpose: "clarification",
      title: "Choose a target scope",
      prompt: "What should I evaluate?",
      selection: "single",
      options: [{ id: "company", label: "A company" }, { id: "market", label: "A market" }],
      allowFreeText: true,
    }]} />);

    screen.getByText("What should I evaluate?");
    await fireEvent.press(screen.getByRole("button", { name: "A company" }));
    expect(screen.getByLabelText("Message GTM Research Agent").props.value).toBe("A company");
  });

  it("shows a safe development diagnostics panel with actionable warnings", async () => {
    const screen = await render(<GtmConversationScreen
      initialState="empty"
      conversationId="11111111-1111-4111-8111-111111111111"
      debugEnabled
    />);

    screen.getByLabelText("2 debug warnings");
    await fireEvent.press(screen.getByRole("button", { name: "Open debug panel" }));

    screen.getByText("Runtime diagnostics");
    screen.getByText("API not configured");
    screen.getByText("Signed out");
    screen.getByText("11111111-1111-4111-8111-111111111111");
    screen.getByText("API base URL is missing.");
    screen.getByText("No authenticated session is available.");
    expect(screen.queryByText(/access-token/i)).toBeNull();
  });

  it("updates debug diagnostics with the accepted run and queue position", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({
      kind: "research",
      runId: "run-live-1",
      status: "queued",
      queuePosition: 3,
      message: "I’ll research the selected scope.",
      usedTools: ["web_search"],
      interactiveObjects: [],
    }), { status: 202, headers: { "content-type": "application/json" } }));
    const screen = await render(<GtmConversationScreen
      initialState="empty"
      apiBaseUrl="https://api.example.com"
      accessToken="sensitive-access-token"
      debugEnabled
      fetcher={fetcher as typeof fetch}
    />);

    await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), "Research example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => screen.getByText("I’ll research the selected scope."));
    await fireEvent.press(screen.getByRole("button", { name: "Open debug panel" }));

    screen.getByText("run-live-1");
    screen.getByText("3");
    screen.getByText("research");
    screen.getByText("web_search");
    screen.getByText("Waiting for first workflow progress event.");
    expect(screen.queryByText("sensitive-access-token")).toBeNull();
  });

  it("warns when interactive-object invariants make the rendered run unreliable", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const duplicatedId = "progress-duplicate";
    const screen = await render(<GtmConversationScreen
      initialState="empty"
      apiBaseUrl="https://api.example.com"
      accessToken="access-token"
      conversationId={conversationId}
      debugEnabled
      interactiveObjects={[
        {
          id: duplicatedId,
          conversationId,
          version: 1,
          type: "workflow_progress",
          title: "Researching Nova",
          live: true,
          steps: [{ id: "queued", label: "Research", agent: "Luna", status: "pending" }],
        },
        {
          id: duplicatedId,
          conversationId: "22222222-2222-4222-8222-222222222222",
          version: 2,
          type: "company_profile",
          company: "Nova",
          domain: "nova.example",
          summary: "Duplicate object should never be silently trusted.",
          facts: [],
          pros: [],
          cons: [],
        },
      ]}
    />);

    await fireEvent.press(screen.getByRole("button", { name: "Open debug panel" }));

    screen.getByText("workflow_progress: 1");
    screen.getByText("Duplicate interactive-object IDs detected: progress-duplicate.");
    screen.getByText("1 interactive object belongs to another conversation.");
    screen.getByText("Workflow is marked live but no phase is running.");
  });

  it("exports a live batch comparison as Markdown or JSON", async () => {
    const conversationExportService = { export: jest.fn(async () => undefined) };
    const screen = await render(<GtmConversationScreen
      initialState="assessment"
      conversationExportService={conversationExportService}
      interactiveObjects={[{
        id: "comparison-1",
        conversationId: "11111111-1111-4111-8111-111111111111",
        version: 1,
        type: "company_comparison",
        title: "Target priority",
        entries: [{ company: "Nova", domain: "nova.example", rank: 1, score: 91, status: "pursue", rationale: "Best evidence-backed fit" }],
      }]}
    />);

    await fireEvent.press(screen.getByRole("button", { name: "Export comparison as Markdown" }));
    await waitFor(() => expect(conversationExportService.export).toHaveBeenCalledWith("markdown"));
    await fireEvent.press(screen.getByRole("button", { name: "Export comparison as JSON" }));
    await waitFor(() => expect(conversationExportService.export).toHaveBeenCalledWith("json"));
  });

  it("shows failed batch targets separately from the ranked companies", async () => {
    const screen = await render(<GtmConversationScreen
      initialState="assessment"
      interactiveObjects={[{
        id: "comparison-partial-1",
        conversationId: "11111111-1111-4111-8111-111111111111",
        version: 1,
        type: "company_comparison",
        title: "Target priority",
        entries: [{ company: "Nova", domain: "nova.example", rank: 1, score: 91, status: "pursue", rationale: "Best evidence-backed fit" }],
        failures: [{ domain: "broken.example", reason: "forced crawl failure" }],
      }]}
    />);

    screen.getByText("1 target could not be analyzed");
    screen.getByText("broken.example");
    screen.getByText("forced crawl failure");
    expect(screen.getAllByText("1")).toHaveLength(1);
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

  it("can start with the evidence drawer open for reproducible native visual QA", async () => {
    const screen = await render(<GtmConversationScreen initialState="assessment" initialEvidenceOpen />);

    screen.getByText("Key sources and facts supporting this analysis.");
    screen.getByText("Acme – Homepage");
  });

  it("shortlists the visible opportunity through the version-checked API action", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      objectId: "object_acme_assessment",
      version: 2,
      action: "shortlist",
      payload: {},
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const screen = await render(<GtmConversationScreen
      initialState="assessment"
      apiBaseUrl="https://api.example.com"
      accessToken="access-token"
      fetcher={fetcher as typeof fetch}
    />);

    await fireEvent.press(screen.getByRole("button", { name: "Shortlist" }));

    await waitFor(() => screen.getByText("Shortlisted"));
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/interactive-objects/object_acme_assessment/actions",
      {
        method: "POST",
        headers: {
          authorization: "Bearer access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "shortlist", expectedVersion: 1, payload: {} }),
      },
    );
  });

  it("restores the latest shortlisted opportunity after the conversation is reloaded", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const common = { conversationId, version: 1 } as const;
    const screen = await render(<GtmConversationScreen
      initialState="assessment"
      interactiveObjects={[
        { ...common, id: "profile-1", type: "company_profile", company: "Foodbegood", domain: "foodbegood.app", summary: "Food-sharing waitlist", facts: [], pros: ["Clear workflow"], cons: ["Budget unknown"] },
        { ...common, id: "score-1", type: "icp_score", company: "Foodbegood", score: 76, band: "medium", reasons: ["Clear workflow"], gaps: ["Budget unknown"] },
        { ...common, id: "opportunity-old", type: "opportunity", company: "Foodbegood", title: "Waitlist Triage Agent", summary: "Qualify waitlist demand.", impact: "high", value: "high", effort: "medium", fit: "high", status: "research" },
        { ...common, id: "opportunity-latest", version: 2, type: "opportunity", company: "Foodbegood", title: "Waitlist Triage Agent", summary: "Qualify waitlist demand.", impact: "high", value: "high", effort: "medium", fit: "high", status: "pursue" },
      ]}
    />);

    screen.getByRole("button", { name: "Shortlisted" });
  });

  it("records a conversational correction against the trusted live object", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const common = { conversationId, version: 4 } as const;
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      objectId: "opportunity-1",
      version: 5,
      action: "correct",
      payload: { message: "Employee range is 201–500." },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const screen = await render(<GtmConversationScreen
      initialState="assessment"
      apiBaseUrl="https://api.example.com"
      accessToken="access-token"
      conversationId={conversationId}
      fetcher={fetcher as typeof fetch}
      interactiveObjects={[
        { ...common, id: "profile-1", type: "company_profile", company: "Nova", domain: "nova.example", summary: "Finance automation", facts: [{ label: "Employees", value: "51–200" }], pros: ["Clear pain"], cons: ["Size uncertain"] },
        { ...common, id: "icp-1", type: "icp_score", company: "Nova", score: 88, band: "high", reasons: ["Clear pain"], gaps: ["Size uncertain"] },
        { ...common, id: "opportunity-1", type: "opportunity", company: "Nova", title: "Invoice Agent", summary: "Handle invoice exceptions.", impact: "high", value: "high", effort: "medium", fit: "high", status: "research" },
      ]}
    />);

    await fireEvent.press(screen.getByRole("button", { name: "Challenge" }));
    await fireEvent.press(screen.getByRole("button", { name: "Record correction" }));
    await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), "Employee range is 201–500.");
    await fireEvent.press(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/interactive-objects/opportunity-1/actions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "correct", expectedVersion: 4, payload: { message: "Employee range is 201–500." } }),
      }),
    ));
    await waitFor(() => screen.getByText("Employee range is 201–500."));
  });

  it("submits a typed company domain through the conversational composer", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      runId: "run-1",
      status: "queued",
      queuePosition: 2,
      interactiveObject: { id: "progress-run-1", type: "workflow_progress", version: 1, title: "Researching example.com", status: "running", steps: [] },
    }), { status: 202 }));
    const screen = await render(<GtmConversationScreen
      apiBaseUrl="https://api.example.com"
      accessToken="supabase-access-token"
      conversationId="11111111-1111-4111-8111-111111111111"
      fetcher={fetcher as typeof fetch}
    />);

    await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), "Analyze example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({
      authorization: "Bearer supabase-access-token",
      "content-type": "application/json",
    });
    await waitFor(() => screen.getByText("Analyze example.com"));
    screen.getByLabelText("Waiting for agent response");
    screen.getByText("Queued · position 2");

    screen.rerender(<GtmConversationScreen
      apiBaseUrl="https://api.example.com"
      accessToken="supabase-access-token"
      conversationId="11111111-1111-4111-8111-111111111111"
      fetcher={fetcher as typeof fetch}
      interactiveObjects={[{
        id: "profile-finished",
        conversationId: "11111111-1111-4111-8111-111111111111",
        version: 1,
        type: "company_profile",
        company: "Example",
        domain: "example.com",
        summary: "Research completed",
        facts: [],
        pros: [],
        cons: [],
      }]}
    />);
    await waitFor(() => expect(screen.queryByLabelText("Waiting for agent response")).toBeNull());
  });

  it("admits one conversation turn when Android emits duplicate submit events", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({
      kind: "research",
      runId: "run-single-admission",
      status: "queued",
      queuePosition: 1,
      message: "Research accepted.",
      usedTools: [],
      interactiveObjects: [],
    }), { status: 202, headers: { "content-type": "application/json" } }));
    const screen = await render(<GtmConversationScreen
      initialState="empty"
      apiBaseUrl="https://api.example.com"
      accessToken="access-token"
      fetcher={fetcher as typeof fetch}
    />);

    const composer = screen.getByLabelText("Message GTM Research Agent");
    await fireEvent.changeText(composer, "Analyze foodbegood.app");
    await act(async () => {
      composer.props.onSubmitEditing();
      composer.props.onSubmitEditing();
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    screen.getByText("Research accepted.");
  });

  it("keeps prior turns visible and accepts a domain-free follow-up in the same conversation", async () => {
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      runId: "run-follow-up",
      status: "queued",
      queuePosition: 2,
      interactiveObject: { id: "progress-run-follow-up" },
    }), { status: 202, headers: { "content-type": "application/json" } }));
    const screen = await render(<GtmConversationScreen
      initialState="assessment"
      apiBaseUrl="https://api.example.com"
      accessToken="access-token"
      conversationId="11111111-1111-4111-8111-111111111111"
      fetcher={fetcher as typeof fetch}
      initialMessages={[{
        id: "message-1",
        ownerId: "owner-1",
        conversationId: "11111111-1111-4111-8111-111111111111",
        role: "user",
        content: { text: "Analyze foodbegood.app", domains: ["foodbegood.app"] },
        sequence: 1,
        createdAt: "2026-08-02T09:00:00.000Z",
      }]}
    />);

    screen.getByText("Analyze foodbegood.app");
    await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), "What are the strongest pros and cons?");
    await fireEvent.press(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => screen.getByText("What are the strongest pros and cons?"));
    screen.getByText("Analyze foodbegood.app");
    screen.getByText("Queued · position 2");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ domains: [] });
  });

  it("attaches a private document and includes its id in the next research message", async () => {
    const documentId = "33333333-3333-4333-8333-333333333333";
    const file = {
      name: "sales notes.txt",
      type: "text/plain",
      size: 18,
      arrayBuffer: async () => new ArrayBuffer(18),
    };
    const documentPicker = { pick: jest.fn(async () => file) };
    const documentUploadService = { upload: jest.fn(async () => ({
      id: documentId,
      ownerId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      bucketId: "user-uploads" as const,
      storagePath: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/sales-notes.txt",
      fileName: "sales notes.txt",
      mimeType: "text/plain",
      sizeBytes: 18,
      status: "uploaded" as const,
      createdAt: "2026-08-02T09:00:00.000Z",
      updatedAt: "2026-08-02T09:00:00.000Z",
    })) };
    const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      runId: "run-1",
      status: "queued",
      interactiveObject: { id: "progress-run-1" },
    }), { status: 202, headers: { "content-type": "application/json" } }));
    const screen = await render(<GtmConversationScreen
      apiBaseUrl="https://api.example.com"
      accessToken="access-token"
      conversationId="22222222-2222-4222-8222-222222222222"
      documentPicker={documentPicker}
      documentUploadService={documentUploadService}
      fetcher={fetcher as typeof fetch}
    />);

    await fireEvent.press(screen.getByRole("button", { name: "Attach source" }));
    await waitFor(() => screen.getByText("sales notes.txt attached"));
    await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), "Analyze example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({
      documentIds: [documentId],
    });
  });
});
