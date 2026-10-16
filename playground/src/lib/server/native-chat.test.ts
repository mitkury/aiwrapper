import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeChat } from './native-chat';

const state = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: state.spawn }));
vi.mock('$env/dynamic/private', () => ({ env: { AIWRAPPER_NATIVE_BINARY: '/trusted/sandbox' } }));
afterEach(() => vi.clearAllMocks());
function childProcess() {
	const child = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn()
	});
	state.spawn.mockReturnValue(child);
	return child;
}
const input = { provider: 'openai-compatible' as const, model: 'test', messages: [] };
it('passes a data request over stdin and streams native output through the same HTTP interface', async () => {
	const child = childProcess();
	const response = nativeChat(input, new AbortController().signal);
	expect(state.spawn.mock.calls[0][0]).toBe('/trusted/sandbox');
	expect(JSON.parse(child.stdin.read().toString())).toEqual(input);
	expect(response.headers.get('x-aiwrapper-runtime')).toBe('rust');
	const pending = response.text();
	child.stdout.write('{"messages":[],"done":true}\n');
	child.emit('close', 0);
	expect(await pending).toBe('{"messages":[],"done":true}\n');
});
it('terminates native work when the frontend cancels', async () => {
	const child = childProcess();
	const response = nativeChat(input, new AbortController().signal);
	await response.body!.cancel();
	expect(child.kill).toHaveBeenCalledOnce();
	child.emit('close', 0);
});
it('returns an actionable error when the example binary is missing', async () => {
	const child = childProcess();
	const response = nativeChat(input, new AbortController().signal);
	child.emit('error', new Error('ENOENT'));
	expect(await response.text()).toContain('npm run native:build');
});
it('closes the response stream when the incoming request is aborted', async () => {
	const child = childProcess();
	const controller = new AbortController();
	const response = nativeChat(input, controller.signal);
	const reading = response.text();
	controller.abort();
	await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
	expect(child.kill).toHaveBeenCalledOnce();
	child.emit('close', 0);
});
