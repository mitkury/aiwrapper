import { LangMessages, LangMessage } from "../../messages";
import type {
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
        break;
      case 'response.image_generation_call.generating':
        break;
      case 'response.image_generation_call.partial_image':
        //@TODO: handle partial image
        break;
      case 'response.image_generation_call.completed':
      case 'image_generation.completed':
        //@TODO: handle completed image
        break;

      case 'response.output_text.delta':
        this.applyTextDelta(data);
        break;
      case 'response.function_call_arguments.delta':
        this.applyToolArgsDelta(data);
        break;
      case 'response.function_call_arguments.done':
        break;
    }

    this.onResult?.(this.newMessage);
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
    if (messageIndex === undefined) {
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
    target.text = res.content.map(part => part.text).join('\n\n');
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

  getNewMessageItem(itemId: string): LangMessageItem | undefined {
    const contentIndex = this.itemIdToMessageItemIndex.get(itemId);
    if (contentIndex === undefined) {
      return undefined;
    }

    return this.newMessage.items[contentIndex];
  }

  applyTextDelta(data: any) {
    const messageItem = this.getNewMessageItem(data.item_id) as LangMessageItemText;
    if (messageItem === undefined) {
      console.warn('Unknown item:', data.item_id);
      return;
    }

    const delta = data.delta as string;

    messageItem.text += delta;
  }

  applyToolArgsDelta(data: any) {
    const messageItem = this.getNewMessageItem(data.item_id) as LangMessageItemTool;
    if (messageItem === undefined) {
      console.warn('Unknown item:', data.item_id);
      return;
    }

    const delta = data.delta as string;
    // Note: given that we keep arguments as objects, delta wouldn't work like that.
    // and in my experiments OpenaAI didn't stream arguments like it streamed text. 
    // Always returned {} and then the final arguments.
    //messageItem.arguments = JSON.parse(messageItem.arguments + delta);
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

  */
}