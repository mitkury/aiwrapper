import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

// Real Rust processes and transports, with local protocol fixtures only.
const binary = name => fileURLToPath(new URL(`../target/debug/examples/${name}${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const pcm = Buffer.from([0, 0, 1, 0, 255, 127, 0, 128]);
const http = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  if (request.url === '/v1/chat/completions' || request.url === '/v1/api/chat') {
    assert.equal(request.headers.authorization, undefined, 'Local language endpoints may be keyless');
    const messages = JSON.parse(body).messages;
    const speak = messages.some(message => message.role === 'tool') && messages.at(-1).role === 'user';
    const call = { function: { name: 'keep_silent', arguments: {} } };
    if (request.url === '/v1/api/chat') {
      response.setHeader('Content-Type', 'application/x-ndjson');
      const reply = speak ? { content: 'Hello.' } : { content: '', tool_calls: [call] };
      response.end(JSON.stringify({ message: { role: 'assistant', ...reply }, done: true }) + '\n');
    } else {
      response.setHeader('Content-Type', 'text/event-stream');
      const delta = speak ? { content: 'Hello.' } : {
        tool_calls: [{ index: 0, id: 'quiet', function: { name: 'keep_silent', arguments: '{}' } }]
      };
      const choice = { delta, finish_reason: speak ? 'stop' : 'tool_calls' };
      response.end('data: ' + JSON.stringify({ choices: [choice] }) + '\n\ndata: [DONE]\n\n');
    }
  } else if (request.url === '/v1/audio/transcriptions') {
    assert(body.includes(Buffer.from('RIFF')));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ text: 'Recorded speech.' }));
  } else {
    const input = JSON.parse(body);
    if (input.input === 'fail') {
      response.writeHead(429);
      response.end('fixture rate limit');
    } else if (request.url.startsWith('/v1/text-to-speech/voice/stream/with-timestamps?')) {
      response.end(JSON.stringify({ audio_base64: pcm.toString('base64') }) + '\n');
    } else {
      assert(request.url.startsWith('/v1/audio/speech') || request.url.startsWith('/v1/text-to-speech/voice/stream'));
      response.write(pcm.subarray(0, 3));
      response.end(pcm.subarray(3));
    }
  }
});
http.listen(0, '127.0.0.1');
await once(http, 'listening');
const base = `http://127.0.0.1:${http.address().port}/v1`;
async function speech(body) {
  const child = spawn(binary('speech'), [], { env: { ...process.env, OPENAI_API_KEY: 'fixture', ELEVENLABS_API_KEY: 'fixture', OPENAI_BASE_URL: base, ELEVENLABS_BASE_URL: base }, stdio: ['pipe', 'pipe', 'pipe'] });
  const timeout = setTimeout(() => child.kill(), 10_000);
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.resume();
  child.stdin.end(JSON.stringify(body));
  try { await once(child, 'close'); return output.trim().split('\n').map(JSON.parse); }
  finally { clearTimeout(timeout); child.kill(); }
}
async function localCascade(provider, tts) {
  const child = spawn(binary('cascade'), [], {
    env: { ...process.env, OPENAI_API_KEY: 'fixture', OPENAI_BASE_URL: base, ELEVENLABS_API_KEY: 'fixture', ELEVENLABS_BASE_URL: base, OPENAI_COMPATIBLE_API_KEY: '', OPENAI_COMPATIBLE_BASE_URL: base, OLLAMA_API_KEY: '', OLLAMA_BASE_URL: '', OLLAMA_URL: base },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stderr.resume();
  const closed = once(child, 'close');
  const timeout = setTimeout(() => child.kill(), 10_000);
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  send({ offline: false, provider, model: 'fixture', sttModel: '', tts, ttsModel: 'fixture', voice: 'voice' });
  let completed = false;
  let inspectedRequest = false;
  const samples = [];
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const packet = JSON.parse(line);
      assert.notEqual(packet.type, 'error', packet.message);
      if (packet.event?.state?.kind === 'connected') send({ type: 'text', text: 'Please wait.' });
      if (packet.event?.state?.kind === 'provider-request') {
        const { request } = packet.event.state;
        assert.equal(request.provider, provider);
        assert.ok(request.body.messages.length);
        inspectedRequest = true;
      }
      if (packet.type === 'tool-result') {
        assert.equal(packet.result.name, 'keep_silent');
        assert.equal(packet.status, 'success');
        completed = true;
        send({ type: 'text', text: 'Please speak.' });
      }
      if (packet.event?.type === 'audio') samples.push(...packet.event.frame.samples);
      if (completed && samples.length && packet.event?.state?.kind === 'synthesis-complete') {
        send({ type: 'close' });
      }
    }
    assert.equal((await closed)[0], 0);
    assert.deepEqual(samples, [0, 1, 32767, -32768], tts + ' should synthesize through its configured endpoint');
    assert.ok(inspectedRequest, "The playground host should emit the provider request");
    assert(completed, `${provider} did not reach the configured keyless endpoint`);
  } finally { clearTimeout(timeout); child.kill(); }
}
async function live(provider) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  let setup = false, input = false, result = false;
  server.on('connection', socket => socket.on('message', bytes => {
    const value = JSON.parse(bytes);
    const send = value => socket.send(JSON.stringify(value));
    if (value.setup || value.type === 'session.update') {
      setup = true;
      send(provider === 'google' ? { setupComplete: {} } : { type: 'session.updated', session: {} });
    } else if (value.realtimeInput?.audio || value.type === 'input_audio_buffer.append') {
      input = true;
      const audio = value.realtimeInput?.audio;
      if (audio) assert.equal(audio.mimeType, 'audio/pcm;rate=16000');
      assert.equal(Buffer.from(audio?.data || value.audio, 'base64').length, pcm.length);
      if (provider === 'google') {
        send({ toolCall: { functionCalls: [{ id: 'sum', name: 'add', args: { a: 2, b: 3 } }] } });
      } else {
        send({ type: 'response.created', response: { id: 'r1' } });
        send({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'sum', name: 'add', arguments: '{"a":2,"b":3}' }] } });
      }
    } else if (value.toolResponse || value.item?.type === 'function_call_output') {
      result = true;
      if (provider === 'google') {
        assert.equal(value.toolResponse.functionResponses[0].response.result, 5);
        send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm.toString('base64') } }] }, turnComplete: true } });
      } else {
        assert.equal(JSON.parse(value.item.output), 5);
      }
    } else if (result && value.type === 'response.create') {
      send({ type: 'response.created', response: { id: 'r2' } });
      send({ type: 'response.output_audio.delta', item_id: 'voice', content_index: 0, delta: pcm.toString('base64') });
      send({ type: 'response.done', response: { status: 'completed', output: [] } });
    }
  }));
  const child = spawn(binary('cascade'), [], { env: { ...process.env, OPENAI_API_KEY: 'fixture', GOOGLE_API_KEY: 'fixture', AIWRAPPER_LIVE_ENDPOINT: `ws://127.0.0.1:${server.address().port}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const timeout = setTimeout(() => child.kill(), 10_000);
  const closed = once(child, 'close');
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  send({ live: true, offline: false, microphone: true, provider, model: 'fixture', voice: 'voice', sttModel: '', tts: 'openai', ttsModel: '' });
  let heard = false, tool = false;
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const packet = JSON.parse(line);
      assert.notEqual(packet.type, 'error', packet.message);
      if (packet.type === 'tool-result') tool = true;
      const event = packet.event;
      if (event?.state?.kind === 'connected') {
        assert.equal(event.state.inputSampleRate, provider === 'google' ? 16000 : 24000);
        send({ type: 'audio', samples: [0, 1, 32767, -32768] });
      }
      if (event?.type === 'audio') {
        assert.deepEqual(event.frame.samples, [0, 1, 32767, -32768]);
        heard = true;
        send({ type: 'close' });
      }
    }
    await closed;
    assert(setup && input && result && tool && heard, `${provider} live host did not complete`);
  } finally {
    clearTimeout(timeout); child.kill();
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
  }
}
try {
  assert.equal((await speech({ operation: 'transcribe', audio: pcm.toString('base64'), sampleRate: 24000 })).at(-1).text, 'Recorded speech.');
  for (const provider of ['openai', 'elevenlabs']) {
    const events = await speech({ operation: 'speak', provider, text: 'Hello', model: 'fixture', voice: 'voice' });
    assert.equal(events.at(-1).done, true);
    assert.deepEqual(Buffer.concat(events.filter(e => e.audio).map(e => Buffer.from(e.audio, 'base64'))), pcm);
  }
  assert.match((await speech({ operation: 'speak', provider: 'openai', text: 'fail', model: 'fixture', voice: 'voice' })).at(-1).error, /429.*fixture rate limit/);
  await localCascade('openai-compatible', 'openai');
  await localCascade('ollama', 'elevenlabs');
  await live('google');
  await live('openai');
  console.log('Native media: transcription, speech, keyless Cascade endpoints, Ollama URL alias, live protocols, tools, PCM and errors passed.');
} finally { http.closeAllConnections(); http.close(); }
