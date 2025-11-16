import {
  LangMessage,
  LangMessageItemImage,
  LangMessageItemReasoning,
  LangMessageItemText,
  LangMessageItemTool,
  LangMessages,
} from "../messages.ts";

/**
 * Handles streaming deltas from OpenAI-compatible chat completions APIs
 * and keeps the LangMessages collection in sync with streamed content.
 */
export class OpenAIChatCompletionsStreamHandler {
  private messages: LangMessages;
  private onResult?: (result: LangMessage) => void;
  private currentAssistantMessage?: LangMessage;
  private toolCallItems = new Map<string, LangMessageItemTool>();
  private toolArgBuffers = new Map<string, string>();

  constructor(messages: LangMessages, onResult?: (result: LangMessage) => void) {
    this.messages = messages;
    this.onResult = onResult;
  }

  setOnResult(onResult?: (result: LangMessage) => void) {
    this.onResult = onResult;
  }

  handleEvent(data: any) {
    if (data == null) {
      return;
    }

    if (data.finished) {
      this.finalizeToolArguments();
      if (this.currentAssistantMessage) {
        this.onResult?.(this.currentAssistantMessage);
      }
      return;
    }

    if (!Array.isArray(data.choices) || data.choices.length === 0) {
      return;
    }

    const choice = data.choices[0];
    const delta = choice?.delta ?? {};

    if (delta.role === "assistant" && !this.currentAssistantMessage) {
      this.ensureAssistantMessage();
    }

    if (delta.content !== undefined) {
      this.handleContentDelta(delta.content);
    }

    if (delta.reasoning_content !== undefined) {
      this.handleReasoningDelta(delta.reasoning_content);
    }

    if (delta.tool_calls) {
      this.handleToolCalls(delta.tool_calls);
    }

    if (delta.function_call) {
      this.handleFunctionCall(delta.function_call);
    }

    if (this.currentAssistantMessage) {
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

  private getOrCreateTextItem(): LangMessageItemText {
    const message = this.ensureAssistantMessage();
    const lastItem = message.items[message.items.length - 1];
    if (lastItem && lastItem.type === "text") {
      return lastItem as LangMessageItemText;
    }
    const textItem: LangMessageItemText = { type: "text", text: "" };
    message.items.push(textItem);
    return textItem;
  }

  private getOrCreateReasoningItem(): LangMessageItemReasoning {
    const message = this.ensureAssistantMessage();
    const lastItem = message.items[message.items.length - 1];
    if (lastItem && lastItem.type === "reasoning") {
      return lastItem as LangMessageItemReasoning;
    }
    const reasoningItem: LangMessageItemReasoning = { type: "reasoning", text: "" };
    message.items.push(reasoningItem);
    return reasoningItem;
  }

  private appendText(delta: string) {
    if (typeof delta !== "string" || delta.length === 0) {
      return;
    }
    const textItem = this.getOrCreateTextItem();
    textItem.text += delta;
  }

  private appendReasoning(delta: string) {
    if (typeof delta !== "string" || delta.length === 0) {
      return;
    }
    const reasoningItem = this.getOrCreateReasoningItem();
    reasoningItem.text += delta;
  }

  private appendImageFromUrl(url: string) {
    if (typeof url !== "string" || url.length === 0) {
      return;
    }
    const message = this.ensureAssistantMessage();
    const imageItem: LangMessageItemImage = { type: "image", url };
    message.items.push(imageItem);
  }

  private appendImageFromBase64(base64: string, mimeType?: string) {
    if (typeof base64 !== "string" || base64.length === 0) {
      return;
    }
    const message = this.ensureAssistantMessage();
    const imageItem: LangMessageItemImage = {
      type: "image",
      base64,
      mimeType: mimeType || "image/png",
    };
    message.items.push(imageItem);
  }

  private handleContentDelta(contentDelta: any) {
    if (typeof contentDelta === "string") {
      this.appendText(contentDelta);
      return;
    }

    if (!Array.isArray(contentDelta)) {
      return;
    }

    for (const part of contentDelta) {
      if (!part) continue;
      if (part.type === "text" && typeof part.text === "string") {
        this.appendText(part.text);
      } else if (part.type === "reasoning" && typeof part.text === "string") {
        this.appendReasoning(part.text);
      } else if (part.type === "image_url" && part.image_url?.url) {
        this.appendImageFromUrl(part.image_url.url);
      } else if ((part.type === "output_image" || part.type === "inline_data") && (part.b64_json || part.data)) {
        const base64 = part.b64_json || part.data;
        const mimeType = part.mime_type || part.mimeType || "image/png";
        this.appendImageFromBase64(base64, mimeType);
      }
    }
  }

  private handleReasoningDelta(reasoningDelta: any) {
    if (typeof reasoningDelta === "string") {
      this.appendReasoning(reasoningDelta);
      return;
    }

    if (!Array.isArray(reasoningDelta)) {
      return;
    }

    for (const part of reasoningDelta) {
      if (!part) continue;
      if (typeof part === "string") {
        this.appendReasoning(part);
      } else if (typeof part.text === "string") {
        this.appendReasoning(part.text);
      }
    }
  }

  private handleToolCalls(toolCalls: any[]) {
    for (const tc of toolCalls) {
      if (!tc) continue;
      const id: string =
        typeof tc.id === "string"
          ? tc.id
          : tc.index !== undefined
            ? String(tc.index)
            : `tool_call_${this.toolCallItems.size}`;
      const toolItem = this.getOrCreateToolItem(id);

      const func = tc.function ?? {};
      if (typeof func.name === "string" && func.name.length > 0) {
        toolItem.name = func.name;
      }

      if (typeof func.arguments === "string") {
        const existing = this.toolArgBuffers.get(id) ?? "";
        const updated = existing + func.arguments;
        this.toolArgBuffers.set(id, updated);

        try {
          toolItem.arguments = JSON.parse(updated);
        } catch {
          // Ignore parse errors while JSON is incomplete
        }
      }

      this.onResult?.(this.ensureAssistantMessage());
    }
  }

  private handleFunctionCall(functionCall: any) {
    const id = "function_call";
    const toolItem = this.getOrCreateToolItem(id);

    if (typeof functionCall.name === "string") {
      toolItem.name = functionCall.name;
    }

    if (typeof functionCall.arguments === "string") {
      const existing = this.toolArgBuffers.get(id) ?? "";
      const updated = existing + functionCall.arguments;
      this.toolArgBuffers.set(id, updated);
      try {
        toolItem.arguments = JSON.parse(updated);
      } catch {
        // Ignore until JSON complete
      }
    }
  }

  private getOrCreateToolItem(id: string): LangMessageItemTool {
    let toolItem = this.toolCallItems.get(id);
    if (!toolItem) {
      const message = this.ensureAssistantMessage();
      toolItem = {
        type: "tool",
        callId: id,
        name: "",
        arguments: {},
      };
      message.items.push(toolItem);
      this.toolCallItems.set(id, toolItem);
    }
    return toolItem;
  }

  private finalizeToolArguments() {
    for (const [id, buffer] of this.toolArgBuffers.entries()) {
      const toolItem = this.toolCallItems.get(id);
      if (!toolItem) continue;
      if (!buffer) {
        toolItem.arguments = {};
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
