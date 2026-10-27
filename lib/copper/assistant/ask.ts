"use server";

// Module 2: the server action the Ask Copper chat calls. It streams the
// conversation to the model through callStream (lib/ai/call.ts), with or
// without the tools, and sends back each step as it happens, so the panel can
// show Copper thinking and using its tools. The contract is in
// specs/module-2/spec.md.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type {
  Progress,
  Step,
  ToolStep,
} from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const APOLOGY_EMPTY =
  "Sorry, I couldn't come up with an answer to that. Could you try asking again?";
const APOLOGY_ERROR =
  "Sorry, something went wrong on my end. Please try again in a moment.";

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();

  // Read the stream in the background. The panel gets `live` right away and
  // reads each update as it arrives, so nothing here is awaited before we
  // return. streamAnswer never throws: a failure becomes an "error" update.
  void streamAnswer(request, update, done);

  return { progress: live };
}

async function streamAnswer(
  request: AskCopperRequest,
  update: (progress: Progress) => void,
  done: (progress: Progress) => void,
) {
  const steps: Step[] = [];
  let reply = "";

  // A fresh copy every time (new array, new step objects), so an update the
  // panel is holding never changes underneath it.
  const snapshot = (status: Progress["status"]): Progress => ({
    steps: steps.map((step) => ({ ...step })),
    reply,
    status,
  });

  // One tool step per call: tool-input-start's `id` is the same value the
  // later tool-call, tool-result and tool-error parts call `toolCallId`.
  const toolStep = (id: string, name: string): ToolStep => {
    let step = steps.find(
      (s): s is ToolStep => s.type === "tool" && s.id === id,
    );
    if (!step) {
      step = { type: "tool", id, name, state: "calling" };
      steps.push(step);
    }
    return step;
  };

  let failed = false;
  try {
    const messages = request.messages.map(({ role, content }) => ({
      role,
      content,
    }));
    // Thought summaries go with both paths. Instructions and tools only go
    // with "Use tools": with it off, the model gets nothing but the chat.
    const result = request.useTools
      ? callStream(
          { module: 2, feature: "ask-copper" },
          {
            instructions: COPPER_INSTRUCTIONS,
            messages,
            tools: copperTools,
            stopWhen: stepCountIs(MAX_STEPS),
            providerOptions: THOUGHT_SUMMARIES,
          },
        )
      : callStream(
          { module: 2, feature: "ask-copper" },
          { messages, providerOptions: THOUGHT_SUMMARIES },
        );

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const last = steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else steps.push({ type: "thinking", text: part.text });
          update(snapshot("working"));
          break;
        }
        case "tool-input-start":
          toolStep(part.id, part.toolName);
          update(snapshot("working"));
          break;
        case "tool-call":
          toolStep(part.toolCallId, part.toolName).input = part.input;
          update(snapshot("working"));
          break;
        case "tool-result": {
          const step = toolStep(part.toolCallId, part.toolName);
          step.output = part.output;
          step.state = "done";
          update(snapshot("working"));
          break;
        }
        case "tool-error": {
          const step = toolStep(part.toolCallId, part.toolName);
          step.output =
            part.error instanceof Error ? part.error.message : String(part.error);
          step.state = "error";
          update(snapshot("working"));
          break;
        }
        case "text-delta":
          reply += part.text;
          update(snapshot("working"));
          break;
        case "error":
          // streamText reports a failed model call as a part, not a throw.
          failed = true;
          break;
      }
    }
  } catch {
    failed = true;
  }

  if (failed) {
    // Don't leave a tool spinning forever, and say sorry after any partial reply.
    for (const step of steps) {
      if (step.type === "tool" && step.state === "calling") step.state = "error";
    }
    reply = reply ? `${reply}\n\n${APOLOGY_ERROR}` : APOLOGY_ERROR;
    done(snapshot("error"));
    return;
  }

  // The stream ended normally but nothing was said: only replace an empty reply.
  if (!reply.trim()) reply = APOLOGY_EMPTY;
  done(snapshot("done"));
}
