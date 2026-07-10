import { LangMessages, LangMessage, LangTool } from "../../messages";

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

  // Find the last assistant message with a response ID
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      if (messages[i].meta?.openaiResponseId) {
        lastMessageWithResponseId = messages[i];
        lastMessageWithResponseIdIndex = i;
      }
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
    switch (message.role) {
      case 'user':
      case 'assistant':
        input.push(...transformMessageToResponsesItems(message));
        break;
      case 'tool-results':
        input.push(...transformToolResultsToResponsesItems(message));
        break;
    }
  }

  return input;
}

/**
 * Transform a regular message into one or more Responses API items.
 *
 * Function calls are top-level Responses items, not message content. Flush the
 * surrounding message content so mixed text/tool messages retain their order.
 */
export function transformMessageToResponsesItems(message: LangMessage): any[] {
  const isAssistant = message.role === 'assistant';
  const responseItems: any[] = [];
  let content: any[] = [];

  const flushContent = () => {
    if (content.length === 0) {
      return;
    }

    responseItems.push({
      role: message.role,
      content
    });
    content = [];
  };

  for (const msgItem of message.items) {

    switch (msgItem.type) {
      case 'text':
        content.push({
          type: isAssistant ? 'output_text' : 'input_text',
          text: msgItem.text
        });
        break;

      case 'tool':
        flushContent();
        responseItems.push({
          type: 'function_call',
          call_id: msgItem.callId,
          name: msgItem.name,
          arguments: JSON.stringify(msgItem.arguments || {})
        });
        break;

      case 'image': {
        const mimeType = msgItem.mimeType || 'image/png';
        const imageUrl = msgItem.url ?? (msgItem.base64 ? `data:${mimeType};base64,${msgItem.base64}` : undefined);

        if (!imageUrl) {
          throw new Error('Image item must include either url or base64 data.');
        }

        if (isAssistant) {
          const revisedPrompt = typeof msgItem.metadata?.revisedPrompt === 'string'
            ? `\n\nPrompt used to generate the image: ${msgItem.metadata.revisedPrompt}`
            : '';

          // We do this becase at the moment (nov 2025) OpenAI doesn't allow to send back images
          // from the assistant role. So the only way it works is if we have a working response id
          // and don't send the list of all messages but just reference messages where the assistant
          // has the generated image.
          // If a durable URL becomes available, callers can store it on the image
          // item and avoid this textual fallback.
          const text = `<revised>I generated an image but no longer have a reference to it.${revisedPrompt}</revised>`;

          content.push({
            type: 'output_text',
            text
          })
        } else {
          content.push({
            type: 'input_image',
            image_url: imageUrl
          });
        }

        break;
      }
    }

  }

  flushContent();
  return responseItems;
}

/**
 * Transform tool results message to function_call_output or apply_patch_call_output items
 */
export function transformToolResultsToResponsesItems(message: LangMessage): any {
  const items: any[] = [];
  for (const toolResult of message.toolResults) {
    // apply_patch tool requires apply_patch_call_output format
    if (toolResult.name === 'apply_patch') {
      const result = toolResult.result;
      // If result is an object with status and output, use it directly
      // Otherwise, wrap it in the expected format
      if (result && typeof result === 'object' && 'status' in result) {
        items.push({
          type: 'apply_patch_call_output',
          call_id: toolResult.callId,
          status: result.status,
          output: result.output || ''
        });
      } else {
        // Default to completed if no status provided
        items.push({
          type: 'apply_patch_call_output',
          call_id: toolResult.callId,
          status: 'completed',
          output: typeof result === 'string' ? result : JSON.stringify(result || {})
        });
      }
    } else {
      // Regular function calls use function_call_output
      items.push({
        type: 'function_call_output',
        call_id: toolResult.callId,
        output: typeof toolResult.result === 'string'
          ? toolResult.result
          : JSON.stringify(toolResult.result)
      });
    }
  }
  return items;
}

export function transformToolsForProvider(tools: LangTool[]): any[] {
  return tools.map(tool => {
    // apply_patch is always a provider built-in tool, even if we have a local handler
    if (tool.name === 'apply_patch') {
      return {
        type: 'apply_patch',
      };
    }

    // Custom function tools (with handlers) are sent as functions
    if ('handler' in tool) {
      return {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      };
    }

    // Other built-in tools (e.g. web_search, image_generation, etc.)
    return {
      type: tool.name,
    };
  });
}
