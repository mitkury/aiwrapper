import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const binary=fileURLToPath(new URL('../target/debug/examples/cascade'+(process.platform==='win32'?'.exe':''),import.meta.url));
const child=spawn(binary,[],{stdio:['pipe','pipe','inherit']});
const send=command=>child.stdin.write(JSON.stringify(command)+'\n');
const timeout=setTimeout(()=>{child.kill();throw new Error('Cascade host test timed out');},10000);
let tool=false,audio=false,stopped=false,requested=false,requests=0;
const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Cascade exited ${code}`)));});
try {
 send({instructions:'Speak plainly. This is a custom playground instruction.',offline:true,cameraContext:'recent',provider:'anthropic',model:'mock',sttModel:'flux-general-en',tts:'elevenlabs',ttsModel:'mock',voice:'mock'});
 for await(const line of createInterface({input:child.stdout})) {
  const packet=JSON.parse(line);
  assert.notEqual(packet.type,'error',packet.message);
  if(packet.type==='tool-result')tool=true;
  const event=packet.event;
  if(event?.state?.kind==='connected'){send({type:'image',id:1,capturedAtMs:1000,data:'YWJj',mime:'image/jpeg'});send({type:'text',text:'tool: add {"a":2,"b":3}'});}
  if(event?.state?.kind==='request'){assert.equal(event.state.conversation.instructions,'Speak plainly. This is a custom playground instruction.');requests++;assert.equal(event.state.camera.frames[0].id,1,'Camera batch must survive the tool continuation');}
  if(event?.type==='audio')audio=true;
  if(event?.state?.kind==='segment-done')send({type:'played',item:event.state.itemId,index:event.state.contentIndex,ms:requests>1?Math.floor(event.state.durationMs/2):event.state.durationMs});
  if(event?.state?.kind==='synthesis-complete'&&audio&&tool&&!requested){requested=true;send({type:'interrupt'});}
  if(event?.state?.kind==='playback-stop-requested')send({type:'playback-stopped',item:event.state.itemId});
  if(event?.state?.kind==='playback-cut'&&requested){assert.equal(event.state.cut.playbackConfirmed,true);assert.ok(event.state.cut.unplayedText);stopped=true;send({type:'close'});child.stdin.end();}
 }
 await exited;
 assert.ok(tool&&audio&&stopped,'Expected tool execution, PCM output and an acknowledged interruption boundary');
 console.log('Native cascade host: tools, streamed PCM, playback acknowledgement, interruption record and clean exit passed.');
} finally {clearTimeout(timeout);child.kill();}

// A silent tool must not cause an automatic model follow-up or audio, and the
// same session must still answer the next user turn.
const quiet=spawn(binary,[],{stdio:['pipe','pipe','inherit']});
const quietSend=command=>quiet.stdin.write(JSON.stringify(command)+'\n');
const quietExit=new Promise((resolve,reject)=>{quiet.on('error',reject);quiet.on('exit',code=>code===0?resolve():reject(new Error(`Cascade exited ${code}`)));});
const quietTimeout=setTimeout(()=>{quiet.kill();},10000);
let resumeTimer, resumed=false, silentResult=false, silentRequests=0, heardNext=false;
try {
 quietSend({offline:true,provider:'anthropic',model:'mock',sttModel:'flux-general-en',tts:'elevenlabs',ttsModel:'mock',voice:'mock'});
 for await(const line of createInterface({input:quiet.stdout})) {
  const packet=JSON.parse(line), event=packet.event;
  assert.notEqual(packet.type,'error',packet.message);
  if(event?.state?.kind==='connected')quietSend({type:'text',text:'tool: keep_silent {}'});
  if(event?.state?.kind==='request') {
   assert.equal(event.state.tools.find(t=>t.name==='keep_silent')?.silent,true);
   if(!resumed)assert.equal(++silentRequests,1,'Silent tool must not trigger a follow-up model request');
   else assert.ok(event.state.conversation.messages.some(m=>m.items.some(i=>i.type==='tool-result'&&i.name==='keep_silent')),'Silent result must remain in history');
  }
  if(packet.type==='tool-result'&&packet.result.name==='keep_silent') {
   assert.equal(packet.status,'success');
   assert.deepEqual(packet.result.result,{silent:true});
   silentResult=true;
   resumeTimer=setTimeout(()=>{resumed=true;quietSend({type:'text',text:'Please reply now.'});},200);
  }
  if(event?.type==='audio') {
   assert.ok(resumed,'Silent turn must not synthesize speech');
   heardNext=true;
   quietSend({type:'close'});quiet.stdin.end();break;
  }
 }
 await quietExit;
 assert.ok(silentResult&&heardNext,'Expected silence followed by a normal spoken response');
 console.log('Native cascade host: keep_silent records its result, skips follow-up speech, and accepts the next turn.');
} finally {clearTimeout(quietTimeout);clearTimeout(resumeTimer);quiet.kill();}
