// Agent state
export type AgentState = "idle" | "running";

// Core built-in event types
export interface AgentFinishedEvent<TOutput> {
  type: "finished";
  output: TOutput;
}

export interface AgentErrorEvent {
  type: "error";
  error: Error;
}

export interface AgentStateEvent {
  type: "state";
  state: AgentState;
}

export interface AgentInputEvent<TInput> {
  type: "input";
  input: TInput;
}

// Base for custom events that agents can define
export interface AgentCustomEvent<TType extends string, TData = any> {
  type: TType;
  data: TData;
}

// Union of all possible agent events - extensible for custom events
export type AgentEvent<TInput, TOutput, TCustomEvents = never> = 
  | AgentFinishedEvent<TOutput>
  | AgentErrorEvent
  | AgentStateEvent
  | AgentInputEvent<TInput>
  | TCustomEvents;

// Event listener function type
export type AgentEventListener<TInput, TOutput, TCustomEvents = never> = (event: AgentEvent<TInput, TOutput, TCustomEvents>) => void;

// Subscription token for unsubscribing
export type SubscriptionToken = () => void;

// Abstract base Agent class
export abstract class Agent<TInput, TOutput, TCustomEvents = never> {
  private listeners: AgentEventListener<TInput, TOutput, TCustomEvents>[] = [];
  private lastInput: TInput | null = null;
  private _state: AgentState = "idle";

  constructor() {
    // No schemas needed - just TypeScript types
  }

  // Get current agent state
  get state(): AgentState {
    return this._state;
  }

  // Subscribe to agent events
  subscribe(listener: AgentEventListener<TInput, TOutput, TCustomEvents>): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  // Provide input to the agent
  input(data: TInput): void {
    this.lastInput = data;
    this.emit({ type: "input", input: data });

    // Allow implementations to handle input processing
    this.inputInternal?.(data);
  }

  // Run the agent either with a new input or the provided in this.lastInput
  async run(input?: TInput): Promise<TOutput | void> {
    this.setState("running");

    try {
      const inputToUse = input || this.lastInput;
      if (!inputToUse) {
        throw new Error("No input provided. Call input() first or pass input to run().");
      }
      
      const result = await this.runInternal(inputToUse);
      this.setState("idle");
      return result;
    } catch (error) {
      this.emit({ type: "error", error: error as Error });
      this.setState("idle");
      throw error;
    }
  }

  // Set state and emit state change event
  private setState(newState: AgentState): void {
    if (this._state !== newState) {
      this._state = newState;
      this.emit({ type: "state", state: newState });
    }
  }

  // Emit events to all listeners
  protected emit(event: AgentEvent<TInput, TOutput, TCustomEvents>): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in agent event listener:", error);
      }
    });
  }

  // Abstract method to be implemented by concrete agents
  // Implementations can return TOutput for one-off tasks or void for long-running agents
  protected abstract runInternal(input?: TInput): Promise<TOutput | void>;

  // Optional method for implementations to handle input processing
  // Called after input validation and event emission
  protected inputInternal?(input: TInput): void;
}
