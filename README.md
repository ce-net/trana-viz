# trana-viz

The mesh-transmitted visualization cell for **trana** — the distributed social/content backend other apps build on.

Every ce app family ships its own visualization as a separate ce app: a self-contained web
component that teaches what the app does, how it works (data flow), and where it is on the mesh
right now (live). No dashboard anywhere hardcodes it; any page that speaks the recursive-frontend
capability (`ce.comp`) discovers and mounts it at load time.

## How it is delivered

This repo is a component app in the recursive-frontend contract:

- `cecomponents.toml` — declares the component (tag `ce-viz-trana`, module `components/viz.js`).
- `components/viz.js` — one self-contained ES module (no imports; blob-delivered code has no
  import base). It defines a shadow-DOM custom element.

A transmitter (the `ce-comp` app, github.com/ce-net/ce-comp) publishes the module as a
content-addressed blob and serves the manifest + bytes on the mesh service `ce.comp`
(topic `ce.comp/ctl`, ops `index` / `fetch`) — the visualization is broadcast when it is
requested, by the node that hosts the app:

    ce-comp serve --app path/to/trana-viz

Any host page then mounts it without naming it (`ceComp.mountAll(grid)`), or targets it
(`ceComp.mountByApp("trana-viz", "viz", el)`).

## The cell's contract

- Reads `node-url` + `token` attributes (the loader sets them).
- Node access works behind `window.__ceNode` (ce-serve /mesh-bridge pages) or a plain HTTP node
  URL / local `/node` proxy — the cell never knows which transport is underneath.
- Live sections degrade honestly: "unreachable" is a rendered state, never a blank or a guess.
- Backing surface it visualizes: `trana + trana/*/v1`.
