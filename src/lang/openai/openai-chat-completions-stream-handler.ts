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
  newMessage: LangMessage;
  messages: LangMessages;
  onResult?: (result: LangMessage) => void;
  toolCallItems = new Map<string, LangMessageItemTool>();
  toolArgBuffers = new Map<string, string>();
  reasoningSummaryIndex = new Map<string, number>();
  toolCallIndexToId = new Map<number, string>();

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
      if (this.newMessage) {
        this.onResult?.(this.newMessage);
      }
      return;
    }

    if (!Array.isArray(data.choices) || data.choices.length === 0) {
      return;
    }

    const choice = data.choices[0];
    const delta = choice?.delta ?? {};

    // Ensure assistant message exists when we see role or any content
    if (delta.role === "assistant" && !this.newMessage) {
      this.handleNewMessage();
    }

    // Handle different types of deltas
    if (delta.content !== undefined) {
      this.applyContentDelta(delta.content);
    }

    if (delta.reasoning !== undefined || delta.reasoning_details !== undefined) {
      this.applyReasoningDelta(delta.reasoning, delta.reasoning_details);
    }

    if (delta.reasoning_content !== undefined) {
      this.applyReasoningContentDelta(delta.reasoning_content);
    }

    if (delta.tool_calls) {
      this.applyToolCallsDelta(delta.tool_calls);
    }

    if (this.newMessage) {
      this.onResult?.(this.newMessage);
    }
  }

  handleNewMessage() {
    this.newMessage = new LangMessage("assistant", []);
    this.messages.push(this.newMessage);
  }

  private getOrCreateTextItem(): LangMessageItemText {
    if (!this.newMessage) {
      this.handleNewMessage();
    }
    const lastItem = this.newMessage.items[this.newMessage.items.length - 1];
    if (lastItem && lastItem.type === "text") {
      return lastItem as LangMessageItemText;
    }
    const textItem: LangMessageItemText = { type: "text", text: "" };
    this.newMessage.items.push(textItem);
    return textItem;
  }

  private getOrCreateReasoningItem(): LangMessageItemReasoning {
    if (!this.newMessage) {
      this.handleNewMessage();
    }
    const lastItem = this.newMessage.items[this.newMessage.items.length - 1];
    if (lastItem && lastItem.type === "reasoning") {
      return lastItem as LangMessageItemReasoning;
    }
    const reasoningItem: LangMessageItemReasoning = { type: "reasoning", text: "" };
    this.newMessage.items.push(reasoningItem);
    return reasoningItem;
  }

  applyContentDelta(contentDelta: any) {
    if (typeof contentDelta === "string") {
      this.applyTextDelta(contentDelta);
      return;
    }

    if (!Array.isArray(contentDelta)) {
      return;
    }

    for (const part of contentDelta) {
      if (!part) continue;
      if (part.type === "text" && typeof part.text === "string") {
        this.applyTextDelta(part.text);
      } else if (part.type === "reasoning" && typeof part.text === "string") {
        this.applyReasoningTextDelta(part.text);
      } else if (part.type === "image_url" && part.image_url?.url) {
        this.applyImageFromUrl(part.image_url.url);
      } else if ((part.type === "output_image" || part.type === "inline_data") && (part.b64_json || part.data)) {
        const base64 = part.b64_json || part.data;
        const mimeType = part.mime_type || part.mimeType || "image/png";
        this.applyImageFromBase64(base64, mimeType);
      }
    }
  }

  applyTextDelta(delta: string) {
    if (typeof delta !== "string" || delta.length === 0) {
      return;
    }
    const textItem = this.getOrCreateTextItem();
    textItem.text += delta;
  }

  applyReasoningDelta(reasoningDelta?: string, reasoningDetails?: any[]) {
    // The reasoning field is the incremental delta text to append
    // The reasoning_details array provides metadata (like index for tracking summary changes)
    
    let deltaToAppend: string | undefined = reasoningDelta;
    
    // Track summary index changes from reasoning_details
    if (Array.isArray(reasoningDetails) && reasoningDetails.length > 0) {
      for (const detail of reasoningDetails) {
        if (!detail) continue;
        
        // Track summary index similar to responses handler
        const summaryIndex = typeof detail.index === "number" ? detail.index : 0;
        const previousIndex = this.reasoningSummaryIndex.get("reasoning") ?? -1;
        
        if (previousIndex !== -1 && summaryIndex > previousIndex) {
          // Index increased, add separator before appending the delta
          const reasoningItem = this.getOrCreateReasoningItem();
          reasoningItem.text += "\n\n";
        }
        this.reasoningSummaryIndex.set("reasoning", summaryIndex);

        // Fallback: if reasoning delta is missing but summary exists, use summary
        if (!deltaToAppend && typeof detail.summary === "string" && detail.summary.length > 0) {
          deltaToAppend = detail.summary;
        }
      }
    }

    // Append the reasoning delta text (this is the actual incremental text)
    if (typeof deltaToAppend === "string" && deltaToAppend.length > 0) {
      this.applyReasoningTextDelta(deltaToAppend);
    }
  }

  applyReasoningContentDelta(reasoningContentDelta: any) {
    if (typeof reasoningContentDelta === "string") {
      this.applyReasoningTextDelta(reasoningContentDelta);
      return;
    }

    if (!Array.isArray(reasoningContentDelta)) {
      return;
    }

    for (const part of reasoningContentDelta) {
      if (!part) continue;
      if (typeof part === "string") {
        this.applyReasoningTextDelta(part);
      } else if (typeof part.text === "string") {
        this.applyReasoningTextDelta(part.text);
      }
    }
  }

  applyReasoningTextDelta(delta: string) {
    if (typeof delta !== "string" || delta.length === 0) {
      return;
    }
    const reasoningItem = this.getOrCreateReasoningItem();
    reasoningItem.text += delta;
  }

  applyImageFromUrl(url: string) {
    if (typeof url !== "string" || url.length === 0) {
      return;
    }
    if (!this.newMessage) {
      this.handleNewMessage();
    }
    const imageItem: LangMessageItemImage = { type: "image", url };
    this.newMessage.items.push(imageItem);
  }

  applyImageFromBase64(base64: string, mimeType?: string) {
    if (typeof base64 !== "string" || base64.length === 0) {
      return;
    }
    if (!this.newMessage) {
      this.handleNewMessage();
    }
    const imageItem: LangMessageItemImage = {
      type: "image",
      base64,
      mimeType: mimeType || "image/png",
    };
    this.newMessage.items.push(imageItem);
  }

  applyToolCallsDelta(toolCalls: any[]) {
    for (const tc of toolCalls) {
      if (!tc) continue;

      // Determine the tool call ID
      // If we have an explicit id, use it and map it to the index
      // If we only have an index, look up the id from our mapping
      let id: string | undefined;
      const index = typeof tc.index === "number" ? tc.index : undefined;

      if (typeof tc.id === "string" && tc.id.length > 0) {
        id = tc.id;
        // Map index to id for future chunks that only have index
        if (index !== undefined) {
          this.toolCallIndexToId.set(index, id);
        }
      } else if (index !== undefined) {
        // Look up the id from our mapping
        id = this.toolCallIndexToId.get(index);
        if (!id) {
          // Fallback: create a new id if we haven't seen this index before
          id = `tool_call_${index}`;
          this.toolCallIndexToId.set(index, id);
        }
      } else {
        // No id and no index - create a new one
        id = `tool_call_${this.toolCallItems.size}`;
      }

      const toolItem = this.getOrCreateToolItem(id);
      const func = tc.function ?? {};

      if (typeof func.name === "string" && func.name.length > 0) {
        toolItem.name = func.name;
      }

      if (typeof func.arguments === "string") {
        this.applyToolArgsDelta(id, func.arguments);
      }
    }
  }

  applyToolArgsDelta(toolCallId: string, delta: string) {
    const existing = this.toolArgBuffers.get(toolCallId) ?? "";
    const updated = existing + delta;
    this.toolArgBuffers.set(toolCallId, updated);

    const toolItem = this.toolCallItems.get(toolCallId);
    if (!toolItem) return;

    try {
      toolItem.arguments = JSON.parse(updated);
    } catch {
      // Ignore parse errors while JSON is incomplete
    }
  }

  private getOrCreateToolItem(id: string): LangMessageItemTool {
    let toolItem = this.toolCallItems.get(id);
    if (!toolItem) {
      if (!this.newMessage) {
        this.handleNewMessage();
      }
      toolItem = {
        type: "tool",
        callId: id,
        name: "",
        arguments: {},
      };
      this.newMessage.items.push(toolItem);
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
