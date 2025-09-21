import {
  LangMessage,
  LangOptions,
  LanguageProvider,
  LangContentPart,
  LangImageInput
} from "../language-provider.ts";
import { LangMessages, ToolWithHandler } from "../messages.ts";
import {
  DecisionOnNotOkResponse,
  httpRequestWithRetry as fetch,
} from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import type { ResponsesStreamEvent } from "./responses-stream-types.ts";
type FinishedEvent = { finished: true };

// Minimal per-item buffers for concurrent stream updates
type StreamItemBuffers = Map<string, { parts: Map<number, string> }>; // key: item_id

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
    // @TODO: no, fuck that - it's wrong; depending on whether we have responseId,
    // we should either send the whole list of messages or only the last message (with attached previous_response_id)
    const input = this.transformMessagesToResponsesInput(messageCollection);
    const providedTools: ToolWithHandler[] = (
      messageCollection.availableTools as ToolWithHandler[]
    ) || (options?.tools as ToolWithHandler[]) || [];
    const hasToolResults = (messageCollection as any).some?.((m: any) => m.role === 'tool-results');

    // Enable streaming if onResult callback is provided
    const stream = typeof options?.onResult === 'function';

    // @IDEA: how about we allow to add custom things to the body, so devs may pass: "tool_choice: required". And same for the headers.
    
    const body = {
      model: this._model,
      input,
      ...(typeof (options as any)?.maxTokens === 'number' ? { max_output_tokens: (options as any).maxTokens } : {}),
      ...(stream ? { stream: true } : {}),
      ...(providedTools && providedTools.length
        ? { tools: this.transformToolsForProvider(providedTools), tool_choice: hasToolResults ? 'none' : 'auto' }
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
      onNotOkResponse: async (res: Response, decision: DecisionOnNotOkResponse): Promise<DecisionOnNotOkResponse> => {
        if (res.status === 401) {
          decision.retry = false;
          throw new Error("Authentication failed. Please check your credentials and try again.");
        }
        if (res.status === 400) {
          const data = await res.text();
          decision.retry = false;
          throw new Error(data);
        }
        return decision;
      },
    } as const;

    const response = await fetch(apiUrl, common);
    if (stream) {
      // Keep minimal mutable stream state between events
      const streamState = { sawAnyTextDelta: false };
      const itemBuffers: StreamItemBuffers = new Map();

      // Route raw SSE events through a dedicated handler
      const onData = (data: ResponsesStreamEvent | FinishedEvent) => this.handleStreamingEvent(
        data,
        result,
        options?.onResult,
        streamState,
        itemBuffers,
      );

      await processResponseStream(response, onData);

      result.finished = true;
      
      // Automatically execute tools if assistant made tool calls
      await this.executeToolsIfRequested(result);
      
      return result;
    }

    const data = await response.json();

    // @TODO: save it somewhere, so we can use it as `body.previous_response_id` later
    const responseId = data?.id as string;
    const output = data?.output as unknown;

    if (typeof (data as any)?.output_text === 'string' && (data as any).output_text.length > 0) {
      result.answer = (data as any).output_text;
      result.addAssistantMessage(result.answer);
    } else if (Array.isArray(output)) {
      for (const item of output) {
        this.handleOutputItem(item, result);
      }

      // Build result.answer from accumulated assistant messages if any
      const last = result.length > 0 ? result[result.length - 1] : undefined;
      if (!result.answer && last && last.role === 'assistant' && typeof last.content === 'string') {
        result.answer = last.content;
      }
    }

    result.finished = true;
    
    // Automatically execute tools if assistant made tool calls
    await this.executeToolsIfRequested(result);
    
    return result;
  }

  /**
   * Handles a single output item from the Responses API.
   * Items must have at least: { id: string, type: string, ... }
   */
  private handleOutputItem(item: { id: string; type: string;[key: string]: any }, result: LangMessages) {
    switch (item.type) {
      case 'message':
        if (item.role === 'assistant') {
          let text = '';
          if (Array.isArray(item.content)) {
            for (const c of item.content) {
              if (c?.type === 'output_text' && typeof c.text === 'string') {
                text += c.text;
              }
            }
          }
          if (text) {
            result.answer += text;
            result.addAssistantMessage(result.answer);
          }
        } else {
          result.addUserMessage(item.content);
        }
        break;
      case 'function_call':
      case 'tool':
      case 'tool_call':
        // Record requested tool use for API consumers
        if (!result.toolsRequested) (result as any).toolsRequested = [] as any;
        (result.toolsRequested as any).push({ id: item.call_id || item.id, name: item.name, arguments: item.arguments || {} });

        // Also append as assistant tool_calls message for transcript
        result.addAssistantToolCalls([
          {
            callId: item.call_id || item.id,
            name: item.name,
            arguments: item.arguments
          }
        ])
        break;
      case 'output_image':
        break;
      case 'computer_call_output':
        break;
      case 'function_call_output':
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

  protected transformToolsForProvider(tools: ToolWithHandler[]): any[] {
    // OpenAI Responses API expects top-level name/parameters on tool objects
    return tools.map(tool => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  private transformMessagesToResponsesInput(messages: LangMessages): any {
    const input: any[] = [];
    for (const m of messages) {
      // Map tool results into input as input_text JSON parts; skip assistant tool call echoes
      if (m.role === 'tool-results' && Array.isArray(m.content)) {
        const parts: any[] = [];
        for (const tr of (m.content as any[])) {
          parts.push({
            type: 'tool_result',
            tool_call_id: tr.toolId,
            content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
          } as any);
        }
        input.push({ role: 'tool', content: parts } as any);
        continue;
      }
      if (m.role === 'tool') {
        // Skip assistant tool call echo for Responses input
        continue;
      }

      const entry: any = { role: (m as any).role === 'assistant' ? 'assistant' : (m as any).role, content: [] as any[] };
      const content = (m as any).content;
      if (Array.isArray(content)) {
        for (const part of content as LangContentPart[]) {
          if ((part as any).type === 'text') {
            const isAssistant = (m as any).role === 'assistant';
            entry.content.push({ type: isAssistant ? 'output_text' : 'input_text', text: (part as any).text });
          } else if ((part as any).type === 'image') {
            const mapped = this.mapImageInput((part as any).image);
            entry.content.push(mapped);
          }
        }
      } else {
        const isAssistant = (m as any).role === 'assistant';
        entry.content.push({ type: isAssistant ? 'output_text' : 'input_text', text: String(content) });
      }
      input.push(entry);
    }
    return input;
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
    onResult?: (result: LangMessages) => void,
    streamState?: { sawAnyTextDelta: boolean },
    itemBuffers?: StreamItemBuffers,
  ): void {
    // Completion or interruption
    if ('finished' in data && data.finished) {
      if (result.answer) {
        if (result.length > 0 && result[result.length - 1].role === 'assistant') {
          (result as any)[result.length - 1].content = result.answer;
        } else {
          result.addAssistantMessage(result.answer);
        }
      }
      result.finished = true;
      onResult?.(result);
      return;
    }

    // Typed events via discriminated union
    if ('type' in data) switch (data.type) {
      case 'response.completed':
      case 'response.incomplete': {
        if (result.answer) {
          if (result.length > 0 && result[result.length - 1].role === 'assistant') {
            (result as any)[result.length - 1].content = result.answer;
          } else {
            result.addAssistantMessage(result.answer);
          }
        }
        result.finished = true;
        onResult?.(result);
        return;
      }
      case 'response.output_item.done': {
        const item = data.item;
        if (item.type === 'message' && Array.isArray(item.content)) {
          // If we buffered parts (no deltas), consolidate
          const buf = itemBuffers?.get(item.id);
          if (buf && buf.parts.size > 0 && !streamState?.sawAnyTextDelta) {
            const merged = [...buf.parts.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([, v]) => v)
              .join('');
            if (merged) {
              result.answer += merged;
            }
          }
          if (!streamState?.sawAnyTextDelta) {
            for (const c of item.content) {
              if (c.type === 'output_text') {
                result.answer += c.text;
              }
            }
          }
          onResult?.(result);
          return;
        }
        // Handle other item types (like function_call) using the same logic as non-streaming
        this.handleOutputItem(item, result);
        onResult?.(result);
        return;
      }
      case 'response.content_part.done': {
        const part = data.part;
        if (part.type === 'output_text') {
          // Finalize buffered part text
          if (itemBuffers && data.item_id) {
            const rec = itemBuffers.get(data.item_id) || { parts: new Map<number, string>() };
            rec.parts.set(data.content_index, part.text);
            itemBuffers.set(data.item_id, rec);
          }
          if (!streamState?.sawAnyTextDelta) {
            result.answer += part.text;
          }
          onResult?.(result);
          return;
        }
        break;
      }
      case 'response.output_text.delta': {
        if (streamState) streamState.sawAnyTextDelta = true;
        // Append to per-item buffer for this part
        if (itemBuffers && data.item_id) {
          const rec = itemBuffers.get(data.item_id) || { parts: new Map<number, string>() };
          const prev = rec.parts.get(data.content_index) || '';
          rec.parts.set(data.content_index, prev + data.delta);
          itemBuffers.set(data.item_id, rec);
        }
        result.answer += data.delta;
        onResult?.(result);
        return;
      }
      case 'response.output_text.done': {
        const text = data.text ?? data.output_text;
        if (typeof text === 'string' && text.length > 0) {
          // Prefer appending unless we never saw deltas
          if (streamState?.sawAnyTextDelta) {
            // ensure answer ends with final text
            if (!result.answer.endsWith(text)) result.answer += text;
          } else {
            result.answer += text;
          }
        }
        onResult?.(result);
        return;
      }
      case 'response.image_generation_call.partial_image': {
        const base64 = data.partial_image_b64;
        result.images = result.images || [];
        result.images.push({ base64, mimeType: 'image/png', provider: this.name, model: this._model });
        onResult?.(result);
        return;
      }
      default:
        // ignore other events; they don't carry text we need
        break;
    }
  }

  /**
   * Automatically execute tools if the assistant made tool calls as the last message
   */
  private async executeToolsIfRequested(result: LangMessages): Promise<void> {
    // Check if there are any requested tools
    const requestedTools = (result.tools && result.tools.length > 0)
      ? result.tools
      : (result.toolsRequested as any) || [];
    
    if (!requestedTools.length || !result.availableTools) {
      return;
    }

    // Execute the tools automatically
    await result.executeRequestedTools();
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
      return { type: 'input_image', data: { mime_type: mimeType, data: base64 } };
    }
    throw new Error('Unsupported image kind for Responses mapping');
  }
}