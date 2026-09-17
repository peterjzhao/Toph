const $ = (id) => document.getElementById(id);
const SIZE = 512;
const manifest = await fetch('./manifest.json').then((response) => response.json());
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('./ort/', location.href).href;
const adapter = await navigator.gpu?.requestAdapter();
const deviceInfo = {
  userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemory: navigator.deviceMemory ?? null, crossOriginIsolated,
  webgpu: Boolean(adapter), adapter: adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null,
  shaderF16: adapter?.features.has('shader-f16') ?? false,
};
$('capability').textContent = JSON.stringify(deviceInfo);
if (!adapter) $('runtime').value = 'wasm';
let session, sessionKey, lastResult, modelDownloadMs, sessionCreateMs;

function status(message) { $('status').textContent = message; }
function locked(value) { for (const id of ['run', 'all', 'upload', 'runtime', 'precision', 'sample', 'confidence']) $(id).disabled = value; }
async function loadSession() {
  const key = `${$('runtime').value}-${$('precision').value}`;
  if (session && sessionKey === key) return false;
  await session?.release(); session = undefined;
  const provider = $('runtime').value;
  if (provider === 'webgpu' && !adapter) throw new Error('This browser exposes no WebGPU adapter. Select WASM or use a browser with WebGPU.');
  status(`Downloading ${$('precision').value} model (${(manifest.models[$('precision').value].bytes / 1e6).toFixed(1)} MB)…`);
  let started = performance.now();
  const response = await fetch(manifest.models[$('precision').value].url);
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = await response.arrayBuffer(); modelDownloadMs = performance.now() - started;
  status(`Creating ${provider} session…`); started = performance.now();
  session = await ort.InferenceSession.create(bytes, { executionProviders: [provider], graphOptimizationLevel: 'all' });
  sessionCreateMs = performance.now() - started; sessionKey = key;
  return true;
}
function iou(a, b) {
  const intersection = Math.max(0, Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1)) * Math.max(0,Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1));
  return intersection / ((a.x2-a.x1)*(a.y2-a.y1)+(b.x2-b.x1)*(b.y2-b.y1)-intersection);
}
function detections(output, threshold) {
  const data = output.data; const count = output.dims[2]; const proposals = [];
  for (let i=0;i<count;i++) {
    const score = data[4*count+i]; if (score < threshold) continue;
    const cx=data[i], cy=data[count+i], w=data[2*count+i], h=data[3*count+i];
    proposals.push({ index:i, score, x1:cx-w/2,y1:cy-h/2,x2:cx+w/2,y2:cy+h/2, coefficients:Array.from({length:32},(_,j)=>data[(j+5)*count+i]) });
  }
  proposals.sort((a,b)=>b.score-a.score);
  const kept=[];
  for(const proposal of proposals) { if (kept.every((item)=>iou(item,proposal)<=0.7)) kept.push(proposal); if(kept.length===300)break; }
  return kept;
}
function masksFor(proposals, prototype, transform) {
  const [,,height,width]=prototype.dims; const plane=height*width, data=prototype.data;
  const masks=[];
  for(const proposal of proposals) {
    const mask=new Uint8Array(plane); let area=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const px=(x+0.5)*SIZE/width,py=(y+0.5)*SIZE/height;
      if(px<proposal.x1||px>proposal.x2||py<proposal.y1||py>proposal.y2||px<transform.left||px>transform.left+transform.width||py<transform.top||py>transform.top+transform.height)continue;
      let value=0; const pixel=y*width+x;
      for(let c=0;c<32;c++)value+=proposal.coefficients[c]*data[c*plane+pixel];
      if(value>0){mask[pixel]=1;area++;}
    }
    if(area/plane>=0.001)masks.push({...proposal,mask,area,width,height});
  }
  return masks;
}
async function draw(image, masks, transform) {
  const canvas=$('preview'),context=canvas.getContext('2d'); canvas.width=image.width;canvas.height=image.height;
  context.drawImage(image,0,0);
  const overlay=document.createElement('canvas');overlay.width=128;overlay.height=128;
  const ctx=overlay.getContext('2d'),pixels=ctx.createImageData(128,128);
  masks.forEach((item,index)=>{const color=[(index*73+40)%225,(index*113+85)%225,(index*47+155)%225];item.mask.forEach((value,pixel)=>{if(value){pixels.data.set([...color,105],pixel*4);}});});
  ctx.putImageData(pixels,0,0);context.imageSmoothingEnabled=false;
  context.drawImage(overlay,transform.left/4,transform.top/4,transform.width/4,transform.height/4,0,0,image.width,image.height);
}
async function parity(outputs, refs) {
  const comparisons=[];
  for(let index=0;index<refs.length;index++) {
    const reference=new Float32Array(await fetch(refs[index]).then(r=>r.arrayBuffer()));
    const actual=outputs[index].data;let maxAbsDiff=0,absoluteSum=0;
    if(reference.length!==actual.length)throw new Error('Reference output size differs');
    for(let i=0;i<actual.length;i++){const delta=Math.abs(reference[i]-actual[i]);maxAbsDiff=Math.max(maxAbsDiff,delta);absoluteSum+=delta;}
    comparisons.push({shape:outputs[index].dims,maxAbsDiff,meanAbsDiff:absoluteSum/actual.length});
  }
  return comparisons;
}
async function runSample(name) {
  const sample=manifest.samples.find(item=>item.name===name);
  const fresh=await loadSession();
  const bytes=await fetch(sample.input).then(response=>response.arrayBuffer());
  const input=new ort.Tensor('float32',new Float32Array(bytes),[1,3,SIZE,SIZE]);
  const image=await createImageBitmap(await fetch(sample.image).then(response=>response.blob()));
  const transform={left:0,top:0,width:SIZE,height:SIZE};
  status(`Running ${name} on ${$('runtime').value}…`);
  const timings=[];let outputs;
  for(let repeat=0;repeat<2;repeat++) {
    for(const tensor of outputs ?? [])tensor.dispose();
    const started=performance.now();const received=await session.run({images:input});outputs=session.outputNames.map(key=>received[key]);
    timings.push(performance.now()-started);
  }
  const started=performance.now();const proposals=detections(outputs[0],Number($('confidence').value));
  const masks=masksFor(proposals,outputs[1],transform);const decodeMs=performance.now()-started;
  await draw(image,masks,transform);
  const result={sample:name,precision:$('precision').value,runtime:$('runtime').value,newSession:fresh,modelDownloadMs,sessionCreateMs,inferenceMs:timings,decodeMs,threshold:Number($('confidence').value),nmsIou:0.7,rawCandidates:proposals.length,masksAtPrototypeResolution:masks.length,parity:await parity(outputs,sample.reference),candidateScores:masks.map(item=>item.score)};
  for(const tensor of outputs)tensor.dispose();input.dispose();image.close();
  return result;
}
async function runAll(all) {
  locked(true);
  try {
    const results=[];
    for(const name of all?manifest.samples.map(item=>item.name):[$('sample').value])results.push(await runSample(name));
    lastResult={date:new Date().toISOString(),device:deviceInfo,model:{revision:manifest.revision,...manifest.models[$('precision').value]},onnxRuntimeWeb:'1.30.0',results};
    $('result').textContent=JSON.stringify(lastResult,null,2);$('download').disabled=false;status('Complete — actual browser inference succeeded.');
  }catch(error){$('result').textContent=String(error.stack??error);status('Failed — no result claimed.');}finally{locked(false);}
}
$('run').addEventListener('click',()=>runAll(false));$('all').addEventListener('click',()=>runAll(true));
$('upload').addEventListener('change',async(event)=>{
  const file=event.target.files?.[0];if(!file)return;locked(true);
  try {
    await loadSession();const image=await createImageBitmap(file);const ratio=Math.min(SIZE/image.width,SIZE/image.height);
    const width=Math.round(image.width*ratio),height=Math.round(image.height*ratio),left=Math.round((SIZE-width)/2-0.1),top=Math.round((SIZE-height)/2-0.1);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE;const context=canvas.getContext('2d',{willReadFrequently:true});
    context.fillStyle='rgb(114,114,114)';context.fillRect(0,0,SIZE,SIZE);context.drawImage(image,left,top,width,height);
    const pixels=context.getImageData(0,0,SIZE,SIZE).data,tensorData=new Float32Array(3*SIZE*SIZE);
    for(let i=0;i<SIZE*SIZE;i++)for(let c=0;c<3;c++)tensorData[c*SIZE*SIZE+i]=pixels[4*i+c]/255;
    const input=new ort.Tensor('float32',tensorData,[1,3,SIZE,SIZE]);status('Segmenting this local image…');const started=performance.now();
    const received=await session.run({images:input}),outputs=session.outputNames.map(name=>received[name]);const inferenceMs=performance.now()-started;
    const transform={left,top,width,height},proposals=detections(outputs[0],Number($('confidence').value)),masks=masksFor(proposals,outputs[1],transform);
    await draw(image,masks,transform);$('result').textContent=JSON.stringify({file:file.name,imageSize:[image.width,image.height],runtime:$('runtime').value,precision:$('precision').value,inferenceMs,masks:masks.length,preprocessing:'Browser canvas RGB letterbox 114 / 255; no PyTorch resize parity asserted'},null,2);
    for(const tensor of outputs)tensor.dispose();input.dispose();image.close();status('Complete — the uploaded image stayed in this browser.');
  }catch(error){$('result').textContent=String(error.stack??error);status('Failed — no result claimed.');}finally{locked(false);}
});
$('download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(lastResult,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='browser-segmentation-result.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
