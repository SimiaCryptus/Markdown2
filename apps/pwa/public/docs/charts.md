---
title: Charts
---
# Charts

Two charting libraries are built in, and both are driven by plain JSON:

- **Plotly** draws interactive scientific and statistical charts: bars, lines, scatter plots, heatmaps, pies and 3D surfaces.
- **Vega-Lite** draws charts from a *grammar of graphics*: you say how data maps to marks and colours, and it builds the chart.

Neither needs the network. A chart carries its data with it, so it draws as soon as the page opens. Until it has drawn, and whenever it cannot, you see its JSON source.

| Library   | Fence names             | Resource type                       |
| :-------- | :---------------------- | :---------------------------------- |
| Plotly    | `plotly`                | `application/vnd.plotly.v1+json`    |
| Vega-Lite | `vega-lite`, `vegalite` | `application/vnd.vegalite.v5+json`  |

These are the type names Jupyter uses. They are not registered with IANA.

## Plotly

A Plotly figure is a JSON object with a `data` array of *traces*, and an optional `layout`. This is the same JSON `Plotly.newPlot` takes, and the same JSON `fig.to_json()` writes in Python.

<<<DIAMETERS type="application/vnd.plotly.v1+json" title="Planet diameters"
{
  "data": [
    {
      "type": "bar",
      "x": ["Mercury", "Venus", "Earth", "Mars"],
      "y": [4879, 12104, 12756, 6792],
      "marker": { "color": "#0f6b5f" }
    }
  ],
  "layout": {
    "title": { "text": "Diameter of the rocky planets (km)" },
    "yaxis": { "title": { "text": "km" } },
    "height": 340
  }
}
DIAMETERS

Hover for values, drag to zoom, double-click to reset. The toolbar at the top right saves a PNG. Scrolling the page never zooms a chart by accident.

Several traces share one set of axes:

<<<READERS type="application/vnd.plotly.v1+json" title="Readers per month"
{
  "data": [
    {
      "type": "scatter", "mode": "lines+markers", "name": "Web",
      "x": ["Jan", "Feb", "Mar", "Apr"], "y": [120, 180, 260, 310],
      "line": { "color": "#0f6b5f" }
    },
    {
      "type": "scatter", "mode": "lines+markers", "name": "App",
      "x": ["Jan", "Feb", "Mar", "Apr"], "y": [40, 90, 170, 260],
      "line": { "color": "#b0802a" }
    }
  ],
  "layout": {
    "title": { "text": "Readers per month" },
    "xaxis": { "title": { "text": "Month" } },
    "yaxis": { "title": { "text": "Readers" } },
    "legend": { "orientation": "h" },
    "height": 340
  }
}
READERS

3D charts work too. Drag to rotate the hill:

<<<HILL type="application/vnd.plotly.v1+json" title="A small hill"
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
  "layout": { "title": { "text": "A small hill" }, "margin": { "l": 0, "r": 0, "b": 0, "t": 40 }, "height": 420 }
}
HILL

The source of the first chart is ordinary JSON in a resource:

```text
<<<DIAMETERS type="application/vnd.plotly.v1+json" title="Planet diameters"
{
  "data": [{ "type": "bar", "x": ["Mercury", "Venus"], "y": [4879, 12104] }],
  "layout": { "height": 340 }
}
DIAMETERS
```

A fenced block named `plotly` is drawn too. Ordinary Markdown previews show it as code:

```plotly
{
  "data": [
    {
      "type": "pie", "hole": 0.4,
      "labels": ["Text and Markdown", "Images", "Data", "Code", "Diagrams", "Maths", "Web"],
      "values": [3, 2, 2, 2, 1, 2, 2]
    }
  ],
  "layout": { "title": { "text": "Handlers by family" }, "height": 340 }
}
```

What the reader changes in a figure:

- `layout.width` is ignored, because a chart fills the page. `layout.height` is kept, between 150 and 2000 pixels, and defaults to 450.
- Only these `config` keys are honoured: `staticPlot`, `scrollZoom`, `displayModeBar` and `doubleClick`. Plotly's links to Chart Studio are switched off, so a figure cannot send your data anywhere.
- Colours of the page, axes and text follow the light or dark theme unless the figure sets its own.
- Up to 200 traces and 500 animation frames are drawn.

## Vega-Lite

A Vega-Lite specification describes the data, a mark, and an *encoding* from fields to position, colour and size. The `$schema` line is optional.

<<<BARS type="application/vnd.vegalite.v5+json" title="A simple bar chart"
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "width": "container",
  "height": 240,
  "data": {
    "values": [
      { "category": "A", "amount": 28 }, { "category": "B", "amount": 55 },
      { "category": "C", "amount": 43 }, { "category": "D", "amount": 91 },
      { "category": "E", "amount": 81 }, { "category": "F", "amount": 53 }
    ]
  },
  "mark": { "type": "bar", "color": "#0f6b5f" },
  "encoding": {
    "x": { "field": "category", "type": "nominal", "axis": { "labelAngle": 0 } },
    "y": { "field": "amount", "type": "quantitative" },
    "tooltip": [
      { "field": "category", "type": "nominal" },
      { "field": "amount", "type": "quantitative" }
    ]
  }
}
BARS

`"width": "container"` makes the chart as wide as the page. Hover a bar for its tooltip.

Data and styling map onto position, size and colour:

<<<PLANETS type="application/vnd.vegalite.v5+json" title="Distance and diameter"
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "width": "container",
  "height": 260,
  "data": {
    "values": [
      { "planet": "Mercury", "au": 0.39, "km": 4879, "type": "Terrestrial" },
      { "planet": "Venus", "au": 0.72, "km": 12104, "type": "Terrestrial" },
      { "planet": "Earth", "au": 1.0, "km": 12756, "type": "Terrestrial" },
      { "planet": "Mars", "au": 1.52, "km": 6792, "type": "Terrestrial" },
      { "planet": "Jupiter", "au": 5.2, "km": 142984, "type": "Gas giant" },
      { "planet": "Saturn", "au": 9.58, "km": 120536, "type": "Gas giant" },
      { "planet": "Uranus", "au": 19.22, "km": 51118, "type": "Ice giant" },
      { "planet": "Neptune", "au": 30.05, "km": 49528, "type": "Ice giant" }
    ]
  },
  "mark": { "type": "point", "filled": true, "size": 120 },
  "encoding": {
    "x": { "field": "au", "type": "quantitative", "scale": { "type": "log" }, "title": "Distance from the Sun (AU)" },
    "y": { "field": "km", "type": "quantitative", "scale": { "type": "log" }, "title": "Diameter (km)" },
    "color": { "field": "type", "type": "nominal" },
    "tooltip": [
      { "field": "planet", "type": "nominal" },
      { "field": "au", "type": "quantitative" },
      { "field": "km", "type": "quantitative" }
    ]
  }
}
PLANETS

Layers share data and axes. Here a line is drawn with a dashed rule at its mean:

<<<MEAN type="application/vnd.vegalite.v5+json" title="A line and its mean"
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "width": "container",
  "height": 220,
  "data": {
    "values": [
      { "month": "Jan", "readers": 160 }, { "month": "Feb", "readers": 270 },
      { "month": "Mar", "readers": 430 }, { "month": "Apr", "readers": 570 },
      { "month": "May", "readers": 520 }, { "month": "Jun", "readers": 690 }
    ]
  },
  "layer": [
    {
      "mark": { "type": "line", "point": true, "color": "#0f6b5f" },
      "encoding": {
        "x": { "field": "month", "type": "ordinal", "sort": null, "axis": { "labelAngle": 0 } },
        "y": { "field": "readers", "type": "quantitative" }
      }
    },
    {
      "mark": { "type": "rule", "strokeDash": [4, 4], "color": "#b4441c" },
      "encoding": { "y": { "aggregate": "mean", "field": "readers", "type": "quantitative" } }
    }
  ]
}
MEAN

A fenced block named `vega-lite` (or `vegalite`) is drawn the same way:

```vega-lite
{
  "width": 240,
  "height": 240,
  "data": {
    "values": [
      { "family": "Text and Markdown", "count": 3 }, { "family": "Images", "count": 2 },
      { "family": "Data", "count": 2 }, { "family": "Code", "count": 2 },
      { "family": "Diagrams", "count": 1 }, { "family": "Maths", "count": 2 },
      { "family": "Web", "count": 2 }
    ]
  },
  "mark": { "type": "arc", "innerRadius": 55 },
  "encoding": {
    "theta": { "field": "count", "type": "quantitative" },
    "color": { "field": "family", "type": "nominal" }
  }
}
```

Specifications are the same JSON that `chart.to_json()` writes in Altair. A few differences from a browser notebook:

- **Data must be inline.** Use `data.values`, or `datasets` with a named dataset. A `url` anywhere in the specification, for data, images or lookups, makes the resource show its fallback with `handler-error`. Fetching nothing is what lets charts draw without asking.
- **No links.** `href` is refused for the same reason.
- **Expressions are interpreted, not compiled.** Filters and calculations in Vega's expression language work, with no script evaluated.
- The actions menu (export, "open in the Vega editor") is hidden.
- Only Vega-Lite is supported. A specification whose `$schema` is Vega itself is refused.

## Charts and the rest of the page

- **Alternatives and descriptions.** Put a `rel="describedby"` text resource right after a chart to describe it for assistive technology, and a `rel="alternate"` image or table to offer a static version. See [resources and encodings](resources.md).
- **Tables.** To show the data behind a chart, embed it as CSV next to the chart. See [data tables](tables.md).
- **Web charts.** Google Charts draws from the network, so it waits for you. See [web pages and charts](embeds.md).
- **Saving.** *Save* in the Resources tab downloads a chart's JSON.

## Safety, in one list

- **Sandboxed.** Both libraries run in frames with an opaque origin. They cannot reach this app, its storage, your keys or the toolbar.
- **No network.** A frame's content policy allows no remote origin. Plotly's geo and map traces, which need map data from the web, show nothing, and a figure's remote images are blocked.
- **Data only.** Specifications are parsed as JSON, never run as script. Keys such as `__proto__` are dropped.
- **Graceful.** An invalid chart shows the resource's fallback with `handler-error`. An invalid fence stays an ordinary code block.

## Next

- [Join the community](community.md): Markdown2 is open source, and ideas are welcome.
- [Back to the welcome page](index.md)
- Related: [Developer features](developer.md), [Maps](maps.md) and [Data tables](tables.md).