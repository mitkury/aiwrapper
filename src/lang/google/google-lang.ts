import { LangOptions, LanguageProvider } from "../language-provider.ts";
import { httpRequestWithRetry as fetch } from "../../http-request.ts";
import { models, Model } from "aimodels";
import { LangContentPart, LangImageInput } from "../language-provider.ts";
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";
import { LangMessage, LangMessages, LangMessageItemImage, LangMessageItemTool, LangTool } from "../messages.ts";
import { addInstructionAboutSchema } from "../prompt-for-json.ts";
import { isZodSchema, zodToJsonSchema } from "../schema/schema-utils.ts";

export type GoogleLangOptions = {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
};

export class GoogleLang extends LanguageProvider {
  private _apiKey: string;
  private _model: string;
  private _systemPrompt: string;
  private _maxTokens?: number;
  private modelInfo?: Model;

  constructor(options: GoogleLangOptions) {
    const modelName = options.model || "gemini-2.5-flash-preview";
    super(modelName);

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
    if (this._systemPrompt) {
      messages.instructions = this._systemPrompt;
    }
    messages.addUserMessage(prompt);
    return await this.chat(messages, options);
  }

  async chat(
    messages: LangMessage[] | LangMessages,
    options?: LangOptions,
  ): Promise<LangMessages> {
    const messageCollection = messages instanceof LangMessages
      ? messages
      : new LangMessages(messages);

    const instructions = this.buildInstructions(messageCollection, options);

    const contents = this.transformMessagesForProvider(messageCollection as any);

    const maxOutputTokens = this.computeMaxTokens(messageCollection);
    const tools = this.buildTools(messageCollection.availableTools);

    const generationConfig: Record<string, any> = {};
    if (typeof maxOutputTokens === "number") {
      generationConfig.maxOutputTokens = maxOutputTokens;
    }

    const requestBody: any = {
      contents,
      ...(instructions ? {
        systemInstruction: {
          role: "system",
          parts: [{ text: instructions }],
        },
      } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
      ...(tools ? { tools } : {}),
      ...(options?.providerSpecificBody ?? {}),
    };

    if (options?.schema) {
      const schema = options.schema;
      requestBody.responseMimeType = "application/json";
      requestBody.responseSchema = isZodSchema(schema)
        ? zodToJsonSchema(schema)
        : schema;
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this._apiKey,
            ...(options?.providerSpecificHeaders ?? {}),
          },
          body: JSON.stringify(requestBody),
          signal: options?.signal,
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Google API request failed with status ${response.status}${body ? `: ${body}` : ""}`,
        );
      }

      const data = await response.json();
      this.applyCandidates(data?.candidates, messageCollection, options?.onResult);
    } catch (error) {
      if ((error as any)?.name === "AbortError") {
        messageCollection.aborted = true;
        (error as any).partialResult = messageCollection;
      }
      throw error;
    }

    messageCollection.finished = true;

    const toolsResults = await messageCollection.executeRequestedTools();
    if (options?.onResult && toolsResults) options.onResult(toolsResults);

    return messageCollection;
  }

  protected transformMessagesForProvider(messages: LangMessages): any[] {
    const mapped: any[] = [];

    for (const msg of messages) {
      if (msg.role === "tool-results") {
        const parts = msg.toolResults.map((tr) => ({
          functionResponse: {
            name: tr.name,
            response: typeof tr.result === "object" && tr.result !== null
              ? tr.result
              : { result: tr.result },
          },
        }));
        mapped.push({ role: "user", parts });
        continue;
      }

      if (msg.role !== "user" && msg.role !== "assistant") {
        continue;
      }

      const parts: any[] = [];

      const legacyContent = (msg as any).content as any;
      if (Array.isArray(legacyContent)) {
        parts.push(...this.mapPartsToGemini(legacyContent as LangContentPart[]));
      } else {
        for (const item of msg.items) {
          if (item.type === "text") {
            parts.push({ text: item.text });
          } else if (item.type === "image") {
            const imagePart = this.mapImageItemToGemini(item as LangMessageItemImage);
            if (imagePart) parts.push(imagePart);
          } else if (item.type === "tool") {
            const toolItem = item as LangMessageItemTool;
            parts.push({
              functionCall: {
                name: toolItem.name,
                args: toolItem.arguments ?? {},
              },
            });
          }
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

  private mapPartsToGemini(parts: LangContentPart[]): any[] {
    const out: any[] = [];
    for (const p of parts) {
      if (p.type === 'text') {
        out.push({ text: p.text });
      } else if (p.type === 'image') {
        const inlineData = this.imageInputToGeminiInlineData(p.image);
        out.push({ inlineData });
      }
    }
    return out;
  }

  private imageInputToGeminiInlineData(image: LangImageInput): { mimeType: string; data: string } {
    const kind: any = (image as any).kind;
    if (kind === 'base64') {
      const base64 = (image as any).base64 as string;
      const mimeType = (image as any).mimeType || 'image/png';
      return { mimeType, data: base64 };
    }
    if (kind === 'url') {
      const url = (image as any).url as string;
      if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+);base64,(.*)$/);
        if (!match) throw new Error('Invalid data URL for Gemini image');
        const mimeType = match[1];
        const data = match[2];
        return { mimeType, data };
      }
      throw new Error("Gemini inline image requires base64 or data URL. Provide base64+mimeType or a data: URL.");
    }
    if (kind === 'bytes' || kind === 'blob') {
      throw new Error("Gemini image input requires base64. Convert bytes/blob to base64 first.");
    }
    throw new Error('Unknown image input kind for Gemini');
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
    let instructions = messageCollection.instructions || "";
    if (this._systemPrompt) {
      instructions = instructions
        ? `${this._systemPrompt}\n\n${instructions}`
        : this._systemPrompt;
    }

    if (options?.schema) {
      const baseInstruction = instructions !== "" ? `${instructions}\n\n` : "";
      instructions = baseInstruction + addInstructionAboutSchema(options.schema);
      messageCollection.instructions = instructions;
    }

    return instructions;
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

    return functionDeclarations.length > 0 ? { functionDeclarations } : undefined;
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
      if (part.functionCall) {
        const name = part.functionCall.name || `function_call_${toolIndex}`;
        const callId = `function_call_${toolIndex++}`;
        const rawArgs = part.functionCall.args;
        const args = this.parseFunctionArgs(rawArgs);
        assistantMessage.items.push({
          type: "tool",
          callId,
          name,
          arguments: args,
        });
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
