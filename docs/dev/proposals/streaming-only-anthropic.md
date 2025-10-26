# Proposal: Streaming-Only Architecture for Anthropic Provider

## Overview
Simplify the Anthropic provider by removing non-streaming support and always using streaming internally, regardless of whether the user provides an `onResult` callback.

## Current State Analysis

### Problems with Dual-Mode Approach

1. **Code Duplication**: We maintain two separate code paths:
   - `processNonStreamingResponse()` for non-streaming
   - `handleStreamEvent()` + `finalizeStreamingResponse()` for streaming
   - Both do essentially the same thing: parse content blocks, accumulate tool calls, build messages

2. **Maintenance Burden**: Any fix or feature needs to be implemented twice
   - Example: The recent tool arguments fix required changes in both paths
   - Risk of divergence between the two implementations

3. **Testing Complexity**: Need to test both code paths for every feature

4. **Performance**: Non-streaming mode still has to wait for the entire response before returning, so there's no latency benefit

### Why Streaming-Only Works

1. **Streaming is Universal**: All major LLM providers support streaming
2. **Better UX**: Even without `onResult`, we can still process data as it arrives internally
3. **Single Code Path**: One implementation to maintain and test
4. **Future-Proof**: Streaming is the direction the industry is moving

## Proposed Changes

### 1. Always Use Streaming Internally

```typescript
async chat(
  messages: LangMessage[] | LangMessages,
  options?: LangOptions,
): Promise<LangMessages> {
  const messageCollection = messages instanceof LangMessages
    ? messages
    : new LangMessages(messages);

  const { system, providerMessages, requestMaxTokens, tools } =
    this.prepareRequest(messageCollection);

  const result = messageCollection;
  
  // Always use streaming - just don't emit events if no callback
  const requestBody: any = {
    model: this._config.model,
    messages: providerMessages,
    max_tokens: requestMaxTokens,
    system,
    stream: true,  // Always stream
    ...(tools ? { tools } : {}),
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    // ... headers
  });

  const streamState: StreamState = {
    isReceivingThinking: false,
    thinkingContent: "",
    toolCalls: [],
    pendingToolInputs: new Map(),
    indexToToolId: new Map(),
  };

  await processResponseStream(response, (data: any) =>
    this.handleStreamEvent(data, result, options?.onResult, streamState)
  );

  // Automatically execute tools if the assistant requested them
  const toolResults = await result.executeRequestedTools();
  if (options?.onResult && toolResults) options.onResult(toolResults);

  return result;
}
```

### 2. Remove Non-Streaming Method

- Delete `processNonStreamingResponse()`
- Remove the `isStreaming` check and branching logic
- Simplify the code path

### 3. Refactor Stream Processing

Instead of a monolithic `handleStreamEvent()`, break it into focused methods:

```typescript
private handleStreamEvent(
  data: any,
  result: LangMessages,
  onResult?: (result: LangMessage) => void,
  streamState: StreamState
): void {
  switch (data.type) {
    case "message_stop":
      this.handleMessageStop(result, streamState, onResult);
      break;
    case "content_block_start":
      this.handleContentBlockStart(data, streamState);
      break;
    case "content_block_delta":
      this.handleContentBlockDelta(data, result, streamState, onResult);
      break;
    case "content_block_stop":
      this.handleContentBlockStop(result, streamState, onResult);
      break;
  }
}

private handleContentBlockStart(data: any, streamState: StreamState): void {
  if (data.content_block?.type === "tool_use") {
    const { id, name = '', index } = { ...data.content_block, index: data.index };
    streamState.indexToToolId.set(index, id);
    streamState.pendingToolInputs.set(id, { name, buffer: '' });
    streamState.toolCalls.push({ id, name, arguments: {} });
  } else if (data.content_block?.type === "thinking") {
    streamState.isReceivingThinking = true;
  }
}

private handleContentBlockDelta(
  data: any,
  result: LangMessages,
  streamState: StreamState,
  onResult?: (result: LangMessage) => void
): void {
  // Handle thinking
  if (data.delta?.type === "thinking_delta" && data.delta.thinking) {
    streamState.isReceivingThinking = true;
    streamState.thinkingContent += data.delta.thinking;
    const msg = result.appendToAssistantThinking(data.delta.thinking);
    if (msg) onResult?.(msg);
    return;
  }

  // Handle tool arguments
  const toolUseId = this.getToolIdFromIndex(data.index, streamState);
  if (toolUseId && streamState.pendingToolInputs.has(toolUseId)) {
    this.accumulateToolArguments(data.delta, toolUseId, streamState);
    return;
  }

  // Handle regular text
  const deltaText = data.delta?.text || "";
  if (!toolUseId && deltaText) {
    this.handleTextDelta(deltaText, result, streamState, onResult);
  }
}

private getToolIdFromIndex(index: number | undefined, streamState: StreamState): string | undefined {
  return index !== undefined ? streamState.indexToToolId.get(index) : undefined;
}

private accumulateToolArguments(delta: any, toolUseId: string, streamState: StreamState): void {
  const acc = streamState.pendingToolInputs.get(toolUseId)!;
  const argChunk = delta.partial_json || delta.input_json_delta || delta.text;

  if (typeof argChunk === 'string' && argChunk.length > 0) {
    acc.buffer += argChunk;
    this.tryParseToolArguments(toolUseId, acc.buffer, streamState);
  }
}

private tryParseToolArguments(toolUseId: string, buffer: string, streamState: StreamState): void {
  try {
    const parsed = JSON.parse(buffer);
    const entry = streamState.toolCalls.find((t) => t.id === toolUseId);
    if (entry) entry.arguments = parsed;
  } catch {
    // Incomplete JSON, will retry on next chunk
  }
}

private handleTextDelta(
  text: string,
  result: LangMessages,
  streamState: StreamState,
  onResult?: (result: LangMessage) => void
): void {
  if (streamState.isReceivingThinking) {
    streamState.thinkingContent += text;
    const msg = result.appendToAssistantThinking(text);
    if (msg) onResult?.(msg);
  } else {
    const msg = result.appendToAssistantText(text);
    onResult?.(msg);
  }
}
```

## Additional Code Improvements

### 4. Better Type Safety

```typescript
// More specific types for stream events
type AnthropicStreamEvent = 
  | { type: "message_start"; message: any }
  | { type: "message_stop" }
  | { type: "content_block_start"; index: number; content_block: ContentBlock }
  | { type: "content_block_delta"; index: number; delta: ContentDelta }
  | { type: "content_block_stop"; index: number };

type ContentBlock = 
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, any> }
  | { type: "thinking"; thinking: string };

type ContentDelta =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "input_json_delta"; partial_json: string };

// Cleaner StreamState with better organization
interface StreamState {
  thinking: {
    isReceiving: boolean;
    content: string;
  };
  tools: {
    calls: ToolCall[];
    pendingInputs: Map<string, PendingToolInput>;
    indexToId: Map<number, string>;
  };
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

interface PendingToolInput {
  name: string;
  buffer: string;
}
```

### 5. Improved Error Handling

```typescript
private async makeRequest(body: any): Promise<Response> {
  try {
    return await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-api-key": this._config.apiKey
      },
      body: JSON.stringify(body),
      onError: async (res: Response, error: Error): Promise<void> => {
        await this.handleRequestError(res, error);
      },
    } as any);
  } catch (err) {
    throw new Error(`Anthropic API request failed: ${err}`);
  }
}

private async handleRequestError(res: Response, error: Error): Promise<void> {
  const status = res.status;
  
  if (status === 401) {
    throw new Error("Anthropic API key is invalid. Please check your API key and try again.");
  }
  
  if (status === 429) {
    throw new Error("Rate limit exceeded. Please try again later.");
  }
  
  if (status === 400) {
    const data = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(data);
      throw new Error(`Anthropic API error: ${parsed.error?.message || data}`);
    } catch {
      throw new Error(`Anthropic API error: ${data}`);
    }
  }
  
  throw error;
}
```

### 6. Separate Message Transformation Logic

Create a dedicated class for message transformation:

```typescript
class AnthropicMessageTransformer {
  static toProviderFormat(messages: LangMessage[]): any[] {
    return messages.map(msg => this.transformMessage(msg)).filter(Boolean);
  }

  private static transformMessage(msg: LangMessage): any {
    switch (msg.role) {
      case 'tool':
        return this.transformToolCallMessage(msg);
      case 'tool-results':
        return this.transformToolResultsMessage(msg);
      default:
        return this.transformRegularMessage(msg);
    }
  }

  private static transformToolCallMessage(msg: LangMessage): any {
    const content = msg.content as any;
    if (!Array.isArray(content)) return null;
    
    const blocks = content.map(tc => ({
      type: 'tool_use',
      id: tc.callId || tc.id,
      name: tc.name,
      input: tc.arguments || {}
    }));
    
    return { role: 'assistant', content: blocks };
  }

  private static transformToolResultsMessage(msg: LangMessage): any {
    const content = msg.content as any;
    if (!Array.isArray(content)) return null;
    
    const blocks = content.map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.toolId,
      content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
    }));
    
    return { role: 'user', content: blocks };
  }

  private static transformRegularMessage(msg: LangMessage): any {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    
    if (Array.isArray(msg.content)) {
      return {
        role,
        content: this.transformContentParts(msg.content as LangContentPart[])
      };
    }
    
    return { role, content: msg.content };
  }

  private static transformContentParts(parts: LangContentPart[]): any[] {
    return parts.map(p => {
      switch (p.type) {
        case 'text':
          return { type: 'text', text: p.text };
        case 'image':
          return { type: 'image', source: this.transformImageInput(p.image) };
        case 'thinking':
          return { type: 'thinking', thinking: p.text };
        default:
          return { type: 'text', text: JSON.stringify(p) };
      }
    });
  }

  private static transformImageInput(image: LangImageInput): any {
    // ... image transformation logic
  }
}
```

## Benefits

1. **Simpler Codebase**: 
   - ~100 fewer lines of code
   - Single code path to maintain
   - Easier to understand

2. **Better Reliability**:
   - No risk of divergence between streaming and non-streaming
   - Fixes apply to all use cases automatically

3. **Easier Testing**:
   - Only need to test one code path
   - Faster test suite

4. **Better Performance**:
   - Internal streaming means we can start processing early
   - Lower memory usage (process as we go)

5. **More Maintainable**:
   - Smaller, focused methods
   - Clear separation of concerns
   - Better type safety

## Migration Impact

### Breaking Changes
None - the public API remains the same. Users who don't provide `onResult` will see no difference in behavior.

### Implementation Steps

1. Remove non-streaming code path from `chat()`
2. Remove `processNonStreamingResponse()` method
3. Refactor `handleStreamEvent()` into smaller methods
4. Add better type definitions
5. Improve error handling
6. Extract message transformation to separate class
7. Update tests to remove non-streaming test cases
8. Update documentation

### Testing Strategy

1. Run existing streaming tests - should pass
2. Convert non-streaming tests to not provide `onResult` - should still pass
3. Add tests for error cases
4. Performance benchmarks to ensure no regression

## Timeline

- Phase 1: Streaming-only refactor (2-3 hours)
- Phase 2: Code structure improvements (2-3 hours)
- Phase 3: Testing and validation (1-2 hours)

## Future Work

After completing this for Anthropic:
1. Apply same pattern to OpenAI provider
2. Apply to Google provider
3. Apply to other providers
4. Create shared base class for streaming-only providers

