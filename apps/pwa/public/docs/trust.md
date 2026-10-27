---
title: Locks, keys and remote resources
---
# Locks, keys and remote resources

Opening a document never grants it anything. It cannot reach the network, read your files or use your keys. A resource that needs one of those stays **locked** until you say otherwise, and it remains visible as a sealed card.

## Remote resources stay locked

This resource lives on the web:

<<<REMOTE type="image/svg+xml" encoding="uri" title="The Markdown2 icon, fetched on request"
https://md2.cognotik.com/icon.svg
REMOTE

It is locked. Choose *Load from md2.cognotik.com…* on its card, or *Unlock…* in the **Resources** tab. You are told which site will be contacted, and you can allow just this resource or always allow the site.

If the fetch fails, the resource fails closed and says why. A fetch can fail because the server does not allow cross-origin reads.

Whatever the server answers, the declared type wins. HTML sent back for a resource declared as an image is never rendered as HTML.

To stop being asked, **Remote…** in the toolbar lets you allow whole `https:` origins. The list is yours. A document can never add to it.

## Encrypted resources

Encryption is an encoding. A JPEG is still a JPEG when its bytes are encrypted, so the declared type stays the real type:

```text
<<<VAULT type="text/markdown" encoding="base64 age" title="Q3 notes"
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IHNjcnlwdCBk…
VAULT
```

To make one with the `age` tool, encrypt, then base64-encode:

```text
age --passphrase notes.md | base64 -w 76
```

Paste the output as the payload. In the app, *Unlock…* asks for a passphrase or an `age` identity. Keys stay in memory for this tab only. **Forget keys** in the toolbar clears every key and grant at once.

A few rules always hold:

- **One layer at a time.** `encoding="base64 age age"` needs two keys, perhaps held by two people. The resource stays locked until both have been given.
- **No inheritance.** Unlocking an encrypted document does not unlock the encrypted sections inside it. Each keeps its own title and lock.
- **Explicit batches.** After a key works, the app offers to try it on the other locked resources. It lists them first, and resources revealed later are never included.
- **Visible, not hidden.** A locked resource still shows its title, type and size. To conceal the type, declare `text/markdown` outside and put the real resource inside the encrypted document.

## Opening documents by URL

`?url=` opens a document, not its resources. Everything said above still applies to what is inside.

- Paths on this site open straight away.
- Other `https:` addresses ask before anything is fetched, and no cookies are sent.
- Documents opened this way are not autosaved, so they never replace your own draft.

## What a document can never do

- Run script in this app. SVG is drawn as an image, and third-party handlers run in a sandbox.
- Fetch anything through its styles. Remote `url()` references in stylesheets are removed. See [document styles](styles.md).
- Reach the inspector, the toolbar or the unlock dialogs. Those are reader chrome, outside the styled page.
- Choose an active file extension when you save one of its resources, unless you confirm it.

## Next

- [Back to the welcome page](index.md)
- Tour stop 5: [Document styles](styles.md), themes and switches, and how you stay in charge.