import { render } from "@testing-library/react-native";

import HomeScreen from "../../app/index";

describe("HomeScreen visual QA", () => {
  it("renders the canonical assessment through the real Expo route", async () => {
    const screen = await render(<HomeScreen visualQaState="assessment" />);

    screen.getByText("Here’s what I found about Acme.");
    screen.getByText("Support Triage Agent");
    expect(screen.queryByRole("button", { name: "Open debug panel" })).toBeNull();
  });
});
