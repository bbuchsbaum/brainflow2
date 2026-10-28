import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';

const fixture=resolve(__dirname,'../../test-data/browser/oblique.nii');
const compressed=resolve(__dirname,'../../test-data/browser/oblique.nii.gz');
const request=JSON.parse(readFileSync(resolve(__dirname,'../../test-data/browser/frame.json'),'utf8'));
const witness=JSON.parse(readFileSync(process.env.BROWSER_NATIVE_WITNESS ?? resolve(__dirname,'../../cruft/browser-portability/native-witness.json'),'utf8'));

test('actual WASM worker agrees with analytic/native pixels, cancels and unloads',async({page})=>{
  await page.goto('/browser.html');
  const result=await page.evaluate(async({bytes,gzip,frame})=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');
    const transport=new BrowserTransport();
    try {
      await transport.invoke('initialize');
      let unsupported='';try{await transport.invoke('mount_remote')}catch(e){unsupported=e.code}
      const file=new File([new Uint8Array(bytes)],'oblique.nii');
      const volume=await transport.invoke('load_file',{file});
      const pixels=await transport.invoke('render_view',{stateJson:JSON.stringify(frame),format:'rgba'});
      await transport.invoke('unload_volume',{volumeId:volume.id});
      const empty=await transport.invoke('diagnostics');
      let stale=false;try{await transport.invoke('render_view',{stateJson:JSON.stringify(frame),format:'rgba'})}catch{stale=true}
      const gz=await transport.invoke('load_file',{file:new File([new Uint8Array(gzip)],'oblique.nii.gz')});
      await transport.invoke('unload_volume',{volumeId:gz.id});
      const abort=new AbortController();
      const cancelled=transport.request('load_file',{file},abort.signal).catch(e=>e.name);
      // Let the independent worker finish while the response cannot be handled
      // on this main event loop, then cancel before publication to the UI.
      const until=performance.now()+100;while(performance.now()<until){}
      abort.abort();const cancellation=await cancelled;
      const afterCancel=await transport.invoke('diagnostics');
      return {volume,packet:Array.from(pixels),empty,stale,unsupported,cancellation,afterCancel,gzip:gz.center};
    } finally {transport.dispose();}
  },{bytes:[...readFileSync(fixture)],gzip:[...readFileSync(compressed)],frame:request});
  expect(result.volume.center).toEqual([4,-1,21]);
  expect(result.volume.bounds).toEqual([[-3,-8.5,3],[11,6.5,39]]);
  expect(result.packet.length).toBe(witness.packet.length);
  expect(Math.max(...result.packet.map((v,i)=>Math.abs(v-witness.packet[i])))).toBeLessThanOrEqual(1);
  expect(result.empty).toEqual({volumes:0,palettes:0,stagingBuffers:0,stagingBytes:0});
  expect(result.afterCancel).toEqual(result.empty);
  expect(result.stale).toBe(true);expect(result.unsupported).toBe('UNSUPPORTED_BROWSER_CAPABILITY');
  expect(result.cancellation).toBe('AbortError');expect(result.gzip).toEqual([4,-1,21]);
  await test.info().attach('browser-native-comparison',{body:JSON.stringify(result),contentType:'application/json'});
});

test('a real 16-texture device renders and tears down the adaptive layout',async({page})=>{
  await page.goto('/browser.html');
  const result=await page.evaluate(async({bytes,frame})=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');
    const transport=new BrowserTransport();
    try {
      const gpu=await transport.invoke('initialize',{maxSampledTextures:16});
      const volume=await transport.invoke('load_file',{file:new File([new Uint8Array(bytes)],'oblique.nii')});
      const packet=await transport.invoke('render_view',{stateJson:JSON.stringify(frame),format:'rgba'});
      await transport.invoke('unload_volume',{volumeId:volume.id});
      const abort=new AbortController();
      const cancelled=transport.request('load_file',{file:new File([new Uint8Array(bytes)],'cancel.nii')},abort.signal).catch(e=>e.name);
      const until=performance.now()+100;while(performance.now()<until){}
      abort.abort();const cancellation=await cancelled;
      return {gpu,packet:[...packet],cancellation,empty:await transport.invoke('diagnostics')};
    } finally {transport.dispose();}
  },{bytes:[...readFileSync(fixture)],frame:request});
  expect(result.gpu).toEqual({volumeSlots:7,sampledTextureLimit:16,float32Filterable:true});
  expect(result.packet.length).toBe(witness.packet.length);
  expect(Math.max(...result.packet.map((v,i)=>Math.abs(v-witness.packet[i])))).toBeLessThanOrEqual(1);
  expect(result.cancellation).toBe('AbortError');
  expect(result.empty).toEqual({volumes:0,palettes:0,stagingBuffers:0,stagingBytes:0});
});

test('insufficient texture limits reject initialization before loading',async({page})=>{
  await page.goto('/browser.html');
  const error=await page.evaluate(async()=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');const transport=new BrowserTransport();
    try {await transport.invoke('initialize',{maxSampledTextures:2});return null;} catch(e) {return String(e);} finally {transport.dispose();}
  });
  expect(error).toContain('GPU cannot support the requested texture layout');
});

test('missing R32Float filtering rejects startup instead of silently reducing precision',async({page})=>{
  await page.goto('/browser.html');
  const created=page.waitForEvent('worker',worker=>worker.url().includes('missing-float32'));
  await page.evaluate(async()=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');
    globalThis.__gpuCapabilityTest=new BrowserTransport(new Worker('/src/services/browser/worker.ts?missing-float32',{type:'module'}));
  });
  const worker=await created;
  await worker.evaluate(()=>{
    const gpu=navigator.gpu;const original=gpu.requestAdapter;
    gpu.requestAdapter=async function(...args){
      const adapter=await original.apply(this,args);
      if(adapter)Object.defineProperty(adapter,'features',{value:new Set([...adapter.features].filter(feature=>feature!=='float32-filterable'))});
      return adapter;
    };
  });
  const error=await page.evaluate(async()=>{
    const transport=globalThis.__gpuCapabilityTest;
    try{await transport.invoke('initialize');return null;}catch(e){return String(e);}finally{transport.dispose();delete globalThis.__gpuCapabilityTest;}
  });
  expect(error).toContain('requires FLOAT32_FILTERABLE');
});

test('linked slices, window, overlay and teardown work at desktop and narrow sizes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/browser.html');await expect(page.getByRole('button',{name:'Open NIfTI'})).toBeEnabled();
  await page.getByLabel('Choose NIfTI file', {exact:true}).setInputFiles(fixture);
  const revision=()=>page.locator('main').getAttribute('data-frame-revision').then(Number);
  await expect.poll(revision).toBeGreaterThan(0);
  expect(await page.getByRole('spinbutton',{name:'R',exact:true}).inputValue()).toBe('4');
  expect(await page.locator('[data-slider-box]').first().evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(100);
  const canvas=page.getByRole('region',{name:'axial slice'}).locator('canvas');
  const pixels=()=>canvas.evaluate(c=>c.toDataURL());
  const before=await pixels();let r=await revision();
  await page.getByRole('slider',{name:'Window low',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect.poll(revision).toBeGreaterThan(r);expect(await pixels()).not.toBe(before);
  r=await revision();await page.getByLabel('Choose NIfTI file', {exact:true}).setInputFiles(compressed);
  await expect(page.getByRole('button',{name:'Unload oblique.nii.gz',exact:true})).toBeVisible();
  await expect.poll(revision).toBeGreaterThan(r);const overlay=await pixels();
  r=await revision();await page.getByRole('slider',{name:'Opacity',exact:true}).focus();await page.keyboard.press('Home');
  await expect.poll(revision).toBeGreaterThan(r);expect(await pixels()).not.toBe(overlay);
  r=await revision();const bounds=await canvas.boundingBox();await canvas.click({position:{x:bounds!.width*.6,y:bounds!.height*.5}});
  await expect.poll(revision).toBeGreaterThan(r);expect(await page.getByRole('spinbutton',{name:'R',exact:true}).inputValue()).not.toBe('4');
  await page.screenshot({path:test.info().outputPath('desktop.png')});
  await page.setViewportSize({width:420,height:900});await page.screenshot({path:test.info().outputPath('narrow.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Clear workspace'}).click();
  await expect(page.getByRole('button',{name:'Open NIfTI'})).toBeVisible();expect(errors).toEqual([]);
});

test('production PWA reloads offline and caches only application assets',async({page,context})=>{
  await page.goto('http://127.0.0.1:5359/browser.html');
  await expect(page.getByRole('button',{name:'Open NIfTI'})).toBeEnabled();
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  const manifest=await page.evaluate(async()=>{
    const link=document.querySelector('link[rel=manifest]') as HTMLLinkElement;
    return (await fetch(link.href)).json();
  });
  expect(manifest.display).toBe('standalone');expect(manifest.icons.map(i=>i.sizes)).toEqual(['192x192','512x512']);
  const cdp=await context.newCDPSession(page);
  const installability=await cdp.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
  await cdp.detach();
  await page.getByLabel('Choose NIfTI file', {exact:true}).setInputFiles(fixture);
  await expect.poll(()=>page.locator('main').getAttribute('data-frame-revision').then(Number)).toBeGreaterThan(0);
  const urls=await page.evaluate(async()=>{const names=await caches.keys();const keys=await Promise.all(names.filter(n=>n.startsWith('brainflow-browser-')).map(n=>caches.open(n).then(c=>c.keys())));return keys.flat().map(r=>r.url)});
  expect(urls.some(u=>u.endsWith('.wasm'))).toBe(true);expect(urls.some(u=>u.includes('oblique'))).toBe(false);
  await context.setOffline(true);await page.reload();
  await expect(page.getByRole('button',{name:'Open NIfTI'})).toBeEnabled();
  await expect(page.getByText('Local processing · Offline')).toBeVisible();
  await page.getByLabel('Choose NIfTI file', {exact:true}).setInputFiles(compressed);
  await expect.poll(()=>page.locator('main').getAttribute('data-frame-revision').then(Number)).toBeGreaterThan(0);
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/octahedron.surf.gii'));
  await expect(page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas')).toBeVisible();
  await page.getByLabel('Choose scalar GIfTI map',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/octahedron.func.gii'));
  await expect(page.getByRole('button',{name:'Remove surface map',exact:true})).toBeVisible();
  await page.getByLabel('Choose label GIfTI map',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/octahedron.label.gii'));
  await expect(page.getByText('octahedron.label.gii',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Surface region',{exact:true})).toContainText('inspect a region');
  await context.setOffline(false);
});

test('4D frame changes preserve native pixels and reject stale indices',async({page})=>{
  const bytes=[...readFileSync(resolve(__dirname,'../../test-data/browser/oblique4d.nii.gz'))];
  const reference=JSON.parse(readFileSync(resolve(dirname(process.env.BROWSER_NATIVE_WITNESS ?? resolve(__dirname,'../../cruft/browser-portability/native-witness.json')),'native-4d-witness.json'),'utf8'));
  await page.goto('/browser.html');
  const output=await page.evaluate(async({bytes,frame})=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');const transport=new BrowserTransport();
    try {
      await transport.invoke('initialize',{maxSampledTextures:3});
      const volume=await transport.invoke('load_file',{file:new File([new Uint8Array(bytes)],'series.nii.gz')});
      frame.layers[0].intensity=[0,2864];const packets=[];
      for(const timepoint of [0,2,1,0]) {
        await transport.invoke('set_timepoint',{volumeId:volume.id,timepoint});
        packets.push([...await transport.invoke('render_view',{stateJson:JSON.stringify(frame),format:'rgba'})]);
      }
      let rejected=false;try{await transport.invoke('set_timepoint',{volumeId:volume.id,timepoint:3})}catch{rejected=true}
      await transport.invoke('unload_volume',{volumeId:volume.id});
      return {volume,packets,rejected,empty:await transport.invoke('diagnostics')};
    }finally{transport.dispose();}
  },{bytes,frame:request});
  expect(output.volume.frameCount).toBe(3);expect(output.volume.center).toEqual([4,-1,21]);expect(output.rejected).toBe(true);
  for(let t=0;t<4;t++)expect(Math.max(...output.packets[t].map((v,i)=>Math.abs(v-reference.packets[t][i])))).toBeLessThanOrEqual(1);
  expect(output.empty).toEqual({volumes:0,palettes:0,stagingBuffers:0,stagingBytes:0});
});

test('4D controls scrub, play, pause and unload without stale presentation',async({page})=>{
  await page.goto('/browser.html');
  await expect(page.getByRole('button',{name:'Open NIfTI'})).toBeEnabled();
  await page.getByLabel('Choose NIfTI file', {exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/oblique4d.nii'));
  const revision=()=>page.locator('main').getAttribute('data-frame-revision').then(Number);
  await expect.poll(revision).toBeGreaterThan(0);
  const field=page.getByRole('spinbutton',{name:'Frame',exact:true});
  const canvas=page.getByRole('region',{name:'axial slice'}).locator('canvas');
  const before=await canvas.evaluate(c=>c.toDataURL());
  let rev=await revision();await field.fill('2');await field.press('Enter');
  await expect.poll(revision).toBeGreaterThan(rev);
  expect(await canvas.evaluate(c=>c.toDataURL())).not.toBe(before);
  await page.getByRole('button',{name:'Play time series'}).click();
  await expect.poll(revision).toBeGreaterThan(await revision());
  await page.getByRole('button',{name:'Pause playback'}).click();
  await expect(page.getByRole('button',{name:'Play time series'})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('time-series.png')});
  await page.getByRole('button',{name:'Clear workspace'}).click();
  await expect(field).toHaveCount(0);
});

test('categorical WASM pixels, sparse IDs, tables and cancelled ownership match native', async ({page}) => {
  await page.goto('/browser.html');
  const reference=JSON.parse(readFileSync(resolve(dirname(process.env.BROWSER_NATIVE_WITNESS ?? resolve(__dirname,'../../cruft/browser-portability/native-witness.json')), 'native-label-witness.json'),'utf8'));
  const result=await page.evaluate(async ({bytes,table,frame})=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');
    const transport=new BrowserTransport();
    try {
      await transport.invoke('initialize');
      const file=new File([new Uint8Array(bytes)],'labels.nii.gz');
      const sidecar=new File([table],'labels.tsv');
      const volume=await transport.invoke('load_file',{file,table:sidecar});
      frame.layers[0].volumeId=volume.id;
      frame.layers[0].interpolation='linear';
      frame.requestedView.origin_mm[1]=-7.3;
      const packet=[...await transport.invoke('render_view',{stateJson:JSON.stringify(frame),format:'rgba'})];
      const label=await transport.invoke('label_at_world',{volumeId:volume.id,world:[4,-1,21]});
      await transport.invoke('unload_volume',{volumeId:volume.id});
      let badTable=false;
      try {await transport.invoke('load_file',{file,table:new File(['not a label table'],'bad.tsv')});} catch {badTable=true;}
      const abort=new AbortController();
      const cancelled=transport.request('load_file',{file,table:sidecar},abort.signal).catch(e=>e.name);
      const until=performance.now()+150;while(performance.now()<until){}
      abort.abort();
      const cancellation=await cancelled;
      const empty=await transport.invoke('diagnostics');
      const fallback=await transport.invoke('load_file',{file});
      await transport.invoke('unload_volume',{volumeId:fallback.id});
      return {volume,packet,label,badTable,cancellation,empty,fallback};
    } finally {transport.dispose();}
  },{bytes:[...readFileSync(resolve(__dirname,'../../test-data/browser/labels.nii.gz'))],table:readFileSync(resolve(__dirname,'../../test-data/browser/labels.tsv'),'utf8'),frame:request});
  expect(result.volume.labelIds).toEqual([0,17,1024,2047]);
  expect(result.volume.legend.map(e=>e.displayName)).toEqual(['Region seventeen','Region thousand','Last region']);
  expect(result.packet).toEqual(reference.packet);
  expect(result.label).toBe(17);
  expect(result.badTable).toBe(true);
  expect(result.cancellation).toBe('AbortError');
  expect(result.empty).toEqual({volumes:0,palettes:0,stagingBuffers:0,stagingBytes:0});
  expect(result.fallback.legend.map(e=>e.displayName)).toEqual(['Label 17','Label 1024','Label 2047']);
  await test.info().attach('label-witness',{body:JSON.stringify(result),contentType:'application/json'});
});

test('label controls reuse opacity and show the named region at the linked crosshair', async ({page}) => {
  await page.goto('/browser.html');
  await expect(page.getByRole('button',{name:'Open labels',exact:true})).toBeEnabled();
  await page.getByLabel('Choose label image and optional table',{exact:true}).setInputFiles([
    resolve(__dirname,'../../test-data/browser/labels.nii'),resolve(__dirname,'../../test-data/browser/labels.tsv')]);
  await expect(page.getByLabel('Region at crosshair',{exact:true})).toHaveText('Region seventeen (17)');
  await expect(page.getByRole('slider',{name:'Window low',exact:true})).toHaveCount(0);
  const revision=()=>page.locator('main').getAttribute('data-frame-revision').then(Number);
  let before=await revision();
  const anterior=page.getByRole('spinbutton',{name:'A',exact:true});
  await anterior.fill('2');await anterior.press('Enter');
  await expect.poll(revision).toBeGreaterThan(before);
  await expect(page.getByLabel('Region at crosshair',{exact:true})).toHaveText('Region thousand (1024)');
  await page.screenshot({path:test.info().outputPath('label-controls.png')});
  before=await revision();
  await page.getByRole('slider',{name:'Opacity',exact:true}).focus();await page.keyboard.press('Home');
  await expect.poll(revision).toBeGreaterThan(before);
  await page.getByRole('button',{name:'Clear workspace',exact:true}).click();
  await expect(page.getByLabel('Region at crosshair',{exact:true})).toHaveCount(0);
});

const surfaceFixture = resolve(__dirname,'../../test-data/browser/octahedron.surf.gii');
const expectedVertices = [10,80,30,10,-40,30,-30,20,30,50,20,30,10,20,110,10,20,-50];

test('surface WASM decoding transfers exact world geometry and survives cancellation', async ({page}) => {
  await page.goto('/browser.html');
  const result = await page.evaluate(async ({files}) => {
    const {BrowserTransport} = await import('/src/services/browser/transport.ts');
    const transport = new BrowserTransport();
    try {
      const geometry=[];
      for(const bytes of files) {
        const mesh=await transport.invoke('load_surface',{file:new File([new Uint8Array(bytes)],'mesh.gii')});
        geometry.push({vertices:[...mesh.vertices],faces:[...mesh.faces],hemisphere:mesh.hemisphere});
      }
      const abort=new AbortController();
      const pending=transport.request('load_surface',{file:new File([new Uint8Array(files[0])],'cancel.gii')},abort.signal).catch(e=>e.name);
      abort.abort();
      const cancellation=await pending;
      const recovered=await transport.invoke('load_surface',{file:new File([new Uint8Array(files[0])],'recovered.gii')});
      let bad=false;try{await transport.invoke('load_surface',{file:new File(['bad XML'],'invalid.gii')});}catch{bad=true;}
      return {geometry,cancellation,recovered:recovered.vertices.length,bad};
    } finally {transport.dispose();}
  },{files:['octahedron.surf.gii','octahedron-column.surf.gii','octahedron-zlib.surf.gii','octahedron.surf.gii.gz'].map(name=>[...readFileSync(resolve(__dirname,'../../test-data/browser',name))])});
  for(const mesh of result.geometry){expect(mesh.vertices).toEqual(expectedVertices);expect(mesh.faces).toEqual([0,2,4,2,1,4,1,3,4,3,0,4,2,0,5,1,2,5,3,1,5,0,3,5]);expect(mesh.hemisphere).toBe('left');}
  expect(result.cancellation).toBe('AbortError');expect(result.recovered).toBe(18);expect(result.bad).toBe(true);
});

test('surface canvas rotates, zooms, picks world vertices and releases GPU objects',async({page})=>{
  await page.addInitScript(()=>{
    const live=new Map<object, WebGLRenderingContext | WebGL2RenderingContext>();
    // Context loss retires all remaining driver objects without individual delete calls.
    globalThis.__surfaceGpuLive=()=>[...live.values()].filter(gl=>!gl.isContextLost()).length;
    for(const Type of [WebGLRenderingContext,WebGL2RenderingContext]) {
      for(const name of ['Buffer','Texture','Program','Framebuffer','Renderbuffer','Shader','VertexArray']) {
        const proto=Type.prototype;const create=proto[`create${name}`],remove=proto[`delete${name}`];
        if(!create||!remove)continue;
        proto[`create${name}`]=function(...args){const value=create.apply(this,args);if(value)live.set(value,this);return value;};
        proto[`delete${name}`]=function(value){live.delete(value);return remove.call(this,value);};
      }
    }
  });
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/browser.html');
  // Inspector controls can move fractional layout edges by one CSS pixel.
  // Fix the drawing area for exact transparency comparisons, then restore it.
  const fixedSize=await page.addStyleTag({content:'.browser-surface-canvas { flex: none !important; width: 600px !important; height: 600px !important; }'});
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles(surfaceFixture);
  const canvas=page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('width','600');
  await expect(canvas).toHaveAttribute('height','600');
  const pixels=()=>canvas.screenshot().then(bytes=>createHash('sha256').update(bytes).digest('hex'));
  await expect.poll(()=>page.evaluate(()=>globalThis.__surfaceGpuLive())).toBeGreaterThan(0);
  // Picking returns a point on the triangle and its nearest vertex, not a snapped point.
  const bounds=(await canvas.boundingBox())!;
  await canvas.click({position:{x:bounds.width/2,y:bounds.height/2}});
  const picked=page.getByLabel('Surface pick',{exact:true});
  await expect(picked).toContainText('Near vertex');
  const match=(await picked.textContent())!.match(/Near vertex (\d+) · RAS ([\d.-]+), ([\d.-]+), ([\d.-]+) mm/)!;
  expect(Number(match[1])).toBeLessThan(6);
  const [x,y,z]=match.slice(2).map(Number);
  // Independent equation for the transformed octahedron's surface.
  expect(Math.abs(x-10)/40 + Math.abs(y-20)/60 + Math.abs(z-30)/80).toBeCloseTo(1,2);
  const base=await pixels();
  await page.getByLabel('Choose scalar GIfTI map',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/octahedron.func.gii'));
  await expect(page.getByLabel('Surface value',{exact:true})).toHaveText(`Vertex ${match[1]} value: ${[-3,-1,0,2,4,8][Number(match[1])]}`);
  await expect.poll(pixels).not.toBe(base);
  const colored=await pixels();
  await page.getByRole('button',{name:/^Select colormap/}).click();
  await page.getByRole('button',{name:'Grayscale',exact:true}).click();
  await expect.poll(pixels).not.toBe(colored);
  const gray=await pixels();
  const rgb = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], {type:'image/png'}));
    const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image,0,0); image.close();
    // The centered camera puts the picked vertex marker at the middle.
    // Sample the adjacent surface, whose grayscale material is under test.
    return [...ctx.getImageData(Math.floor(canvas.width*0.55),Math.floor(canvas.height*0.55),1,1).data].slice(0,3);
  }, [...await canvas.screenshot()]);
  expect(Math.min(...rgb)).toBeGreaterThan(15);
  expect(Math.max(...rgb)-Math.min(...rgb)).toBeLessThanOrEqual(2);

  await page.getByRole('button',{name:/^Surface range high/}).click();
  await page.getByRole('textbox',{name:'Surface range high',exact:true}).fill('20');
  await page.getByRole('textbox',{name:'Surface range high',exact:true}).press('Enter');
  await expect.poll(pixels).not.toBe(gray);
  const rescaled=await pixels();
  await page.getByRole('slider',{name:'Map opacity',exact:true}).press('Home');
  await expect.poll(pixels).not.toBe(rescaled);
  await page.getByRole('slider',{name:'Map opacity',exact:true}).press('End');
  // A rejected map cannot overwrite the existing attachment.
  await page.getByLabel('Choose scalar GIfTI map',{exact:true}).setInputFiles({name:'wrong.gii',mimeType:'application/xml',buffer:Buffer.from(readFileSync(resolve(__dirname,'../../test-data/browser/octahedron.func.gii'),'utf8').replace('Dim0="6"','Dim0="5"').replace('-3 -1 0 2 4 8','-3 -1 0 2 4'))});
  await expect(page.getByRole('alert')).toContainText('surface requires 6');
  await expect(page.getByLabel('Surface value',{exact:true})).toHaveText(`Vertex ${match[1]} value: ${[-3,-1,0,2,4,8][Number(match[1])]}`);
  await page.getByRole('button',{name:'Remove surface map',exact:true}).click();
  await expect(page.getByLabel('Surface value',{exact:true})).toHaveCount(0);
  await page.getByLabel('Choose scalar GIfTI map',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/octahedron.func.gii'));
  await expect(page.getByRole('button',{name:'Remove surface map',exact:true})).toBeVisible();
  const labelXml=readFileSync(resolve(__dirname,'../../test-data/browser/octahedron.label.gii'),'utf8');
  await page.getByLabel('Choose label GIfTI map',{exact:true}).setInputFiles({name:'background.label.gii',mimeType:'application/xml',buffer:Buffer.from(labelXml.replace('0 17 16777217 16777218 4294967295 17','0 0 0 0 0 0'))});
  await expect(page.getByRole('button',{name:/^Select colormap/})).toHaveCount(0);
  // Label zero must reveal exactly the existing uncolored base surface.
  await expect.poll(pixels).toBe(base);
  await page.getByLabel('Choose label GIfTI map',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/octahedron.label.gii'));
  const ids=[0,17,16777217,16777218,4294967295,17];
  const names=['Medial wall','Region red','Region & left','Label 16777218','Hidden region','Region red'];
  const vertex=Number(match[1]);
  await expect(page.getByLabel('Surface region',{exact:true})).toHaveText(`${names[vertex]} (${ids[vertex]}) · vertex ${vertex}`);
  await expect.poll(pixels).not.toBe(base);
  const categorical=await pixels();
  await page.getByRole('slider',{name:'Map opacity',exact:true}).press('Home');
  await expect.poll(pixels).toBe(base);
  await page.getByRole('slider',{name:'Map opacity',exact:true}).press('End');
  await expect.poll(pixels).toBe(categorical);
  const original=await pixels();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.6,{steps:8});await page.mouse.up();
  await expect.poll(pixels).not.toBe(original);
  const rotated=await pixels();await page.mouse.wheel(0,150);
  await expect.poll(pixels).not.toBe(rotated);
  await page.getByRole('button',{name:'Reset camera',exact:true}).click();
  await fixedSize.evaluate(element=>element.remove());
  await expect(canvas).not.toHaveAttribute('width','600');
  await page.screenshot({path:test.info().outputPath('surface-desktop.png')});
  await page.setViewportSize({width:420,height:900});
  await page.getByLabel('Surface region',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath('surface-narrow.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Unload surface',exact:true}).click();
  await expect(canvas).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>globalThis.__surfaceGpuLive())).toBe(0);
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles(surfaceFixture);
  await expect(canvas).toBeVisible();
  await page.getByRole('button',{name:'Clear workspace',exact:true}).click();
  await expect(canvas).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>globalThis.__surfaceGpuLive())).toBe(0);
  expect(errors).toEqual([]);
});

test('surface GPU initialization failure clears provisional UI geometry',async({page})=>{
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(kind==='webgl'||kind==='webgl2'||kind==='experimental-webgl')return null;
      return original.call(this,kind,...args);
    };
  });
  await page.goto('/browser.html');
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles(surfaceFixture);
  await expect(page.getByRole('alert')).toContainText('Surface viewer failed to initialize');
  await expect(page.getByRole('button',{name:'Unload surface',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Surface view',exact:true})).toHaveCount(0);
});


test('surface decoding does not require a WebGPU adapter',async({page})=>{
  await page.goto('/browser.html');
  const created=page.waitForEvent('worker',worker=>worker.url().includes('surface-no-webgpu'));
  await page.evaluate(async()=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');
    globalThis.__surfaceTransport=new BrowserTransport(new Worker('/src/services/browser/worker.ts?surface-no-webgpu',{type:'module'}));
  });
  const worker=await created;
  await worker.evaluate(()=>Object.defineProperty(navigator,'gpu',{value:undefined}));
  const vertices=await page.evaluate(async(bytes)=>{
    const transport=globalThis.__surfaceTransport;
    try { const mesh=await transport.invoke('load_surface',{file:new File([new Uint8Array(bytes)],'mesh.gii')});return [...mesh.vertices]; }
    finally {transport.dispose();delete globalThis.__surfaceTransport;}
  },[...readFileSync(surfaceFixture)]);
  expect(vertices).toEqual(expectedVertices);
});


test('scalar surface WASM decoding returns exact values and recovers after cancellation', async ({page}) => {
  await page.goto('/browser.html');
  const result = await page.evaluate(async (xml) => {
    const {BrowserTransport} = await import('/src/services/browser/transport.ts');
    const transport = new BrowserTransport();
    const file = new File([xml], 'map.func.gii');
    try {
      const abort = new AbortController();
      const pending = transport.request('load_surface_scalar', {file}, abort.signal).catch(e => e.name);
      abort.abort();
      const cancelled = await pending;
      const values = await transport.invoke('load_surface_scalar', {file});
      let rejected = false;
      try { await transport.invoke('load_surface_scalar', {file: new File([xml.replace('-3 -1 0 2 4 8', '-3 -1 NaN 2 4 8')], 'missing.gii')}); } catch { rejected = true; }
      return {cancelled, values: [...values], rejected};
    } finally { transport.dispose(); }
  }, readFileSync(resolve(__dirname,'../../test-data/browser/octahedron.func.gii'),'utf8'));
  expect(result).toEqual({cancelled:'AbortError', values:[-3,-1,0,2,4,8], rejected:true});
});


test('surface labels preserve sparse integer IDs, embedded names and alpha without a dense LUT', async ({page}) => {
  await page.goto('/browser.html');
  const result = await page.evaluate(async (xml) => {
    const {BrowserTransport} = await import('/src/services/browser/transport.ts');
    const transport = new BrowserTransport();
    const file = new File([xml], 'labels.gii');
    try {
      const abort = new AbortController();
      const pending = transport.request('load_surface_labels', {file}, abort.signal).catch(e => e.name);
      abort.abort();
      const cancelled = await pending;
      const map = await transport.invoke('load_surface_labels', {file});
      const again = await transport.invoke('load_surface_labels', {file});
      let rejected = false;
      try { await transport.invoke('load_surface_labels', {file: new File([xml.replace('0 17 16777217', '0 17 0.5')], 'fractional.gii')}); } catch { rejected = true; }
      return {cancelled, labels:[...map.labels], rgba:[...map.rgba], legend:map.legend,
        same: [...again.rgba].every((v,i)=>v===map.rgba[i]), integerArray: map.labels instanceof Uint32Array, rejected};
    } finally { transport.dispose(); }
  }, readFileSync(resolve(__dirname,'../../test-data/browser/octahedron.label.gii'),'utf8'));
  expect(result.cancelled).toBe('AbortError'); expect(result.rejected).toBe(true); expect(result.integerArray).toBe(true);
  expect(result.labels).toEqual([0,17,16777217,16777218,4294967295,17]);
  expect(result.rgba.length).toBe(24); expect(result.legend.length).toBe(5); expect(result.same).toBe(true);
  expect(result.rgba.slice(0,12)).toEqual([0,0,0,0, 1,0,0,1, 0,1,0,0.5]);
  expect(result.rgba.slice(16)).toEqual([0,0,1,0, 1,0,0,1]);
  expect(result.legend.find(e=>e.id===16777217)).toMatchObject({name:'Region & left',rgba:[0,1,0,0.5]});
  expect(result.legend.find(e=>e.id===16777218).name).toBe('Label 16777218');
});

test('session settings verify sources before replacement and export presented slices', async ({page}) => {
  await page.goto('/browser.html');
  await expect(page.getByRole('button',{name:'Open NIfTI',exact:true})).toBeEnabled();
  await page.getByLabel('Choose NIfTI file',{exact:true}).setInputFiles(fixture);
  await expect(page.getByRole('button',{name:'Unload oblique.nii',exact:true})).toBeVisible();
  await expect(page.locator('.browser-raster canvas').first()).toBeVisible();
  const savedEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  const saved=await savedEvent;
  const settings=readFileSync((await saved.path())!);
  const parsed=JSON.parse(settings.toString());
  expect(parsed.volumes[0].source.sha256).toBe(createHash('sha256').update(readFileSync(fixture)).digest('hex'));
  await page.getByLabel('Choose session settings',{exact:true}).setInputFiles({name:'session.json',mimeType:'application/json',buffer:settings});
  await expect(page.getByRole('button',{name:'Choose session sources',exact:true})).toBeVisible();
  const changed=Buffer.from(readFileSync(fixture));changed[changed.length-1]^=1;
  await page.getByLabel('Choose session sources',{exact:true}).setInputFiles({name:'oblique.nii',mimeType:'application/octet-stream',buffer:changed});
  await expect(page.getByRole('alert')).toContainText('original contents');
  await expect(page.getByRole('button',{name:'Unload oblique.nii',exact:true})).toBeVisible();
  await page.getByLabel('Choose session sources',{exact:true}).setInputFiles({name:'renamed.nii',mimeType:'application/octet-stream',buffer:readFileSync(fixture)});
  await expect(page.getByRole('button',{name:'Unload renamed.nii',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Choose session sources',exact:true})).toHaveCount(0);
  // Wait for the restored render to publish before exporting it.
  await expect(page.locator('[data-frame-revision]')).toHaveAttribute('data-frame-revision', /[1-9]\d*/);
  const pngEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const png=readFileSync((await (await pngEvent).path())!);
  expect(Array.from(png.subarray(0,8))).toEqual([137,80,78,71,13,10,26,10]);
  expect(png.readUInt32BE(16)).toBeGreaterThan(1536);
  expect(png.toString('latin1')).toContain('brainflow-browser-image');
});

test('surface session restores orbit and zoom and exports its shared canvas', async ({page}) => {
  page.on('pageerror', error => console.log('SURFACE PAGE ERROR', error.message));
  page.on('console', message => { if(message.type()==='error') console.log('SURFACE CONSOLE ERROR',message.text()); });
  await page.goto('/browser.html');
  await page.addStyleTag({content:'.browser-surface-canvas { flex: none !important; width: 600px !important; height: 600px !important; }'});
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles(surfaceFixture);
  const canvas=page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas');
  await expect(canvas).toBeVisible();
  const save=async()=>{
    const event=page.waitForEvent('download');
    await page.getByRole('button',{name:'Save session',exact:true}).click();
    return readFileSync((await (await event).path())!);
  };
  const initial=JSON.parse((await save()).toString());
  expect(initial.camera).toBeTruthy();
  const bounds=(await canvas.boundingBox())!;
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.6,{steps:8});await page.mouse.up();
  await page.mouse.wheel(0,150);
  // Wait for orbit-control damping to settle before capturing exact camera state.
  await page.waitForTimeout(700);
  const settings=await save();
  const saved=JSON.parse(settings.toString());
  expect(saved.camera.position).not.toEqual(initial.camera.position);
  await page.getByRole('button',{name:'Clear workspace',exact:true}).click();
  await page.getByLabel('Choose session settings',{exact:true}).setInputFiles({name:'session.json',mimeType:'application/json',buffer:settings});
  await expect(page.getByRole('button',{name:'Choose session sources',exact:true})).toBeVisible();
  await page.getByLabel('Choose session sources',{exact:true}).setInputFiles(surfaceFixture);
  await expect(canvas).toBeVisible().catch(async error => { console.log('RESTORE BODY',await page.locator('body').innerText());throw error; });
  await page.waitForTimeout(100);
  const restored=JSON.parse((await save()).toString());
  await test.info().attach('camera-round-trip', { body: JSON.stringify({saved:saved.camera,restored:restored.camera},null,2), contentType:'application/json' });
  for (const key of ['position','target','rotation']) {
    for (let i=0;i<3;i++) expect(restored.camera[key][i]).toBeCloseTo(saved.camera[key][i],6);
  }
  expect(restored.camera.zoom).toBe(saved.camera.zoom);
  const event=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const png=readFileSync((await (await event).path())!);
  expect(png.readUInt32BE(16)).toBe(600);
  expect(png.readUInt32BE(20)).toBe(600);
  await page.screenshot({path:test.info().outputPath('surface-session-restored.png')});
});

test('explicit surface linking preserves picked world coordinates in slices and saved settings', async ({page}) => {
  await page.goto('/browser.html');
  await expect(page.getByRole('button',{name:'Open NIfTI',exact:true})).toBeEnabled();
  await page.getByLabel('Choose NIfTI file',{exact:true}).setInputFiles(fixture);
  await expect.poll(()=>page.locator('main').getAttribute('data-frame-revision').then(Number)).toBeGreaterThan(0);
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles(surfaceFixture);
  const canvas=page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas');
  await expect(canvas).toBeVisible();
  const link=page.getByRole('button',{name:'Link volume cursor',exact:true});
  await expect(link).toHaveAttribute('aria-pressed','false');
  await link.click();
  await canvas.click();
  const picked=page.getByLabel('Surface pick',{exact:true});
  await expect(picked).toContainText('Near vertex');
  const match=(await picked.textContent())!.match(/RAS ([\d.-]+), ([\d.-]+), ([\d.-]+) mm/)!;
  const world=match.slice(1).map(Number);
  await page.getByRole('button',{name:'Show slices',exact:true}).click();
  for(const [axis,index] of [['R',0],['A',1],['S',2]] as const) {
    expect(Number(await page.getByRole('spinbutton',{name:axis,exact:true}).inputValue())).toBeCloseTo(world[index],1);
  }
  const event=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  const saved=JSON.parse(readFileSync((await (await event).path())!,'utf8'));
  expect(saved.surfaces[0].linked).toBe(true);
  for(let i=0;i<3;i++) expect(saved.crosshair[i]).toBeCloseTo(world[i],1);
  const inflated=readFileSync(surfaceFixture,'utf8').replace('<MetaData>', '<MetaData><MD><Name>GeometricType</Name><Value>Inflated</Value></MD>');
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles({name:'inflated.gii',mimeType:'application/xml',buffer:Buffer.from(inflated)});
  await expect(link).toBeDisabled();
  await expect(link).toHaveAttribute('aria-pressed','false');
});

test('paired hemispheres retain independent maps and restore as one scene', async ({page}) => {
  const left=readFileSync(surfaceFixture);
  const right=Buffer.from(left.toString().replace('CortexLeft','CortexRight').replace('0 -2 0 10 3 0 0 20','0 -2 0 110 3 0 0 20'));
  const mapFile=resolve(__dirname,'../../test-data/browser/octahedron.func.gii');
  await page.goto('/browser.html');
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles({name:'left.gii',mimeType:'application/xml',buffer:left});
  await page.getByLabel('Choose scalar GIfTI map',{exact:true}).setInputFiles(mapFile);
  await expect(page.getByRole('button',{name:/^Select colormap/})).toHaveAttribute('aria-label',/Viridis/);
  await page.getByLabel('Choose companion hemisphere',{exact:true}).setInputFiles({name:'right.gii',mimeType:'application/xml',buffer:right});
  await expect(page.getByRole('list',{name:'Surfaces',exact:true}).getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Add hemisphere',exact:true})).toBeDisabled();
  await page.getByLabel('Choose scalar GIfTI map',{exact:true}).setInputFiles(mapFile);
  await page.getByRole('button',{name:/^Select colormap/}).click();
  await page.getByRole('button',{name:'Grayscale',exact:true}).click();
  await page.getByRole('button',{name:'left.gii',exact:true}).click();
  await expect(page.getByRole('button',{name:/^Select colormap/})).toHaveAttribute('aria-label',/Viridis/);
  const event=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  const settings=readFileSync((await (await event).path())!);
  const saved=JSON.parse(settings.toString());
  expect(saved.version).toBe(2);expect(saved.surfaces).toHaveLength(2);
  expect(saved.surfaces.map(s=>s.overlay.colormap)).toEqual(['viridis','gray']);
  await page.getByRole('button',{name:'Clear workspace',exact:true}).click();
  await page.getByLabel('Choose session settings',{exact:true}).setInputFiles({name:'session.json',mimeType:'application/json',buffer:settings});
  await expect(page.getByRole('button',{name:'Choose session sources',exact:true})).toBeVisible();
  await page.getByLabel('Choose session sources',{exact:true}).setInputFiles([
    {name:'left.gii',mimeType:'application/xml',buffer:left},
    {name:'right.gii',mimeType:'application/xml',buffer:right},
    {name:'octahedron.func.gii',mimeType:'application/xml',buffer:readFileSync(mapFile)},
  ]);
  await expect(page.getByRole('button',{name:'Choose session sources',exact:true})).toHaveCount(0);
  await expect(page.getByRole('list',{name:'Surfaces',exact:true}).getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('paired-hemispheres.png')});
  await page.getByRole('button',{name:'right.gii',exact:true}).click();
  await page.getByRole('button',{name:'Unload surface',exact:true}).click();
  await expect(page.getByRole('list',{name:'Surfaces',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^Select colormap/})).toHaveAttribute('aria-label',/Viridis/);
});

test('projection frame transfer preserves analytic voxel order, full affine and 4D selection', async ({page}) => {
  await page.goto('/browser.html');
  const result=await page.evaluate(async bytes=>{
    const {BrowserTransport}=await import('/src/services/browser/transport.ts');
    const transport=new BrowserTransport();
    try {
      const volume=await transport.invoke('load_file',{file:new File([new Uint8Array(bytes)],'series.nii')});
      const frame=await transport.invoke('projection_frame',{volumeId:volume.id,timepoint:2});
      let invalid=false;try {await transport.invoke('projection_frame',{volumeId:volume.id,timepoint:3});}catch {invalid=true;}
      await transport.invoke('unload_volume',{volumeId:volume.id});
      let unloaded=false;try {await transport.invoke('projection_frame',{volumeId:volume.id,timepoint:0});}catch {unloaded=true;}
      return {values:[...frame.values],dims:frame.dims,affine:[...frame.affine],invalid,unloaded,empty:await transport.invoke('diagnostics')};
    } finally {transport.dispose();}
  },[...readFileSync(resolve(__dirname,'../../test-data/browser/oblique4d.nii'))]);
  expect(result.dims).toEqual([5,7,9]);
  expect(result.affine).toEqual([0,3,0,0,-2,0,0,0,0,0,4,0,10,-7,5,1]);
  const expected=[];for(let k=0;k<9;k++)for(let j=0;j<7;j++)for(let i=0;i<5;i++)expected.push(2000+i+10*j+100*k);
  expect(result.values).toEqual(expected);
  expect(result.invalid).toBe(true);expect(result.unloaded).toBe(true);
  expect(result.empty).toEqual({volumes:0,palettes:0,stagingBuffers:0,stagingBytes:0});
});

test('browser scalar projection matches analytic surface values and restores its source frame', async ({page}) => {
  // All three vertices lie on i + 10*j + 100*k = 411 under the rotated NIfTI affine.
  let array=0;
  const surface=readFileSync(surfaceFixture,'utf8').replace('Dim0="6"','Dim0="3"').replace('Dim0="8"','Dim0="1"')
    .replace(/<MatrixData>[^<]*<\/MatrixData>/,'<MatrixData>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</MatrixData>')
    .replace(/<Data>[^<]*<\/Data>/g,()=>array++===0?'<Data>8 -4 21 8 2 20.92 4 -4 20.2</Data>':'<Data>0 1 2</Data>');
  const scalar=readFileSync(resolve(__dirname,'../../test-data/browser/octahedron.func.gii'),'utf8')
    .replace('Dim0="6"','Dim0="3"').replace(/<Data>[^<]*<\/Data>/,'<Data>411 411 411</Data>');
  await page.goto('/browser.html');
  await page.addStyleTag({content:'.browser-surface-canvas { flex: none !important; width: 600px !important; height: 600px !important; }'});
  await expect(page.getByRole('button',{name:'Open NIfTI',exact:true})).toBeEnabled();
  await page.getByLabel('Choose NIfTI file',{exact:true}).setInputFiles(fixture);
  await expect(page.getByRole('button',{name:'Unload oblique.nii',exact:true})).toBeVisible();
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles({name:'isovalue.gii',mimeType:'application/xml',buffer:Buffer.from(surface)});
  await page.getByRole('button',{name:'Link volume cursor',exact:true}).click();
  await page.getByRole('button',{name:'Project selected frame',exact:true}).click();
  await expect(page.getByText('Projected frame 1 · linear interpolation',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas')).toBeVisible();
  const exportPNG=async()=>{
    const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    return readFileSync((await (await event).path())!);
  };
  await page.screenshot({path:test.info().outputPath('projection-screen.png')});
  const projected=await exportPNG();
  writeFileSync(test.info().outputPath('projected.png'),projected);
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Save session',exact:true}).click();
  const settings=readFileSync((await (await event).path())!);
  expect(JSON.parse(settings.toString()).surfaces[0].overlay).toMatchObject({kind:'projection',volume:0,frame:0});
  await page.getByLabel('Choose scalar GIfTI map',{exact:true}).setInputFiles({name:'analytic.gii',mimeType:'application/xml',buffer:Buffer.from(scalar)});
  await page.getByRole('button',{name:/^Select colormap/}).click();await page.getByRole('button',{name:'Grayscale',exact:true}).click();
  for(const [end,value] of [['low','0'],['high','864']]) {
    await page.getByRole('button',{name:new RegExp('^Surface range '+end)}).click();
    await page.getByRole('textbox',{name:'Surface range '+end,exact:true}).fill(value);
    await page.getByRole('textbox',{name:'Surface range '+end,exact:true}).press('Enter');
  }
  await page.screenshot({path:test.info().outputPath('analytic-screen.png')});
  const analytic=await exportPNG();
  writeFileSync(test.info().outputPath('analytic.png'),analytic);
  await test.info().attach('projected.png',{body:projected,contentType:'image/png'});
  await test.info().attach('analytic.png',{body:analytic,contentType:'image/png'});
  const difference=await page.evaluate(async({a,b})=>{
    const read=async(bytes:number[])=>{
      const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.close();return ctx.getImageData(0,0,canvas.width,canvas.height).data;
    };
    const x=await read(a),y=await read(b);let pixels=0,total=0;
    // Compare the grayscale surface only, excluding the green linked-cursor marker.
    for(let i=0;i<x.length;i+=4)if(y[i]+y[i+1]+y[i+2]>30 && Math.max(y[i],y[i+1],y[i+2])-Math.min(y[i],y[i+1],y[i+2])<=2){pixels++;for(let c=0;c<3;c++)total+=Math.abs(x[i+c]-y[i+c]);}
    return {pixels,mean:total/(3*pixels)};
  },{a:[...projected],b:[...analytic]});
  await test.info().attach('projection-difference.json',{body:Buffer.from(JSON.stringify(difference)),contentType:'application/json'});
  expect(difference.pixels).toBeGreaterThan(10000);
  expect(difference.mean).toBeLessThan(3); // f32 affine and 8-bit palette interpolation tolerance.
  await page.getByLabel('Choose session settings',{exact:true}).setInputFiles({name:'session.json',mimeType:'application/json',buffer:settings});
  await expect(page.getByRole('button',{name:'Choose session sources',exact:true})).toBeVisible();
  await page.getByLabel('Choose session sources',{exact:true}).setInputFiles([
    {name:'oblique.nii',mimeType:'application/octet-stream',buffer:readFileSync(fixture)},
    {name:'isovalue.gii',mimeType:'application/xml',buffer:Buffer.from(surface)},
  ]);
  await expect(page.getByRole('button',{name:'Choose session sources',exact:true})).toHaveCount(0);
  await expect(page.getByText('Projected frame 1 · linear interpolation',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Unload oblique.nii',exact:true}).click();
  await expect(page.getByText('Projected frame 1 · linear interpolation',{exact:true})).toHaveCount(0);
});

test('categorical projection preserves nearest IDs, palette, outside coverage and restored source', async ({page}) => {
  let array=0;
  const surface=readFileSync(surfaceFixture,'utf8').replace('Dim0="6"','Dim0="4"').replace('Dim0="8"','Dim0="2"')
    .replace(/<MatrixData>[^<]*<\/MatrixData>/,'<MatrixData>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</MatrixData>')
    .replace(/<Data>[^<]*<\/Data>/g,()=>array++===0?'<Data>10 -4 21 8 -4 21 10 -1 21 20 -4 21</Data>':'<Data>0 2 1 0 3 2</Data>');
  const bytes=readFileSync(resolve(__dirname,'../../test-data/browser/labels.nii'));
  const table=readFileSync(resolve(__dirname,'../../test-data/browser/labels.tsv'),'utf8');
  await page.goto('/browser.html');
  const result=await page.evaluate(async({bytes,table,surface})=>{
    const {BrowserSession}=await import('/src/services/browser/session.ts');
    const session=new BrowserSession();
    try {
      await session.initialize();
      await session.load(new File([new Uint8Array(bytes)],'labels.nii'),true,new File([table],'labels.tsv'));
      await session.loadSurface(new File([surface],'label-surface.gii'));
      session.setSurfaceLink(true);
      await session.projectVolume();
      if(session.store.getState().error)throw new Error(session.store.getState().error!);
      return {labels:[...session.surfaceLabels!.labels],rgba:[...session.surfaceLabels!.rgba],
        legend:session.surfaceLabels!.legend,record:await session.saveRecord()};
    } finally {session.dispose();}
  },{bytes:[...bytes],table,surface});
  // world=(10-2*j,-7+3*i,5+4*k); IDs cycle [0,17,1024,2047] by i+j.
  expect(result.labels).toEqual([17,1024,1024,0]);
  expect(result.rgba).toEqual([1,0,0,1,0,1,0,1,0,1,0,1,0,0,0,0]);
  expect(result.legend.find(entry=>entry.id===17)?.name).toBe('Region seventeen');
  expect(result.record.surfaces[0].overlay).toMatchObject({kind:'projection',volume:0,frame:0});
  await page.getByLabel('Choose session settings',{exact:true}).setInputFiles({name:'labels.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(result.record))});
  await page.getByLabel('Choose session sources',{exact:true}).setInputFiles([
    {name:'labels.nii',mimeType:'application/octet-stream',buffer:bytes},
    {name:'labels.tsv',mimeType:'text/tab-separated-values',buffer:Buffer.from(table)},
    {name:'label-surface.gii',mimeType:'application/xml',buffer:Buffer.from(surface)},
  ]);
  await expect(page.getByRole('button',{name:'Choose session sources',exact:true})).toHaveCount(0);
  await expect(page.getByText('Projected frame 1 · nearest label',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Select colormap/})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('categorical-projection.png')});
  await page.getByRole('button',{name:'Unload labels.nii',exact:true}).click();
  await expect(page.getByText('Projected frame 1 · nearest label',{exact:true})).toHaveCount(0);
});
