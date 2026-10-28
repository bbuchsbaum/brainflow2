import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

test('published assets match source hashes with only declared HTML metadata insertion', async ({request}) => {
  const response=await request.get('/build-info.json');expect(response.ok()).toBe(true);
  expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(process.env.BROWSER_PREVIEW_MANIFEST_SHA);
  const info=await response.json();
  expect(info.sourceRevision).toBe(process.env.BROWSER_PREVIEW_SHA);
  expect(info.sourceDirty).toBe(false);
  expect(Object.keys(info.files).length).toBeGreaterThan(20);
  const transformations=[];
  for(const [path,expected] of Object.entries(info.files) as [string,{bytes:number,sha256:string}][]){
    const response=await request.get(`/${path}`);expect(response.ok(),path).toBe(true);
    let bytes=await response.body();
    if(path.endsWith('.html') && createHash('sha256').update(bytes).digest('hex')!==expected.sha256){
      // here.now adds only this observed, non-executable social-card block.
      // Any other HTML change, including scripts, still fails the source hash.
      const baseMetadata=[
        '<meta property="og:title" content="Brainflow browser viewer" />',
        '<meta property="og:description" content="A private local NIfTI neuroimaging file viewer that runs directly in your web browser." />',
        `<meta property="og:url" content="${new URL(path,process.env.BROWSER_PREVIEW_URL+'/').href}" />`,
        '<meta property="og:type" content="website" />',
      ];
      const imageUrl=`https://here.now/og/${new URL(process.env.BROWSER_PREVIEW_URL!).hostname.split('.')[0]}.jpg`;
      const candidates=[
        [...baseMetadata,'<meta name="twitter:card" content="summary" />'].join('\n'),
        [...baseMetadata,
          `<meta property="og:image" content="${imageUrl}" />`,
          '<meta property="og:image:width" content="1280" />',
          '<meta property="og:image:height" content="720" />',
          `<meta name="twitter:image" content="${imageUrl}" />`,
          '<meta name="twitter:card" content="summary_large_image" />',
        ].join('\n'),
      ];
      const html=bytes.toString();const metadata=candidates.find(block=>html.split(block).length===2);
      expect(metadata,path).toBeDefined();
      bytes=Buffer.from(html.replace(metadata!,''));transformations.push({path,metadata});
    }
    expect(bytes.length,path).toBe(expected.bytes);
    expect(createHash('sha256').update(bytes).digest('hex'),path).toBe(expected.sha256);
  }
  await test.info().attach('host-html-transformations',{body:JSON.stringify(transformations),contentType:'application/json'});
  await test.info().attach('build-info',{body:JSON.stringify(info),contentType:'application/json'});
});

test('live preview renders local files and catalog images and reloads offline',async({page,context})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Open NIfTI',exact:true})).toBeEnabled();
  await page.getByLabel('Choose NIfTI file',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/oblique.nii'));
  await expect.poll(()=>page.locator('main').getAttribute('data-frame-revision').then(Number)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Clear workspace',exact:true}).click();
  await page.getByText('Atlas and template catalog',{exact:true}).click();
  await page.getByLabel('Catalog item',{exact:true}).selectOption('MNI152NLin2009cAsym_T1w_2mm');
  await page.getByRole('button',{name:'Load catalog image',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unload MNI152 T1w (2mm)',exact:true})).toBeVisible({timeout:60_000});
  await expect.poll(()=>page.locator('main').getAttribute('data-frame-revision').then(Number)).toBeGreaterThan(0);
  await page.screenshot({path:test.info().outputPath('published-template.png')});
  await page.getByRole('button',{name:'Clear workspace',exact:true}).click();
  await page.getByLabel('Catalog item',{exact:true}).selectOption('schaefer2018-100-7-2mm');
  await page.getByRole('button',{name:'Load catalog image',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unload Schaefer 2018 · 100 regions · 7 networks · 2mm',exact:true})).toBeVisible({timeout:60_000});
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
  await context.setOffline(true);await page.reload();
  await expect(page.getByRole('button',{name:'Open NIfTI',exact:true})).toBeEnabled();
  await page.getByLabel('Choose NIfTI file',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/oblique.nii.gz'));
  await expect.poll(()=>page.locator('main').getAttribute('data-frame-revision').then(Number)).toBeGreaterThan(0);
  await page.getByLabel('Choose GIfTI surface',{exact:true}).setInputFiles(resolve(__dirname,'../../test-data/browser/octahedron.surf.gii'));
  await expect(page.getByRole('region',{name:'Surface view',exact:true}).locator('canvas')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
