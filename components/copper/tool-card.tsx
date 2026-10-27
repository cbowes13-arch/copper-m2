"use client";

// The tool card: one round trip between Copper and the app. The top half is
// what Copper sent (the model writes the input), the bottom half is what came
// back (ordinary code computed the result). Always open: nothing to click.
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useMemo } from "react";
import { Spinner } from "@/components/ui/spinner";
import { TOOL_LABELS, type ToolStep } from "@/lib/copper/assistant/progress";
import { formatUsd, getPlans, getProducts } from "@/lib/copper/catalog";
import { cn } from "@/lib/utils";

type Names = {
  products: Record<string, string>;
  plans: Record<string, string>;
};

/** Display names for product and plan ids, read from the catalog. */
function useNames(): Names {
  return useMemo(
    () => ({
      products: Object.fromEntries(getProducts().map((p) => [p.id, p.name])),
      plans: Object.fromEntries(getPlans().map((p) => [p.id, p.name])),
    }),
    [],
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-11-14" becomes "Nov 14, 2026". Anything else is returned as it came. */
function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : value;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const asText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

/** "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// ---------------------------------------------------------------------------
// What Copper sent
// ---------------------------------------------------------------------------

type Row = { label: string; value: string };

function inputRows(tool: string, input: unknown, names: Names): Row[] {
  const data = isRecord(input) ? input : {};
  if (tool === "calculate_cost") {
    const counts = new Map<string, number>();
    for (const id of asList(data.products)) {
      const name = names.products[asText(id)] ?? asText(id);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const products = [...counts]
      .map(([name, count]) => (count > 1 ? `${count} × ${name}` : name))
      .join(", ");
    const plan = asText(data.plan);
    return [
      { label: "Products", value: products || "No devices" },
      { label: "Plan", value: names.plans[plan] ?? plan },
      { label: "Billing", value: asText(data.billing) },
      { label: "Years", value: asText(data.years) },
    ];
  }
  if (tool === "check_availability") {
    const product = asText(data.product);
    return [
      { label: "Product", value: names.products[product] ?? product },
      { label: "Color", value: asText(data.color) || "Every color" },
    ];
  }
  // A tool this panel doesn't know: still a labelled list, never raw JSON.
  return Object.entries(data).map(([label, value]) => ({
    label,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

const NO_INPUT: Record<string, string> = {
  get_prices: "Nothing, it just asked for the price list",
  get_products: "Nothing, it just asked what Copper sells",
};

function Sent({
  tool,
  input,
  state,
  names,
}: {
  tool: string;
  input: unknown;
  state: ToolStep["state"];
  names: Names;
}) {
  if (input === undefined && state !== "calling") {
    return (
      <p className="text-muted-foreground text-sm">No details were sent</p>
    );
  }
  if (input === undefined) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm italic">
        <Spinner className="size-3.5" />
        filling in the details…
      </p>
    );
  }
  if (tool in NO_INPUT) {
    return <p className="text-muted-foreground text-sm">{NO_INPUT[tool]}</p>;
  }
  const rows = inputRows(tool, input, names);
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing</p>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-medium break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// What came back
// ---------------------------------------------------------------------------

function Money({ children }: { children: number }) {
  return (
    <span className="font-medium tabular-nums">{formatUsd(children)}</span>
  );
}

function Pill({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-primary-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

function CostResult({ output }: { output: Record<string, unknown> }) {
  const lines = asList(output.lines).filter(isRecord);
  const total = Number(output.totalUsd);
  return (
    <div className="text-sm">
      {lines.length > 0 && (
        <ul className="space-y-1">
          {lines.map((line, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span>{asText(line.item)}</span>
              <Money>{Number(line.usd)}</Money>
            </li>
          ))}
        </ul>
      )}
      <div className="border-border mt-2 flex items-baseline justify-between gap-3 border-t pt-2">
        <span className="font-semibold">Total</span>
        <span className="font-heading text-primary text-2xl font-extrabold tabular-nums">
          {formatUsd(total)}
        </span>
      </div>
    </div>
  );
}

function ProductsResult({ output }: { output: Record<string, unknown> }) {
  const products = asList(output.products).filter(isRecord);
  return (
    <ul className="space-y-3 text-sm">
      {products.map((product, i) => (
        <li key={asText(product.id) || i}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{asText(product.name)}</span>
            <Money>{Number(product.priceUsd)}</Money>
          </div>
          <p className="text-muted-foreground text-xs">
            {asText(product.type)}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {asList(product.colors).map((color) => (
              <Pill key={asText(color)} className="bg-accent">
                {asText(color)}
              </Pill>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PricesResult({ output }: { output: Record<string, unknown> }) {
  const products = asList(output.products).filter(isRecord);
  const paidPlans = asList(output.plans)
    .filter(isRecord)
    .filter(
      (plan) => Number(plan.monthlyUsd) > 0 || Number(plan.annualUsd) > 0,
    );
  return (
    <ul className="space-y-1 text-sm">
      {products.map((product, i) => (
        <li
          key={asText(product.id) || i}
          className="flex items-baseline justify-between gap-3"
        >
          <span>{asText(product.name)}</span>
          <Money>{Number(product.priceUsd)}</Money>
        </li>
      ))}
      {paidPlans.map((plan, i) => (
        <li
          key={asText(plan.id) || i}
          className="flex items-baseline justify-between gap-3"
        >
          <span>{asText(plan.name)}</span>
          <span className="font-medium tabular-nums">
            {formatUsd(Number(plan.monthlyUsd))}/mo ·{" "}
            {formatUsd(Number(plan.annualUsd))}/yr
          </span>
        </li>
      ))}
    </ul>
  );
}

function StockPill({
  stock,
  restockDate,
}: {
  stock: string;
  restockDate: string;
}) {
  if (stock === "in_stock") return <Pill className="bg-accent">In stock</Pill>;
  if (stock === "low_stock")
    return <Pill className="bg-chart-4">Low stock</Pill>;
  if (stock === "backordered") {
    return (
      <Pill className="bg-chart-3">
        {restockDate
          ? `Back-ordered until ${formatDate(restockDate)}`
          : "Back-ordered"}
      </Pill>
    );
  }
  return <Pill className="bg-foreground/10 text-foreground">{stock}</Pill>;
}

function AvailabilityResult({ output }: { output: Record<string, unknown> }) {
  const status = asText(output.status);
  if (status === "not_a_color") {
    const colors = asList(output.colors).map(asText);
    return (
      <p className="text-sm">
        {asText(output.product)} doesn&apos;t come in {asText(output.color)}. It
        comes in {joinNames(colors)}.
      </p>
    );
  }
  if (status === "unavailable") {
    return <p className="text-sm">{asText(output.message)}</p>;
  }
  const colors = asList(output.colors).filter(isRecord);
  if (colors.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No stock rows found.</p>
    );
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {colors.map((row, i) => (
        <li
          key={asText(row.color) || i}
          className="flex items-center justify-between gap-3"
        >
          <span>{asText(row.color)}</span>
          <StockPill
            stock={asText(row.stock)}
            restockDate={asText(row.restockDate)}
          />
        </li>
      ))}
    </ul>
  );
}

function GenericResult({ output }: { output: unknown }) {
  const rows = isRecord(output)
    ? Object.entries(output).map(([label, value]) => ({
        label,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }))
    : [{ label: "Result", value: asText(output) }];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-medium break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Came({ step }: { step: ToolStep }) {
  if (step.state === "calling") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm italic">
        <Spinner className="size-3.5" />
        the app is running the code…
      </p>
    );
  }
  if (step.state === "error") {
    return (
      <p className="border-chart-3 bg-chart-3/10 rounded-md border px-2.5 py-1.5 text-sm">
        {asText(step.output) || "The tool ran into a problem."}
      </p>
    );
  }
  const output = step.output;
  if (isRecord(output)) {
    if (step.name === "calculate_cost") return <CostResult output={output} />;
    if (step.name === "get_products") return <ProductsResult output={output} />;
    if (step.name === "get_prices") return <PricesResult output={output} />;
    if (step.name === "check_availability") {
      return <AvailabilityResult output={output} />;
    }
  }
  return <GenericResult output={output} />;
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[0.7rem] font-bold tracking-widest uppercase">
      {icon}
      {children}
    </p>
  );
}

/** `number` is which tool call this is in the answer (1, 2, 3...). */
export function ToolCard({ step, number }: { step: ToolStep; number: number }) {
  const names = useNames();
  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="bg-card overflow-hidden rounded-xl border shadow-sm"
    >
      <div className="bg-accent text-accent-foreground flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <span className="font-mono text-sm font-bold">{step.name}()</span>
        <span className="bg-accent-foreground/15 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold">
          tool {number}
        </span>
        <span className="ml-auto text-xs font-medium">
          {TOOL_LABELS[step.name] ?? ""}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <SectionLabel icon={<ArrowRightIcon className="size-3" />}>
          What Copper sent
        </SectionLabel>
        <Sent
          tool={step.name}
          input={step.input}
          state={step.state}
          names={names}
        />
      </div>
      <div className="border-border bg-accent/10 border-t px-3 py-2.5">
        <SectionLabel icon={<ArrowLeftIcon className="size-3" />}>
          What came back
        </SectionLabel>
        <Came step={step} />
      </div>
    </div>
  );
}
