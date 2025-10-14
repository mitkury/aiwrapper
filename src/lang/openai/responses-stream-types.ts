// Minimal types for OpenAI Responses SSE events that we actually consume.

export type OutputTextPart = {
  type: 'output_text';
  text: string;
  annotations?: unknown[];
  logprobs?: unknown[];
};

export type RefusalPart = {
  type: 'refusal';
  text?: string;
};

export type ReasoningTextPart = {
  type: 'reasoning_text';
  text: string;
  annotations?: unknown[];
};

export type MessageContentPart = OutputTextPart | RefusalPart | ReasoningTextPart;

export type ReasoningItem = {
  id: string;
  type: 'reasoning';
  summary?: unknown[];
};

export type MessageItem = {
  id: string;
  type: 'message';
  status: 'in_progress' | 'completed';
  role: 'assistant';
  content: MessageContentPart[];
};

export type ResponseOutputItem = ReasoningItem | MessageItem;

export type ResponsesObject = {
  id: string;
  object: 'response';
  created_at: number;
  status: 'in_progress' | 'completed' | 'incomplete';
  model: string;
  output: ResponseOutputItem[];
};

type BaseEvent<T extends string> = {
  type: T;
  sequence_number?: number;
};

export type ResponseCreatedEvent = BaseEvent<'response.created'> & {
  response: ResponsesObject;
};

export type ResponseInProgressEvent = BaseEvent<'response.in_progress'> & {
  response: ResponsesObject;
};

export type ResponseCompletedEvent = BaseEvent<'response.completed'> & {
  response: ResponsesObject;
};

export type ResponseIncompleteEvent = BaseEvent<'response.incomplete'> & {
  response?: ResponsesObject;
};

export type OutputItemAddedEvent = BaseEvent<'response.output_item.added'> & {
  output_index: number;
  item: ResponseOutputItem;
};

export type OutputItemDoneEvent = BaseEvent<'response.output_item.done'> & {
  output_index: number;
  item: ResponseOutputItem;
};

export type ContentPartAddedEvent = BaseEvent<'response.content_part.added'> & {
  item_id: string;
  output_index: number;
  content_index: number;
  part: MessageContentPart;
};

export type ContentPartDoneEvent = BaseEvent<'response.content_part.done'> & {
  item_id: string;
  output_index: number;
  content_index: number;
  part: MessageContentPart;
};

export type OutputTextDeltaEvent = BaseEvent<'response.output_text.delta'> & {
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
};

export type OutputTextDoneEvent = BaseEvent<'response.output_text.done'> & {
  item_id: string;
  output_index: number;
  content_index: number;
  text?: string;
  output_text?: string;
};

export type PartialImageEvent = BaseEvent<'response.image_generation_call.partial_image'> & {
  partial_image_b64: string;
};

// Function call arguments streaming events
export type FunctionCallArgumentsDeltaEvent = BaseEvent<'response.function_call_arguments.delta'> & {
  item_id: string;
  output_index: number;
  delta: string;
};

export type FunctionCallArgumentsDoneEvent = BaseEvent<'response.function_call_arguments.done'> & {
  item_id: string;
  output_index: number;
  arguments: string;
};

export type ReasoningTextDeltaEvent = BaseEvent<'response.reasoning_text.delta'> & {
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
};

export type ResponsesStreamEvent =
  | ResponseCreatedEvent
  | ResponseInProgressEvent
  | ResponseCompletedEvent
  | ResponseIncompleteEvent
  | OutputItemAddedEvent
  | OutputItemDoneEvent
  | ContentPartAddedEvent
  | ContentPartDoneEvent
  | OutputTextDeltaEvent
  | OutputTextDoneEvent
  | PartialImageEvent
  | FunctionCallArgumentsDeltaEvent
  | FunctionCallArgumentsDoneEvent
  | ReasoningTextDeltaEvent;


