import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles(surfaceFixture);
  const canvas=page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas');
  await expect(canvas).toBeVisible();
  const pixels=()=>canvas.screenshot().then(bytes=>bytes.toString('base64'));
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
  const original=await pixels();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.6,{steps:8});await page.mouse.up();
  await expect.poll(pixels).not.toBe(original);
  const rotated=await pixels();await page.mouse.wheel(0,150);
  await expect.poll(pixels).not.toBe(rotated);
  await page.getByRole('button',{name:'Reset camera',exact:true}).click();
  await page.screenshot({path:test.info().outputPath('surface-desktop.png')});
  await page.setViewportSize({width:420,height:900});
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
