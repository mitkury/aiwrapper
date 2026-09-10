import {
  assertPcmFrame,
  createAbortError,
  linkAbortSignal,
  throwIfAborted,
} from "../speech/audio.js";
import type { PcmAudioFormat, PcmAudioFrame } from "../speech/types.js";
import type {
  SpeechToSpeechProvider,
  SpeechToSpeechSession,
  SpeechToSpeechSessionOptions,
} from "./types.js";
import { createObservableSpeechToSpeechSession } from "./session-events.js";
import { executeSpeechToSpeechToolCall } from "./live-lang-tools.js";
import type { ToolRequest } from "../lang/messages.js";

export type MockSpeechToSpeechOptions = {
  inputSampleRate?: number;
  outputSampleRate?: number;
  outputFrames?: Int16Array[];
  inputTranscript?: string;
  outputTranscript?: string;
  interruptAfterFrame?: number;
  delayMs?: number;
  toolCalls?: ToolRequest[];
};

export class MockSpeechToSpeech implements SpeechToSpeechProvider {
  readonly inputFormat: PcmAudioFormat;
  readonly outputFormat: PcmAudioFormat;
  readonly receivedFrames: PcmAudioFrame[] = [];
  private readonly outputFrames: Int16Array[];
  private readonly delayMs: number;

  constructor(private readonly options: MockSpeechToSpeechOptions = {}) {
    this.inputFormat = pcmFormat(options.inputSampleRate ?? 24000, "input");
    this.outputFormat = pcmFormat(options.outputSampleRate ?? 24000, "output");
    this.outputFrames = options.outputFrames?.map(
      (samples) => new Int16Array(samples),
    ) ?? [new Int16Array([0])];
    if (this.outputFrames.length === 0) {
      throw new RangeError(
        "Mock speech-to-speech requires at least one output frame",
      );
    }
    this.delayMs = options.delayMs ?? 0;
    if (!Number.isFinite(this.delayMs) || this.delayMs < 0) {
      throw new RangeError(
        "Mock speech-to-speech delayMs must be a non-negative number",
      );
    }
    if (
      options.interruptAfterFrame !== undefined &&
      (!Number.isInteger(options.interruptAfterFrame) ||
        options.interruptAfterFrame < 1 ||
        options.interruptAfterFrame > this.outputFrames.length)
    ) {
      throw new RangeError(
        "Mock speech-to-speech interruptAfterFrame must select an output frame",
      );
    }
  }

  async createSession(
    options: SpeechToSpeechSessionOptions = {},
  ): Promise<SpeechToSpeechSession> {
    return createObservableSpeechToSpeechSession(options, async (events) =>
      new MockSpeechToSpeechSession(
        this.inputFormat,
        events,
        (frame) => {
          this.receivedFrames.push({
            ...frame,
            samples: new Int16Array(frame.samples),
          });
        },
        (signal) => this.emitOutput(events, signal),
      ),
    );
  }

  private async emitOutput(
    session: SpeechToSpeechSessionOptions,
    signal: AbortSignal,
  ): Promise<void> {
    session.onEvent?.({ type: "response-start" });
    if (this.options.inputTranscript) {
      session.onEvent?.({
        type: "input-transcript",
        transcript: { type: "final", text: this.options.inputTranscript },
      });
    }

    for (const call of this.options.toolCalls ?? []) {
      await executeSpeechToSpeechToolCall(session, call, signal);
    }

    for (let index = 0; index < this.outputFrames.length; index++) {
      await abortableDelay(this.delayMs, signal);
      throwIfAborted(signal);
      session.onEvent?.({
        type: "output-audio",
        frame: {
          ...this.outputFormat,
          samples: new Int16Array(this.outputFrames[index]),
        },
      });
      if (this.options.interruptAfterFrame === index + 1) {
        session.onEvent?.({ type: "response-interrupted" });
        return;
      }
    }

    if (this.options.outputTranscript) {
      session.onEvent?.({
        type: "output-transcript",
        transcript: { type: "final", text: this.options.outputTranscript },
      });
    }
    session.onEvent?.({ type: "response-end" });
  }
}

class MockSpeechToSpeechSession {
  private readonly controller = new AbortController();
  private readonly unlinkAbort: () => void;
  private outputTask?: Promise<void>;
  private closed = false;

  constructor(
    private readonly inputFormat: PcmAudioFormat,
    options: SpeechToSpeechSessionOptions,
    private readonly record: (frame: PcmAudioFrame) => void,
    private readonly startOutput: (signal: AbortSignal) => Promise<void>,
  ) {
    this.unlinkAbort = linkAbortSignal(options.signal, this.controller);
    throwIfAborted(this.controller.signal);
  }

  async appendAudio(frame: PcmAudioFrame): Promise<void> {
    this.assertOpen();
    throwIfAborted(this.controller.signal);
    assertPcmFrame(frame);
    if (frame.sampleRate !== this.inputFormat.sampleRate) {
      throw new Error(
        `Mock speech-to-speech requires ${this.inputFormat.sampleRate} Hz PCM and cannot accept ${frame.sampleRate} Hz without resampling`,
      );
    }
    if (frame.samples.length === 0) return;
    this.record(frame);
    if (!this.outputTask) {
      this.outputTask = this.startOutput(this.controller.signal);
      void this.outputTask.catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.unlinkAbort();
    await this.outputTask?.catch((error) => {
      if (!isAbortError(error)) throw error;
    });
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Speech-to-speech session is closed");
  }
}

function pcmFormat(sampleRate: number, direction: string): PcmAudioFormat {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(
      `Mock speech-to-speech ${direction} sample rate must be a positive integer`,
    );
  }
  return { encoding: "pcm_s16le", channels: 1, sampleRate };
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}
