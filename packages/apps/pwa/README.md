- `text/vnd.mermaid` and ```` ```mermaid ````: Mermaid (strict) in a sandboxed frame (`/sandbox/mermaid.html`).
- `text/vnd.graphviz`, ```` ```dot ```` and ```` ```graphviz ````: Graphviz (WebAssembly, `@viz-js/viz`) in a
sandboxed frame (`/sandbox/graphviz.html`); `layout="neato"` etc. picks the engine. The SVG is shown through `<img>`.
- `text/vnd.wavedrom` and ```` ```wavedrom ````: WaveDrom timing diagrams and registers. WaveJSON is parsed as JSON5
(never evaluated) and the SVG is shown through `<img>`.
- `application/x-tex`, ```` ```math ```` and `application/mathml+xml`: MathJax to SVG, shown through `<img>`.