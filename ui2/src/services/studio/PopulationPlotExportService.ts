import { getTransport } from '@/services/transport';

/** Export the rendered marks with resolved theme styles and facet headings.
 * Detached clones contain no event listeners; only the app's SVG mark trees
 * are included. Controls and unrelated panel content are excluded. */
export async function populationPlotPng(
  container: HTMLElement,
  title: string,
  legend: { label: string; color: string }[] = [],
): Promise<Uint8Array> {
  const svgs = [...container.querySelectorAll('svg')].filter(
    (svg) => !svg.parentElement?.closest('svg'),
  );
  if (!svgs.length) throw new Error('There are no rendered plot marks to export.');
  const origin = container.getBoundingClientRect();
  const positions = svgs.map((svg) => ({ svg, rect: svg.getBoundingClientRect() }));
  const top = Math.min(...positions.map(({ rect }) => rect.top));
  const bottom = Math.max(...positions.map(({ rect }) => rect.bottom));
  const width = Math.ceil(origin.width);
  const style = getComputedStyle(container);
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('Plot export canvas is unavailable.');
  measure.font = `12px ${style.fontFamily}`;
  const lines: string[] = [];
  for (const paragraph of title.split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (line && measure.measureText(line + character).width > width - 16) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
    lines.push(line);
  }
  const legendColumns = Math.max(1, Math.floor(width / 200));
  const titleHeight = lines.length * 16;
  const header = titleHeight + 40 + Math.ceil(legend.length / legendColumns) * 18;
  const height = Math.ceil(bottom - top + header + 16);
  if (width < 1 || height < 1 || width * height > 16_000_000)
    throw new Error('Plot export exceeds 16 million pixels.');
  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  const background = document.createElementNS(ns, 'rect');
  background.setAttribute('width', '100%');
  background.setAttribute('height', '100%');
  background.setAttribute(
    'fill',
    style.getPropertyValue('--bf-bg-app').trim() || getComputedStyle(document.body).backgroundColor,
  );
  root.append(background);
  function text(value: string, x: number, y: number, size: number) {
    const t = document.createElementNS(ns, 'text');
    t.textContent = value;
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y));
    t.setAttribute('fill', style.color);
    t.setAttribute('font-family', style.fontFamily);
    t.setAttribute('font-size', String(size));
    root.append(t);
  }
  lines.forEach((line, i) => text(line, 8, 18 + i * 16, 12));
  legend.forEach((entry, i) => {
    const x = 8 + (i % legendColumns) * (width / legendColumns);
    const y = titleHeight + 20 + Math.floor(i / legendColumns) * 18;
    const swatch = document.createElementNS(ns, 'rect');
    swatch.setAttribute('x', String(x));
    swatch.setAttribute('y', String(y - 8));
    swatch.setAttribute('width', '8');
    swatch.setAttribute('height', '8');
    swatch.setAttribute('fill', entry.color);
    root.append(swatch);
    text(entry.label, x + 12, y, 11);
  });
  for (const { svg, rect } of positions) {
    const copy = svg.cloneNode(true) as SVGSVGElement;
    const original = [svg, ...svg.querySelectorAll('*')];
    const clones = [copy, ...copy.querySelectorAll('*')];
    original.forEach((element, i) => {
      const target = clones[i] as SVGElement;
      const css = getComputedStyle(element);
      for (const property of [
        'fill',
        'stroke',
        'stroke-width',
        'opacity',
        'font-family',
        'font-size',
        'font-weight',
        'color',
      ])
        target.style.setProperty(property, css.getPropertyValue(property));
      target.removeAttribute('tabindex');
    });
    const x = rect.left - origin.left;
    const y = rect.top - top + header;
    copy.setAttribute('x', String(x));
    copy.setAttribute('y', String(y));
    copy.setAttribute('width', String(rect.width));
    copy.setAttribute('height', String(rect.height));
    const heading = svg.previousElementSibling;
    if (heading && !heading.querySelector('svg'))
      text(heading.textContent?.slice(0, 160) ?? '', x + 4, y - 6, 11);
    root.append(copy);
  }
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(root)], {
      type: 'image/svg+xml;charset=utf-8',
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Plot export canvas is unavailable.');
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode the plot.'))),
        'image/png',
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function savePopulationPlot(
  bytes: Uint8Array,
  format: 'png' | 'json',
): Promise<string | null> {
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) {
    const path = await getTransport().invoke<string | null>('plugin:dialog|save', {
      options: {
        title: 'Save population plot',
        defaultPath: `population-plot.${format}`,
        filters: [
          {
            name: format === 'png' ? 'PNG image' : 'Plot recipe and samples',
            extensions: [format],
          },
        ],
      },
    });
    if (!path) return null;
    return getTransport().invoke<string>('export_population_plot', {
      path,
      bytes: Array.from(bytes),
      format,
    });
  }
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(bytes).buffer], {
      type: format === 'png' ? 'image/png' : 'application/json',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `population-plot.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return a.download;
}
