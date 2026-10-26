export const SAMPLE = `---
title: Welcome to Markdown2
---
Markdown2 is Markdown with typed, opaque resources. Edit this text and the preview updates as you type.

<<<NOTE type="text/plain" title="A plain text resource"
Everything here is opaque: # not a heading, \`\`\` not a fence.
NOTE

<<<LOGO type="image/svg+xml" title="Logo"
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="teal"/></svg>
LOGO

A remote resource stays locked until you allow it:

<<<REMOTE type="image/png" encoding="uri" title="Remote image"
https://example.org/logo.png
REMOTE

A near miss of a known type gets a hint, never a silent correction:

<<<PHOTO type="image/jpg"
not really a photo
PHOTO
`;