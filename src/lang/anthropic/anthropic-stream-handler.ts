import {
  LangMessage,
  LangMessageItemReasoning,
  LangMessageItemText,
  LangMessageItemTool,
  LangMessages,
} from "../messages.ts";

/**
 * Handles streaming events from the Anthropic Messages API and keeps
 * LangMessages in sync with streamed content.
 */
export class AnthropicStreamHandler {
  private messages: LangMessages;
  private onResult?: (result: LangMessage) => void;
  private currentAssistantMessage?: LangMessage;

  private textBlocks = new Map<number, LangMessageItemText>();
  private reasoningBlocks = new Map<number, LangMessageItemReasoning>();
  private toolBlocks = new Map<number, LangMessageItemTool>();
  private toolArgBuffers = new Map<string, string>();

  constructor(messages: LangMessages, onResult?: (result: LangMessage) => void) {
    this.messages = messages;
    this.onResult = onResult;
  }

  setOnResult(onResult?: (result: LangMessage) => void) {
    this.onResult = onResult;
  }

  handleEvent(data: any) {
    if (!data) return;

    let updated = false;

    switch (data.type) {
      case "message_start":
        updated = this.handleMessageStart(data);
        break;
      case "content_block_start":
        updated = this.handleContentBlockStart(data);
        break;
      case "content_block_delta":
        updated = this.handleContentBlockDelta(data);
        break;
      case "content_block_stop":
        updated = false;
        break;
      case "message_delta":
        // Usage / metadata updates – ignore for transcript for now
        break;
      case "message_stop":
        updated = this.handleMessageStop();
        break;
      default:
        break;
    }

    if (updated && this.currentAssistantMessage) {
      this.onResult?.(this.currentAssistantMessage);
    }
  }

  private ensureAssistantMessage(): LangMessage {
    if (!this.currentAssistantMessage) {
      this.currentAssistantMessage = new LangMessage("assistant", []);
      this.messages.push(this.currentAssistantMessage);
    }
    return this.currentAssistantMessage;
  }

  private handleMessageStart(data: any): boolean {
    const message = this.ensureAssistantMessage();
    this.textBlocks.clear();
    this.reasoningBlocks.clear();
    this.toolBlocks.clear();
    this.toolArgBuffers.clear();
    if (data.message?.id) {
      message.meta = {
        ...(message.meta ?? {}),
        anthropicMessageId: data.message.id,
      };
    }
    return false;
  }

  private handleContentBlockStart(data: any): boolean {
    const block = data.content_block;
    if (!block) return false;
    const index = typeof data.index === "number" ? data.index : 0;
    const message = this.ensureAssistantMessage();

    switch (block.type) {
      case "text": {
        const textItem = this.getOrCreateTextItem(index, message);
        if (typeof block.text === "string" && block.text.length > 0) {
          textItem.text += block.text;
          return true;
        }
        return false;
      }
      case "thinking": {
        const reasoningItem = this.getOrCreateReasoningItem(index, message);
        if (typeof block.thinking === "string" && block.thinking.length > 0) {
          reasoningItem.text += block.thinking;
          return true;
        }
        return false;
      }
      case "tool_use": {
        const id = typeof block.id === "string" && block.id.length > 0
          ? block.id
          : `tool_${index}`;
        const name = typeof block.name === "string" ? block.name : "";
        const toolItem = this.createToolItem(index, id, name, message);

        if (block.input && typeof block.input === "object") {
          toolItem.arguments = block.input;
        } else if (typeof block.input === "string") {
          this.toolArgBuffers.set(id, block.input);
          this.tryParseToolArguments(id, toolItem);
        }

        return true;
      }
      default:
        return false;
    }
  }

  private handleContentBlockDelta(data: any): boolean {
    const delta = data.delta;
    if (!delta) return false;
    const index = typeof data.index === "number" ? data.index : 0;
    const message = this.ensureAssistantMessage();

    if (delta.type === "text_delta" || typeof delta.text === "string") {
      const text = delta.text ?? "";
      if (text.length === 0) return false;
      const textItem = this.getOrCreateTextItem(index, message);
      textItem.text += text;
      return true;
    }

    if (delta.type === "thinking_delta" || typeof delta.thinking === "string") {
      const thinking = delta.thinking ?? "";
      if (thinking.length === 0) return false;
      const reasoningItem = this.getOrCreateReasoningItem(index, message);
      reasoningItem.text += thinking;
      return true;
    }

    if (
      delta.type === "input_json_delta" ||
      delta.type === "tool_use_delta" ||
      typeof delta.partial_json === "string" ||
      typeof delta.input_json_delta === "object" ||
      typeof delta.text === "string"
    ) {
      return this.applyToolDelta(index, delta);
    }

    return false;
  }

  private handleMessageStop(): boolean {
    this.finalizeToolArguments();
    if (this.messages.length > 0) {
      this.messages.finished = true;
    }
    this.currentAssistantMessage = undefined;
    return true;
  }

  private getOrCreateTextItem(index: number, message: LangMessage): LangMessageItemText {
    let item = this.textBlocks.get(index);
    if (!item) {
      item = { type: "text", text: "" };
      message.items.push(item);
      this.textBlocks.set(index, item);
    }
    return item;
  }

  private getOrCreateReasoningItem(index: number, message: LangMessage): LangMessageItemReasoning {
    let item = this.reasoningBlocks.get(index);
    if (!item) {
      item = { type: "reasoning", text: "" };
      message.items.push(item);
      this.reasoningBlocks.set(index, item);
    }
    return item;
  }

  private createToolItem(index: number, id: string, name: string, message: LangMessage): LangMessageItemTool {
    const toolItem: LangMessageItemTool = {
      type: "tool",
      callId: id,
      name,
      arguments: {},
    };
    message.items.push(toolItem);
    this.toolBlocks.set(index, toolItem);
    if (!this.toolArgBuffers.has(id)) {
      this.toolArgBuffers.set(id, "");
    }
    return toolItem;
  }

  private applyToolDelta(index: number, delta: any): boolean {
    const toolItem = this.toolBlocks.get(index);
    if (!toolItem) return false;
    const callId = toolItem.callId;

    if (typeof delta.partial_json === "string") {
      const buffer = (this.toolArgBuffers.get(callId) ?? "") + delta.partial_json;
      this.toolArgBuffers.set(callId, buffer);
      this.tryParseToolArguments(callId, toolItem);
      return true;
    }

    if (typeof delta.text === "string") {
      const buffer = (this.toolArgBuffers.get(callId) ?? "") + delta.text;
      this.toolArgBuffers.set(callId, buffer);
      this.tryParseToolArguments(callId, toolItem);
      return true;
    }

    if (typeof delta.input_json_delta === "object" && delta.input_json_delta !== null) {
      const currentArgs = { ...(toolItem.arguments ?? {}) };
      Object.assign(currentArgs, delta.input_json_delta);
      toolItem.arguments = currentArgs;
      return true;
    }

    return false;
  }

  private tryParseToolArguments(callId: string, toolItem: LangMessageItemTool) {
    const buffer = this.toolArgBuffers.get(callId);
    if (!buffer || buffer.trim().length === 0) {
      return;
    }
    try {
      toolItem.arguments = JSON.parse(buffer);
    } catch {
      // Ignore until JSON complete
    }
  }

  private finalizeToolArguments() {
    for (const [callId, buffer] of this.toolArgBuffers.entries()) {
      const toolItem = Array.from(this.toolBlocks.values()).find(item => item.callId === callId);
      if (!toolItem) continue;
      if (!buffer || buffer.trim().length === 0) {
        continue;
      }
      try {
        toolItem.arguments = JSON.parse(buffer);
      } catch {
        toolItem.arguments = {};
      }
    }
    this.toolArgBuffers.clear();
  }
}
