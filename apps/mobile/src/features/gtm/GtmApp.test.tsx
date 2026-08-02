import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { GtmApp, type AuthSessionService } from "./GtmApp";
import type { InteractiveObjectEvent } from "./interactive-object-reducer";

function createAuthService(initialToken?: string): AuthSessionService & { signIn: jest.Mock } {
  let token = initialToken;
  return {
    getAccessToken: async () => token,
    signIn: jest.fn(async () => {
      token = "signed-in-token";
      return token;
    }),
    signOut: async () => { token = undefined; },
    subscribe: () => () => undefined,
  };
}

describe("GtmApp session bootstrap", () => {
  it("shows safe signed-out runtime diagnostics without exposing credentials", async () => {
    const screen = await render(<GtmApp
      apiBaseUrl="http://127.0.0.1:3000"
      supabaseUrl="http://127.0.0.1:54321"
      authService={createAuthService()}
      debugEnabled
    />);

    await waitFor(() => screen.getByText("Sign in to your GTM workspace"));
    await fireEvent.changeText(screen.getByLabelText("Email"), "operator@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "private-password");
    await fireEvent.press(screen.getByRole("button", { name: "Open auth debug panel" }));

    screen.getByText("Auth diagnostics");
    screen.getByText("127.0.0.1:3000");
    screen.getByText("127.0.0.1:54321");
    screen.getByText("20");
    screen.getByText("16");
    expect(screen.queryByText("operator@example.com")).toBeNull();
    expect(screen.queryByText("private-password")).toBeNull();
  });

  it("moves sign-in keyboard flow from email toward the secure password field", async () => {
    const screen = await render(<GtmApp
      apiBaseUrl="http://127.0.0.1:3000"
      authService={createAuthService()}
    />);

    const email = await screen.findByLabelText("Email");
    expect(email.props.returnKeyType).toBe("next");
    expect(email.props.blurOnSubmit).toBe(false);
  });

  it("opens an authenticated empty workspace without seeded conversation content", async () => {
    const authService = createAuthService("restored-token");
    const conversationId = "33333333-3333-4333-8333-333333333333";
    const fetcher = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/seller-profile")) return new Response(JSON.stringify({
        id: "22222222-2222-4222-8222-222222222222",
        ownerId: "11111111-1111-4111-8111-111111111111",
        businessName: "Dandelion AI",
        offerSummary: "AI and agent automation",
        capabilities: ["Agent orchestration"],
        proofPoints: [],
        constraints: { externalWritesRequireApproval: true },
        updatedAt: "2026-08-02T09:00:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/conversations")) return new Response(JSON.stringify([{
        id: conversationId,
        ownerId: "11111111-1111-4111-8111-111111111111",
        sellerProfileId: "22222222-2222-4222-8222-222222222222",
        icpDefinitionId: null,
        title: "GTM research",
        status: "active",
        createdAt: "2026-08-02T09:00:00.000Z",
        updatedAt: "2026-08-02T09:00:00.000Z",
      }]), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/messages") || url.endsWith("/interactive-objects")) {
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const screen = await render(<GtmApp
      apiBaseUrl="https://api.example.com"
      authService={authService}
      fetcher={fetcher as typeof fetch}
    />);

    await waitFor(() => screen.getByText("Start a new GTM conversation"));
    expect(screen.queryByText("Analyze acme.ai")).toBeNull();
    expect(screen.queryByText("Support Triage Agent")).toBeNull();
  });

  it("signs the operator in and starts conversational onboarding when no seller profile exists", async () => {
    const authService = createAuthService();
    const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/seller-profile")) return new Response(JSON.stringify({ error: "seller_profile_not_found" }), {
        status: 404, headers: { "content-type": "application/json" },
      });
      if (!init?.method) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({
        id: "33333333-3333-4333-8333-333333333333",
        ownerId: "11111111-1111-4111-8111-111111111111",
        sellerProfileId: null,
        icpDefinitionId: null,
        title: "GTM research",
        status: "active",
        createdAt: "2026-08-02T09:00:00.000Z",
        updatedAt: "2026-08-02T09:00:00.000Z",
      }), { status: 201, headers: { "content-type": "application/json" } });
    });
    const screen = await render(<GtmApp
      apiBaseUrl="https://api.example.com"
      authService={authService}
      fetcher={fetcher as typeof fetch}
    />);

    await waitFor(() => screen.getByText("Sign in to your GTM workspace"));
    await fireEvent.changeText(screen.getByLabelText("Email"), "operator@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "correct horse battery staple");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => screen.getByText("Before we research companies, what should I call your business?"));
    expect(authService.signIn).toHaveBeenCalledWith("operator@example.com", "correct horse battery staple");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/seller-profile",
      { headers: { authorization: "Bearer signed-in-token" } },
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/conversations",
      { headers: { authorization: "Bearer signed-in-token" } },
    );
  });

  it("restores the canonical conversation when the authenticated operator already has a profile", async () => {
    const authService = createAuthService("restored-token");
    const conversationId = "33333333-3333-4333-8333-333333333333";
    let emitRealtime: ((event: InteractiveObjectEvent) => void) | undefined;
    const realtimeService = {
      subscribe: jest.fn((_conversationId: string, listener: (event: InteractiveObjectEvent) => void) => {
        emitRealtime = listener;
        return () => undefined;
      }),
    };
    const fetcher = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/seller-profile")) return new Response(JSON.stringify({
        id: "22222222-2222-4222-8222-222222222222",
        ownerId: "11111111-1111-4111-8111-111111111111",
        businessName: "Dandelion AI",
        offerSummary: "AI and agent automation",
        capabilities: ["Agent orchestration"],
        proofPoints: [],
        constraints: { externalWritesRequireApproval: true },
        updatedAt: "2026-08-02T09:00:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/conversations")) return new Response(JSON.stringify([{
        id: conversationId,
        ownerId: "11111111-1111-4111-8111-111111111111",
        sellerProfileId: "22222222-2222-4222-8222-222222222222",
        icpDefinitionId: null,
        title: "GTM research",
        status: "active",
        createdAt: "2026-08-02T09:00:00.000Z",
        updatedAt: "2026-08-02T09:00:00.000Z",
      }]), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/interactive-objects")) return new Response(JSON.stringify([{
        id: "44444444-4444-4444-8444-444444444444",
        conversationId,
        version: 1,
        type: "opportunity",
        company: "Acme",
        title: "Support Triage Agent",
        summary: "Automate support triage",
        impact: "high",
        value: "high",
        effort: "medium",
        fit: "high",
        status: "research",
      }]), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/messages")) return new Response(JSON.stringify([
        { id: "message-1", ownerId: "11111111-1111-4111-8111-111111111111", conversationId, role: "user", content: { text: "Analyze foodbegood.app", domains: ["foodbegood.app"] }, sequence: 1, createdAt: "2026-08-02T08:59:00.000Z" },
        { id: "message-2", ownerId: "11111111-1111-4111-8111-111111111111", conversationId, role: "assistant", content: { text: "I’ll keep the result in this conversation." }, sequence: 2, createdAt: "2026-08-02T08:59:01.000Z" },
      ]), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({
        runId: "run-1",
        status: "queued",
        interactiveObject: { id: "progress-run-1" },
      }), { status: 202, headers: { "content-type": "application/json" } });
    });

    const screen = await render(<GtmApp
      apiBaseUrl="https://api.example.com"
      authService={authService}
      fetcher={fetcher as typeof fetch}
      realtimeService={realtimeService}
    />);

    await waitFor(() => screen.getByText("Here’s what I found about Acme."));
    screen.getByText("Analyze foodbegood.app");
    screen.getByText("I’ll keep the result in this conversation.");
    screen.getByText("Support Triage Agent");
    await act(async () => {
      emitRealtime?.({
        kind: "upsert",
        object: {
          id: "44444444-4444-4444-8444-444444444444",
          conversationId,
          version: 2,
          type: "opportunity",
          company: "Acme",
          title: "Support Triage Agent",
          summary: "Automate support triage",
          impact: "high",
          value: "high",
          effort: "medium",
          fit: "high",
          status: "pursue",
        },
      });
    });
    await waitFor(() => screen.getByText("Shortlisted"));
    await fireEvent.changeText(screen.getByLabelText("Message GTM Research Agent"), "Analyze example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.com/api/v1/conversations/${conversationId}/messages`,
      expect.any(Object),
    ));
  });
});
