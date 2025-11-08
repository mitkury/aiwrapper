import { LangMessages, LangMessage, LangContentPart, LangContentImage, LangTool, LangMessageItemImage } from "../../messages";

export type BodyPartForOpenAIResponses = {
  input?: any[];
  previous_response_id?: string
  instructions?: string;
  tools?: any[];
  tool_choice?: string;
};

export function prepareBodyPartForOpenAIResponsesAPI(messages: LangMessages): BodyPartForOpenAIResponses {
  // Find the last message with an openaiResponseId
  let lastMessageWithResponseId: LangMessage | undefined;
  let lastMessageWithResponseIdIndex = -1;

  const bodyPart: BodyPartForOpenAIResponses = { 
    instructions: messages.instructions,
    tools: transformToolsForProvider(messages.availableTools || [])
  };

  if (bodyPart.tools.length > 0) {
    bodyPart.tool_choice = 'auto';
  }

  // Here we try to find the last message with a response ID
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].meta?.openaiResponseId) {
      lastMessageWithResponseId = messages[i];
      lastMessageWithResponseIdIndex = i;
      break;
    }
  }

  if (lastMessageWithResponseId) {
    if (lastMessageWithResponseIdIndex < messages.length - 1) {
      // There are new messages after the last message with a response ID
      // Use previous_response_id + only the new messages as input
      const newMessages = messages.slice(lastMessageWithResponseIdIndex + 1);
      const newInput = transformMessagesToResponsesInput(new LangMessages(newMessages));

      bodyPart.previous_response_id = lastMessageWithResponseId.meta.openaiResponseId;
      bodyPart.input = newInput;
    } else {
      // The last message has a response ID and there are no new messages after it
      // Use previous_response_id with empty input (let the API continue from that response)
      bodyPart.previous_response_id = lastMessageWithResponseId.meta.openaiResponseId;
      bodyPart.input = [];
    }
  } else {
    // In this case we feed all messages to the API
    bodyPart.input = transformMessagesToResponsesInput(messages);
  }

  // Fall back to sending full input
  return bodyPart;
}

/**
* Converts our internal message format to OpenAI Responses API input format.
* 
* The Responses API expects a flat array of items, where:
* - Regular messages (system/user/assistant) become message items with content arrays
* - Tool calls become function_call items  
* - Tool results become function_call_output items
* - Previous raw output items are preserved for context
*/
export function transformMessagesToResponsesInput(messages: LangMessages): any {
  const input: any[] = [];

  for (const message of messages) {
    const baseItem = transformMessageToResponsesItem(message);
    if (baseItem) {
      input.push(baseItem);
    }

    if (message.role === 'assistant' && message.toolRequests.length > 0) {
      input.push(...transformToolCallsToResponsesItems(message));
    }

    if (message.toolResults.length > 0) {
      input.push(...transformToolResultsToResponsesItems(message));
    }
  }

  return input;
}

/**
* Transform a regular message (system/user/assistant) to Responses API format
*/
export function transformMessageToResponsesItem(message: LangMessage): any {
  const isAssistant = message.role === 'assistant';
  const entry = {
    role: message.role,
    content: [] as any[]
  };

  for (const item of message.items) {
    if (item.type === 'text') {
      entry.content.push({
        type: isAssistant ? 'output_text' : 'input_text',
        text: item.text
      });
    } else if (item.type === 'thinking') {
      entry.content.push({
        type: isAssistant ? 'output_text' : 'input_text',
        text: item.text
      });
    } else if (item.type === 'image') {
      if (isAssistant) {
        entry.content.push(mapImageOutput(itemImageToContentImage(item)));
      } else {
        entry.content.push(mapImageInput(itemImageToContentImage(item)));
      }
    }
  }

  if (entry.content.length === 0) {
    return null;
  }

  return entry;
}

/**
 * Transform tool call messages to function_call items
 */
export function transformToolCallsToResponsesItems(message: LangMessage): any[] {
  const items: any[] = [];
  for (const call of message.toolRequests) {
    items.push({
      type: 'function_call',
      call_id: call.callId,
      name: call.name,
      arguments: JSON.stringify(call.arguments || {})
    });
  }

  return items;
}

/**
 * Transform tool result messages to function_call_output items
 * Also includes any previous raw output items that need to be preserved
 */
export function transformToolResultsToResponsesItems(message: LangMessage): any[] {
  const items: any[] = [];

  // Add function_call_output items for each tool result
  for (const toolResult of message.toolResults) {
    items.push({
      type: 'function_call_output',
      call_id: toolResult.callId,
      output: typeof toolResult.result === 'string'
        ? toolResult.result
        : JSON.stringify(toolResult.result)
    });
  }

  return items;
}

function itemImageToContentImage(item: LangMessageItemImage): LangContentImage {
  if (item.base64) {
    return { kind: "base64", base64: item.base64, mimeType: item.mimeType };
  }
  if (item.url) {
    return { kind: "url", url: item.url };
  }
  if (item.metadata?.original?.url) {
    return { kind: "url", url: item.metadata.original.url };
  }
  if (item.metadata?.original?.base64) {
    return { kind: "base64", base64: item.metadata.original.base64, mimeType: item.metadata.original.mimeType };
  }
  return { kind: "base64", base64: "", mimeType: item.mimeType };
}

export function mapImageInput(image: LangContentImage): any {
  const kind: any = (image as any).kind;
  if (kind === 'url') {
    const url = (image as any).url as string;
    return { type: 'input_image', image_url: url };
  }
  if (kind === 'base64') {
    const base64 = (image as any).base64 as string;
    const mimeType = (image as any).mimeType || 'image/png';
    // Responses API expects image_url with a data URL for inline base64 images
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return { type: 'input_image', image_url: dataUrl };
  }
  throw new Error('Unsupported image kind for Responses mapping');
}

/**
 * Maps assistant images to output_text format for Responses API.
 * Assistant messages can only contain output_text or refusal, not input_image.
 */
export function mapImageOutput(image: LangContentImage): any {
  const kind: any = (image as any).kind;
  if (kind === 'url') {
    const url = (image as any).url as string;
    return {
      type: 'output_text',
      text: url
    };
  }
  if (kind === 'base64') {
    const base64 = (image as any).base64 as string;
    const mimeType = (image as any).mimeType || 'image/png';
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return {
      type: 'output_text',
      text: dataUrl
    };
  }
  throw new Error(`Unsupported image kind '${kind}' for assistant messages in Responses API`);
}

export function transformToolsForProvider(tools: LangTool[]): any[] {
  return tools.map(tool => {
    // Check if this is a custom function tool (has a handler)
    if ('handler' in tool) {
      // Custom function tool - transform to OpenAI function format
      return {
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      };
    } else {
      // Built-in tool (e.g "web_search")
      return {
        type: tool.name
      }
    }
  });
}