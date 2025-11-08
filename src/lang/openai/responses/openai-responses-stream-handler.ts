import { LangMessages, LangMessage } from "../../messages";
import type {
  LangMessageContent,
  LangMessageItem,
  LangMessageItemText,
  LangMessageItemTool,
  LangMessageItemImage
} from "../../messages";
import { MessageItem } from "../responses-stream-types";

type OpenAIResponseItem = {
  id: string;
  type: string;
  // We link our messages to items so we can mutate them as items are updated
  targetMessage?: LangMessage;
  [key: string]: any;
}

/**
 * Stream response handler for the OpenAI Responses API
 */
export class OpenAIResponseStreamHandler {
  id: string;
  items: OpenAIResponseItem[];
  itemIdToMessageItemIndex: Map<string, number> = new Map();
  newMessage: LangMessage;
  messages: LangMessages;
  onResult?: (result: LangMessage) => void;

  constructor(messages: LangMessages, onResult?: (result: LangMessage) => void) {
    this.items = [];
    this.messages = messages;
    this.onResult = onResult;
  }

  handleEvent(data: any) {
    if (!('type' in data)) {
      console.warn('Unknown data from server:', data);
      return;
    }

    if (!('type' in data)) {
      console.warn('Unknown data from server:', data);
      return;
    }

    switch (data.type) {
      case 'response.created':
        this.id = data.response.id;
        this.newMessage = new LangMessage('assistant', []);
        this.newMessage.meta = {
          openaiResponseId: this.id
        }
        this.messages.push(this.newMessage);
        break;

      case 'response.output_item.added':
        this.handleNewItem(data);
        break;
      case 'response.output_item.done':
        this.handleItemFinished(data);
        break;

      case 'response.content_part.added':
        break;
      case 'response.content_part.done':
        break;
      case 'response.image_generation_call.in_progress':
      case 'response.image_generation_call.generating':
      case 'response.image_generation_call.partial_image':
        //this.handlePartialImage(data);
        //this.setItem(data.item)
        break;
      case 'response.image_generation_call.completed':
      case 'image_generation.completed':
        //this.addImage(data);
        break;

      // Deltas that we care about (feel free to add more if you want to show them in-progress somewhere)
      case 'response.output_text.delta':
        //case 'response.function_call_arguments.delta':
        //this.applyDelta(data.item_id, data.delta);
        break;
      case 'response.function_call_arguments.delta':
        //this.applyArgsDelta(data.item_id, data.delta);
        break;
      case 'response.function_call_arguments.done':
        //this.setArgs(data.item_id, data.arguments);
        break;
    }
  }

  // @TODO: NO, let's not do it. Just add id to content part so I can associate them with items
  turnItemsIntoContent(items: OpenAIResponseItem[]): LangMessageContent {
    // We collapse the OpenAI Responses streaming items into the LangMessage content format.
    // The handler needs to support three cases: plain assistant text, generated images,
    // and tool/function call requests streamed via deltas.

    type TextPart = { type: "text"; text: string };
    type ImagePart = { type: "image"; image: any; alt?: string };

    const contentParts: Array<TextPart | ImagePart> = [];
    const toolCalls: Array<{ callId: string; name: string; arguments: Record<string, any> }> = [];

    const appendText = (text: string) => {
      if (!text) return;
      const last = contentParts.length > 0 ? contentParts[contentParts.length - 1] : undefined;
      if (last && last.type === "text") {
        last.text += text;
      } else {
        contentParts.push({ type: "text", text });
      }
    };

    for (const item of items) {
      if (!item || typeof item.type !== "string") continue;

      switch (item.type) {
        case "message": {
          // Assistant text may be provided as an aggregate string or as an array of parts.
          if (typeof item.text === "string") {
            appendText(item.text);
            break;
          }

          if (Array.isArray(item.content)) {
            for (const part of item.content) {
              if (part && typeof part === "object" && part.type === "output_text" && typeof part.text === "string") {
                appendText(part.text);
              }
            }
          }
          break;
        }

        case "image_generation_call": {
          // Image generation items surface either a base64 payload or a URL once complete.
          const base64 = typeof item.result === "string" && item.result.length > 0
            ? item.result
            : (typeof item.b64_json === "string" && item.b64_json.length > 0 ? item.b64_json : undefined);
          const url = typeof item.url === "string" && item.url.length > 0 ? item.url : undefined;

          const format = typeof item.output_format === "string" ? item.output_format : item.format;
          let mimeType: string | undefined;
          if (typeof format === "string") {
            const normalized = format.toLowerCase();
            if (normalized === "png") mimeType = "image/png";
            else if (normalized === "jpeg" || normalized === "jpg") mimeType = "image/jpeg";
            else if (normalized === "webp") mimeType = "image/webp";
          }

          const alt = typeof item.revised_prompt === "string" && item.revised_prompt.length > 0
            ? item.revised_prompt
            : (typeof item.prompt === "string" && item.prompt.length > 0 ? item.prompt : undefined);

          if (base64) {
            contentParts.push({ type: "image", image: { kind: "base64", base64, mimeType }, alt });
          } else if (url) {
            contentParts.push({ type: "image", image: { kind: "url", url }, alt });
          }
          break;
        }

        case "function_call": {
          // Tool calls are streamed via argument deltas; consolidate them into a request payload.
          const name = typeof item.name === "string" ? item.name : undefined;
          if (!name) break;

          const callId = typeof item.call_id === "string" && item.call_id.length > 0
            ? item.call_id
            : (typeof item.id === "string" ? item.id : name);

          let args: Record<string, any> = {};
          const rawArgs = item.arguments;
          if (typeof rawArgs === "string" && rawArgs.trim().length > 0) {
            try {
              args = JSON.parse(rawArgs);
            } catch {
              // Ignore JSON parsing errors and fall back to an empty object so callers can handle it.
              args = {};
            }
          } else if (rawArgs && typeof rawArgs === "object") {
            args = rawArgs as Record<string, any>;
          }

          toolCalls.push({ callId, name, arguments: args });
          break;
        }

        default:
          // Other item types (e.g. reasoning, placeholders) are not converted here.
          break;
      }
    }

    if (toolCalls.length > 0) {
      return toolCalls;
    }

    if (contentParts.length === 0) {
      return "";
    }

    const onlyText = contentParts.every(part => part.type === "text");
    if (onlyText) {
      return contentParts.map(part => (part as TextPart).text).join("");
    }

    return contentParts;
  }

  handleNewItem(data: any) {
    const itemType = data.item.type as string;

    if (!this.newMessage) {
      console.warn("Received item without an active assistant message:", data);
      return;
    }

    // Create a new item for the message
    switch (itemType) {
      case 'message':
        {
          const textItem: LangMessageItemText = {
            type: "text",
            text: typeof data.item.text === "string" ? data.item.text : ""
          };
          this.newMessage.items.push(textItem);
        }
        break;
      case 'function_call':
        {
          const toolItem: LangMessageItemTool = {
            type: "tool",
            name: typeof data.item.name === "string" ? data.item.name : "",
            callId: typeof data.item.call_id === "string" ? data.item.call_id : "",
            arguments:
              data.item.arguments && typeof data.item.arguments === "object"
                ? data.item.arguments
                : {}
          };
          this.newMessage.items.push(toolItem);
        }
        break;
      case 'image_generation_call':
        {
          const imageItem: LangMessageItemImage = { type: "image" };
          if (typeof data.item.url === "string") {
            imageItem.url = data.item.url;
          }
          if (typeof data.item.b64_json === "string") {
            imageItem.base64 = data.item.b64_json;
          }
          if (typeof data.item.output_format === "string" || typeof data.item.format === "string") {
            imageItem.mimeType = (data.item.output_format || data.item.format) ?? undefined;
          }
          this.newMessage.items.push(imageItem);
        }
        break;
      default:
        console.warn('Unknown item type:', itemType);
        return;
    }

    this.itemIdToMessageItemIndex.set(data.item.id, this.newMessage.items.length - 1);
  }

  handleItemFinished(data: any) {
    const itemFromResponse = data.item as OpenAIResponseItem;

    const messageIndex = this.itemIdToMessageItemIndex.get(itemFromResponse.id);
    if (messageIndex === -1) {
      console.warn('Unknown message index for item:', itemFromResponse);
      return;
    }

    const messageItem = this.newMessage.items[messageIndex];

    this.applyItemToMessage(itemFromResponse, messageItem);
  }

  applyItemToMessage(resItem: OpenAIResponseItem, messageItem: LangMessageItem) {
    switch (resItem.type) {
      case 'message':
        this.applyTextMessage(resItem as MessageItem, messageItem as LangMessageItemText);
        break;
      case 'function_call':
        break;
      case 'image_generation_call':
        break;
    }
  }

  applyTextMessage(res: MessageItem, target: LangMessageItemText) {
    target.text += res.content.map(part => part.text).join('\n\n');
  }

  applyFunctionCall(res: any, target: LangMessageItemTool) {
    target.callId = res.call_id;
    target.name = res.name;
    target.arguments = res.arguments;
  }

  applyImageGenerationCall(res: any, target: LangMessageItemImage) {
    target.url = res.url;
    target.base64 = res.b64_json;
    target.mimeType = res.output_format || res.format;
    target.width = res.width;
    target.height = res.height;
    target.metadata = res.metadata;
  }

  updateContent(item: OpenAIResponseItem) {

  }

  /*
  // @TODO: remove this method
  setItem(target: OpenAIResponseItem) {
    const item = this.getItem(target.id);
    if (!target) {
      console.warn('Unknown item:', target);
      return;
    }

    switch (item.type) {
      case 'message':
        if (!item.targetMessage) {
          console.warn('Unknown target message for item:', target);
          return;
        }
        if (item.role === 'assistant') {
          // Ensure we use parts so image and text live in one message
          if (!Array.isArray(item.targetMessage.content)) {
            const existingText = typeof item.targetMessage.content === 'string' ? item.targetMessage.content : '';
            item.targetMessage.content = existingText ? [{ type: 'text', text: existingText }] : [];
          }
          // If we already accumulated text via deltas, do not append again on 'done'
          const alreadyStreamedText = typeof (item as any).text === 'string' && (item as any).text.length > 0;
          if (!alreadyStreamedText) {
            for (const content of target.content) {
              if (content.type === 'output_text') {
                const parts = item.targetMessage.content as any[];
                const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
                if (lastPart && lastPart.type === 'text') {
                  lastPart.text += String(content.text ?? '');
                } else {
                  parts.push({ type: 'text', text: String(content.text ?? '') });
                }
              }
            }
          }

          this.onResult?.(item.targetMessage);
        } else {
          console.warn('Unknown role:', item.role, 'for item:', item);
        }
        break;

      case 'function_call':
        const argsParsed = JSON.parse(target.arguments) as Record<string, any>;
        const callId = target.call_id;
        const name = target.name;

        this.messages.addAssistantToolCalls([
          {
            callId,
            name,
            arguments: argsParsed
          }
        ], { openaiResponseId: this.id });

        this.onResult?.(this.messages[this.messages.length - 1]);
        break;

      case 'image_generation_call':
        this.addImage(target);
        this.onResult?.(item.targetMessage);

        break;

      default:
        break;
    }
  }

  // @TODO: remove this method
  addItem(target: OpenAIResponseItem) {
    this.items.push(target);

    switch (target.type) {
      case 'message':

        if (target.role === 'assistant') {
          // Reuse an existing trailing assistant message (possibly created by image events)
          const last = this.messages.length > 0 ? this.messages[this.messages.length - 1] : undefined;
          if (last && last.role === 'assistant') {
            // Ensure it's parts to allow mixed content and set response id
            if (!Array.isArray(last.content)) {
              const existingText = typeof last.content === 'string' ? last.content : '';
              (last as any).content = existingText ? [{ type: 'text', text: existingText }] : [];
            }
            last.meta = { ...(last.meta || {}), openaiResponseId: this.id };
            target.targetMessage = last;
          } else {
            // Initialize as parts message to allow images + text together
            this.messages.addAssistantContent([], { openaiResponseId: this.id });
            target.targetMessage = this.messages[this.messages.length - 1];
          }
          this.onResult?.(target.targetMessage);
        } else {
          console.warn('Unknown role:', target.role, 'for item:', target);
        }

        break;
      case 'function_call':

        if (typeof target.arguments !== 'string') {
          target.arguments = '';
        }

        break;
      default:
        break;
    }
  }

  // @TODO: remove this method
  addImage(data: OpenAIResponseItem) {
    const b64image = data.b64_json || data.result;
    const imageGenerationMeta = {
      size: data.size,
      format: data.output_format || data.format,
      background: data.background,
      quality: data.quality,
      revisedPrompt: data.revised_prompt,
    }

    if (b64image) {
      // Add the completed image to the assistant message
      this.messages.addAssistantImage({
        kind: 'base64',
        base64: b64image,
        mimeType: imageGenerationMeta.format === 'png' ? 'image/png' : 'image/jpeg'
      });

      // Store metadata in the message
      const last = this.messages[this.messages.length - 1];
      if (!last.meta) last.meta = {};
      last.meta.openaiResponseId = this.id;
      last.meta.imageGeneration = imageGenerationMeta;

      this.onResult?.(last);
    }
  }

  // @TODO: remove this method
  getItem(id: string): OpenAIResponseItem | undefined {
    return this.items.find(r => r.id === id);
  }

  // @TODO: remove this method
  applyArgsDelta(itemId: string, delta: string) {
    const item = this.getItem(itemId);
    if (item && item.type === 'function_call') {
      if (typeof item.arguments !== 'string') item.arguments = '';
      item.arguments += delta;
    }
  }

  // @TODO: remove this method
  setArgs(itemId: string, args: string) {
    const item = this.getItem(itemId);
    if (item && item.type === 'function_call') {
      item.arguments = args;
    }
  }

  // @TODO: remove this method; BUT see how we can use it effectively when we turn
  // items into content. 
  // Perhaps we should update the items but update content by appending to the text part and not
  // by replacing the content with a new array of parts.
  applyDelta(itemId: string, delta: any) {
    const item = this.getItem(itemId);
    if (item) {
      if (typeof delta === "string") {
        item.text += delta;
      }

      if (item.targetMessage) {
        // Ensure parts structure to safely append text alongside images
        if (!Array.isArray(item.targetMessage.content)) {
          const existingText = typeof item.targetMessage.content === 'string' ? item.targetMessage.content : '';
          item.targetMessage.content = existingText ? [{ type: 'text', text: existingText }] : [];
        }

        if (typeof delta === "string") {
          const parts = item.targetMessage.content as any[];
          const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
          if (lastPart && lastPart.type === 'text') {
            lastPart.text += delta;
          } else {
            parts.push({ type: 'text', text: delta });
          }
        } else {
          // @TODO: handle other delta types
          console.warn('Unknown delta type:', typeof delta, 'for item:', item);
        }

        // This callback is responsible for the real-time visualization of the model output.
        this.onResult?.(item.targetMessage);
      }
    }
  }
  */
}