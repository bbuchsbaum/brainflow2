/* eslint-disable react-refresh/only-export-components -- dev-only entry module */

/**
 * Dev-only harness for the segmentation design directions (round 0 of the
 * segmentation visual hill climb). `?direction=a|b|c&state=<DesignState>`
 * renders one direction in one state; without parameters it lists them.
 *
 * Images are real MNI152NLin2009cAsym T2w/T1w slices; labels, strokes,
 * proposals and raters are mock data (`modules/segmentation/__design__`).
 * Nothing talks to the bridge. Not part of the production bundle.
 * Captured by e2e/harness/segmentation-design.capture.spec.ts.
 */
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../index.css';

import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DIRECTIONS } from '@/modules/segmentation/components/directions';
import {
  DESIGN_STATES,
  DESIGN_STATE_TITLES,
  type DesignState,
  type DirectionId,
} from '@/modules/segmentation/components/shared/types';

if (!import.meta.env.DEV) throw new Error('The segmentation design harness is development-only.');

declare global {
  interface Window {
    __harnessReady?: boolean;
    __harnessFailed?: string;
  }
}

const params = new URLSearchParams(location.search);
const direction = params.get('direction') as DirectionId | null;
const state = params.get('state') as DesignState | null;

function Index() {
  return (
    <div className="min-h-screen bg-bf-bg-app p-6 font-sans text-bf-text-primary">
      <h1 className="m-0 mb-4 text-bf-lg font-semibold">Segmentation design</h1>
      {Object.values(DIRECTIONS).map((d) => (
        <section key={d.id} className="mb-4">
          <h2 className="m-0 text-bf-md font-semibold">
            {d.id.toUpperCase()} · {d.title}
          </h2>
          <p className="m-0 mb-1 text-bf-xs text-bf-text-secondary">{d.concept}</p>
          <div className="flex flex-wrap gap-3 text-bf-xs">
            {DESIGN_STATES.map((s) => (
              <a key={s} className="text-bf-text-primary underline" href={`?direction=${d.id}&state=${s}`}>
                {DESIGN_STATE_TITLES[s]}
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Harness() {
  if (!direction || !state) return <Index />;
  const def = DIRECTIONS[direction];
  if (!def || !DESIGN_STATES.includes(state)) throw new Error(`Unknown direction/state: ${direction}/${state}`);
  const Component = def.component;
  return <Component state={state} />;
}

async function waitForImages(): Promise<void> {
  const images = [...document.querySelectorAll('image')].map((el) => el.getAttribute('href') ?? '');
  await Promise.all(
    [...new Set(images)].map(
      (src) =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`image failed: ${src}`));
          img.src = src;
        }),
    ),
  );
}

window.addEventListener('error', (e) => {
  window.__harnessFailed = String(e.message);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

void document.fonts.ready
  .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  .then(waitForImages)
  .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  .then(() => {
    window.__harnessReady = true;
  })
  .catch((e: unknown) => {
    window.__harnessFailed = String(e);
  });
