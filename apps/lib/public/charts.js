import { initChrome, mountEditableDemo, run } from './shared.js';

initChrome();

const PLOTLY_SRC = `### Multi-trace line chart

<<<READERS type="application/vnd.plotly.v1+json" title="Readers per month"
{
  "data": [
    {
      "type": "scatter", "mode": "lines+markers", "name": "Web",
      "x": ["Jan", "Feb", "Mar", "Apr", "May"], "y": [120, 180, 260, 310, 410],
      "line": { "color": "#0f6b5f" }
    },
    {
      "type": "scatter", "mode": "lines+markers", "name": "App",
      "x": ["Jan", "Feb", "Mar", "Apr", "May"], "y": [40, 90, 170, 260, 355],
      "line": { "color": "#b0802a" }
    }
  ],
  "layout": {
    "title": { "text": "Readers per month" },
    "xaxis": { "title": { "text": "Month" } },
    "yaxis": { "title": { "text": "Readers" } },
    "legend": { "orientation": "h" },
    "height": 320
  }
}
READERS

### 3D surface plot (drag to rotate)

\`\`\`plotly
{
  "data": [
    {
      "type": "surface",
      "colorscale": "Viridis",
      "z": [
        [1, 2, 3, 2, 1],
        [2, 4, 6, 4, 2],
        [3, 6, 9, 6, 3],
        [2, 4, 6, 4, 2],
        [1, 2, 3, 2, 1]
      ]
    }
  ],
  "layout": { "title": { "text": "A small hill" }, "margin": { "l": 0, "r": 0, "b": 0, "t": 40 }, "height": 360 }
}
\`\`\`
`;

const VEGA_SRC = `<<<PLANETS type="application/vnd.vegalite.v5+json" title="Rocky planet diameters"
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "description": "Diameters of the four rocky planets",
  "width": "container",
  "height": 220,
  "data": {
    "values": [
      { "planet": "Mercury", "diameter_km": 4879, "moons": 0 },
      { "planet": "Venus",   "diameter_km": 12104, "moons": 0 },
      { "planet": "Earth",   "diameter_km": 12756, "moons": 1 },
      { "planet": "Mars",    "diameter_km": 6792, "moons": 2 }
    ]
  },
  "mark": { "type": "bar", "cornerRadiusEnd": 4, "tooltip": true },
  "encoding": {
    "x": { "field": "planet", "type": "nominal", "sort": null, "title": "Planet" },
    "y": { "field": "diameter_km", "type": "quantitative", "title": "Diameter (km)" },
    "color": { "value": "#0f6b5f" }
  }
}
PLANETS
`;

const GCHART_SRC = `<<<SHARE type="application/vnd.google.charts+json" title="Resource types in a typical report"
{
  "chartType": "PieChart",
  "data": [
    ["Kind", "Count"],
    ["Tables (CSV/TSV)", 8],
    ["Diagrams", 6],
    ["Charts", 5],
    ["Math equations", 4],
    ["Encrypted notes", 2]
  ],
  "options": {
    "title": "Resource types in a typical report",
    "pieHole": 0.4,
    "height": 300
  }
}
SHARE
`;

run(async () => {
  await mountEditableDemo({
    editorId: 'plotly-src',
    viewId: 'plotly-view',
    resetId: 'plotly-reset',
    timeId: 'plotly-time',
    source: PLOTLY_SRC,
  });

  await mountEditableDemo({
    editorId: 'vega-src',
    viewId: 'vega-view',
    resetId: 'vega-reset',
    timeId: 'vega-time',
    source: VEGA_SRC,
  });

  await mountEditableDemo({
    editorId: 'gchart-src',
    viewId: 'gchart-view',
    resetId: 'gchart-reset',
    timeId: 'gchart-time',
    source: GCHART_SRC,
  });
});
