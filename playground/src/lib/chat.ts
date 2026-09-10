import type { LangMessageItem, LangMessageRole } from 'aiwrapper';
import type { ProviderId } from './provider-config';

export type ChatMessage = {
	role: LangMessageRole;
	items: LangMessageItem[];
	meta?: Record<string, unknown>;
};

export type ChatEvent = {
	messages: ChatMessage[];
	done?: boolean;
	error?: string;
};

export async function runChat(
	provider: ProviderId,
	model: string,
	messages: ChatMessage[],
	onEvent: (event: ChatEvent) => void,
	signal: AbortSignal
): Promise<void> {
	const response = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ provider, model, messages }),
		signal
	});
	if (!response.ok) {
		const body = await response.json();
		throw new Error(body.error || 'Chat request failed');
	}
	if (!response.body) throw new Error('Chat response has no stream');
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) throw new Error('Chat stream ended before completion');
			buffer += value;
			let newline: number;
			while ((newline = buffer.indexOf('\n')) !== -1) {
				const event = JSON.parse(buffer.slice(0, newline)) as ChatEvent;
				buffer = buffer.slice(newline + 1);
				onEvent(event);
				if (event.error) throw new Error(event.error);
				if (event.done) return;
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
