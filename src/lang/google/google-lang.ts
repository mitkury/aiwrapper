import { LanguageProvider } from "../language-provider.js";
import type { LangOptions } from "../language-provider.js";
import { httpRequestWithRetry as fetch } from "../../http-request.js";
import { models, type Model } from "aimodels";
import { calculateModelResponseTokens } from "../utils/token-calculator.js";
import {
  LangMessage,
  LangMessages,
  fixToolResultsIfNeeded,
  isLangToolResultContent,
  normalizeLangToolResultImage,
} from "../messages.js";
import type {
  LangMessageItemImage,
  LangMessageItemTool,
  LangTool,
  LangToolResultContent,
} from "../messages.js";
import {
  addInstructionAboutSchema,
  combineInstructions,
} from "../prompt-for-json.js";
import { attachPartialResult, isAbortError } from "../../errors.js";

export type GoogleLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  defaultOptions?: LangOptions;
};

export class GoogleLang extends LanguageProvider {
  private _apiKey: string;
  private _model: string;
  private _systemPrompt: string;
  private _maxTokens?: number;
  private modelInfo?: Model;

  constructor(options: GoogleLangOptions) {
    const modelName = options.model || "gemini-2.5-pro";
    super(modelName, options.defaultOptions);

    const modelInfo = models.id(modelName);
    if (!modelInfo) {
      console.error(`Invalid Google model: ${modelName}. Model not found in aimodels database.`);
    }

    this.modelInfo = modelInfo;
    this._apiKey = options.apiKey;
    this._model = modelName;
    this._systemPrompt = options.systemPrompt || "";
    this._maxTokens = options.maxTokens;
  }

  async ask(
    prompt: string,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messages = new LangMessages();
    messages.addUserMessage(prompt);
    return await this.chat(messages, options);
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const resolvedOptions = this.resolveOptions(options);
    const messageCollection = this.beginRequest(
      messages instanceof LangMessages
        ? messages
        : new LangMessages(messages),
    );

    const instructions = this.buildInstructions(messageCollection, resolvedOptions);

    fixToolResultsIfNeeded(messageCollection);

    const contents = this.transformMessagesForProvider(messageCollection as any);

    const maxOutputTokens = this.computeMaxTokens(messageCollection);
    const tools = this.buildTools(messageCollection.availableTools);

    const generationConfig: Record<string, any> = {};
    if (typeof maxOutputTokens === "number") {
      generationConfig.max_output_tokens = maxOutputTokens;
    }

    const requestBody: any = {
      contents,
      ...(instructions ? {
        system_instruction: {
          role: "system",
          parts: [{ text: instructions }],
        },
      } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generation_config: generationConfig } : {}),
      ...(tools ? { tools } : {}),
      ...(resolvedOptions?.providerSpecificBody ?? {}),
    };

    // Gemini REST v1beta doesn't yet accept responseSchema/responseMimeType; fall back to prompt
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this._apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Some setups still expect the header, so keep both
            "x-goog-api-key": this._apiKey,
            ...(resolvedOptions?.providerSpecificHeaders ?? {}),
          },
          body: JSON.stringify(requestBody),
          signal: resolvedOptions?.signal,
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Google API request failed with status ${response.status}${body ? `: ${body}` : ""}`,
        );
      }

      const data = await response.json();
      this.applyCandidates(data?.candidates, messageCollection, resolvedOptions?.onResult);
    } catch (error) {
      if (isAbortError(error)) {
        messageCollection.aborted = true;
        throw attachPartialResult(error, messageCollection);
      }
      throw error;
    }

    messageCollection.finished = true;

    const toolsResults = await messageCollection.executeRequestedTools();
    if (resolvedOptions?.onResult && toolsResults) resolvedOptions.onResult(toolsResults);

    return messageCollection;
  }

  protected transformMessagesForProvider(messages: LangMessages): any[] {
    const mapped: any[] = [];

    for (const msg of messages) {
      if (msg.role === "tool-results") {
        const parts = msg.toolResults.map((tr) => {
          if (isLangToolResultContent(tr.result)) {
            return {
              functionResponse: this.mapMultimodalToolResult(
                tr.callId,
                tr.name,
                tr.result,
              ),
            };
          }

          // Google API requires response to be an object, not an array
          // If result is an array, wrap it in an object
          let response: any;
          if (Array.isArray(tr.result)) {
            response = { result: tr.result };
          } else if (typeof tr.result === "object" && tr.result !== null) {
            response = tr.result;
          } else {
            response = { result: tr.result };
          }
          return {
            functionResponse: {
              id: tr.callId,
              name: tr.name,
              response,
            },
          };
        });
        mapped.push({ role: "user", parts });
        continue;
      }

      if (msg.role !== "user" && msg.role !== "assistant") {
        continue;
      }

      const parts: any[] = [];

      for (const item of msg.items) {
        if (item.type === "text") {
          parts.push({ text: item.text });
        } else if (item.type === "image") {
          const imagePart = this.mapImageItemToGemini(item as LangMessageItemImage);
          if (imagePart) parts.push(imagePart);
        } else if (item.type === "tool") {
          const toolItem = item as LangMessageItemTool & { thoughtSignature?: string };
          const part: any = {
            function_call: {
              id: toolItem.callId,
              name: toolItem.name,
              args: toolItem.arguments ?? {},
            },
          };
          // Include thoughtSignature at part level (required by Google Gemini API)
          if (toolItem.thoughtSignature) {
            part.thoughtSignature = toolItem.thoughtSignature;
          }
          parts.push(part);
        }
      }

      if (parts.length === 0) {
        parts.push({ text: "" });
      }

      mapped.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      });
    }

    return mapped;
  }

  private mapMultimodalToolResult(
    callId: string,
    toolName: string,
    result: LangToolResultContent,
  ): Record<string, any> {
    if (result.content.length === 0) {
      throw new Error("Gemini tool content must contain at least one part.");
    }

    const imageParts = result.content.filter(part => part.type === "image");
    if (imageParts.length > 0 && !this.supportsMultimodalFunctionResponses()) {
      throw new Error(
        `Gemini model "${this._model}" does not support multimodal function responses. Use a Gemini 3-series model.`,
      );
    }

    const output: any[] = [];
    const parts: any[] = [];
    let imageIndex = 0;

    for (const part of result.content) {
      if (part.type === "text") {
        output.push(part.text);
        continue;
      }

      const image = normalizeLangToolResultImage(part);
      if (image.kind === "url") {
        throw new Error(
          "Gemini multimodal function responses require base64 or byte image data. Fetch URL images inside the tool handler before returning them.",
        );
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)) {
        throw new Error(
          `Gemini multimodal function responses do not support MIME type "${image.mimeType}". Use image/jpeg, image/png, or image/webp.`,
        );
      }

      const displayName = `tool-result-${imageIndex + 1}.${this.extensionForMimeType(image.mimeType)}`;
      imageIndex += 1;
      output.push({ $ref: displayName });
      parts.push({
        inlineData: {
          displayName,
          mimeType: image.mimeType,
          data: image.base64,
        },
      });
    }

    return {
      id: callId,
      name: toolName,
      response: { output },
      ...(parts.length > 0 ? { parts } : {}),
    };
  }

  private supportsMultimodalFunctionResponses(): boolean {
    return /^gemini-3(?:[.-]|$)/.test(this._model);
  }

  private extensionForMimeType(mimeType: string): string {
    switch (mimeType) {
      case "image/jpeg":
        return "jpg";
      case "image/webp":
        return "webp";
      case "image/png":
      default:
        return "png";
    }
  }

  private mapImageItemToGemini(image: LangMessageItemImage): any | null {
    if (typeof image.base64 === "string" && image.base64.length > 0) {
      return {
        inlineData: {
          mimeType: image.mimeType || "image/png",
          data: image.base64,
        },
      };
    }

    if (typeof image.url === "string" && image.url.length > 0) {
      if (image.url.startsWith("data:")) {
        const match = image.url.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) return null;
        const mimeType = match[1];
        const data = match[2];
        return {
          inlineData: { mimeType, data },
        };
      }

      return { fileData: { fileUri: image.url } };
    }

    return null;
  }

  private buildInstructions(messageCollection: LangMessages, options?: LangOptions): string {
    return combineInstructions(
      this._systemPrompt,
      messageCollection.instructions,
      options?.schema
        ? addInstructionAboutSchema(options.schema)
        : undefined,
    );
  }

  private computeMaxTokens(messageCollection: LangMessages): number | undefined {
    if (this._maxTokens !== undefined) return this._maxTokens;
    if (!this.modelInfo) return undefined;
    return calculateModelResponseTokens(
      this.modelInfo,
      messageCollection,
      this._maxTokens,
    );
  }

  private buildTools(availableTools?: LangTool[]) {
    if (!availableTools || !Array.isArray(availableTools) || availableTools.length === 0) {
      return undefined;
    }

    const functionDeclarations = availableTools.map((tool) => ({
      name: tool.name,
      description: (tool as any).description || "",
      parameters: (tool as any).parameters,
    }));

    return functionDeclarations.length > 0 ? [{ function_declarations: functionDeclarations }] : undefined;
  }

  private applyCandidates(
    candidates: any[] | undefined,
    result: LangMessages,
    onResult?: (msg: LangMessage) => void,
  ): void {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return;
    }

    const candidate = candidates[0];
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) return;

    const assistantMessage = new LangMessage("assistant", []);
    let toolIndex = 0;

    for (const part of parts) {
      if (!part) continue;
      if (typeof part.text === "string" && part.text.length > 0) {
        assistantMessage.items.push({ type: "text", text: part.text });
      }
      if (part.inlineData && (part.inlineData.data || part.inlineData.b64_json)) {
        const base64 = part.inlineData.data || part.inlineData.b64_json;
        const mimeType = part.inlineData.mimeType || "image/png";
        assistantMessage.items.push({ type: "image", base64, mimeType });
      }
      if (part.fileData?.fileUri) {
        assistantMessage.items.push({ type: "image", url: part.fileData.fileUri });
      }
      const funcCall = part.functionCall || part.function_call;
      if (funcCall) {
        const name = funcCall.name || `function_call_${toolIndex}`;
        const fallbackCallId = `function_call_${toolIndex++}`;
        const callId = typeof funcCall.id === "string" && funcCall.id.length > 0
          ? funcCall.id
          : fallbackCallId;
        const rawArgs = funcCall.args || funcCall.arguments;
        const args = this.parseFunctionArgs(rawArgs);
        const toolItem: any = {
          type: "tool",
          callId,
          name,
          arguments: args,
        };
        // Store thoughtSignature if present (required by Google Gemini API)
        // Google API returns thoughtSignature (camelCase) at the part level
        const thoughtSignature = part.thoughtSignature || funcCall?.thoughtSignature;
        if (thoughtSignature) {
          toolItem.thoughtSignature = thoughtSignature;
        }
        assistantMessage.items.push(toolItem);
      }
    }

    if (assistantMessage.items.length > 0) {
      result.push(assistantMessage);
      onResult?.(assistantMessage);
    }
  }

  private parseFunctionArgs(rawArgs: any): Record<string, any> {
    if (!rawArgs) return {};
    if (typeof rawArgs === "object") return rawArgs;
    if (typeof rawArgs === "string") {
      try {
        return JSON.parse(rawArgs);
      } catch {
        return {};
      }
    }
    return {};
  }
}
