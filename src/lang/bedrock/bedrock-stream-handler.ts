import type {
  ConverseStreamMetadataEvent,
  ConverseStreamOutput,
  MessageStopEvent,
} from "@aws-sdk/client-bedrock-runtime";
import {
  LangMessage,
  LangMessages,
} from "../messages.js";
import type {
  LangMessageItemReasoning,
  LangMessageItemText,
  LangMessageItemTool,
} from "../messages.js";

const STREAM_ERROR_KEYS = [
  "internalServerException",
  "modelStreamErrorException",
  "validationException",
  "throttlingException",
  "serviceUnavailableException",
] as const;

/**
 * Applies Bedrock's event-stream protocol to the provider-neutral transcript.
 * Tool input arrives as JSON string fragments, so it is buffered per content
 * block and parsed only when complete.
 */
export class BedrockStreamHandler {
  private currentAssistantMessage?: LangMessage;
  private messageStopped = false;
  private readonly textBlocks = new Map<number, LangMessageItemText>();
  private readonly reasoningBlocks = new Map<number, LangMessageItemReasoning>();
  private readonly toolBlocks = new Map<number, LangMessageItemTool>();
  private readonly toolArgumentBuffers = new Map<number, string>();

  constructor(
    private readonly messages: LangMessages,
    private readonly onResult?: (result: LangMessage) => void,
  ) {}

  handleEvent(event: ConverseStreamOutput): void {
    this.throwStreamException(event);

    let updated = false;
    if (event.messageStart) {
      this.startMessage(event.messageStart.role);
    } else if (event.contentBlockStart) {
      updated = this.handleBlockStart(
        requiredBlockIndex(
          event.contentBlockStart.contentBlockIndex,
          "contentBlockStart",
        ),
        event.contentBlockStart.start,
      );
    } else if (event.contentBlockDelta) {
      updated = this.handleBlockDelta(
        requiredBlockIndex(
          event.contentBlockDelta.contentBlockIndex,
          "contentBlockDelta",
        ),
        event.contentBlockDelta.delta,
      );
    } else if (event.contentBlockStop) {
      this.finalizeToolArguments(requiredBlockIndex(
        event.contentBlockStop.contentBlockIndex,
        "contentBlockStop",
      ));
    } else if (event.messageStop) {
      this.handleMessageStop(event.messageStop);
    } else if (event.metadata) {
      this.handleMetadata(event.metadata);
    }

    if (updated && this.currentAssistantMessage) {
      this.onResult?.(this.currentAssistantMessage);
    }
  }

  assertComplete(): void {
    if (!this.messageStopped) {
      throw new Error(
        "Bedrock ConverseStream ended before messageStop.",
      );
    }
  }

  private requireAssistantMessage(): LangMessage {
    if (!this.currentAssistantMessage) {
      throw new Error(
        "Bedrock ConverseStream sent content before messageStart.",
      );
    }
    return this.currentAssistantMessage;
  }

  private startMessage(role: string | undefined): void {
    if (role !== "assistant") {
      throw new Error(
        `Bedrock ConverseStream started an unexpected "${role ?? "missing"}" role.`,
      );
    }
    if (this.currentAssistantMessage) {
      throw new Error(
        "Bedrock ConverseStream sent more than one messageStart event.",
      );
    }
    this.currentAssistantMessage = new LangMessage("assistant", []);
    this.messages.push(this.currentAssistantMessage);
    this.textBlocks.clear();
    this.reasoningBlocks.clear();
    this.toolBlocks.clear();
    this.toolArgumentBuffers.clear();
  }

  private handleBlockStart(
    index: number,
    start: NonNullable<ConverseStreamOutput["contentBlockStart"]>["start"],
  ): boolean {
    if (!start) {
      throw new Error(
        "Bedrock ConverseStream sent contentBlockStart without start data.",
      );
    }
    if (start.image) {
      throw new Error(
        "Bedrock streamed image output is not supported by AIWrapper messages.",
      );
    }
    if (start.toolResult) {
      throw new Error(
        "Bedrock streamed tool-result output is not supported by AIWrapper messages.",
      );
    }
    if (!start.toolUse) {
      throw new Error(
        "Bedrock ConverseStream sent an unknown content block.",
      );
    }
    if (!start.toolUse.toolUseId) {
      throw new Error(
        "Bedrock ConverseStream started tool use without a toolUseId.",
      );
    }
    if (!start.toolUse.name) {
      throw new Error(
        "Bedrock ConverseStream started tool use without a name.",
      );
    }

    const item: LangMessageItemTool = {
      type: "tool",
      callId: start.toolUse.toolUseId,
      name: start.toolUse.name,
      arguments: {},
    };
    this.requireAssistantMessage().items.push(item);
    this.toolBlocks.set(index, item);
    this.toolArgumentBuffers.set(index, "");
    return true;
  }

  private handleBlockDelta(
    index: number,
    delta: NonNullable<ConverseStreamOutput["contentBlockDelta"]>["delta"],
  ): boolean {
    if (!delta) {
      throw new Error(
        "Bedrock ConverseStream sent contentBlockDelta without delta data.",
      );
    }
    const message = this.requireAssistantMessage();

    if (delta.image) {
      throw new Error(
        "Bedrock streamed image output is not supported by AIWrapper messages.",
      );
    }
    if (delta.toolResult) {
      throw new Error(
        "Bedrock streamed tool-result output is not supported by AIWrapper messages.",
      );
    }
    if (delta.citation) {
      throw new Error(
        "Bedrock streamed citations are not supported by AIWrapper messages.",
      );
    }

    if (typeof delta.text === "string" && delta.text.length > 0) {
      let item = this.textBlocks.get(index);
      if (!item) {
        item = { type: "text", text: "" };
        this.textBlocks.set(index, item);
        message.items.push(item);
      }
      item.text += delta.text;
      return true;
    }

    if (
      delta.reasoningContent &&
      "text" in delta.reasoningContent &&
      typeof delta.reasoningContent.text === "string" &&
      delta.reasoningContent.text.length > 0
    ) {
      let item = this.reasoningBlocks.get(index);
      if (!item) {
        item = { type: "reasoning", text: "" };
        this.reasoningBlocks.set(index, item);
        message.items.push(item);
      }
      item.text += delta.reasoningContent.text;
      return true;
    }

    if (delta.toolUse) {
      if (typeof delta.toolUse.input !== "string") {
        throw new Error(
          "Bedrock ConverseStream sent a tool-use delta without input.",
        );
      }
      const item = this.toolBlocks.get(index);
      if (!item) {
        throw new Error(
          "Bedrock ConverseStream sent tool arguments before starting the tool use.",
        );
      }

      const buffer = (this.toolArgumentBuffers.get(index) ?? "") + delta.toolUse.input;
      this.toolArgumentBuffers.set(index, buffer);
      this.tryParseToolArguments(buffer, item);
      return true;
    }

    if (delta.reasoningContent) {
      // Signatures and redacted reasoning cannot currently be represented by
      // LangMessageItemReasoning. Text deltas above remain available to callers.
      return false;
    }

    throw new Error(
      "Bedrock ConverseStream sent an unknown content-block delta.",
    );
  }

  private handleMessageStop(event: MessageStopEvent): void {
    if (this.messageStopped) {
      throw new Error(
        "Bedrock ConverseStream sent more than one messageStop event.",
      );
    }
    const message = this.requireAssistantMessage();
    for (const index of this.toolBlocks.keys()) {
      this.finalizeToolArguments(index);
    }
    this.messageStopped = true;
    message.meta = {
      ...(message.meta ?? {}),
      ...(event.stopReason
        ? { bedrockStopReason: event.stopReason }
        : {}),
      ...(event.additionalModelResponseFields
        ? {
            bedrockAdditionalModelResponseFields:
              event.additionalModelResponseFields,
          }
        : {}),
    };
  }

  private handleMetadata(event: ConverseStreamMetadataEvent): void {
    const message = this.requireAssistantMessage();
    message.meta = {
      ...(message.meta ?? {}),
      ...(event.usage ? { bedrockUsage: event.usage } : {}),
      ...(event.metrics ? { bedrockMetrics: event.metrics } : {}),
      ...(event.trace ? { bedrockTrace: event.trace } : {}),
      ...(event.performanceConfig
        ? { bedrockPerformanceConfig: event.performanceConfig }
        : {}),
      ...(event.serviceTier ? { bedrockServiceTier: event.serviceTier } : {}),
    };
  }

  private tryParseToolArguments(
    buffer: string,
    item: LangMessageItemTool,
  ): void {
    if (buffer.trim().length === 0) return;
    try {
      const parsed = JSON.parse(buffer);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        item.arguments = parsed as Record<string, unknown>;
      }
    } catch {
      // A delta commonly ends midway through JSON; the block stop validates it.
    }
  }

  private finalizeToolArguments(index: number): void {
    const item = this.toolBlocks.get(index);
    const buffer = this.toolArgumentBuffers.get(index);
    if (!item || buffer === undefined) return;

    if (buffer.trim().length === 0) {
      item.arguments = {};
      this.toolArgumentBuffers.delete(index);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer);
    } catch {
      throw new Error(
        `Bedrock returned invalid JSON arguments for tool "${item.name}".`,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `Bedrock returned non-object arguments for tool "${item.name}".`,
      );
    }

    item.arguments = parsed as Record<string, unknown>;
    this.toolArgumentBuffers.delete(index);
  }

  private throwStreamException(event: ConverseStreamOutput): void {
    for (const key of STREAM_ERROR_KEYS) {
      const exception = event[key];
      if (!exception) continue;
      const message = "message" in exception && exception.message
        ? exception.message
        : key;
      throw new Error(`Bedrock ConverseStream failed: ${message}`);
    }
  }
}

function requiredBlockIndex(
  index: number | undefined,
  eventName: string,
): number {
  if (!Number.isInteger(index) || (index ?? -1) < 0) {
    throw new Error(
      `Bedrock ConverseStream sent ${eventName} without a valid contentBlockIndex.`,
    );
  }
  return index as number;
}
