import { LangMessage, LangMessageItem, LangMessageItemText, LangMessageItemThinking, LangMessageItemTool, LangMessages } from "../../messages";

type ItemState = {
  message: LangMessage;
  item: LangMessageItem;
};

const enum ResponseEventType {
  ResponseCreated = "response.created",
  OutputItemAdded = "response.output_item.added",
  OutputItemDone = "response.output_item.done",
  OutputTextDelta = "response.output_text.delta",
  OutputTextDone = "response.output_text.done",
  FunctionArgumentsDelta = "response.function_call_arguments.delta",
  FunctionArgumentsDone = "response.function_call_arguments.done",
  ImageGenerationCompleted = "response.image_generation_call.completed",
  ImageCompleted = "image_generation.completed",
  ReasoningTextDelta = "response.reasoning_text.delta",
}

const IMAGE_MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Stream response handler for the OpenAI Responses API.
 * Collapses streaming events into a single assistant LangMessage that contains items
 * for text, reasoning, tool calls, and images.
 */
export class OpenAIResponseStreamHandler {
  private responseId?: string;
  private readonly messages: LangMessages;
  private readonly onResult?: (result: LangMessage) => void;
  private readonly itemState: Map<string, ItemState>;
  private readonly toolArgumentBuffers: Map<string, string>;
  private readonly pendingImageMessages: Map<string, LangMessage>;

  constructor(messages: LangMessages, onResult?: (result: LangMessage) => void) {
    this.messages = messages;
    this.onResult = onResult;
    this.itemState = new Map();
    this.toolArgumentBuffers = new Map();
    this.pendingImageMessages = new Map();
  }

  handleEvent(data: any) {
    if (!data || typeof data.type !== "string") {
      console.warn("Unknown data from server:", data);
      return;
    }

    switch (data.type as ResponseEventType) {
      case ResponseEventType.ResponseCreated:
        this.responseId = data.response?.id ?? data.id;
        break;

      case ResponseEventType.OutputItemAdded:
        this.handleOutputItemAdded(data.item);
        break;

      case ResponseEventType.OutputItemDone:
        this.handleOutputItemDone(data.item);
        break;

      case ResponseEventType.OutputTextDelta:
        this.applyTextDelta(data.item_id, data.delta);
        break;

      case ResponseEventType.OutputTextDone:
        this.applyOutputTextDone(data.item_id, data.text ?? data.output_text);
        break;

      case ResponseEventType.FunctionArgumentsDelta:
        this.applyFunctionArgumentsDelta(data.item_id, data.delta);
        break;

      case ResponseEventType.FunctionArgumentsDone:
        this.setFunctionArguments(data.item_id, data.arguments);
        break;

      case ResponseEventType.ImageGenerationCompleted:
      case ResponseEventType.ImageCompleted:
        this.handleImageCompleted(data);
        break;

      case ResponseEventType.ReasoningTextDelta:
        this.applyReasoningDelta(data.item_id, data.delta);
        break;

      default:
        break;
    }
  }

  private ensureAssistantMessage(): LangMessage {
    const meta = this.responseId ? { openaiResponseId: this.responseId } : undefined;
    if (this.messages.length > 0) {
      const last = this.messages[this.messages.length - 1];
      if (last.role === "assistant") {
        if (meta) {
          last.meta = { ...(last.meta || {}), ...meta };
        }
        return last;
      }
    }
    const message = new LangMessage("assistant", [], meta);
    this.messages.push(message);
    return message;
  }

  private handleOutputItemAdded(item: any) {
    if (!item || typeof item.type !== "string") return;
    const message = this.ensureAssistantMessage();

    switch (item.type) {
      case "message": {
        const text = typeof item.text === "string" ? item.text : this.extractTextFromMessageItem(item);
        const textItem = this.createOrGetItem<LangMessageItemText>(item.id, message, { type: "text", text: "" });

        if (typeof text === "string" && text.length > 0) {
          textItem.text = text;
          this.emit(message);
        }
        break;
      }

      case "reasoning": {
        const text = typeof item.text === "string" ? item.text : "";
        const thinkingItem = this.createOrGetItem<LangMessageItemThinking>(item.id, message, { type: "thinking", text: "" });
        if (typeof text === "string" && text.length > 0) {
          thinkingItem.text = text;
          this.emit(message);
        }
        break;
      }

      case "function_call": {
        const callId = this.getCallId(item);
        const name = typeof item.name === "string" ? item.name : item.function?.name ?? "";
        const args = this.parseArgs(item.arguments);

        const toolItem = message.upsertToolCall({ callId, name, arguments: args });
        this.itemState.set(item.id, { message, item: toolItem });

        if (typeof item.arguments === "string") {
          this.toolArgumentBuffers.set(item.id, item.arguments);
        }

        this.emit(message);
        break;
      }

      case "image_generation_call": {
        this.pendingImageMessages.set(item.id, message);
        if (!message.meta) message.meta = {};
        message.meta.openaiResponseId = this.responseId;
        message.meta.imageGeneration = {
          size: item.size,
          format: item.output_format ?? item.format,
          background: item.background,
          quality: item.quality,
          revisedPrompt: item.revised_prompt ?? item.prompt,
        };
        break;
      }

      default:
        break;
    }
  }

  private handleOutputItemDone(item: any) {
    if (!item || typeof item.type !== "string" || typeof item.id !== "string") return;
    const state = this.itemState.get(item.id);
    if (!state) {
      // If we never saw the item, attempt to convert once fully available.
      if (item.type === "message") {
        const message = this.ensureAssistantMessage();
        const text = this.extractTextFromMessageItem(item);
        const textItem = this.createOrGetItem<LangMessageItemText>(item.id, message, { type: "text", text: "" });
        textItem.text = text ?? textItem.text;
        this.emit(message);
      } else if (item.type === "reasoning") {
        const message = this.ensureAssistantMessage();
        const text = typeof item.text === "string" ? item.text : "";
        const thinkingItem = this.createOrGetItem<LangMessageItemThinking>(item.id, message, { type: "thinking", text: "" });
        thinkingItem.text = text;
        this.emit(message);
      } else if (item.type === "function_call") {
        const message = this.ensureAssistantMessage();
        const callId = this.getCallId(item);
        const name = typeof item.name === "string" ? item.name : "";
        const args = this.parseArgs(item.arguments);
        const toolItem = message.upsertToolCall({ callId, name, arguments: args });
        this.itemState.set(item.id, { message, item: toolItem });
        this.emit(message);
      }
      return;
    }

    if (item.type === "message" && state.item.type === "text") {
      const text = this.extractTextFromMessageItem(item);
      if (typeof text === "string" && text.length > 0) {
        state.item.text = text;
        this.emit(state.message);
      }
    }

    if (item.type === "reasoning" && state.item.type === "thinking") {
      if (typeof item.text === "string" && item.text.length > 0) {
        state.item.text = item.text;
        this.emit(state.message);
      }
    }

    if (item.type === "function_call" && state.item.type === "tool") {
      const args = this.parseArgs(item.arguments);
      if (args) {
        state.item.arguments = args;
        this.emit(state.message);
      }
    }
  }

  private applyTextDelta(itemId: string, delta: unknown) {
    if (typeof itemId !== "string" || typeof delta !== "string") return;
    const state = this.itemState.get(itemId);
    const message = state?.message ?? this.ensureAssistantMessage();

    if (state) {
      if (state.item.type === "text") {
        state.item.text += delta;
        this.emit(message);
        return;
      }
      if (state.item.type === "thinking") {
        state.item.text += delta;
        this.emit(message);
        return;
      }
    }

    const textItem = this.createOrGetItem<LangMessageItemText>(itemId, message, { type: "text", text: "" });
    textItem.text += delta;

    this.emit(message);
  }

  private applyOutputTextDone(itemId: string, finalText: unknown) {
    if (typeof itemId !== "string" || typeof finalText !== "string") return;
    const state = this.itemState.get(itemId);
    const message = state?.message ?? this.ensureAssistantMessage();

    if (state && state.item.type === "text") {
      state.item.text = finalText;
    } else {
      const textItem = this.createOrGetItem<LangMessageItemText>(itemId, message, { type: "text", text: "" });
      textItem.text = finalText;
    }

    this.emit(message);
  }

  private applyReasoningDelta(itemId: string, delta: unknown) {
    if (typeof itemId !== "string" || typeof delta !== "string") return;
    const state = this.itemState.get(itemId);
    const message = state?.message ?? this.ensureAssistantMessage();

    if (state && state.item.type === "thinking") {
      state.item.text += delta;
    } else {
      const thinkingItem = this.createOrGetItem<LangMessageItemThinking>(itemId, message, { type: "thinking", text: "" });
      thinkingItem.text += delta;
    }

    this.emit(message);
  }

  private applyFunctionArgumentsDelta(itemId: string, delta: unknown) {
    if (typeof itemId !== "string" || typeof delta !== "string") return;
    const existing = this.toolArgumentBuffers.get(itemId) ?? "";
    const buffer = existing + delta;
    this.toolArgumentBuffers.set(itemId, buffer);
    this.trySetParsedArguments(itemId, buffer);
  }

  private setFunctionArguments(itemId: string, args: unknown) {
    if (typeof itemId !== "string") return;
    const parsed = this.parseArgs(args);
    if (!parsed) return;
    this.toolArgumentBuffers.set(itemId, typeof args === "string" ? args : JSON.stringify(parsed));

    const state = this.itemState.get(itemId);
    if (state && state.item.type === "tool") {
      state.item.arguments = parsed;
      this.emit(state.message);
    } else {
      const message = this.ensureAssistantMessage();
      const callId = itemId;
      const toolItem = message.upsertToolCall({ callId, arguments: parsed });
      this.itemState.set(itemId, { message, item: toolItem });
      this.emit(message);
    }
  }

  private trySetParsedArguments(itemId: string, raw: string) {
    const parsed = this.parseArgs(raw);
    if (!parsed) return;
    const state = this.itemState.get(itemId);
    if (!state || state.item.type !== "tool") return;
    state.item.arguments = parsed;
    this.emit(state.message);
  }

  private handleImageCompleted(data: any) {
    const item = data?.item ?? data;
    const itemId = item?.id ?? data?.item_id ?? data?.id;
    const message = (typeof itemId === "string" && this.pendingImageMessages.get(itemId)) || this.ensureAssistantMessage();

    const base64 = item?.b64_json ?? item?.result ?? data?.b64_json ?? data?.result;
    const url = item?.url ?? data?.url;
    const format = (item?.output_format ?? item?.format ?? data?.output_format ?? data?.format)?.toLowerCase?.();
    const mimeType = format ? IMAGE_MIME_MAP[format] ?? `image/${format}` : item?.mime_type ?? item?.mimeType;

    if (typeof base64 === "string" && base64.length > 0) {
      message.addImage({ kind: "base64", base64, mimeType });
      this.emit(message);
    } else if (typeof url === "string" && url.length > 0) {
      message.addImage({ kind: "url", url });
      this.emit(message);
    }
  }

  private createOrGetItem<T extends LangMessageItem>(itemId: string, message: LangMessage, fallback: T): T {
    const existing = this.itemState.get(itemId);
    if (existing) {
      return existing.item as T;
    }

    message.items.push(fallback);
    this.itemState.set(itemId, { message, item: fallback });
    return fallback;
  }

  private extractTextFromMessageItem(item: any): string | undefined {
    if (typeof item?.text === "string") return item.text;
    if (Array.isArray(item?.content)) {
      const parts = item.content
        .filter((part: any) => part && typeof part === "object" && (part.type === "output_text" || part.type === "text"))
        .map((part: any) => part.text ?? part.output_text)
        .filter((text: any) => typeof text === "string");
      if (parts.length > 0) {
        return parts.join("");
      }
    }
    return undefined;
  }

  private getCallId(item: any): string {
    if (typeof item?.call_id === "string" && item.call_id.length > 0) return item.call_id;
    if (typeof item?.id === "string" && item.id.length > 0) return item.id;
    if (typeof item?.function?.name === "string") return item.function.name;
    if (typeof item?.name === "string") return item.name;
    return "";
  }

  private parseArgs(args: unknown): Record<string, any> | undefined {
    if (args == null) return {};
    if (typeof args === "string") {
      const trimmed = args.trim();
      if (trimmed.length === 0) return {};
      try {
        return JSON.parse(trimmed);
      } catch {
        return undefined;
      }
    }
    if (typeof args === "object") {
      return args as Record<string, any>;
    }
    return undefined;
  }

  private emit(message: LangMessage) {
    this.onResult?.(message);
  }
}