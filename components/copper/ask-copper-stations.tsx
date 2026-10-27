"use client";

// How Ask Copper shows its work: one answer is a line of stations hanging off
// a vertical rail (the tools Copper could use, what it was thinking, each tool
// it called), then Copper's reply as a chat bubble below the rail. The spec's
// section 5 describes each part.
import {
  BrainIcon,
  ListChecksIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { ToolCard } from "@/components/copper/tool-card";
import {
  TOOL_LABELS,
  type Progress,
  type Step,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A little markdown: **bold**, `code` and "- " bullets. Gemini's thought
// summaries arrive this way, and a half-written **mark** mid-stream still
// reads as bold, so no library is needed.
// ---------------------------------------------------------------------------

const INLINE = /\*\*(.+?)(?:\*\*|$)|`([^`]+?)(?:`|$)/g;

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <strong key={match.index} className="font-semibold">
          {match[1]}
        </strong>,
      );
    } else {
      parts.push(
        <code
          key={match.index}
          className="bg-foreground/10 rounded px-1 py-0.5 font-mono text-[0.85em] not-italic"
        >
          {match[2]}
        </code>,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

type Block = { kind: "text"; text: string } | { kind: "list"; items: string[] };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let open = false; // is the last block still being written to?
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (bullet) {
      if (open && last?.kind === "list") last.items.push(bullet[1]);
      else blocks.push({ kind: "list", items: [bullet[1]] });
      open = true;
    } else if (line.trim() === "") {
      open = false;
    } else if (open && last?.kind === "text") {
      last.text += `\n${line}`;
    } else {
      blocks.push({ kind: "text", text: line });
      open = true;
    }
  }
  return blocks;
}

function Caret() {
  return (
    <span
      aria-hidden
      className="bg-primary ml-0.5 inline-block h-[1.1em] w-0.5 animate-pulse align-text-bottom motion-reduce:animate-none"
    />
  );
}

/** Renders `text` as markdown. `caret` adds a blinking caret at the very end. */
function Markdown({
  text,
  caret = false,
  className,
}: {
  text: string;
  caret?: boolean;
  className?: string;
}) {
  const blocks = toBlocks(text);
  return (
    <div className={cn("space-y-2", className)}>
      {blocks.map((block, i) => {
        const end = caret && i === blocks.length - 1;
        if (block.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>
                  {renderInline(item)}
                  {end && j === block.items.length - 1 && <Caret />}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {renderInline(block.text)}
            {end && <Caret />}
          </p>
        );
      })}
      {blocks.length === 0 && caret && (
        <p>
          <Caret />
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The rail and its stations
// ---------------------------------------------------------------------------

/** Tools on: Copper and Patina Teal. Tools off: all Sonoran Sunset. */
type Tone = "on" | "off";

const NODE: Record<Tone, { menu: string; think: string; tool: string }> = {
  on: { menu: "bg-primary", think: "bg-primary", tool: "bg-accent" },
  off: { menu: "bg-chart-3", think: "bg-chart-3", tool: "bg-chart-3" },
};

function Rail({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={cn(
          "absolute top-3.5 bottom-0 left-3.5 w-0.5 -translate-x-1/2 rounded-full",
          tone === "on"
            ? "bg-linear-to-b from-primary via-accent to-accent"
            : "bg-chart-3",
        )}
      />
      <ol className="relative">{children}</ol>
    </div>
  );
}

/** A round node on the rail, ringed in the panel's colour so the rail passes behind it. */
function Node({
  className,
  children,
}: {
  className: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "text-primary-foreground ring-secondary absolute top-0 left-0 grid size-7 place-items-center rounded-full ring-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Station({
  node,
  label,
  children,
}: {
  node: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pb-5 pl-10 last:pb-0">
      {node}
      <p className="text-muted-foreground flex min-h-7 items-center text-[0.7rem] font-bold tracking-widest uppercase">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </li>
  );
}

/** Station 1: the menu of tools the model was handed. */
function ToolsStation({ tone, used }: { tone: Tone; used: Set<string> }) {
  const names = Object.keys(TOOL_LABELS);
  return (
    <Station
      node={
        <Node className={NODE[tone].menu}>
          <ListChecksIcon className="size-3.5" />
        </Node>
      }
      label={
        tone === "on" ? "Tools Copper can use" : "Tools given to Copper: none"
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {names.map((name) =>
          tone === "off" ? (
            <span
              key={name}
              className="text-muted-foreground bg-foreground/5 rounded-md px-2 py-0.5 font-mono text-xs line-through"
            >
              {name}
            </span>
          ) : (
            <span
              key={name}
              title={TOOL_LABELS[name]}
              className={cn(
                "rounded-md px-2 py-0.5 font-mono text-xs",
                used.has(name)
                  ? "bg-accent text-accent-foreground font-bold"
                  : "bg-foreground/5 text-muted-foreground ring-border ring-1",
              )}
            >
              {name}
            </span>
          ),
        )}
      </div>
      {tone === "off" && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Copper has to answer from memory alone.
        </p>
      )}
    </Station>
  );
}

/** Station 2: Gemini's own summary of what it is doing and why. */
function ThinkingStation({ tone, text }: { tone: Tone; text: string }) {
  return (
    <Station
      node={
        <Node className={NODE[tone].think}>
          <BrainIcon className="size-3.5" />
        </Node>
      }
      label="Copper is thinking"
    >
      <div
        data-testid="thinking"
        className="border-primary/50 text-muted-foreground border-l-2 pl-3 text-sm italic"
      >
        <Markdown text={text} />
      </div>
    </Station>
  );
}

/** Station 3: a tool call, drawn as an open card. */
function ToolStation({
  tone,
  step,
  number,
}: {
  tone: Tone;
  step: ToolStep;
  number: number;
}) {
  const label =
    step.state === "calling"
      ? "Copper is calling a tool"
      : step.state === "done"
        ? "Copper called a tool"
        : "Copper's tool call ran into a problem";
  return (
    <Station
      node={
        <Node className={NODE[tone].tool}>
          <WrenchIcon className="size-3.5" />
        </Node>
      }
      label={label}
    >
      <ToolCard step={step} number={number} />
    </Station>
  );
}

/** Station 4: what's happening right now. Only while Copper is working. */
function NowStation({ tone, text }: { tone: Tone; text: string }) {
  return (
    <li className="relative pl-10">
      <Node
        className={cn(
          "animate-pulse motion-reduce:animate-none",
          NODE[tone].think,
        )}
      >
        <span className="flex items-center gap-0.5">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="bg-primary-foreground size-1 animate-bounce rounded-full motion-reduce:animate-none"
              style={{ animationDelay: `${dot * 150}ms` }}
            />
          ))}
        </span>
      </Node>
      <p className="text-muted-foreground flex min-h-7 items-center text-sm">
        {text}
      </p>
    </li>
  );
}

function nowText(progress: Progress, useTools: boolean): string {
  if (progress.reply) return "Writing the answer…";
  if (!useTools) return "Answering from memory…";
  if (progress.steps.length > 0) return "Deciding what to do next…";
  return "Reading your question…";
}

// ---------------------------------------------------------------------------
// The reply
// ---------------------------------------------------------------------------

function ReplyBubble({
  reply,
  streaming,
  withoutTools,
}: {
  reply: string;
  streaming: boolean;
  withoutTools: boolean;
}) {
  return (
    <div className="bg-card ring-foreground/10 mt-3 ml-10 rounded-2xl rounded-tl-sm p-3.5 shadow-sm ring-1">
      <p className="text-primary mb-1 text-xs font-bold">Copper</p>
      {withoutTools && (
        <div className="border-chart-3 bg-chart-3/10 mb-2.5 rounded-lg border p-2.5">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <TriangleAlertIcon className="text-chart-3 size-4 shrink-0" />
            Answered without tools: may be made up
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            With tools off, Copper can&apos;t see today&apos;s prices or stock.
            The AI only has what it learned in training, so it fills the gaps
            with guesses that sound right. That&apos;s a hallucination.
          </p>
        </div>
      )}
      <Markdown text={reply} caret={streaming} className="text-sm" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One question and its answer
// ---------------------------------------------------------------------------

type Numbered = { step: Step; number: number };

/** Each step with its place among the tool calls (tool 1, tool 2...). */
function numbered(steps: Step[]): Numbered[] {
  return steps.map((step, i) => ({
    step,
    number: steps.slice(0, i + 1).filter((s) => s.type === "tool").length,
  }));
}

export function Turn({
  question,
  progress,
  useTools,
}: {
  question: string;
  progress: Progress;
  useTools: boolean;
}) {
  const tone: Tone = useTools ? "on" : "off";
  const working = progress.status === "working";
  const used = new Set(
    progress.steps.flatMap((step) => (step.type === "tool" ? [step.name] : [])),
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="bg-primary text-primary-foreground ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm break-words whitespace-pre-wrap">
        {question}
      </p>
      <div>
        <Rail tone={tone}>
          <ToolsStation tone={tone} used={used} />
          {numbered(progress.steps).map(({ step, number }, i) =>
            step.type === "thinking" ? (
              <ThinkingStation
                key={`thinking-${i}`}
                tone={tone}
                text={step.text}
              />
            ) : (
              <ToolStation
                key={step.id}
                tone={tone}
                step={step}
                number={number}
              />
            ),
          )}
          {working && (
            <NowStation tone={tone} text={nowText(progress, useTools)} />
          )}
        </Rail>
        {progress.reply && (
          <ReplyBubble
            reply={progress.reply}
            streaming={working}
            withoutTools={!useTools}
          />
        )}
      </div>
    </div>
  );
}
