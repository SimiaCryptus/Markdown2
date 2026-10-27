---
title: Maps
---
# Maps

Places, routes and areas travel as **GeoJSON**, the open format for geographic data (RFC 7946), declared as `application/geo+json`. The reader draws them on an interactive map with [MapLibre GL JS](https://maplibre.org), over free map tiles from [OpenFreeMap](https://openfreemap.org), built from OpenStreetMap data.

Tiles come from the network, so a map waits for you. Until you allow it, it lists its features and the area they cover. The page stays readable either way.

## A walk through Greenwich

Choose *Load from tiles.openfreemap.org…* right under the summary, or *Load…* in the **Resources** tab. *Always allow* adds OpenFreeMap to your list, and every map draws without asking from then on. Then drag to pan, Ctrl+scroll (⌘+scroll on a Mac) to zoom, and click a marker, the route or the park for details.

<<<WALK type="application/geo+json" title="A walk through Greenwich"
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
      "properties": { "name": "National Maritime Museum" },
      "geometry": { "type": "Point", "coordinates": [-0.0053, 51.4810] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Queen's House", "built": 1635 },
      "geometry": { "type": "Point", "coordinates": [-0.0036, 51.4809] }
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

The source is ordinary GeoJSON in a resource:

```text
<<<WALK type="application/geo+json" title="A walk through Greenwich"
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "properties": { "name": "Royal Observatory", "marker-color": "#b4441c" },
      "geometry": { "type": "Point", "coordinates": [-0.0015, 51.4769] } }
  ]
}
WALK
```

Positions are `[longitude, latitude]`, in that order. The map fits itself to the features.

## Colours and the basemap

Features can carry their own colours with the common *simplestyle* properties:

| Property                  | Applies to       | Example     |
| :------------------------ | :--------------- | :---------- |
| `marker-color`            | points           | `"#b4441c"` |
| `stroke`, `stroke-width`  | lines, outlines  | `"#3f7a3a"` |
| `stroke-opacity`          | lines, outlines  | `0.8`       |
| `fill`, `fill-opacity`    | areas            | `0.2`       |

Other properties appear in the popup when you click a feature, always as plain text.

The `basemap` attribute picks an OpenFreeMap style: `liberty` (the default), `bright` or `positron`, a quiet grey map that lets your data stand out:

<<<MERIDIAN type="application/geo+json" basemap="positron" title="The Prime Meridian through Western Europe"
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Prime Meridian", "longitude": "0°", "stroke": "#b0802a", "stroke-width": 3 },
      "geometry": { "type": "LineString", "coordinates": [[0, 53.6], [0, 38.7]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Greenwich", "country": "United Kingdom" },
      "geometry": { "type": "Point", "coordinates": [-0.0015, 51.4769] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Villers-sur-Mer", "country": "France" },
      "geometry": { "type": "Point", "coordinates": [-0.0006, 49.3226] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Castellón de la Plana", "country": "Spain" },
      "geometry": { "type": "Point", "coordinates": [-0.0378, 39.9864] }
    }
  ]
}
MERIDIAN

## Fenced GeoJSON

A fenced block named `geojson` is drawn too. Ordinary Markdown previews show it as code. A single Feature or a bare geometry works as well as a collection:

```geojson
{
  "type": "Feature",
  "properties": { "name": "The Bermuda Triangle", "fill": "#0f6b5f", "fill-opacity": 0.15 },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-80.19, 25.76], [-64.78, 32.30], [-66.11, 18.47], [-80.19, 25.76]]]
  }
}
```

A fence has no resource behind it, so it has no *Load…* button. It draws once you have allowed OpenFreeMap with *Always allow* or **Remote…**.

## Large data in its own file

Like any resource, GeoJSON can live in a separate file. `encoding="uri"` points at it, and it stays locked until you allow the fetch:

```text
<<<ROUTES type="application/geo+json" encoding="uri" title="Cycle routes"
data/routes.geojson
ROUTES
```

## What a map can and cannot do

- **Waits for you.** Nothing is fetched until you allow `tiles.openfreemap.org`. Your data never leaves this tab: the map receives it from the app, and OpenFreeMap only sees which tiles you look at.
- **Sandboxed.** MapLibre runs in a frame with an opaque origin. It can reach OpenFreeMap and nothing else, and it cannot touch this app, its storage, your keys or the toolbar.
- **Checked, never run.** GeoJSON is read as data. Positions must be longitudes and latitudes in degrees. Anything else shows the resource's fallback with `handler-error`.
- **Text only.** Feature properties are shown as text, so a property holding HTML is just characters.
- **Graceful.** Offline or blocked, a map keeps listing its features.
- *Save* in the Resources tab downloads the data as `.geojson`.

## Next

That is the end of the tour.

- [Join the community](community.md): Markdown2 is open source, and ideas are welcome.
- [Back to the welcome page](index.md), the showcase where it all started.
- Related: [Locks, keys and remote resources](trust.md), and [data tables](tables.md).