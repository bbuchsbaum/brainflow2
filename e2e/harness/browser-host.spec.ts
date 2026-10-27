import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fixture=resolve(__dirname,'../../test-data/browser/oblique.nii');
const compressed=resolve(__dirname,'../../test-data/browser/oblique.nii.gz');
const request=JSON.parse(readFileSync(resolve(__dirname,'../../test-data/browser/frame.json'),'utf8'));
const witness=JSON.parse(readFileSync(resolve(__dirname,'../../cruft/browser-portability/native-witness.json'),'utf8'));

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
  expect(result.empty).toEqual({volumes:0,stagingBuffers:0,stagingBytes:0});
  expect(result.afterCancel).toEqual(result.empty);
  expect(result.stale).toBe(true);expect(result.unsupported).toBe('UNSUPPORTED_BROWSER_CAPABILITY');
  expect(result.cancellation).toBe('AbortError');expect(result.gzip).toEqual([4,-1,21]);
  await test.info().attach('browser-native-comparison',{body:JSON.stringify(result),contentType:'application/json'});
});

test('linked slices, window, overlay and teardown work at desktop and narrow sizes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/browser.html');await expect(page.getByRole('button',{name:'Open NIfTI'})).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(fixture);
  const revision=()=>page.locator('main').getAttribute('data-frame-revision').then(Number);
  await expect.poll(revision).toBeGreaterThan(0);
  expect(await page.getByRole('spinbutton',{name:'R',exact:true}).inputValue()).toBe('4');
  expect(await page.locator('[data-slider-box]').first().evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(100);
  const canvas=page.getByRole('region',{name:'axial slice'}).locator('canvas');
  const pixels=()=>canvas.evaluate(c=>c.toDataURL());
  const before=await pixels();let r=await revision();
  await page.getByRole('slider',{name:'Window low',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect.poll(revision).toBeGreaterThan(r);expect(await pixels()).not.toBe(before);
  r=await revision();await page.locator('input[type=file]').setInputFiles(compressed);
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
  await page.locator('input[type=file]').setInputFiles(fixture);
  await expect.poll(()=>page.locator('main').getAttribute('data-frame-revision').then(Number)).toBeGreaterThan(0);
  const urls=await page.evaluate(async()=>{const names=await caches.keys();const keys=await Promise.all(names.filter(n=>n.startsWith('brainflow-browser-')).map(n=>caches.open(n).then(c=>c.keys())));return keys.flat().map(r=>r.url)});
  expect(urls.some(u=>u.endsWith('.wasm'))).toBe(true);expect(urls.some(u=>u.includes('oblique'))).toBe(false);
  await context.setOffline(true);await page.reload();
  await expect(page.getByRole('button',{name:'Open NIfTI'})).toBeEnabled();
  await expect(page.getByText('Local processing · Offline')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(compressed);
  await expect.poll(()=>page.locator('main').getAttribute('data-frame-revision').then(Number)).toBeGreaterThan(0);
  await context.setOffline(false);
});
