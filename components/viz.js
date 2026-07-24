// ---- ce viz cell core (inlined; recursive-frontend v1 modules must be self-contained) ----
// Contract: the ce-comp loader sets `node-url` (+ `token`) attributes. Node access works two
// ways and the cell never knows which: window.__ceNode.request() when the page runs behind
// ce-serve's /mesh-bridge (production), plain fetch(nodeUrl + path) in local dev (:8844 or a
// /node proxy). All live sections degrade honestly — "unreachable" is a rendered state, never
// a blank or a fake.

const VIZ_CSS = `
  :host { display: block; }
  .card { background: #14171c; border: 1px solid #232a33; border-radius: 10px;
          padding: 16px 18px; color: #dfe3e8;
          font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
  .head b { font-size: 15px; letter-spacing: .2px; }
  .kind { color: #8b95a1; font-size: 11px; border: 1px solid #232a33; border-radius: 99px;
          padding: 1px 8px; }
  .status { margin-left: auto; font-size: 11px; display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 99px; background: #8b95a1; }
  .status.ok .dot { background: #43e0a0; } .status.ok { color: #43e0a0; }
  .status.bad .dot { background: #ff5d72; } .status.bad { color: #ff5d72; }
  .status.unk { color: #8b95a1; }
  .what { color: #9aa3ad; margin: 4px 0 12px; max-width: 68ch; }
  .sect { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: .12em;
          margin: 12px 0 6px; }
  svg { display: block; max-width: 100%; height: auto; }
  svg text { font: 11px ui-monospace, Menlo, monospace; fill: #b9c2cc; }
  svg .bx { fill: #191d23; stroke: #39424f; rx: 6; }
  svg .mesh { stroke: #43e0a0; } svg .edge { stroke: #4a5462; }
  svg .lbl { fill: #7d8794; font-size: 10px; }
  table.live { border-collapse: collapse; width: 100%; }
  table.live td { padding: 3px 10px 3px 0; vertical-align: top; }
  table.live td:first-child { color: #8b95a1; white-space: nowrap; }
  .ok-t { color: #43e0a0; } .bad-t { color: #ff5d72; } .unk-t { color: #8b95a1; }
  code { color: #b9c2cc; background: #191d23; border-radius: 4px; padding: 0 5px; }
  .foot { margin-top: 12px; color: #6b7280; font-size: 11px; display: flex; gap: 14px; flex-wrap: wrap; }
  .foot a { color: #7d8794; }
`;

const vizHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const vizUnhex = (s) => new Uint8Array((String(s).match(/../g) || []).map((x) => parseInt(x, 16)));
const vizShort = (id) => (id ? String(id).slice(0, 8) : "?");
const vizEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// One HTTP-shaped call against the page's node, whichever transport is underneath.
async function vizNodeReq(el, method, path, body) {
  const nodeUrl = (el.getAttribute("node-url") || "").replace(/\/$/, "");
  const bridged = (!nodeUrl || nodeUrl === "bridge") && globalThis.__ceNode?.request;
  if (bridged) {
    const r = await globalThis.__ceNode.request(method, path, body ? { body: JSON.stringify(body) } : undefined);
    if (r.status >= 400) throw new Error(`${path}: ${r.status}`);
    let out = r.body;
    if (out instanceof Uint8Array) out = new TextDecoder().decode(out);
    if (typeof out === "string") { try { out = JSON.parse(out); } catch { /* raw */ } }
    return out;
  }
  if (!nodeUrl) throw new Error("no node: neither node-url nor __ceNode present");
  const headers = { "Content-Type": "application/json" };
  const token = el.getAttribute("token");
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(nodeUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// Directed request over the mesh to `to` on `topic`; resolves with the decoded JSON reply.
// ANY well-formed reply (even {"error":...}) proves a live app behind the topic.
async function vizMeshReq(el, to, topic, payloadObj, timeoutMs = 8000) {
  const out = await vizNodeReq(el, "POST", "/mesh/request", {
    to, topic, timeout_ms: timeoutMs,
    payload_hex: vizHex(new TextEncoder().encode(JSON.stringify(payloadObj))),
  });
  const text = new TextDecoder().decode(vizUnhex(out.payload_hex));
  try { return JSON.parse(text || "{}"); } catch { return { raw: true }; } // any reply = a live app
}

// Live row runners. Each returns {cls: "ok"|"bad"|"unk", html}.
const VIZ_ROWS = {
  async self(el) {
    const s = await vizNodeReq(el, "GET", "/status");
    return { cls: "ok", html: `<span class="ok-t">connected</span> — node <code>${vizShort(s.node_id)}</code> peer <code>${vizShort(s.peer_id)}</code>` };
  },
  async discover(el, spec) {
    const f = await vizNodeReq(el, "GET", `/discovery/find/${encodeURIComponent(spec.service)}`);
    const provs = f?.providers || [];
    if (!provs.length) return { cls: "unk", html: `<span class="unk-t">no providers found from here</span> (DHT lookup <code>${vizEsc(spec.service)}</code>)` };
    return { cls: "ok", html: `<span class="ok-t">${provs.length} provider${provs.length > 1 ? "s" : ""}</span> — ${provs.slice(0, 4).map((p) => `<code>${vizShort(p)}</code>`).join(" ")}` };
  },
  async ping(el, spec) {
    let to = spec.to;
    if (!to) to = (await vizNodeReq(el, "GET", "/status")).node_id;
    const t0 = performance.now();
    await vizMeshReq(el, to, spec.topic, spec.payload || { op: "status" }, spec.timeoutMs || 8000);
    const ms = Math.round(performance.now() - t0);
    return { cls: "ok", html: `<span class="ok-t">responding</span> on <code>${vizEsc(spec.topic)}</code> (${ms} ms, node <code>${vizShort(to)}</code>)` };
  },
  async info(el, spec) { return { cls: "ok", html: spec.html }; },
  async http(el, spec) {
    const t0 = performance.now();
    const res = await fetch(spec.url, { method: "GET" });
    if (!res.ok) throw new Error(`${res.status}`);
    return { cls: "ok", html: `<span class="ok-t">up</span> — <code>${vizEsc(spec.url)}</code> (${Math.round(performance.now() - t0)} ms)` };
  },
};

function defineVizCell(cfg) {
  if (customElements.get(cfg.tag)) return;
  class VizCell extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>${VIZ_CSS}</style>
        <div class="card">
          <div class="head"><b>${vizEsc(cfg.app)}</b><span class="kind">${vizEsc(cfg.kind)}</span>
            <span class="status unk"><span class="dot"></span><span class="stxt">checking</span></span></div>
          <div class="what">${cfg.what}</div>
          <div class="sect">how it works</div>
          ${cfg.how}
          <div class="sect">where it is on the mesh — live</div>
          <table class="live">${cfg.live.map((r, i) => `<tr><td>${vizEsc(r.label)}</td><td class="lv" data-i="${i}"><span class="unk-t">…</span></td></tr>`).join("")}</table>
          <div class="foot">${cfg.foot}</div>
        </div>`;
      this._alive = true;
      this._tick();
    }
    disconnectedCallback() { this._alive = false; clearTimeout(this._t); }
    async _tick() {
      if (!this._alive) return;
      const results = await Promise.all(cfg.live.map(async (r) => {
        try { return await VIZ_ROWS[r.kind](this, r); }
        catch (e) { return { cls: "bad", html: `<span class="bad-t">unreachable</span> — ${vizEsc(e.message).slice(0, 90)}` }; }
      }));
      if (!this._alive) return;
      results.forEach((res, i) => { const td = this.shadowRoot.querySelector(`.lv[data-i="${i}"]`); if (td) td.innerHTML = res.html; });
      const worst = results.some((r) => r.cls === "bad") ? "bad" : results.every((r) => r.cls === "ok") ? "ok" : "unk";
      const st = this.shadowRoot.querySelector(".status");
      st.className = `status ${worst}`;
      st.querySelector(".stxt").textContent = worst === "ok" ? "live" : worst === "bad" ? "degraded" : "partial";
      this._t = setTimeout(() => this._tick(), 15000 + Math.random() * 5000);
    }
  }
  customElements.define(cfg.tag, VizCell);
}

// SVG diagram helpers (build-time strings; recessive strokes, one accent for the mesh hop).
function vizFlow(w, h, inner) {
  return `<svg viewBox="0 0 ${w} ${h}" role="img">
    <defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0 L8 4 L0 8 z" fill="#4a5462"/></marker>
    <marker id="arm" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0 L8 4 L0 8 z" fill="#43e0a0"/></marker></defs>${inner}</svg>`;
}
const vizBox = (x, y, w, h, label, sub) =>
  `<rect class="bx" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>
   <text x="${x + w / 2}" y="${y + (sub ? h / 2 - 3 : h / 2 + 4)}" text-anchor="middle">${label}</text>` +
  (sub ? `<text class="lbl" x="${x + w / 2}" y="${y + h / 2 + 12}" text-anchor="middle">${sub}</text>` : "");
const vizArrow = (x1, y1, x2, y2, mesh, label) =>
  `<line class="${mesh ? "mesh" : "edge"}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="1.5" marker-end="url(#${mesh ? "arm" : "ar"})"/>` +
  (label ? `<text class="lbl" x="${(x1 + x2) / 2}" y="${Math.min(y1, y2) - 6}" text-anchor="middle">${label}</text>` : "");
// ---- end core ----
// trana-viz — the trana backend explains itself.
defineVizCell({
  tag: "ce-viz-trana",
  app: "trana",
  kind: "content backend",
  what: "A reusable distributed social/content backend: threads, boards, media, profiles, karma and compute-trust — served as versioned mesh topics that other apps build products on. No central database; trana nodes replicate between themselves.",
  how: vizFlow(660, 145,
    vizBox(10, 45, 120, 50, "client SDK", "any app") +
    vizArrow(130, 70, 240, 70, true, "trana/boards/v1 · comments/v1 · ...") +
    vizBox(240, 45, 130, 50, "trana-node", "typed topic API") +
    vizArrow(370, 70, 440, 70) +
    vizBox(440, 45, 210, 50, "CRDT store + karma/trust", "state merges, never locks") +
    vizArrow(305, 95, 305, 125, true) +
    `<text class="lbl" x="305" y="140" text-anchor="middle">replicates to peer trana-nodes over the mesh</text>`
  ),
  live: [
    { kind: "self", label: "this node" },
    { kind: "discover", label: "trana nodes", service: "trana" },
  ],
  foot: `<span>service <code>trana</code>, topics <code>trana/*/v1</code></span><a href="https://github.com/ce-net/trana">github.com/ce-net/trana</a>`,
});
