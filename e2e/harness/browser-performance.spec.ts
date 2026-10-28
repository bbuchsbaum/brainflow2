import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('measures worker startup, render/readback/copy stages and retained heap', async ({page}) => {
  const navigationStart=performance.now();
  await page.goto('/browser.html');
  await expect(page.getByRole('button',{name:'Open NIfTI',exact:true})).toBeEnabled();
  const navigationMs=performance.now()-navigationStart;
  const created=page.waitForEvent('worker',worker=>worker.url().includes('performance-probe'));
  await page.evaluate(async()=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');
    globalThis.__perfTransport=new BrowserTransport(new Worker('/src/services/browser/worker.ts?performance-probe',{type:'module'}));
  });
  const worker=await created;
  const startup=await page.evaluate(async()=>{
    const start=performance.now();const gpu=await globalThis.__perfTransport.invoke('initialize');
    return {workerInitializeMs:performance.now()-start,gpu};
  });
  const baseline=await worker.evaluate(async()=>{
    const module=await import('/src/browser/generated/browser_host.js');
    const wasm=await module.default();
    globalThis.__perfWasm=wasm;
    globalThis.__perfStages={render:[],map:[]};
    const render=module.BrowserHost.prototype.render_view;
    module.BrowserHost.prototype.render_view=async function(...args){
      const start=performance.now();try{return await render.apply(this,args)}finally{globalThis.__perfStages.render.push(performance.now()-start)}
    };
    const map=GPUBuffer.prototype.mapAsync;
    GPUBuffer.prototype.mapAsync=async function(...args){
      const start=performance.now();try{return await map.apply(this,args)}finally{globalThis.__perfStages.map.push(performance.now()-start)}
    };
    return {wasmHeapBytes:wasm.memory.buffer.byteLength};
  });
  const fixture=[...readFileSync(resolve(__dirname,'../../test-data/browser/oblique.nii'))];
  const frame=JSON.parse(readFileSync(resolve(__dirname,'../../test-data/browser/frame.json'),'utf8'));
  const measurements=await page.evaluate(async({fixture,frame,apiPath})=>{
    const transport=globalThis.__perfTransport;
    const {decodeRawRgbaPacket}=await import('/@fs'+apiPath);
    const start=performance.now();
    const volume=await transport.invoke('load_file',{file:new File([new Uint8Array(fixture)],'oblique.nii')});
    const loadMs=performance.now()-start;
    const cases=[];
    for(const size of [128,512,1024]) for(const mode of ['copy','view']){
      const request=structuredClone(frame);request.layers[0].volumeId=volume.id;
      request.requestedView.width=size;request.requestedView.height=size;
      const samples=[];
      for(let iteration=0;iteration<31;iteration++){
        const t0=performance.now();
        const packet=await transport.invoke('render_view',{stateJson:JSON.stringify(request),format:'rgba'});
        const t1=performance.now();const rgba=decodeRawRgbaPacket(packet);
        const t2=performance.now();const pixels=mode==='copy' ? new Uint8ClampedArray(rgba.rgba) : new Uint8ClampedArray(rgba.rgba.buffer,rgba.rgba.byteOffset,rgba.rgba.byteLength);
        const t3=performance.now();const bitmap=await createImageBitmap(new ImageData(pixels,rgba.width,rgba.height));
        const t4=performance.now();
        if(iteration===0){
          const canvas=new OffscreenCanvas(size,size);const context=canvas.getContext('2d');
          context.drawImage(bitmap,0,0);
          const actual=context.getImageData(0,0,size,size).data;
          if(actual.some((value,index)=>value!==rgba.rgba[index]))throw Error('Bitmap pixels differ from raw RGBA');
        }
        bitmap.close();
        if(packet.length!==8+size*size*4)throw Error('Unexpected output dimensions');
        samples.push({roundtripMs:t1-t0,decodeCopyMs:t2-t1,clampedCopyMs:t3-t2,bitmapMs:t4-t3,totalMs:t4-t0});
      }
      cases.push({size,mode,rgbaBytes:size*size*4,first:samples[0],warm:samples.slice(1)});
    }
    await transport.invoke('unload_volume',{volumeId:volume.id});
    return {loadMs,cases,empty:await transport.invoke('diagnostics')};
  },{fixture,frame,apiPath:resolve(__dirname,'../../packages/api/src/renderClient.ts')});
  const stages=await worker.evaluate(()=>({...globalThis.__perfStages,wasmHeapBytes:globalThis.__perfWasm.memory.buffer.byteLength}));
  expect(stages.render).toHaveLength(186);expect(stages.map).toHaveLength(186);
  expect(measurements.empty).toEqual({volumes:0,palettes:0,stagingBuffers:0,stagingBytes:0});
  const memory=[];
  for(let cycle=0;cycle<5;cycle++){
    await page.evaluate(async header=>{
      const dims=[192,192,192];const bytes=new Uint8Array(352+192**3*4);bytes.set(header);
      const view=new DataView(bytes.buffer);view.setInt16(40,3,true);dims.forEach((n,i)=>view.setInt16(42+2*i,n,true));
      view.setInt16(70,16,true);view.setInt16(72,32,true);new Float32Array(bytes.buffer,352).fill(42);
      const volume=await globalThis.__perfTransport.invoke('load_file',{file:new File([bytes],'large.nii')});
      await globalThis.__perfTransport.invoke('unload_volume',{volumeId:volume.id});
    },fixture.slice(0,352));
    memory.push(await worker.evaluate(()=>globalThis.__perfWasm.memory.buffer.byteLength));
  }
  const resident=await page.evaluate(async header=>{
    const bytes=new Uint8Array(352+256*256*384*4);bytes.set(header);
    const view=new DataView(bytes.buffer);view.setInt16(40,3,true);
    [256,256,384].forEach((n,i)=>view.setInt16(42+2*i,n,true));
    view.setInt16(70,16,true);view.setInt16(72,32,true);
    new Float32Array(bytes.buffer,352).fill(42);
    const file=new File([bytes],'resident.nii');const volumes=[];
    const start=performance.now();
    try{
      for(let i=0;i<2;i++)volumes.push(await globalThis.__perfTransport.invoke('load_file',{file}));
      let error='';try{await globalThis.__perfTransport.invoke('load_file',{file})}catch(e){error=String(e)}
      return {loadAndRejectMs:performance.now()-start,error,loaded:await globalThis.__perfTransport.invoke('diagnostics')};
    }finally{for(const volume of volumes)await globalThis.__perfTransport.invoke('unload_volume',{volumeId:volume.id})}
  },fixture.slice(0,352));
  expect(resident.loaded.volumes).toBe(2);
  expect(resident.error).toContain('64 million resident voxel limit');
  const residentHeapAfterUnload=await worker.evaluate(()=>globalThis.__perfWasm.memory.buffer.byteLength);
  const empty=await page.evaluate(()=>globalThis.__perfTransport.invoke('diagnostics'));
  expect(empty).toEqual(measurements.empty);
  const result={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),navigationMs,startup,baseline,measurements,stages,largeImageHeapAfterUnload:memory,resident,residentHeapAfterUnload,
    limits:'Single Mac Chromium/Metal; navigation has empty browser HTTP cache but local server/OS caches uncontrolled. mapAsync includes queue wait and mapping, not GPU-only time. WASM heap capacity is retained allocation, not process RSS. 30 warm samples per size.'};
  writeFileSync(test.info().outputPath('performance.json'),JSON.stringify(result,null,2));
  await page.evaluate(()=>{globalThis.__perfTransport.dispose();delete globalThis.__perfTransport});
});
