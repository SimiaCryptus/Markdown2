import { $, initChrome, mountEditableDemo, run } from './shared.js';

initChrome();

const mapSource = (basemap) => `<<<WALK type="application/geo+json" basemap="${basemap}" title="A walk through Greenwich (${basemap})"
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Cutty Sark", "description": "A tea clipper from 1869, and the start of the walk" },
      "geometry": { "type": "Point", "coordinates": [-0.0096, 51.4828] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Royal Observatory", "description": "Home of the Prime Meridian", "marker-color": "#b4441c" },
      "geometry": { "type": "Point", "coordinates": [-0.0015, 51.4769] }
    },
    {
      "type": "Feature",
      "properties": { "name": "The walk", "length": "about 1.2 km", "stroke": "#b4441c", "stroke-width": 4 },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-0.0096, 51.4828], [-0.0072, 51.4818], [-0.0053, 51.4810],
          [-0.0036, 51.4809], [-0.0028, 51.4790], [-0.0015, 51.4769]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Greenwich Park", "fill": "#3f7a3a", "fill-opacity": 0.2, "stroke": "#3f7a3a", "stroke-width": 2 },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [-0.0050, 51.4800], [0.0040, 51.4800], [0.0050, 51.4745],
          [-0.0010, 51.4728], [-0.0050, 51.4760], [-0.0050, 51.4800]
        ]]
      }
    }
  ]
}
WALK
`;

const X3D_SRC = `<<<SCENE type="model/x3d+xml" title="A box and a sphere"
<X3D profile='Interchange' version='4.0'>
  <Scene>
    <Background skyColor='0.96 0.93 0.85'/>
    <Viewpoint position='0 0 8' description='Front'/>
    <Transform translation='-1.5 0 0' rotation='1 1 0 0.6'>
      <Shape>
        <Appearance><Material diffuseColor='0.06 0.42 0.37'/></Appearance>
        <Box size='2 2 2'/>
      </Shape>
    </Transform>
    <Transform translation='1.5 0 0'>
      <Shape>
        <Appearance><Material diffuseColor='0.69 0.5 0.16'/></Appearance>
        <Sphere radius='1.2'/>
      </Shape>
    </Transform>
  </Scene>
</X3D>
SCENE
`;

const CODE_SRC = `<<<SNIPPET type="text/javascript" title="decode.js"
// Nothing here is Markdown: # not a heading, \`\`\` not a fence.
export async function decodePipeline(stack, payload) {
  let bytes = payload;
  for (const step of stack) {
    bytes = await step(bytes);
  }
  return bytes;
}
SNIPPET

<<<QUERY type="application/sql" title="metrics.sql"
SELECT region, SUM(revenue) AS total
FROM quarterly_results
WHERE quarter = '2026-Q3'
GROUP BY region
ORDER BY total DESC;
QUERY
`;

run(async () => {
  const mapDemo = await mountEditableDemo({
    editorId: 'map-src',
    viewId: 'map-view',
    resetId: 'map-reset',
    timeId: 'map-time',
    source: mapSource('liberty'),
  });

  const buttons = [...$('basemap-buttons').querySelectorAll('button[data-basemap]')];
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const bm = btn.dataset.basemap;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === btn));
      void mapDemo.setSource(mapSource(bm));
    });
  }

  await mountEditableDemo({
    editorId: 'x3d-src',
    viewId: 'x3d-view',
    resetId: 'x3d-reset',
    timeId: 'x3d-time',
    source: X3D_SRC,
  });

  await mountEditableDemo({
    editorId: 'code-src',
    viewId: 'code-view',
    resetId: 'code-reset',
    timeId: 'code-time',
    source: CODE_SRC,
  });
});
