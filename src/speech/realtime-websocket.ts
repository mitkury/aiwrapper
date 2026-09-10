type SocketEvent = { data?: unknown; error?: unknown };
type SocketListener = (event: SocketEvent) => void;

export type RealtimeSpeechWebSocketData =
  | string
  | ArrayBuffer
  | ArrayBufferView;

export interface RealtimeSpeechWebSocket {
  readonly readyState: number;
  send(data: RealtimeSpeechWebSocketData): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: SocketListener): void;
  removeEventListener(type: string, listener: SocketListener): void;
}

export type RealtimeSpeechWebSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => RealtimeSpeechWebSocket | Promise<RealtimeSpeechWebSocket>;

export async function createNodeWebSocket(
  url: string,
  headers: Record<string, string>,
): Promise<RealtimeSpeechWebSocket> {
  const module = await import("ws");
  return new module.WebSocket(url, { headers }) as unknown as RealtimeSpeechWebSocket;
}

export async function socketDataToText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    ));
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new TextDecoder().decode(await data.arrayBuffer());
  }
  throw new Error("Realtime speech provider returned an unsupported message");
}

export function websocketURL(baseURL: string, path: string): string {
  const websocketBase = baseURL
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:")
    .replace(/\/$/, "");
  return `${websocketBase}${path}`;
}
