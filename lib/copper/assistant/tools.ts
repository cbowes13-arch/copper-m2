// Module 2: the four tools Ask Copper can use. Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getPlans, getProducts } from "@/lib/copper/catalog";
import type { Plan, ProductId } from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: { id: Plan["id"]; name: string; monthlyUsd: number; annualUsd: number }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  // Only what the catalog says. Stock is check_availability's job.
  return {
    products: getProducts().map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      priceUsd: p.priceUsd,
      colors: p.colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map((p) => ({
      id: p.id,
      name: p.name,
      priceUsd: p.priceUsd,
    })),
    plans: getPlans().map((p) => ({
      id: p.id,
      name: p.name,
      monthlyUsd: p.monthlyUsd,
      annualUsd: p.annualUsd,
    })),
  };
}

// The calculate_cost contract: up to 5 devices, a plan, how it's billed, and
// a whole number of years from 1 to 5.
export const calculateCostInput: z.ZodType<CalculateCostInput> = z.object({
  products: z.array(z.enum(["copper-home", "copper-notes"])).max(5),
  plan: z.enum(["free", "copper-plus"]),
  billing: z.enum(["monthly", "annual"]),
  years: z.number().int().min(1).max(5),
});

/** Rounds to whole cents. */
function toCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const lines: CostBreakdown["lines"] = [];

  // Each device is paid for once, and is its own line.
  const products = getProducts();
  for (const id of input.products) {
    const product = products.find((p) => p.id === id);
    if (!product) throw new Error(`Unknown product: ${id}`);
    lines.push({ item: product.name, usd: toCents(product.priceUsd) });
  }

  // A paid plan covers the whole household, so it's one line however many
  // devices there are. The free plan costs nothing, so it gets no line.
  const plan = getPlans().find((p) => p.id === input.plan);
  if (!plan) throw new Error(`Unknown plan: ${input.plan}`);
  if (plan.id !== "free") {
    const usd =
      input.billing === "monthly"
        ? plan.monthlyUsd * 12 * input.years
        : plan.annualUsd * input.years;
    const years = input.years === 1 ? "1 year" : `${input.years} years`;
    lines.push({
      item: `${plan.name} (${input.billing}, ${years})`,
      usd: toCents(usd),
    });
  }

  const totalUsd = toCents(lines.reduce((sum, line) => sum + line.usd, 0));
  return { lines, totalUsd };
}

// The check_availability contract: a Copper product, and optionally one color.
export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.object({
    product: z.enum(["copper-home", "copper-notes"]),
    color: z.string().optional(),
  });

/** 0 units is back-ordered, 1 to 9 is low, 10 or more is in stock. */
function stockFor(units: number): Stock {
  if (units < 1) return "backordered";
  return units < 10 ? "low_stock" : "in_stock";
}

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product);
  if (!product) throw new Error(`Unknown product: ${input.product}`);

  // Check the color against the catalog first, in any capitalization. A color
  // the product doesn't come in is not "out of stock", even if stock is down.
  let colors = product.colors;
  if (input.color !== undefined) {
    const asked = input.color.toLowerCase();
    colors = product.colors.filter((c) => c.toLowerCase() === asked);
    if (colors.length === 0) {
      return {
        status: "not_a_color",
        product: product.name,
        color: input.color,
        colors: product.colors,
      };
    }
  }

  // Stock changes, so read it fresh every time. Never guess when it's down.
  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message: "Stock can't be checked right now. Please try again soon.",
    };
  }

  // Rows name the product by its display name ("Copper Notes"), not its id.
  // A color with no row is left out.
  const found: { color: string; stock: Stock; restockDate: string | null }[] =
    [];
  for (const color of colors) {
    const row = rows.find((r) => r.product === product.name && r.color === color);
    if (!row) continue;
    const stock = stockFor(row.units_in_stock);
    found.push({
      color,
      stock,
      restockDate: stock === "backordered" ? row.next_shipment : null,
    });
  }
  return { status: "ok", product: product.name, colors: found };
}

// The tools the model can call. The description tells it when to use each one.
export const copperTools: ToolSet = {
  get_products: tool({
    description:
      "List every Copper product with its type, price and the colors it comes in (not whether they are in stock).",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description:
      "Get the price of every Copper product and the monthly and yearly price of every plan.",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Work out the total cost of up to 5 Copper devices plus a plan, billed monthly or annually, over 1 to 5 years.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Check live stock for a Copper product, or one of its colors: in stock, low stock, or back-ordered with a restock date.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
};
