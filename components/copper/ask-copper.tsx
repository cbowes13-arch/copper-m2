"use client";

// Ask Copper: the floating chat panel. A launcher button (bottom-right) opens a
// side sheet where shoppers ask about prices, totals and stock. The panel draws
// every step of each answer (see ask-copper-stations.tsx), and keeps two
// separate conversations: one with Copper's tools, one without.
import { ArrowUpIcon, MessageCircleIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Turn } from "@/components/copper/ask-copper-stations";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import type { Progress } from "@/lib/copper/assistant/progress";

/** The three questions offered in an empty chat and after every answer. */
const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

const SORRY = "Sorry, I couldn't answer that just now. Please try again.";

type ChatKey = "on" | "off";

type TurnState = { id: number; question: string; progress: Progress };

/** Tools on and tools off are separate chats, so the comparison is honest. */
type Chats = Record<ChatKey, TurnState[]>;

/** The conversation as the model sees it: finished questions and replies only. */
function historyOf(turns: TurnState[]): ChatMessage[] {
  return turns.flatMap(({ question, progress }): ChatMessage[] =>
    progress.status === "done" && progress.reply
      ? [
          { role: "user", content: question },
          { role: "assistant", content: progress.reply },
        ]
      : [],
  );
}

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Chats>({ on: [], off: [] });
  const [input, setInput] = useState("");
  const nextId = useRef(0);

  const key: ChatKey = useTools ? "on" : "off";
  const turns = chats[key];
  const busy = turns.at(-1)?.progress.status === "working";

  // The header's "Ask Copper" link (#ask), and loading the site at /#ask. A
  // link whose address already ends in #ask fires no hashchange, so the click
  // is heard too, or the link would only work once.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a");
      if (link?.getAttribute("href")?.endsWith("#ask")) setOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Closing clears #ask, so a reload doesn't pop the panel open again.
    if (!next && window.location.hash === "#ask") {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", pathname + search);
    }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const chat = key;
    const messages: ChatMessage[] = [
      ...historyOf(chats[chat]),
      { role: "user", content: question },
    ];
    nextId.current += 1;
    const id = nextId.current;
    const show = (progress: Progress) =>
      setChats((all) => ({
        ...all,
        [chat]: all[chat].map((turn) =>
          turn.id === id ? { ...turn, progress } : turn,
        ),
      }));

    setChats((all) => ({
      ...all,
      [chat]: [
        ...all[chat],
        { id, question, progress: { steps: [], reply: "", status: "working" } },
      ],
    }));
    setInput("");

    // Every update carries everything so far, so just redraw with each one.
    let last: Progress | undefined;
    try {
      const { progress } = await askCopper({
        messages,
        useTools: chat === "on",
      });
      for await (const update of readLive(progress)) {
        last = update;
        show(update);
      }
      if (!last) show({ steps: [], reply: SORRY, status: "error" });
      else if (last.status === "working") show({ ...last, status: "done" });
    } catch {
      show({
        steps: last?.steps ?? [],
        reply: last?.reply || SORRY,
        status: "error",
      });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          data-testid="ask-copper-launcher"
          className="fixed right-4 bottom-4 z-40 h-12 gap-2 rounded-full px-5 text-base font-semibold shadow-lg"
        >
          <MessageCircleIcon className="size-5" />
          Ask Copper
        </Button>
      </SheetTrigger>
      <SheetContent
        data-testid="ask-copper"
        side="right"
        showCloseButton={false}
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <PanelHeader
          aiConfigured={aiConfigured}
          useTools={useTools}
          onUseTools={setUseTools}
        />
        {aiConfigured ? (
          <>
            <ChatBody
              turns={turns}
              useTools={useTools}
              busy={busy}
              onAsk={send}
            />
            <form
              className="bg-card shrink-0 border-t p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void send(input);
              }}
            >
              <div className="flex items-end gap-2">
                <Textarea
                  aria-label="Your question"
                  placeholder="Ask about prices, totals or stock"
                  rows={1}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send(input);
                    }
                  }}
                  className="bg-secondary/60 max-h-32 min-h-10 resize-none rounded-2xl px-3.5 py-2"
                />
                <Button
                  type="submit"
                  size="icon-lg"
                  aria-label="Send"
                  disabled={busy || input.trim() === ""}
                  className="size-10 shrink-0 rounded-full"
                >
                  <ArrowUpIcon className="size-5" />
                </Button>
              </div>
            </form>
          </>
        ) : (
          <div className="bg-secondary min-h-0 flex-1 overflow-y-auto p-4">
            <SetupRequired service="ai" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default AskCopper;

/** Night Sky header: mascot, title, the "Use tools" strip and the close button. */
function PanelHeader({
  aiConfigured,
  useTools,
  onUseTools,
}: {
  aiConfigured: boolean;
  useTools: boolean;
  onUseTools: (value: boolean) => void;
}) {
  return (
    // `dark` makes this Night Sky (with Desert Sand text) in light and dark mode.
    <div className="dark bg-background text-foreground shrink-0">
      <SheetHeader className="flex-row items-center gap-3 p-4">
        <span className="bg-primary relative size-11 shrink-0 overflow-hidden rounded-full">
          <Image
            src="/assets/brand/copper-mascot.png"
            alt=""
            width={1254}
            height={1254}
            sizes="96px"
            className="absolute top-px -left-7 h-auto w-24 max-w-none"
          />
        </span>
        <div className="min-w-0 flex-1">
          <SheetTitle className="font-heading text-foreground text-lg font-bold">
            Ask Copper
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-xs">
            Prices, totals and stock, checked with tools.
          </SheetDescription>
        </div>
        <SheetClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-foreground hover:bg-foreground/10 hover:text-foreground shrink-0"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        </SheetClose>
      </SheetHeader>
      {aiConfigured && (
        <div className="bg-foreground/5 flex items-center gap-3 px-4 py-2.5">
          <Label
            htmlFor="ask-copper-use-tools"
            className="text-sm font-semibold"
          >
            Use tools
          </Label>
          <span className="text-muted-foreground text-xs">
            {useTools ? "Checks every answer" : "Model guesses alone"}
          </span>
          <Switch
            id="ask-copper-use-tools"
            aria-label="Use tools"
            checked={useTools}
            onCheckedChange={onUseTools}
            className="ml-auto"
          />
        </div>
      )}
    </div>
  );
}

/** The scrolling Desert Sand body: the conversation, then the starter questions. */
function ChatBody({
  turns,
  useTools,
  busy,
  onAsk,
}: {
  turns: TurnState[];
  useTools: boolean;
  busy: boolean;
  onAsk: (question: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  // A new question (or the other chat) jumps to the bottom, and the panel then
  // stays at the bottom as steps arrive, unless the shopper scrolls up to read.
  useEffect(() => {
    following.current = true;
  }, [turns.length, useTools]);
  useEffect(() => {
    const element = body.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  });

  return (
    <div
      ref={body}
      role="log"
      aria-label="Conversation"
      aria-busy={busy}
      onScroll={(event) => {
        const el = event.currentTarget;
        following.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="bg-secondary min-h-0 flex-1 overflow-y-auto p-4"
    >
      <div className="flex flex-col gap-6">
        {turns.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {useTools
              ? "Hi, I'm Copper. Ask me what our devices cost, what a plan adds up to, or whether a color is in stock."
              : "Tools are off, so Copper has to answer from memory alone. Ask the same question in both chats and compare."}
          </p>
        )}
        {turns.map((turn) => (
          <Turn
            key={turn.id}
            question={turn.question}
            progress={turn.progress}
            useTools={useTools}
          />
        ))}
        {!busy && (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs font-bold tracking-widest uppercase">
              Try asking
            </p>
            {STARTERS.map((starter) => (
              <Button
                key={starter}
                type="button"
                variant="outline"
                onClick={() => onAsk(starter)}
                className="h-auto justify-start rounded-xl px-3 py-2 text-left whitespace-normal"
              >
                {starter}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
