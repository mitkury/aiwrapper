import type { ChatMessage } from '$lib/chat';
import type { ProviderId } from '$lib/provider-config';
import { nativeProcess } from './native-process';

export function nativeChat(
	body: { provider: ProviderId; model: string; messages: ChatMessage[] },
	signal: AbortSignal
): Response {
	return nativeProcess('sandbox', body, signal);
}
