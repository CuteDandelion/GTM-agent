// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Prototype from "./Prototype";
import { MobileRuntime } from "./mobile";

function renderPrototype() {
  return render(
    <MobileRuntime>
      <Prototype />
    </MobileRuntime>
  );
}

describe("canonical GTM conversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("progresses from research to the approved Acme assessment", () => {
    renderPrototype();

    expect(screen.getByRole("heading", { name: "GTM Research Agent" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Researching Acme" })).toBeVisible();
    expect(screen.getByText("Research · Luna")).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(1800);
    });

    expect(screen.getByText("ICP fit")).toBeVisible();
    expect(screen.getByText("Support Triage Agent")).toBeVisible();
  });

  it("opens evidence, closes it, and shortlists the opportunity", () => {
    renderPrototype();

    act(() => {
      vi.advanceTimersByTime(1800);
    });

    fireEvent.click(screen.getByRole("button", { name: "Shortlist" }));
    expect(screen.getByRole("button", { name: "Shortlisted" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(screen.getByRole("heading", { name: "Evidence" })).toBeVisible();
    expect(screen.getByText("Acme – Pricing")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close evidence" }));
    expect(screen.getByRole("dialog", { name: "Evidence" })).toHaveAttribute("data-state", "closed");
  });
});
