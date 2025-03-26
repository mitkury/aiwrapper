import { LangChatMessages, LangResultWithMessages, LangResultWithString, LanguageProvider } from "../language-provider.ts";
import { httpRequestWithRetry as fetch } from "../../http-request.ts";
import { processResponseStream } from "../../process-response-stream.ts";
import { models, Model } from 'aimodels';
import { calculateModelResponseTokens } from "../utils/token-calculator.ts";

export type OllamaLangOptions = {
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  url?: string;
};

export type OllamaLangConfig = {
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  baseURL: string;
};

export class OllamaLang extends LanguageProvider {
  protected _config: OllamaLangConfig;
  protected modelInfo?: Model;

  constructor(options: OllamaLangOptions) {
    const modelName = options.model || "llama2:latest";
    super(modelName);
    
    this._config = {
      model: modelName,
      systemPrompt: options.systemPrompt || "",
      maxTokens: options.maxTokens,
      baseURL: options.url || "http://localhost:11434",
    };
    
    // Try to get model info from aimodels
    this.modelInfo = models.id(modelName);
    
    // Print a warning if model is not in database, but don't block execution
    // This allows users to use any Ollama model, even if it's not in our database
    if (!this.modelInfo) {
      //console.error(`Invalid Ollama model: ${modelName}. Model not found in aimodels database.`);
    }
  }

  protected transformBody(body: Record<string, unknown>): Record<string, unknown> {
    // Ollama uses context_length instead of max_tokens
    if (body.max_tokens) {
      const { max_tokens, ...rest } = body;
      return {
        ...rest,
        context_length: max_tokens
      };
    }
    return body;
  }

  async ask(
    prompt: string,
    onResult?: (result: LangResultWithString) => void,
  ): Promise<LangResultWithString> {
    const result = new LangResultWithString(prompt);

    // Try to get model info and calculate max tokens
    let requestMaxTokens = this._config.maxTokens;

    if (this.modelInfo) {
      requestMaxTokens = calculateModelResponseTokens(
        this.modelInfo,
        [{ role: "user", content: prompt }],
        this._config.maxTokens
      );
    }

    let visibleContent = "";
    const onData = (data: any) => {
      if (data.done) {
        // Final check for thinking content when streaming is complete
        const extracted = this.extractThinking(visibleContent);
        if (extracted.thinking) {
          result.thinking = extracted.thinking;
          result.answer = extracted.answer;
        }
        
        result.finished = true;
        onResult?.(result);
        return;
      }

      if (data.response) {
        visibleContent += data.response;
        
        // Check for thinking content in each chunk
        const extracted = this.extractThinking(visibleContent);
        if (extracted.thinking) {
          result.thinking = extracted.thinking;
          result.answer = extracted.answer;
        } else {
          // If no thinking content is found, just use the full response
          result.answer = visibleContent;
        }
      }

      onResult?.(result);
    };

    const response = await fetch(`${this._config.baseURL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this._config.model,
        prompt,
        stream: true,
        ...(requestMaxTokens && { num_predict: requestMaxTokens })
      }),
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);
    
    // For non-streaming case, perform final extraction
    if (!onResult) {
      const extracted = this.extractThinking(result.answer);
      if (extracted.thinking) {
        result.thinking = extracted.thinking;
        result.answer = extracted.answer;
      }
    }

    return result;
  }

  async chat(messages: LangChatMessages, onResult?: (result: LangResultWithMessages) => void): Promise<LangResultWithMessages> {
    const result = new LangResultWithMessages(
      messages,
    );

    // Try to get model info and calculate max tokens
    let requestMaxTokens = this._config.maxTokens;

    if (this.modelInfo) {
      requestMaxTokens = calculateModelResponseTokens(
        this.modelInfo,
        messages,
        this._config.maxTokens
      );
    }

    let visibleContent = "";
    const onData = (data: any) => {
      if (data.done) {
        // Final check for thinking content when streaming is complete
        const extracted = this.extractThinking(visibleContent);
        if (extracted.thinking) {
          result.thinking = extracted.thinking;
          result.answer = extracted.answer;
        }
        
        result.finished = true;
        onResult?.(result);
        return;
      }

      if (data.message && data.message.content) {
        const newContent = data.message.content;
        visibleContent += newContent;
        
        // Check for thinking content in each chunk
        const extracted = this.extractThinking(visibleContent);
        if (extracted.thinking) {
          result.thinking = extracted.thinking;
          result.answer = extracted.answer;
        } else {
          // If no thinking content is found, just use the full response
          result.answer = visibleContent;
        }
      }

      onResult?.(result);
    };

    const response = await fetch(`${this._config.baseURL}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: this._config.model,
        messages,
        stream: true,
        ...(requestMaxTokens && { num_predict: requestMaxTokens }),
      })
    })
      .catch((err) => {
        throw new Error(err);
      });

    await processResponseStream(response, onData);
    
    // For non-streaming case, perform final extraction
    if (!onResult) {
      const extracted = this.extractThinking(result.answer);
      if (extracted.thinking) {
        result.thinking = extracted.thinking;
        result.answer = extracted.answer;
      }
    }

    return result;
  }
  
  // Helper to extract thinking content from <think> tags
  private extractThinking(content: string): { thinking: string, answer: string } {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    const matches = content.match(thinkRegex);
    
    if (!matches || matches.length === 0) {
      return { thinking: "", answer: content };
    }
    
    // Extract thinking content
    const thinking = matches
      .map((match: string) => match.replace(/<think>|<\/think>/g, "").trim())
      .join("\n");
    
    // Remove thinking tags for clean answer
    const answer = content.replace(thinkRegex, "").trim();
    
    return { thinking, answer };
  }
}
