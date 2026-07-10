import { LangOptions, LangResult, LanguageProvider } from "../language-provider.ts";
import {
  fixToolResultsIfNeeded,
  LangMessage,
  LangMessageItemTool,
  LangMessages,
  LangToolWithHandler,
} from "../messages.ts";
import { httpRequestWithRetry as fetch } from "../../http-request.ts";
import { processServerEvents } from "../../process-server-events.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type OllamaLangOptions = {
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  url?: string;
  defaultOptions?: LangOptions;
};

export type OllamaLangConfig = {
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  baseURL: string;
};

type OllamaToolCall = {
  id?: string;
  function?: {
    index?: number;
    name?: string;
    arguments?: Record<string, any> | string;
  };
};

export class OllamaLang extends LanguageProvider {
  protected _config: OllamaLangConfig;
  protected modelInfo?: Model;

  constructor(options: OllamaLangOptions = {}) {
    const modelName = options.model || "llama2:latest";
    super(modelName, options.defaultOptions);

    this._config = {
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: options.url || "http://localhost:11434",
    };

    // Ollama supports arbitrary local model names, so missing catalog metadata
    // should never prevent a request.
    this.modelInfo = models.id(modelName);
  }

  async ask(prompt: string, options?: LangOptions): Promise<LangResult> {
    return this.chat(new LangMessages(prompt), options);
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangResult> {
    const resolvedOptions = this.resolveOptions(options);
    const result = new LangResult(
      messages instanceof LangMessages ? messages : new LangMessages(messages),
    );

    fixToolResultsIfNeeded(result);

    let requestMaxTokens = this._config.maxTokens;
    if (this.modelInfo) {
      requestMaxTokens = calculateModelResponseTokens(
        this.modelInfo,
        result,
        this._config.maxTokens,
      );
    }

    let assistantMessage: LangMessage | undefined;
    let visibleContent = "";
    let explicitReasoning = "";

    const onData = (data: any) => {
      const responseMessage = data?.message;
      const contentDelta = typeof responseMessage?.content === "string"
        ? responseMessage.content
        : "";
      const reasoningDelta = typeof responseMessage?.thinking === "string"
        ? responseMessage.thinking
        : "";
      const toolCalls = Array.isArray(responseMessage?.tool_calls)
        ? responseMessage.tool_calls as OllamaToolCall[]
        : [];

      visibleContent += contentDelta;
      explicitReasoning += reasoningDelta;

      const hasUpdate = contentDelta.length > 0 || reasoningDelta.length > 0 || toolCalls.length > 0;
      if (hasUpdate) {
        assistantMessage ??= this.createAssistantMessage(result);
        this.renderAssistantContent(assistantMessage, visibleContent, explicitReasoning);
        this.applyToolCalls(assistantMessage, toolCalls);
        resolvedOptions?.onResult?.(assistantMessage);
      }

      if (data?.done) {
        result.finished = true;
        if (!hasUpdate && assistantMessage) {
          resolvedOptions?.onResult?.(assistantMessage);
        }
      }
    };

    try {
      const response = await fetch(`${this._config.baseURL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(resolvedOptions?.providerSpecificHeaders ?? {}),
        },
        body: JSON.stringify({
          model: this._config.model,
          messages: this.transformMessagesForProvider(result),
          tools: this.transformToolsForProvider(result.availableTools),
          stream: true,
          ...(requestMaxTokens
            ? { options: { num_predict: requestMaxTokens } }
            : {}),
          ...(resolvedOptions?.providerSpecificBody ?? {}),
        }),
        signal: resolvedOptions?.signal,
      });

      await processServerEvents(response, onData, resolvedOptions?.signal);
    } catch (error) {
      if ((error as any)?.name === "AbortError") {
        result.aborted = true;
        (error as any).partialResult = result;
      }
      throw error;
    }

    const toolResults = await result.executeRequestedTools();
    if (toolResults) {
      resolvedOptions?.onResult?.(toolResults);
    }

    return result;
  }

  private createAssistantMessage(messages: LangMessages): LangMessage {
    const message = new LangMessage("assistant", []);
    messages.push(message);
    return message;
  }

  private renderAssistantContent(
    message: LangMessage,
    content: string,
    explicitReasoning: string,
  ): void {
    const parsed = this.splitThinkingTags(content);
    const toolItems = message.items.filter(
      (item): item is LangMessageItemTool => item.type === "tool",
    );

    message.items.length = 0;

    const reasoning = [explicitReasoning, parsed.reasoning]
      .filter(part => part.length > 0)
      .join("\n\n");
    if (reasoning.length > 0) {
      message.items.push({ type: "reasoning", text: reasoning });
    }
    if (parsed.answer.length > 0) {
      message.items.push({ type: "text", text: parsed.answer });
    }

    message.items.push(...toolItems);
  }

  private splitThinkingTags(content: string): { reasoning: string; answer: string } {
    const reasoning: string[] = [];
    const answer: string[] = [];
    let cursor = 0;

    while (cursor < content.length) {
      const openIndex = content.indexOf("<think>", cursor);
      if (openIndex === -1) {
        answer.push(content.slice(cursor));
        break;
      }

      answer.push(content.slice(cursor, openIndex));
      const thinkingStart = openIndex + "<think>".length;
      const closeIndex = content.indexOf("</think>", thinkingStart);
      if (closeIndex === -1) {
        reasoning.push(content.slice(thinkingStart));
        break;
      }

      reasoning.push(content.slice(thinkingStart, closeIndex));
      cursor = closeIndex + "</think>".length;
    }

    return {
      reasoning: reasoning.join("\n\n"),
      answer: answer.join(""),
    };
  }

  private applyToolCalls(message: LangMessage, calls: OllamaToolCall[]): void {
    const currentToolItems = message.toolRequests;

    for (let index = 0; index < calls.length; index++) {
      const call = calls[index];
      const fn = call?.function;
      if (!fn?.name) continue;

      const targetIndex = typeof fn.index === "number" ? fn.index : index;
      let item = currentToolItems[targetIndex];
      if (!item) {
        item = {
          type: "tool",
          callId: call.id || `ollama_tool_${targetIndex}`,
          name: fn.name,
          arguments: {},
        };
        message.items.push(item);
        currentToolItems[targetIndex] = item;
      }

      item.name = fn.name;
      item.callId = call.id || item.callId;
      item.arguments = this.parseToolArguments(fn.arguments);
    }
  }

  private parseToolArguments(
    args: Record<string, any> | string | undefined,
  ): Record<string, any> {
    if (!args) return {};
    if (typeof args === "object") return args;

    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }

  private transformToolsForProvider(
    tools: LangMessages["availableTools"],
  ): any[] | undefined {
    const toolDefinitions = (tools ?? [])
      .filter((tool): tool is LangToolWithHandler => "handler" in tool)
      .map(tool => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));

    return toolDefinitions.length > 0 ? toolDefinitions : undefined;
  }

  private transformMessagesForProvider(messages: LangMessages): any[] {
    const providerMessages: any[] = [];
    const systemPrompt = messages.instructions || this._config.systemPrompt;
    if (systemPrompt) {
      providerMessages.push({ role: "system", content: systemPrompt });
    }

    for (const message of messages) {
      if (message.role === "tool-results") {
        for (const result of message.toolResults) {
          providerMessages.push({
            role: "tool",
            tool_name: result.name,
            content: typeof result.result === "string"
              ? result.result
              : JSON.stringify(result.result),
          });
        }
        continue;
      }

      const providerMessage: Record<string, any> = {
        role: message.role,
        content: message.text,
      };

      const images = message.images.map(image => {
        if (image.base64) return image.base64;
        if (image.url?.startsWith("data:")) {
          return image.url.slice(image.url.indexOf(",") + 1);
        }
        throw new Error(
          "Ollama image messages require base64 data or a data URL.",
        );
      });
      if (images.length > 0) {
        providerMessage.images = images;
      }

      if (message.reasoning) {
        providerMessage.thinking = message.reasoning;
      }

      if (message.toolRequests.length > 0) {
        providerMessage.tool_calls = message.toolRequests.map(tool => ({
          type: "function",
          function: {
            name: tool.name,
            arguments: tool.arguments,
          },
        }));
      }

      providerMessages.push(providerMessage);
    }

    return providerMessages;
  }
}
