/**
 * markdown2.js: Markdown2 as a library.
 *
 *   import { marked } from 'https://md2.cognotik.com/lib/markdown2.js';
 *   el.innerHTML = marked.parse(source);               // drop-in, synchronous
 *   el.innerHTML = await marked.parse(source, { async: true });
 *
 *   import { mount } from 'https://md2.cognotik.com/lib/markdown2.js';
 *   const view = mount(el, source);                    // live, with permission controls
 */
export {
  marked,
  Marked,
  Lexer,
  Parser,
  parse,
  parseInline,
  options,
  setOptions,
  use,
  walkTokens,
  lexer,
  parser,
  getDefaults,
  defaults,
} from './marked.js';
export type {
  Hooks,
  MarkedExtension,
  MarkedFunction,
  MarkedOptions,
  ParseFn,
  ProseToken,
  ResourceToken,
  Token,
  TokensList,
} from './marked.js';

export { mount, defineElement, defaultConsent, dedent, downloadBytes } from './view.js';
export type {
  ConsentAnswer,
  ConsentHandler,
  ConsentRequest,
  Markdown2View,
  MountOptions,
  ResourceInfo,
  ViewState,
} from './view.js';

export {
  builtinHandlers,
  imageHandler,
  jsonHandler,
  pageHandler,
  tableHandler,
  textHandler,
  wavedromHandler,
  yamlHandler,
} from './handlers.js';
export type { Md2Handler, Md2HandlerContext, RemoteNeed } from './handlers.js';

export { ageDecoder, createBrowserUriPolicy, createRegistry, isKeyGrant, resolveRemoteUri } from './decoders.js';
export type { KeyGrant } from './decoders.js';

export { defaultCss, themeCss } from './css.js';
export { encryptAge, gzipBase64, pickToken, resource, wrap76 } from './authoring.js';
export type { EncryptOptions, ResourceSpec } from './authoring.js';

export { REQUIRES_ASYNC } from './sync.js';

/** The full reference implementation, for advanced use. */
export * as core from '@markdown2/core';

export const version = '0.2.0';