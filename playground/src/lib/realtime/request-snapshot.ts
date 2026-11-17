export type RequestItem = Record<string, unknown> & {
	type: string;
	text?: string;
	base64?: string;
	mimeType?: string;
};
export type RequestPayload = {
	kind: 'request';
	itemId: string;
	conversation: {
		instructions?: string;
		messages: { role: string; items: RequestItem[]; meta?: unknown }[];
	};
	tools?: unknown[];
	maxTokens?: number;
	camera?: {
		candidateCount: number;
		omittedCount: number;
		evictedSincePreviousTurn: number;
		reusedLatest: boolean;
		policy: string;
		itemStart: number;
		frames: { id: number; capturedAtMs: number; clock: string }[];
	} | null;
};
export type RequestSnapshot = {
	itemId: string;
	time: string;
	payload: RequestPayload;
	size: number;
	wire?: ProviderRequest;
};

/** Requests arrive as independent JSON objects; keep their payload, without cloning image strings. */
export function retainRequest(requests: RequestSnapshot[], payload: RequestPayload, at: number) {
	const snapshot = {
		itemId: payload.itemId,
		time: (at / 1000).toFixed(2),
		payload,
		// Conservative UTF-16 serialized size, including all text, tools and image data.
		size: JSON.stringify(payload).length * 2
	};
	const retained = [...requests, snapshot];
	let size = retained.reduce((sum, r) => sum + r.size, 0);
	while (retained.length && (retained.length > 8 || size > 16 * 1024 * 1024))
		size -= retained.shift()!.size;
	return { requests: retained, dropped: requests.length + 1 - retained.length };
}

export function cameraRequest(request: RequestSnapshot) {
	const camera = request.payload.camera;
	if (!camera) return undefined;
	const message = request.payload.conversation.messages.findLast((m) => m.role === 'user');
	const images = message?.items.slice(camera.itemStart).filter((i) => i.type === 'image') ?? [];
	return {
		itemId: request.itemId,
		time: request.time,
		camera,
		frames: camera.frames.map((f, i) => ({
			...f,
			data: images[i]?.base64 ?? '',
			mime: images[i]?.mimeType ?? 'image/jpeg'
		}))
	};
}

/** Keep JSON readable; the exact image bytes remain in the snapshot and visual previews. */
export function readableRequest(value: unknown) {
	return JSON.stringify(
		value,
		(key, item) => {
			if (typeof item === 'string' && item.startsWith('data:image/')) {
				const comma = item.indexOf(',');
				return `${item.slice(0, comma + 1)}[${item.length - comma - 1} base64 characters; see image preview]`;
			}
			if (
				item &&
				typeof item.data === 'string' &&
				(item.type === 'base64' || key === 'inlineData' || key === 'inline_data')
			)
				return { ...item, data: `[${item.data.length} base64 characters; see image preview]` };
			if (item && item.type === 'image' && typeof item.base64 === 'string')
				return { ...item, base64: `[${item.base64.length} base64 characters; see image preview]` };
			return item;
		},
		2
	);
}

export type ProviderRequest = {
	provider: string;
	model: string;
	path: string;
	attempt: number;
	body: unknown;
};
export function attachProviderRequest(
	requests: RequestSnapshot[],
	itemId: string,
	wire: ProviderRequest
) {
	const retained = requests.map((r) =>
		r.itemId === itemId
			? { ...r, wire, size: (JSON.stringify(r.payload).length + JSON.stringify(wire).length) * 2 }
			: r
	);
	let size = retained.reduce((sum, r) => sum + r.size, 0);
	while (retained.length && size > 16 * 1024 * 1024) size -= retained.shift()!.size;
	return { requests: retained, dropped: requests.length - retained.length };
}
