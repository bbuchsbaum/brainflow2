import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
const fixture=resolve(__dirname,'../../test-data/browser/oblique.nii');
async function boot(page:Page){
 await page.goto('/workspace.html');
 await expect(page.getByTestId('top-app-bar')).toBeVisible({timeout:30000});
 await page.waitForFunction(async()=>{
   const {areServicesInitialized}=await import('/src/hooks/useServicesInit.ts');return areServicesInitialized();
 });
}
async function open(page:Page,empty=false){
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('region',{name:'Files start',exact:true}).getByRole('button',{name:'Open file…',exact:true}).click();
 await (await chooser).setFiles(empty?[]:fixture);
}
async function state(page:Page){return page.evaluate(async()=>{
 const {useLayerStore}=await import('/src/stores/layerStore.ts');
 const {useViewStateStore}=await import('/src/stores/viewStateStore.ts');
 const {getTransport}=await import('/src/services/transport.ts');
 return {layers:useLayerStore.getState().layers.map(l=>l.id),viewLayers:useViewStateStore.getState().viewState.layers.map(l=>l.id),resources:await getTransport().invoke('diagnostics')};
});}
const empty={volumes:0,palettes:0,stagingBuffers:0,stagingBytes:0};

test('the actual App loads, inspects, navigates and unloads through shared services',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await boot(page);await open(page);
 await expect.poll(async()=>(await state(page)).layers.length).toBe(1);
 const id=(await state(page)).layers[0];
 const measurements=await page.evaluate(async id=>{
  const {getTransport}=await import('/src/services/transport.ts');
  const {useLayerStore}=await import('/src/stores/layerStore.ts');
  const transport=getTransport();
  return {metadata:useLayerStore.getState().layerMetadata.get(id),histogram:await transport.invoke('compute_layer_histogram',{layerId:id,binCount:16}),value:await transport.invoke('sample_layer_value_at_world',{layerId:id,worldCoords:[4,-1,21]})};
 },id);
 expect(measurements.value).toBe(432);
 expect(measurements.metadata?.dimensions).toEqual([5,7,9]);
 expect(measurements.histogram).toMatchObject({total_count:315,min_value:0,max_value:864,mean:432});
 expect(measurements.histogram.bins.reduce((n,b)=>n+b.count,0)).toBe(315);
 await expect(page.getByRole('button',{name:/^Mount directory/})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Mount remote (SSH)…',exact:true})).toBeDisabled();
 await page.getByRole('row',{name:/oblique\.nii/}).click();
 const opacity=page.getByRole('slider',{name:'Opacity',exact:true});
 await expect(opacity).toBeVisible();await opacity.focus();await page.keyboard.press('Home');
 await expect.poll(()=>page.evaluate(async()=>{
  const {useViewStateStore}=await import('/src/stores/viewStateStore.ts');return useViewStateStore.getState().viewState.layers[0].opacity;
 })).toBe(0);
 await page.keyboard.press('End');
 const axial=page.getByRole('region',{name:'Axial view',exact:true}).locator('canvas').first();
 const bounds=(await axial.boundingBox())!;
 const before=await page.evaluate(async()=>{const {useViewStateStore}=await import('/src/stores/viewStateStore.ts');return useViewStateStore.getState().viewState.crosshair.world_mm});
 await axial.click({position:{x:bounds.width*.55,y:bounds.height*.45}});
 await expect.poll(()=>page.evaluate(async()=>{const {useViewStateStore}=await import('/src/stores/viewStateStore.ts');return useViewStateStore.getState().viewState.crosshair.world_mm})).not.toEqual(before);
 await page.screenshot({path:test.info().outputPath('shared-app.png')});
 await page.evaluate(async id=>{const {getLayerService}=await import('/src/services/LayerService.ts');await getLayerService().removeLayer(id)},id);
 await expect.poll(()=>state(page)).toEqual({layers:[],viewLayers:[],resources:empty});
 expect(errors).toEqual([]);
});

test('browser file dialog cancellation publishes no volume',async({page})=>{
 await boot(page);await open(page,true);
 expect(await state(page)).toEqual({layers:[],viewLayers:[],resources:empty});
});

for(const action of ['cancel','close'] as const){
 test(`pending real worker read is reclaimed after workspace ${action}`,async({page})=>{
  await boot(page);
  const worker=page.workers().find(w=>w.url().includes('/services/browser/worker.ts'))!;
  await worker.evaluate(()=>{
   const original=File.prototype.arrayBuffer;
   File.prototype.arrayBuffer=async function(){
    globalThis.__reading=true;
    await new Promise<void>(resolve=>{globalThis.__releaseRead=resolve});
    return original.call(this);
   };
  });
  await open(page);await expect.poll(()=>worker.evaluate(()=>globalThis.__reading)).toBe(true);
  await page.evaluate(async action=>{
   if(action==='cancel'){
    const {useLoadingQueueStore}=await import('/src/stores/loadingQueueStore.ts');
    const store=useLoadingQueueStore.getState();for(const id of store.activeLoads.keys())store.cancel(id);
   }else{
    const {useWorkspaceStore}=await import('/src/stores/workspaceStore.ts');const store=useWorkspaceStore.getState();store.closeWorkspace(store.activeWorkspaceId!);
   }
  },action);
  await worker.evaluate(()=>globalThis.__releaseRead());
  await expect.poll(()=>state(page)).toEqual({layers:[],viewLayers:[],resources:empty});
 });
}

test('failed real GPU upload validation leaves no provisional volume',async({page})=>{
 await boot(page);
 const worker=page.workers().find(w=>w.url().includes('/services/browser/worker.ts'))!;
 await worker.evaluate(()=>{
  const original=GPUDevice.prototype.popErrorScope;let once=true;
  GPUDevice.prototype.popErrorScope=async function(){const error=await original.call(this);if(once){once=false;return new GPUValidationError('Injected upload failure')}return error};
 });
 await open(page);
 await expect.poll(()=>page.evaluate(async()=>{const {useLoadingQueueStore}=await import('/src/stores/loadingQueueStore.ts');return useLoadingQueueStore.getState().completed.some(x=>x.status==='error')})).toBe(true);
 expect(await state(page)).toEqual({layers:[],viewLayers:[],resources:empty});
});

test('GPU residency can be released and reacquired without duplicating CPU volumes',async({page})=>{
 await boot(page);await open(page);await expect.poll(async()=>(await state(page)).layers.length).toBe(1);
 const id=(await state(page)).layers[0];
 const results=await page.evaluate(async id=>{
  const {getApiService}=await import('/src/services/apiService.ts');
  const api=getApiService();await api.releaseLayerGpuResources(id);
  const released=await api.waitForLayerReady(id);
  await api.requestLayerGpuResources(id,id);
  const reacquired=await api.waitForLayerReady(id);
  const {getLayerService}=await import('/src/services/LayerService.ts');await getLayerService().removeLayer(id);
  return {released,reacquired};
 },id);
 expect(results).toEqual({released:false,reacquired:true});
 expect(await state(page)).toEqual({layers:[],viewLayers:[],resources:empty});
});

test('production entry mounts the same workspace and real volume views',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5359/workspace.html');
 await expect(page.getByTestId('top-app-bar')).toBeVisible();await open(page);
 await expect(page.getByRole('row',{name:/oblique\.nii/})).toBeVisible();
 for(const view of ['Axial','Coronal','Sagittal'])await expect(page.getByRole('region',{name:`${view} view`,exact:true}).locator('canvas').first()).toBeVisible();
 await page.screenshot({path:test.info().outputPath('production-workspace.png')});expect(errors).toEqual([]);
});


test('even-sized oblique volumes use the same voxel-centred initial cursor as desktop',async({page})=>{
 await boot(page);
 const bytes=Buffer.from(readFileSync(fixture));for(let axis=0;axis<3;axis++)bytes.writeInt16LE(2,42+2*axis);
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('region',{name:'Files start',exact:true}).getByRole('button',{name:'Open file…',exact:true}).click();
 await (await chooser).setFiles({name:'even.nii',mimeType:'application/octet-stream',buffer:bytes});
 await expect.poll(async()=>(await state(page)).layers.length).toBe(1);
 const result=await page.evaluate(async()=>{
  const {useViewStateStore}=await import('/src/stores/viewStateStore.ts');
  const {getTransport}=await import('/src/services/transport.ts');
  const state=useViewStateStore.getState().viewState;
  const bounds=await getTransport().invoke('get_volume_bounds',{volumeId:state.layers[0].volumeId});
  return {cursor:state.crosshair.world_mm,bounds};
 });
 expect(result.cursor).toEqual([10,-7,5]);
 expect(result.bounds).toMatchObject({dims:[2,2,2],center:[9,-5.5,7],center_voxel_world:[10,-7,5]});
});
