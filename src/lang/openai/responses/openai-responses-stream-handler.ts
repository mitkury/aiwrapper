import { LangMessages, LangMessage } from "../../messages";
import type {
  LangMessageItem,
  LangMessageItemText,
  LangMessageItemTool,
  LangMessageItemImage,
  LangMessageItemReasoning
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
  itemIdToSummaryIndex: Map<string, number> = new Map();
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
      case 'response.reasoning_summary_part.added':
        break;
      case 'response.reasoning_summary_text.delta':
        this.applyReasoningSummaryTextDelta(data);
        break;
      case 'response.reasoning_summary_text.done':
        break;
      case 'response.reasoning_summary_part.done':
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
      case 'reasoning':
        {
          // Create a thinking item immediately when reasoning starts
          const reasoningItem: LangMessageItemReasoning = {
            type: "reasoning",
            text: ""
          };
          this.newMessage.items.push(reasoningItem);
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
        this.applyFunctionCall(resItem as MessageItem, messageItem as LangMessageItemTool);
        break;
      case 'image_generation_call':
        this.applyImageGenerationCall(resItem as MessageItem, messageItem as LangMessageItemImage);
        break;
    }
  }

  applyTextMessage(res: MessageItem, target: LangMessageItemText) {
    target.text = res.content.map(part => part.text).join('\n\n');
  }

  applyFunctionCall(res: any, target: LangMessageItemTool) {
    target.callId = res.call_id;
    target.name = res.name;
    try {
      target.arguments = JSON.parse(res.arguments);
    } catch (error) {
      console.error('Error parsing arguments for function call:', error);
      target.arguments = {};
    }
  }

  applyImageGenerationCall(res: any, target: LangMessageItemImage) {
    if (typeof res.url === "string") {
      target.url = res.url;
    }

    const base64 = res.b64_json || res.base64 || res.result;
    if (typeof base64 === "string") {
      target.base64 = base64;
    }

    const format = res.mimeType || res.mime_type || res.output_format || res.format;
    if (typeof format === "string") {
      target.mimeType = format.includes("/") ? format : `image/${format}`;
    }

    if (typeof res.width === "number") {
      target.width = res.width;
    }
    if (typeof res.height === "number") {
      target.height = res.height;
    }

    if (res.metadata || res.revised_prompt || res.background || res.quality || res.size || res.status) {
      const metadata: Record<string, any> = {
        ...(target.metadata ?? {}),
        ...(res.metadata ?? {}),
      };

      if (res.revised_prompt) metadata.revisedPrompt = res.revised_prompt;
      if (res.background) metadata.background = res.background;
      if (res.quality) metadata.quality = res.quality;
      if (res.size) metadata.size = res.size;
      if (res.status) metadata.status = res.status;

      target.metadata = metadata;
    }
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

  applyReasoningSummaryTextDelta(data: any) {
    const thinkingItem = this.getNewMessageItem(data.item_id) as LangMessageItemReasoning;
    if (thinkingItem === undefined) {
      console.warn('Unknown reasoning item:', data.item_id);
      return;
    }

    const delta = data.delta as string;
    
    // Check if summary_index exists and has increased
    if (typeof data.summary_index === 'number') {
      const previousIndex = this.itemIdToSummaryIndex.get(data.item_id);
      if (previousIndex !== undefined && data.summary_index > previousIndex) {
        // summary_index increased, add separator before the delta
        thinkingItem.text += '\n\n';
      }
      // Update the stored summary_index
      this.itemIdToSummaryIndex.set(data.item_id, data.summary_index);
    }
    
    thinkingItem.text += delta;
  }

}