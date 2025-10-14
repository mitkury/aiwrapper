import { LangMessages, LangMessage, LangContentPart, LangImageInput, LangTool } from "../messages";

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
      const newInput = this.transformMessagesToResponsesInput(new LangMessages(newMessages));

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
    switch (message.role) {
      case 'system':
      case 'user':
      case 'assistant':
        input.push(transformMessageToResponsesItem(message));
        break;

      case 'tool':
        input.push(...transformToolCallsToResponsesItems(message));
        break;

      case 'tool-results':
        input.push(...transformToolResultsToResponsesItems(message));
        break;
    }
  }

  return input;
}

/**
* Transform a regular message (system/user/assistant) to Responses API format
*/
export function transformMessageToResponsesItem(message: LangMessage): any {
  const isAssistant = message.role === 'assistant';
  const content = (message as any).content;

  const entry = {
    role: message.role,
    content: [] as any[]
  };

  if (Array.isArray(content)) {
    // Handle multi-part content (text + images)
    for (const part of content as LangContentPart[]) {
      if ((part as any).type === 'text') {
        entry.content.push({
          type: isAssistant ? 'output_text' : 'input_text',
          text: (part as any).text
        });
      } else if ((part as any).type === 'image') {
        entry.content.push(this.mapImageInput((part as any).image));
      }
    }
  } else {
    // Handle simple string content
    entry.content.push({
      type: isAssistant ? 'output_text' : 'input_text',
      text: String(content)
    });
  }

  return entry;
}

/**
 * Transform tool call messages to function_call items
 */
export function transformToolCallsToResponsesItems(message: LangMessage): any[] {
  if (!Array.isArray(message.content)) {
    return [];
  }

  const items: any[] = [];
  for (const call of (message.content as any[])) {
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
  if (Array.isArray(message.content)) {
    for (const toolResult of (message.content as any[])) {
      items.push({
        type: 'function_call_output',
        call_id: toolResult.toolId,
        output: typeof toolResult.result === 'string'
          ? toolResult.result
          : JSON.stringify(toolResult.result)
      });
    }
  }

  return items;
}

export function mapImageInput(image: LangImageInput): any {
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