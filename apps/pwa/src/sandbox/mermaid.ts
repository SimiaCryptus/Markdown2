import mermaid from 'mermaid';
import { serve } from './frame.js';

serve(async ({ source, dark }, root) => {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
  const { svg } = await mermaid.render('m2-diagram', source);
  root.innerHTML = svg; // sanitised by Mermaid (strict), inside an opaque-origin sandbox
});