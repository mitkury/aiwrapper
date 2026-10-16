import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// Exercises the actual example process, reqwest HTTP transport, streamed tool
// assembly, handler execution and continuation. No credentials or remote calls.
const requests = [];
const server = createServer(async (request, response) => {
  let input = '';
  for await (const chunk of request) input += chunk;
  const body = JSON.parse(input);
  requests.push(body);
  assert.equal(request.url, '/v1/chat/completions');
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const events = requests.length === 1 ? [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'sum', function: { name: 'add', arguments: '{"a":2,' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"b":3}' } }] }, finish_reason: 'tool_calls' }] }
  ] : [
    { choices: [{ delta: { content: '5 🦀' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] }
  ];
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end('data: [DONE]\n\n');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const executable = fileURLToPath(new URL('../target/debug/examples/' + (process.platform === 'win32' ? 'sandbox.exe' : 'sandbox'), import.meta.url));
const child = spawn(executable, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, AIWRAPPER_NATIVE_MOCK: '0', AIWRAPPER_COMPRESSION_TOKENS: '', OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` }
});
let output = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', data => { output += data; });
child.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
const timeout = setTimeout(() => child.kill(), 15_000);
try {
  child.stdin.end(JSON.stringify({ provider: 'openai-compatible', model: 'fixture', messages: [{ role: 'user', items: [{ type: 'text', text: 'Add 2 and 3' }] }] }));
  const [code] = await once(child, 'close');
  assert.equal(code, 0, stderr);
  const events = output.trim().split('\n').map(JSON.parse);
  const last = events.at(-1);
  assert.equal(last.done, true);
  assert.equal(last.error, null);
  assert.equal(last.messages.at(-1).items[0].text, '5 🦀');
  assert.deepEqual(last.messages.map(message => message.role), ['user', 'assistant', 'tool-results', 'assistant']);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-1).content, '5.0');
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'sum');
  assert(events.length > 2, 'expected streaming updates');
  console.log('Native sandbox: process → HTTP → tool → continuation → NDJSON passed.');
} finally {
  clearTimeout(timeout);
  child.kill();
  server.closeAllConnections();
  server.close();
}
