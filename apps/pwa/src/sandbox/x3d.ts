import { serve } from './frame.js';

/** The small part of the X_ITE API this frame uses. */
type X3DScene = object;
interface X3DBrowser {
  createX3DFromString(source: string): Promise<X3DScene>;
  replaceWorld(scene: X3DScene): Promise<void> | void;
}
interface X3DGlobal {
  getBrowser(element: Element): X3DBrowser;
}

/** Served from this site; see scripts/vendor-x_ite.mjs. */
const XITE = '/vendor/x_ite/x_ite.min.js';
const HEIGHT = 400;
/** An in-memory Storage, used when the real one is out of reach. */
function memoryStorage(): Storage {
   const m = new Map<string, string>();
   return {
     get length() {
       return m.size;
     },
     clear: () => {
       m.clear();
     },
     getItem: (k: string) => m.get(String(k)) ?? null,
     key: (i: number) => [...m.keys()][i] ?? null,
     removeItem: (k: string) => {
       m.delete(String(k));
     },
     setItem: (k: string, v: string) => {
       m.set(String(k), String(v));
     },
   };
}
/**
  * This frame has an opaque origin (no `allow-same-origin`), so reading
  * `localStorage` throws. X_ITE reads it at start-up for its browser settings,
  * so it gets an in-memory stand-in: settings simply do not persist.
  */
function shimStorage(): void {
   for (const name of ['localStorage', 'sessionStorage'] as const) {
     try {
       void window[name];
     } catch {
       Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
     }
   }
}
/**
  * The frame has no `xr` permission, and should not get one. Without this,
  * X_ITE probes `navigator.xr` on start-up, which logs permission-policy
  * violations and rejects with an uncaught SecurityError. Hide WebXR so it
  * never tries.
  */
function hideWebXR(): void {
   try {
     delete (Navigator.prototype as unknown as { xr?: unknown }).xr;
   } catch {
     // not configurable here; fall through
   }
   if ('xr' in navigator) {
     try {
       Object.defineProperty(navigator, 'xr', { value: undefined, configurable: true });
     } catch {
       // keep going: XR stays unavailable through the permissions policy anyway
     }
   }
}


function loadXite(): Promise<X3DGlobal> {
   shimStorage();
    hideWebXR();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XITE;
    s.onload = () => {
      const g = (window as unknown as { X3D?: X3DGlobal }).X3D;
      if (g) resolve(g);
      else reject(new Error('X_ITE did not load'));
    };
    s.onerror = () => {
      reject(new Error('X_ITE could not be loaded'));
    };
    document.head.append(s);
  });
}

serve(async ({ source }, root) => {
  const X3D = await loadXite();
  root.style.height = `${HEIGHT}px`;
  const canvas = document.createElement('x3d-canvas');
  canvas.setAttribute('splashScreen', 'false');
  canvas.setAttribute('notifications', 'false');
  canvas.setAttribute('contextMenu', 'false');
  canvas.setAttribute('cache', 'false');
   canvas.setAttribute('xrSessionMode', 'NONE');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  root.append(canvas);
  const browser = (canvas as unknown as { browser?: X3DBrowser }).browser ?? X3D.getBrowser(canvas);
  const scene = await browser.createX3DFromString(source);
  await browser.replaceWorld(scene);
});