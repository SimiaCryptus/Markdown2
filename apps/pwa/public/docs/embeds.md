---
title: Web pages and charts
---
# Web pages and charts

Two handlers bring live content from the web into a page:

- **Embedded pages**, declared as `text/uri-list`, appear in a frame, much like an HTML `<iframe>`.
- **Google Charts**, declared as `application/vnd.google.charts+json`, are drawn from a short JSON description.

Both reach the network, so both wait for you. Opening a document never loads them. Until you allow one, an embedded page shows its address and a chart shows its data as a table. Either way the page stays readable.

## Embedded pages

A `text/uri-list` resource holds one `https:` address. Blank lines and lines starting with `#` are ignored:

<<<MAP type="text/uri-list" title="OpenStreetMap: Greenwich"
# The Royal Observatory and its park
https://www.openstreetmap.org/export/embed.html?bbox=-0.0106%2C51.4747%2C0.0057%2C51.4813&layer=mapnik
MAP

Choose *Load from www.openstreetmap.org…* right under the address, or *Load…* in the **Resources** tab. You are told which site will be contacted. *Load this one* allows only this resource; *Always allow* adds the site to your list, so its pages load without asking from then on. **Remote…** in the toolbar shows and edits that list.

The source is short:

```text
<<<MAP type="text/uri-list" title="OpenStreetMap: Greenwich"
# The Royal Observatory and its park
https://www.openstreetmap.org/export/embed.html?bbox=…
MAP
```

What an embedded page can and cannot do:

- It runs in a sandboxed frame. It may run its own scripts and open pop-ups, but it cannot navigate this app or reach its storage, your keys or the toolbar.
- It receives no referrer, and no cookies in browsers that support credentialless frames.
- Only `https:` addresses on other sites are framed. Addresses on this site, plain `http:` and addresses with credentials make the resource fail.
- Many sites refuse to be framed and show an empty frame. Use the address a site offers for embedding, such as a map export or a `youtube-nocookie.com/embed/…` video.

Frames are 16:9. A document stylesheet can change that, for resources carrying `md2-class="tall"`:

```text
<<<TALL type="text/css" rel="stylesheet"
md2-resource.tall md2-view iframe { aspect-ratio: 3 / 4; }
TALL
```

## Google Charts

A chart is a JSON object with three members:

- `chartType`: a Google Charts name such as `PieChart`, `ColumnChart`, `LineChart`, `AreaChart`, `ScatterChart`, `Table` or `GeoChart`.
- `data`: rows of values. The first row holds the column labels.
- `options`: optional settings passed to the chart, such as `title`, `colors` or `height`.

<<<REVENUE type="application/vnd.google.charts+json" title="Revenue by region"
{
  "chartType": "PieChart",
  "data": [["Region", "Revenue"], ["North", 42], ["South", 31], ["East", 18], ["West", 9]],
  "options": { "title": "Q3 revenue by region", "pieHole": 0.4, "height": 320 }
}
REVENUE

<<<GROWTH type="application/vnd.google.charts+json" title="Readers per month"
{
  "chartType": "LineChart",
  "data": [
    ["Month", "Web", "App"],
    ["Jan", 120, 40],
    ["Feb", 180, 90],
    ["Mar", 260, 170],
    ["Apr", 310, 260]
  ],
  "options": { "title": "Readers per month", "curveType": "function", "legend": { "position": "bottom" }, "height": 300 }
}
GROWTH

Choose *Load from www.gstatic.com…* above a chart's data table to draw it. Pick *Always allow* once and every chart draws without asking.

- Google's library is loaded from `www.gstatic.com` into a sandboxed frame with an opaque origin. It cannot reach this app.
- Your data stays in this tab: the frame receives it from the app, never from the network. Some chart types, such as `GeoChart` with place names, ask Google to look locations up.
- Until a chart is drawn, and whenever it cannot be (offline, blocked or invalid), its data table stays visible.
- An invalid description, such as a missing `chartType`, shows the resource's fallback with `handler-error`.

`application/vnd.google.charts+json` is not registered with IANA. Markdown2 uses it as a provisional name, like `text/vnd.mermaid`.

## Next

That is the end of the tour.

- [Back to the welcome page](index.md), the showcase where it all started.
- [Using the app](guide.md), to go round again.