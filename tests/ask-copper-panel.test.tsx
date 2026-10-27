// The Ask Copper panel, rendered on its own with a fake askCopper, so these
// run without the landing page, an AI key or a model. They cover what the
// module's spec tests don't: the station-by-station drawing of an answer.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLive, type Live } from "@/lib/ai/live";
import type { Progress, Step } from "@/lib/copper/assistant/progress";

const askCopper = vi.fn();
vi.mock("@/lib/copper/assistant/ask", () => ({
  askCopper: (request: unknown) => askCopper(request),
}));

import { AskCopper } from "@/components/copper/ask-copper";

const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

/** A streaming answer the test can push updates into. */
function streaming() {
  const live = createLive<Progress>();
  askCopper.mockResolvedValueOnce({ progress: live.live as Live<Progress> });
  return live;
}

function finished(reply: string, steps: Step[] = []) {
  const live = createLive<Progress>();
  live.done({ steps, reply, status: "done" });
  return { progress: live.live };
}

const toolStep = (
  name: string,
  input: unknown,
  output: unknown,
  state: "calling" | "done" | "error" = "done",
  id = "call-1",
): Step => ({ type: "tool", id, name, state, input, output });

async function openPanel(aiConfigured = true) {
  render(<AskCopper aiConfigured={aiConfigured} />);
  fireEvent.click(screen.getByTestId("ask-copper-launcher"));
  return within(await screen.findByTestId("ask-copper"));
}

function ask(chat: ReturnType<typeof within>, question: string) {
  fireEvent.change(chat.getByRole("textbox"), { target: { value: question } });
  fireEvent.click(chat.getByRole("button", { name: /send/i }));
}

beforeEach(() => {
  askCopper.mockReset();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("AskCopper", () => {
  it("opens from the launcher, offers the three starters, and keeps offering them", async () => {
    askCopper.mockResolvedValue(finished("Sure."));
    const chat = await openPanel();
    for (const starter of STARTERS) {
      expect(chat.getByRole("button", { name: starter })).toBeInTheDocument();
    }
    fireEvent.click(chat.getByRole("button", { name: STARTERS[0] }));
    await waitFor(() => expect(chat.getByText("Sure.")).toBeInTheDocument());
    expect(askCopper).toHaveBeenCalledWith({
      messages: [{ role: "user", content: STARTERS[0] }],
      useTools: true,
    });
    for (const starter of STARTERS) {
      expect(chat.getByRole("button", { name: starter })).toBeInTheDocument();
    }
  });

  it("hides the starters while an answer streams, then shows them again", async () => {
    const live = streaming();
    const chat = await openPanel();
    ask(chat, "Is Copper Notes in Night Sky in stock?");
    await waitFor(() =>
      expect(chat.getByText("Reading your question…")).toBeInTheDocument(),
    );
    expect(chat.queryByRole("button", { name: STARTERS[0] })).toBeNull();
    // Station 1 is there from the start, with every tool on the menu.
    for (const name of [
      "get_products",
      "get_prices",
      "calculate_cost",
      "check_availability",
    ]) {
      expect(chat.getByText(name)).toBeInTheDocument();
    }
    await act(async () =>
      live.done({ steps: [], reply: "Yes.", status: "done" }),
    );
    expect(chat.getByRole("button", { name: STARTERS[0] })).toBeInTheDocument();
    expect(chat.queryByText("Reading your question…")).toBeNull();
  });

  it("draws thinking (with markdown), the tool card and then the reply as they arrive", async () => {
    const live = streaming();
    const chat = await openPanel();
    ask(chat, "Copper Home with Plus, yearly, for 2 years?");

    await act(async () =>
      live.update({
        steps: [
          {
            type: "thinking",
            text: "**Calculating the cost**\n\nI'll use `calculate_cost`.",
          },
        ],
        reply: "",
        status: "working",
      }),
    );
    const thinking = chat.getByTestId("thinking");
    expect(thinking.textContent).not.toContain("**");
    expect(thinking.textContent).not.toContain("`");
    expect(thinking.querySelector("strong")?.textContent).toBe(
      "Calculating the cost",
    );
    expect(thinking.querySelector("code")?.textContent).toBe("calculate_cost");
    expect(chat.getByText("Deciding what to do next…")).toBeInTheDocument();

    // The tool is named before its input is known.
    await act(async () =>
      live.update({
        steps: [
          { type: "thinking", text: "**Calculating the cost**" },
          toolStep("calculate_cost", undefined, undefined, "calling"),
        ],
        reply: "",
        status: "working",
      }),
    );
    let card = within(chat.getByTestId("tool-call"));
    expect(card.getByText(/filling in the details/)).toBeInTheDocument();
    expect(card.getByText(/the app is running the code/)).toBeInTheDocument();
    expect(chat.getByText("Copper is calling a tool")).toBeInTheDocument();

    await act(async () =>
      live.update({
        steps: [
          { type: "thinking", text: "**Calculating the cost**" },
          toolStep(
            "calculate_cost",
            {
              products: ["copper-home"],
              plan: "copper-plus",
              billing: "annual",
              years: 2,
            },
            {
              lines: [
                { item: "Copper Home", usd: 149 },
                { item: "Copper Plus, annual, 2 years", usd: 158 },
              ],
              totalUsd: 307,
            },
          ),
        ],
        reply: "That comes",
        status: "working",
      }),
    );
    card = within(chat.getByTestId("tool-call"));
    expect(chat.getByText("Copper called a tool")).toBeInTheDocument();
    expect(card.getByText("tool 1")).toBeInTheDocument();
    expect(card.getByText("Working out the cost")).toBeInTheDocument();
    // What Copper sent is a labelled list, never raw JSON.
    expect(card.getByText("Products").nextSibling?.textContent).toBe(
      "Copper Home",
    );
    expect(card.getByText("Plan").nextSibling?.textContent).toBe("Copper Plus");
    expect(card.getByText("Billing").nextSibling?.textContent).toBe("annual");
    expect(card.getByText("Years").nextSibling?.textContent).toBe("2");
    expect(card.queryByText(/\{|\}/)).toBeNull();
    // What came back: each line, then the total.
    expect(card.getByText("$149")).toBeInTheDocument();
    expect(card.getByText("$158")).toBeInTheDocument();
    expect(card.getByText("Total")).toBeInTheDocument();
    expect(card.getByText("$307")).toBeInTheDocument();
    // Copper used calculate_cost, so its chip on the menu is filled in.
    expect(chat.getByTitle("Working out the cost").className).toContain(
      "bg-accent",
    );
    expect(chat.getByTitle("Checking stock").className).not.toContain(
      "bg-accent",
    );
    expect(chat.getByText("Writing the answer…")).toBeInTheDocument();

    await act(async () =>
      live.done({
        steps: [toolStep("calculate_cost", {}, { lines: [], totalUsd: 307 })],
        reply: "That comes to $307.",
        status: "done",
      }),
    );
    expect(chat.getByText("That comes to $307.")).toBeInTheDocument();
    expect(chat.queryByText("Writing the answer…")).toBeNull();
  });

  it("numbers each tool call in the answer", async () => {
    askCopper.mockResolvedValue(
      finished("Done.", [
        toolStep("get_products", {}, { products: [] }, "done", "a"),
        toolStep("get_prices", {}, { products: [], plans: [] }, "done", "b"),
      ]),
    );
    const chat = await openPanel();
    ask(chat, "What do you sell?");
    await waitFor(() => expect(chat.getByText("Done.")).toBeInTheDocument());
    const cards = chat.getAllByTestId("tool-call");
    expect(cards.map((card) => card.dataset.tool)).toEqual([
      "get_products",
      "get_prices",
    ]);
    expect(within(cards[0]).getByText("tool 1")).toBeInTheDocument();
    expect(within(cards[1]).getByText("tool 2")).toBeInTheDocument();
  });

  it("shows what came back for each tool", async () => {
    askCopper.mockResolvedValue(
      finished("Done.", [
        toolStep(
          "get_products",
          {},
          {
            products: [
              {
                id: "copper-notes",
                name: "Copper Notes",
                type: "Clip-on recorder",
                priceUsd: 129,
                colors: ["Brushed Copper", "Night Sky"],
              },
            ],
          },
          "done",
          "a",
        ),
        toolStep(
          "get_prices",
          {},
          {
            products: [
              { id: "copper-home", name: "Copper Home", priceUsd: 149 },
            ],
            plans: [
              { id: "free", name: "Free", monthlyUsd: 0, annualUsd: 0 },
              {
                id: "copper-plus",
                name: "Copper Plus",
                monthlyUsd: 7.99,
                annualUsd: 79,
              },
            ],
          },
          "done",
          "b",
        ),
        toolStep(
          "check_availability",
          { product: "copper-notes" },
          {
            status: "ok",
            product: "Copper Notes",
            colors: [
              { color: "Brushed Copper", stock: "in_stock", restockDate: null },
              { color: "Desert Sand", stock: "low_stock", restockDate: null },
              {
                color: "Night Sky",
                stock: "backordered",
                restockDate: "2026-11-14",
              },
            ],
          },
          "done",
          "c",
        ),
        toolStep(
          "check_availability",
          { product: "copper-notes", color: "Patina Teal" },
          {
            status: "not_a_color",
            product: "Copper Notes",
            color: "Patina Teal",
            colors: ["Brushed Copper", "Desert Sand", "Night Sky"],
          },
          "done",
          "d",
        ),
        toolStep(
          "check_availability",
          { product: "copper-home" },
          {
            status: "unavailable",
            message: "Stock can't be checked right now.",
          },
          "done",
          "e",
        ),
      ]),
    );
    const chat = await openPanel();
    ask(chat, "Everything?");
    await waitFor(() => expect(chat.getByText("Done.")).toBeInTheDocument());
    const [products, prices, stock, notAColor, unavailable] = chat
      .getAllByTestId("tool-call")
      .map((card) => within(card));

    expect(
      products.getByText("Nothing, it just asked what Copper sells"),
    ).toBeInTheDocument();
    expect(products.getByText("$129")).toBeInTheDocument();
    expect(products.getByText("Clip-on recorder")).toBeInTheDocument();
    expect(products.getByText("Brushed Copper")).toBeInTheDocument();

    expect(
      prices.getByText("Nothing, it just asked for the price list"),
    ).toBeInTheDocument();
    expect(prices.getByText("$149")).toBeInTheDocument();
    expect(prices.getByText("$7.99/mo · $79/yr")).toBeInTheDocument();
    expect(prices.queryByText("Free")).toBeNull();

    expect(stock.getByText("Product").nextSibling?.textContent).toBe(
      "Copper Notes",
    );
    expect(stock.getByText("Color").nextSibling?.textContent).toBe(
      "Every color",
    );
    expect(stock.getByText("In stock").className).toContain("bg-accent");
    expect(stock.getByText("Low stock").className).toContain("bg-chart-4");
    expect(
      stock.getByText("Back-ordered until Nov 14, 2026").className,
    ).toContain("bg-chart-3");

    expect(
      notAColor.getByText(
        "Copper Notes doesn't come in Patina Teal. It comes in Brushed Copper, Desert Sand and Night Sky.",
      ),
    ).toBeInTheDocument();
    expect(
      unavailable.getByText("Stock can't be checked right now."),
    ).toBeInTheDocument();
  });

  it("keeps tools on and tools off as separate chats, and labels the unchecked answer", async () => {
    askCopper
      .mockResolvedValueOnce(finished("Checked: $307."))
      .mockResolvedValueOnce(finished("Probably $300."));
    const chat = await openPanel();
    const toolsSwitch = chat.getByRole("switch", { name: /use tools/i });
    expect(toolsSwitch).toBeChecked();
    expect(chat.getByText("Checks every answer")).toBeInTheDocument();

    ask(chat, "First question");
    await waitFor(() =>
      expect(chat.getByText("Checked: $307.")).toBeInTheDocument(),
    );
    expect(chat.queryByText(/answered without tools/i)).toBeNull();

    fireEvent.click(toolsSwitch);
    expect(toolsSwitch).not.toBeChecked();
    expect(chat.getByText("Model guesses alone")).toBeInTheDocument();
    expect(chat.queryByText("Checked: $307.")).toBeNull();

    ask(chat, "Second question");
    await waitFor(() =>
      expect(chat.getByText("Probably $300.")).toBeInTheDocument(),
    );
    expect(chat.getByText("Tools given to Copper: none")).toBeInTheDocument();
    expect(
      chat.getByText("Copper has to answer from memory alone."),
    ).toBeInTheDocument();
    expect(askCopper).toHaveBeenLastCalledWith({
      messages: [{ role: "user", content: "Second question" }],
      useTools: false,
    });
    expect(chat.getByText(/answered without tools/i)).toBeInTheDocument();
    expect(chat.queryAllByTestId("tool-call")).toHaveLength(0);

    fireEvent.click(toolsSwitch);
    expect(chat.getByText("Checked: $307.")).toBeInTheDocument();
    expect(chat.getByText("First question")).toBeInTheDocument();
    expect(chat.queryByText("Probably $300.")).toBeNull();
  });

  it("says so when Copper can't answer, instead of showing nothing", async () => {
    askCopper.mockRejectedValueOnce(new Error("boom"));
    const chat = await openPanel();
    ask(chat, "Anything");
    await waitFor(() =>
      expect(chat.getByText(/couldn't answer that/i)).toBeInTheDocument(),
    );
    // A failed turn isn't sent back as history.
    askCopper.mockResolvedValueOnce(finished("Fine."));
    ask(chat, "Again");
    await waitFor(() => expect(askCopper).toHaveBeenCalledTimes(2));
    expect(askCopper.mock.calls[1][0].messages).toEqual([
      { role: "user", content: "Again" },
    ]);
  });

  it("shows the setup card, and no chat box, without an AI key", async () => {
    const chat = await openPanel(false);
    expect(chat.getByText(/set up .+ to use this page/i)).toBeInTheDocument();
    expect(chat.queryByRole("textbox")).toBeNull();
    expect(chat.queryByRole("switch")).toBeNull();
  });

  it("opens from an #ask link every time it is clicked, and from /#ask on load", async () => {
    render(
      <>
        <a href="#ask">Ask Copper link</a>
        <AskCopper aiConfigured />
      </>,
    );
    expect(screen.queryByTestId("ask-copper")).toBeNull();
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByText("Ask Copper link"));
      expect(await screen.findByTestId("ask-copper")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
      await waitFor(() =>
        expect(screen.queryByTestId("ask-copper")).toBeNull(),
      );
    }
    cleanup();

    window.history.replaceState(null, "", "/#ask");
    render(<AskCopper aiConfigured />);
    expect(await screen.findByTestId("ask-copper")).toBeInTheDocument();
  });
});
