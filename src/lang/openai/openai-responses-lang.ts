import {
  LangMessage,
  LangOptions,
  LanguageProvider,
  LangContentPart,
  LangImageInput
} from "../language-provider.ts";
import { LangMessages, LangTool, LangToolWithHandler } from "../messages.ts";
import {
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import type { ResponsesStreamEvent } from "./responses-stream-types.ts";
type FinishedEvent = { finished: true };

// Per-item streaming state
type StreamItemState = {
  type: string;
  role?: string;
  name?: string;
  call_id?: string;
  parts: Map<number, { buf: string; sawDelta: boolean; finalized?: boolean }>;
  argsBuf?: string; // for function_call arguments streaming
};

/**
 * OpenAI-specific built-in tools
 */
export type OpenAIBuiltInTool =
  | { type: "web_search" }
  | { type: "file_search"; vector_store_ids: string[] }
  | { type: "mcp"; server_label: string; server_description: string; server_url: string; require_approval: "never" | "always" | "if_needed" }
  | { type: "image_generation" }
  | { type: "code_interpreter" }
  | { type: "computer_use" };

export type OpenAIResponsesOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
};

export class OpenAIResponsesLang extends LanguageProvider {
  private _apiKey: string;
  private _model: string;
  private _systemPrompt: string;
  private _baseURL = "https://api.openai.com/v1";

  constructor(options: OpenAIResponsesOptions) {
    if (!options.model) {
      throw new Error("Model is required");
    }

    const modelName = options.model;
    super(modelName);
    this._apiKey = options.apiKey;
    this._model = modelName;
    this._systemPrompt = options.systemPrompt || "";
  }

  async ask(prompt: string, options?: LangOptions): Promise<LangMessages> {
    const messages = new LangMessages();
    if (this._systemPrompt) {
      messages.push({ role: "system", content: this._systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    return this.chat(messages, options);
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messageCollection = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    const result = messageCollection;

    // Check if we can use previous_response_id optimization
    const inputConfig = this.prepareInputForResponses(messageCollection);
    const providedTools: LangTool[] = messageCollection.availableTools || [];

    // Always stream internally to unify the code path
    const stream = true;

    // @IDEA: how about we allow to add custom things to the body, so devs may pass: "tool_choice: required". And same for the headers.

    const body = {
      model: this._model,
      ...(messageCollection.instructions ? { instructions: messageCollection.instructions } : {}),
      ...inputConfig,
      ...(typeof (options as any)?.maxTokens === 'number' ? { max_output_tokens: (options as any).maxTokens } : {}),
      ...(stream ? { stream: true } : {}),
      ...(providedTools && providedTools.length
        ? { tools: this.transformToolsForProvider(providedTools), tool_choice: 'auto' }
        : {}),
    };

    const apiUrl = `${this._baseURL}/responses`;

    const common = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(stream ? { "Accept": "text/event-stream" } : {}),
        Authorization: `Bearer ${this._apiKey}`
      },
      body: JSON.stringify(body),
      onError: async (res: Response, error: Error): Promise<void> => {
        if (res.status === 401) {
          throw new Error("Authentication failed. Please check your credentials and try again.");
        }
        if (res.status === 400) {
          const data = await res.text();
          try {
            const errorObj = JSON.parse(data);
            // Check if this is a previous_response_id not found error
            if (inputConfig.previous_response_id &&
              errorObj.error?.param === 'previous_response_id') {
              // This is a special retry case - we'll handle it in the main logic
              throw new Error(`PREVIOUS_RESPONSE_ID_NOT_FOUND: ${data}`);
            }
          } catch (parseError) {
            // If we can't parse the JSON, fall back to string matching
            if (inputConfig.previous_response_id && data.includes('previous_response_not_found')) {
              throw new Error(`PREVIOUS_RESPONSE_ID_NOT_FOUND: ${data}`);
            }
          }
          // For other 400 errors, let the default behavior handle it (don't throw)
        }
        // For other errors (5xx, network issues), let the default retry behavior handle it
      },
    } as const;

    // Try the optimized request first (with previous_response_id if available)
    let response: Response;
    let useFullInput = false;

    try {
      response = await fetch(apiUrl, common);
    } catch (error: any) {
      // Check if this is a previous_response_id not found error that we should retry with full input
      if (error.message && error.message.startsWith('PREVIOUS_RESPONSE_ID_NOT_FOUND:')) {
        // Previous response ID not found, falling back to full input
        useFullInput = true;
      } else {
        throw error; // Re-throw if it's a different error
      }
    }

    // If we need to retry with full input, prepare the fallback request
    if (useFullInput) {
      const fallbackBody = {
        model: this._model,
        input: this.transformMessagesToResponsesInput(messageCollection),
        ...(typeof (options as any)?.maxTokens === 'number' ? { max_output_tokens: (options as any).maxTokens } : {}),
        ...(stream ? { stream: true } : {}),
        ...(providedTools && providedTools.length
          ? { tools: this.transformToolsForProvider(providedTools), tool_choice: 'auto' }
          : {}),
      };

      const fallbackCommon = {
        ...common,
        body: JSON.stringify(fallbackBody),
        onError: async (res: Response, error: Error): Promise<void> => {
          if (res.status === 401) {
            throw new Error("Authentication failed. Please check your credentials and try again.");
          }
          if (res.status === 400) {
            const data = await res.text();
            throw new Error(data);
          }
          // For other errors, let the default retry behavior handle it
        },
      };

      response = await fetch(apiUrl, fallbackCommon);
    }

    // Keep minimal mutable stream state between events
    const streamState = {
      openaiResponseId: undefined as string | undefined,
      items: new Map() as Map<string, StreamItemState>,
    };

    // Route raw SSE events through a dedicated handler
    const onData = (data: ResponsesStreamEvent | FinishedEvent) => this.handleStreamingEvent(
      data,
      result,
      options?.onResult,
      streamState,
    );

    await processResponseStream(response, onData);

    result.finished = true;

    // Automatically execute tools if the assistant requested them
    const toolResults = await result.executeRequestedTools();
    if (options?.onResult && toolResults) options.onResult(toolResults);

    return result;
  }

  /**
   * Handles a single output item from the Responses API.
   * Items must have at least: { id: string, type: string, ... }
   */
  private handleOutputItem(item: { id: string; type: string;[key: string]: any }, result: LangMessages, openaiResponseId?: string) {
    switch (item.type) {
      case 'message':
        if (item.role === 'assistant') {
          let hasAny = false;
          if (Array.isArray(item.content)) {
            for (const c of item.content) {
              if (c?.type === 'output_text' && typeof c.text === 'string') {
                const msg = result.appendToAssistantText(c.text);
                msg.meta = { openaiResponseId };
                hasAny = true;
              }
            }
          }
        } else {
          result.addUserMessage(item.content);
        }
        break;

      case 'function_call':
      case 'tool':
      case 'tool_call':
        // Parse arguments if they come as a JSON string
        let parsedArgs = item.arguments;
        if (typeof item.arguments === 'string') {
          try {
            parsedArgs = JSON.parse(item.arguments);
          } catch (e) {
            console.warn('Failed to parse tool arguments:', e);
            parsedArgs = {};
          }
        }

        // Also append as assistant tool_calls message for transcript
        result.addAssistantToolCalls([
          {
            callId: item.call_id || item.id,
            name: item.name,
            arguments: parsedArgs
          }
        ], { openaiResponseId })

        break;
      case 'output_image':
        if (item.image_url) {
          result.addAssistantImage({ kind: 'url', url: item.image_url });
        } else if (item.b64_json || item.data) {
          const base64 = item.b64_json || item.data;
          const mimeType = item.mime_type || item.mimeType || 'image/png';
          result.addAssistantImage({ kind: 'base64', base64, mimeType });
        }
        break;
      // @TODO: this is what we send. Let's remove all "output" from this switch?
      case 'computer_call_output':
        break;
      case 'function_call_output':
        {
          const callId = item.call_id || item.id;
          const name = item.name || 'function';
          let output = item.output;
          // Try to parse JSON/stringified outputs back to native types
          if (typeof output === 'string') {
            try {
              output = JSON.parse(output);
            } catch {
              // keep as string if not JSON
            }
          }
          result.addToolUseMessage([
            {
              toolId: callId,
              name,
              result: output
            }
          ], { openaiResponseId });
        }
        break;
      case 'image_generation_call':
        break;
      case 'local_shell_call':
        break;
      case 'local_shell_call_output':
        break;
      case 'mcp_list_tools':
        break;
      case 'mcp_approval_request':
        break;
      case 'mcp_approval_response':
        break;
      case 'mcp_call':
        break;
      case 'item_reference':
        break;
    }
  }

  protected transformToolsForProvider(tools: LangTool[]): any[] {
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

  /**
   * Prepares input configuration for the Responses API, optimizing to use previous_response_id when possible.
   * 
   * Returns either:
   * - { input: [...] } - Full message stack when optimization isn't possible
   * - { previous_response_id: "resp_..." } - When we can reference a previous response
   */
  private prepareInputForResponses(messages: LangMessages): { input?: any[]; previous_response_id?: string } {
    // Find the last message with an openaiResponseId
    let lastMessageWithResponseId: LangMessage | undefined;
    let lastMessageWithResponseIdIndex = -1;

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
        return {
          previous_response_id: lastMessageWithResponseId.meta.openaiResponseId,
          input: newInput
        };
      } else {
        // The last message has a response ID and there are no new messages after it
        // Use previous_response_id with empty input (let the API continue from that response)
        return {
          previous_response_id: lastMessageWithResponseId.meta.openaiResponseId,
          input: []
        };
      }
    }

    // Fall back to sending full input
    return { input: this.transformMessagesToResponsesInput(messages) };
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
  private transformMessagesToResponsesInput(messages: LangMessages): any {
    const input: any[] = [];
    const previousOutputItems = this.getPreviousOutputItems(messages);

    for (const message of messages) {
      switch (message.role) {
        case 'system':
        case 'user':
        case 'assistant':
          input.push(this.transformMessageToResponsesItem(message));
          break;

        case 'tool':
          input.push(...this.transformToolCallsToResponsesItems(message));
          break;

        case 'tool-results':
          input.push(...this.transformToolResultsToResponsesItems(message, previousOutputItems));
          break;
      }
    }

    return input;
  }

  /**
   * Extract previous raw output items that need to be preserved for context
   */
  private getPreviousOutputItems(messages: LangMessages): any[] {
    return (messages as any)._responsesOutputItems || [];
  }

  /**
   * Transform a regular message (system/user/assistant) to Responses API format
   */
  private transformMessageToResponsesItem(message: LangMessage): any {
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
  private transformToolCallsToResponsesItems(message: LangMessage): any[] {
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
  private transformToolResultsToResponsesItems(message: LangMessage, previousOutputItems: any[]): any[] {
    const items: any[] = [];

    // Include previous raw function_call and reasoning items for context
    for (const item of previousOutputItems) {
      if (item && (item.type === 'function_call' || item.type === 'reasoning')) {
        items.push(item);
      }
    }

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

  /**
   * Handle one SSE event from the Responses API stream.
   * This function normalizes different streaming shapes into a unified answer:
   * - response.output_text.delta: append incremental tokens to result.answer
   * - response.output_text.done: set final text for the content part
   * - response.content_part.done / response.output_item.done: append full text when deltas weren't sent
   * - response.completed / response.incomplete: finalize the message and mark finished
   */
  private handleStreamingEvent(
    data: ResponsesStreamEvent | FinishedEvent,
    result: LangMessages,
    onResult?: (result: LangMessage) => void,
    streamState?: { openaiResponseId?: string; items: Map<string, StreamItemState> },
  ): void {

    // Completion or interruption
    if ('finished' in data && data.finished) {
      result.finished = true;
      return;
    }

    // Typed events via discriminated union
    if ('type' in data) switch (data.type) {
      case 'response.created': {
        // Capture response ID and create assistant message eagerly
        const respId = data.response?.id;
        if (streamState && respId) {
          streamState.openaiResponseId = respId;
        }
        // Create a single assistant message if not present or with different response id
        const last = result.length > 0 ? result[result.length - 1] : undefined;
        const lastIsAssistantForThisResp = !!(last && last.role === 'assistant' && (last.meta?.openaiResponseId === streamState?.openaiResponseId));
        if (!lastIsAssistantForThisResp) {
          result.addAssistantMessage('', streamState?.openaiResponseId ? { openaiResponseId: streamState.openaiResponseId } : undefined);
        }
        break;
      }
      case 'response.in_progress': {
        // Capture the response ID as soon as it's available (no-op if already set)
        if (streamState && data.response?.id && !streamState.openaiResponseId) {
          streamState.openaiResponseId = data.response.id;
        }
        break;
      }
      case 'response.completed':
      case 'response.incomplete': {
        // Capture the response ID if we haven't already
        if (streamState && data.response?.id && !streamState.openaiResponseId) {
          streamState.openaiResponseId = data.response.id;
        }

        result.finished = true;
        return;
      }
      case 'response.output_item.done': {
        const item = data.item;
        // Accumulate raw output items for pass-back on next turn
        const raw = (result as any)._responsesOutputItems as any[] | undefined;
        if (Array.isArray(raw)) raw.push(item); else (result as any)._responsesOutputItems = [item];
        if (item.type === 'message' && Array.isArray(item.content)) {
          // Fallback: emit any parts that had no deltas (based on per-item state)
          const st = streamState?.items.get(item.id);
          if (st) {
            // For each content index, if no deltas seen and buffer has text, emit once
            for (const [idx, partState] of st.parts.entries()) {
              if (!partState.sawDelta && partState.buf) {
                const msg = result.appendToAssistantText(partState.buf);
                if (streamState?.openaiResponseId) {
                  msg.meta = { ...(msg.meta || {}), openaiResponseId: streamState.openaiResponseId };
                }
                onResult?.(msg);
              }
            }
          } else {
            // If no state, emit outputs in item.content once
            for (const c of item.content) {
              if (c.type === 'output_text') {
                const msg = result.appendToAssistantText(c.text);
                if (streamState?.openaiResponseId) {
                  msg.meta = { ...(msg.meta || {}), openaiResponseId: streamState.openaiResponseId };
                }
                onResult?.(msg);
              }
            }
          }
          // Clear finished item state to avoid leaks
          if (st) streamState?.items.delete(item.id);
          return;
        }
        // If this was a function_call, prefer finalized/buffered arguments
        if ((item as any).type === 'function_call') {
          const id = (item as any).id as string;
          const st = streamState?.items.get(id);
          const buffered = st?.argsBuf;
          if (buffered && typeof (item as any).arguments !== 'string') {
            (item as any).arguments = buffered;
          }
          if (st) streamState?.items.delete(id);
        }
        // Handle other item types (like function_call) using the same logic as non-streaming
        this.handleOutputItem(item, result, streamState?.openaiResponseId);
        const last = result.length > 0 ? result[result.length - 1] : undefined;
        // Don't emit user messages (they're just echoes of input)
        if (last && last.role !== 'user') onResult?.(last);
        return;
      }
      case 'response.output_item.added': {
        const item = data.item as any;
        const id = item?.id as string | undefined;
        if (!id) break;
        const state: StreamItemState = {
          type: item.type,
          role: item.role,
          name: item.name,
          call_id: item.call_id,
          parts: new Map(),
        };
        streamState?.items.set(id, state);
        return;
      }
      case 'response.content_part.done': {
        const part = data.part;
        if (part.type === 'output_text') {
          // If no deltas were seen for this part, emit its text once
          const st = streamState?.items.get(data.item_id);
          const partState = st?.parts.get(data.content_index) || { buf: '', sawDelta: false };
          if (!partState.sawDelta && typeof (part as any).text === 'string' && (part as any).text.length > 0) {
            const msg = result.appendToAssistantText((part as any).text);
            if (streamState?.openaiResponseId) {
              msg.meta = { ...(msg.meta || {}), openaiResponseId: streamState.openaiResponseId };
            }
            onResult?.(msg);
            partState.finalized = true;
            st?.parts.set(data.content_index, partState);
          }
          return;
        }
        break;
      }
      case 'response.output_text.delta': {
        // Track per-part deltas and emit immediately
        const st = streamState?.items.get(data.item_id);
        const partState = st?.parts.get(data.content_index) || { buf: '', sawDelta: false };
        partState.buf = partState.buf + data.delta;
        partState.sawDelta = true;
        st?.parts.set(data.content_index, partState);
        const msg = result.appendToAssistantText(data.delta);
        if (streamState?.openaiResponseId) {
          msg.meta = { ...(msg.meta || {}), openaiResponseId: streamState.openaiResponseId };
        }
        onResult?.(msg);
        return;
      }
      case 'response.output_text.done': {
        const text = data.text ?? data.output_text;
        if (typeof text === 'string' && text.length > 0) {
          // If no deltas were seen for this part, emit the text once
          const st = streamState?.items.get(data.item_id);
          const partState = st?.parts.get(data.content_index) || { buf: '', sawDelta: false };
          if (!partState.sawDelta) {
            const msg = result.appendToAssistantText(text);
            if (streamState?.openaiResponseId) {
              msg.meta = { ...(msg.meta || {}), openaiResponseId: streamState.openaiResponseId };
            }
            onResult?.(msg);
          }
        }
        return;
      }
      case 'response.function_call_arguments.delta': {
        const st = streamState?.items.get(data.item_id);
        if (st) st.argsBuf = (st.argsBuf || '') + data.delta;
        return;
      }
      case 'response.function_call_arguments.done': {
        const st = streamState?.items.get(data.item_id);
        if (st) st.argsBuf = data.arguments || '';
        return;
      }
      case 'response.image_generation_call.partial_image': {
        const base64 = data.partial_image_b64;
        result.addAssistantImage({ kind: 'base64', base64, mimeType: 'image/png' });
        const last = result.length > 0 ? result[result.length - 1] : undefined;
        if (last) onResult?.(last);
        return;
      }
      default:
        // ignore other events; they don't carry text we need
        break;
    }
  }

  private mapImageInput(image: LangImageInput): any {
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
}