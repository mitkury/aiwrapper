import { describe, expect, it } from "vitest";
import { ChatAgent } from "../../src/agents/ChatAgent.ts";
import { LanguageProvider } from "../../src/lang/language-provider.ts";
import {
  LangMessage,
  LangMessages,
  type LangMessageItem,
  type LangMessageRole,
  type LangOptions,
} from "../../src/lang/index.ts";

type ChatInput =
  | { role: LangMessageRole; items: LangMessageItem[] }[]
  | LangMessage[]
  | LangMessages;

class LoopingToolProvider extends LanguageProvider {
  calls = 0;

  constructor() {
    super("looping-tool-provider");
  }

  ask(prompt: string): Promise<LangMessages> {
    return this.chat(new LangMessages(prompt));
  }

  async chat(input: ChatInput): Promise<LangMessages> {
    this.calls++;
    const messages = input instanceof LangMessages
      ? input
      : new LangMessages(input);
    messages.addAssistantItems([{
      type: "tool",
      name: "loop",
      callId: `call-${this.calls}`,
      arguments: {},
    }]);
    await messages.executeRequestedTools();
    return messages;
  }
}

class DeferredProvider extends LanguageProvider {
  private finish!: () => void;
  private pending = new Promise<void>((resolve) => {
    this.finish = resolve;
  });

  constructor() {
    super("deferred-provider");
  }

  resolve(): void {
    this.finish();
  }

  ask(prompt: string, options?: LangOptions): Promise<LangMessages> {
    return this.chat(new LangMessages(prompt), options);
  }

  async chat(input: ChatInput): Promise<LangMessages> {
    const messages = input instanceof LangMessages
      ? input
      : new LangMessages(input);
    await this.pending;
    messages.addAssistantMessage("Done");
    return messages;
  }
}

describe("ChatAgent", () => {
  it("stops tool loops at the configured iteration limit", async () => {
    const provider = new LoopingToolProvider();
    const agent = new ChatAgent(provider, {
      maxIterations: 2,
      tools: [{
        name: "loop",
        description: "Continue the loop",
        parameters: { type: "object" },
        handler: () => "continue",
      }],
    });

    await expect(agent.run([
      new LangMessage("user", "Loop forever"),
    ])).rejects.toThrow("2-iteration limit");

    expect(provider.calls).toBe(2);
    expect(agent.state).toBe("idle");
  });

  it("rejects invalid iteration limits", () => {
    expect(() => new ChatAgent(undefined, { maxIterations: 0 }))
      .toThrow("positive integer");
  });

  it("does not allow concurrent runs to corrupt shared history", async () => {
    const provider = new DeferredProvider();
    const agent = new ChatAgent(provider);
    const firstRun = agent.run([new LangMessage("user", "First")]);

    await expect(agent.run([new LangMessage("user", "Second")]))
      .rejects.toThrow("already running");

    provider.resolve();
    const result = await firstRun;

    expect(result.answer).toBe("Done");
    expect(result.some(message => message.text === "Second")).toBe(false);
    expect(agent.state).toBe("idle");
  });
});
