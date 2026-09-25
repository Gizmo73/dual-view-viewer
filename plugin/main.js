"use strict";

const {
  Plugin,
  PluginSettingTab,
  ItemView,
  Setting,
  FileSystemAdapter,
  FuzzySuggestModal,
  TFile,
  TFolder,
  Menu,
  Modal,
  Notice,
  debounce,
} = require("obsidian");
const os = require("os");

const VIEW_TYPE_CONTROLLER = "dual-view-controller";

const DEFAULTS = {
  swap: false,
  orientation: "portrait", // "portrait" or "landscape" (the physical screen)
  rememberPosition: true,
  backgroundColor: "#000000",
  textColor: "#ffffff",
  fontFamily: "inherit", // "inherit" picks up Obsidian's own current theme font
  presets: {},            // name -> { backgroundColor, textColor, fontFamily }
  hosts: {},
  broadcast: true,        // run the player room at all (main screen always mirrors)
  broadcastRoomId: "",    // the player room; "New player link" replaces it
  viewerBaseUrl: "",      // where the viewer page is hosted, e.g. a GitHub Pages URL
  owlbearUrl: "",         // Owlbear Rodeo room, offered to players as a button
  ambient: {}             // ambient window's own settings bag, filled by AMBIENT_DEFAULTS
};

// The ambient window is independent of the main one: its own look and its
// own saved position. It shares the player room (players pick the ambient
// screen from the viewer page) and the global presets. Defaults lean toward
// an upright second screen (single view, landscape orientation renders
// single upright).
const AMBIENT_DEFAULTS = {
  swap: false,
  orientation: "landscape",
  rememberPosition: true,
  backgroundColor: "#000000",
  textColor: "#ffffff",
  fontFamily: "inherit",
  hosts: {},
  broadcast: true,        // mirror the ambient screen to players
  scenes: []              // premade scenes: [{ name, path, mode }], in display order
};

// Curated font choices. "inherit" pulls whatever font Obsidian's own theme
// is currently using; anything else is a plain CSS font-family value.
const FONT_OPTIONS = [
  ["inherit", "Obsidian default"],
  ["Georgia, 'Times New Roman', serif", "Serif (Georgia)"],
  ["'Segoe UI', system-ui, sans-serif", "Sans-serif (Segoe UI)"],
  ["Consolas, 'Cascadia Code', monospace", "Monospace (Consolas)"],
  ["Papyrus, fantasy", "Decorative (Papyrus)"],
  ["Impact, sans-serif", "Bold display (Impact)"],
];

let idCounter = 0;
function makeItemId() {
  idCounter += 1;
  return "item-" + Date.now() + "-" + idCounter;
}

// Short label for a controller tab: first line of the text, trimmed.
function titleForText(text) {
  const first = text.trim().split("\n")[0].trim();
  if (!first) return "Text";
  return first.length > 40 ? first.slice(0, 40) + "\u2026" : first;
}

/* Injected straight into the popout document so we never depend on Obsidian   */
/* propagating the plugin stylesheet into a separate window.                   */
const STYLE = `
.view-content.drm-active { position: relative; padding: 0 !important; overflow: hidden; }
.view-content.drm-active > *:not(.drm-overlay) { display: none !important; }
.drm-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--dual-view-background, #000); z-index: 5; cursor: grab; overflow: hidden; }
.drm-overlay.drm-dragging { cursor: grabbing; }
.drm-overlay.drm-split-v { flex-direction: row; }
.drm-half { flex: 1 1 50%; min-height: 0; min-width: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.drm-content { transform-origin: 50% 50%; user-select: none; flex-shrink: 0; flex-grow: 0; }
.drm-img, .drm-single-img { display: block; object-fit: contain; -webkit-user-drag: none; }
.drm-text, .drm-single-text {
  display: flex; align-items: center; justify-content: center; text-align: center;
  box-sizing: border-box; padding: 6%; overflow: hidden;
  color: var(--dual-view-text-color, #fff); font-family: var(--dual-view-font, inherit);
  font-size: 48px; line-height: 1.3; white-space: pre-wrap;
}
.drm-overlay.drm-single { align-items: center; justify-content: center; }
`;



/* Styles for the controller tab, injected into the MAIN window document   */
/* (not the popout) since this plugin doesn't rely on a separate styles.css */
const CONTROLLER_STYLE = `
.dual-view-controller { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.dual-view-controller__section { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--background-modifier-border); border-left-width: 4px; border-radius: 8px; }
.dual-view-controller__section--players { border-left-color: var(--text-faint); }
.dual-view-controller__section--main { border-left-color: var(--interactive-accent); }
.dual-view-controller__section--ambient { border-left-color: var(--color-orange, #e0a040); }
.dual-view-controller__heading { margin: 0; font-size: 0.8em; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
.dual-view-controller__tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.dual-view-controller__tab { display: flex; align-items: stretch; border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden; }
.dual-view-controller__tab.is-active { border-color: var(--interactive-accent); }
.dual-view-controller__tab-main { padding: 4px 10px; background: var(--background-secondary); border: none; cursor: pointer; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dual-view-controller__tab.is-active .dual-view-controller__tab-main { background: var(--interactive-accent); color: var(--text-on-accent); }
.dual-view-controller__tab-close { padding: 4px 8px; background: var(--background-secondary); border: none; border-left: 1px solid var(--background-modifier-border); cursor: pointer; opacity: 0.6; }
.dual-view-controller__tab-close:hover { opacity: 1; }
.dual-view-controller__empty { color: var(--text-muted); font-style: italic; }
.dual-view-controller__status { color: var(--text-muted); font-size: 0.9em; }
.dual-view-controller__controls { display: flex; flex-direction: column; gap: 8px; }
.dual-view-controller__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dual-view-controller__row button { padding: 4px 10px; }
.dual-view-controller__row select, .dual-view-controller__row input[type="text"] { padding: 3px 8px; background: var(--background-secondary); color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-radius: 4px; }
.dual-view-controller__row input[type="text"] { min-width: 140px; }
`;

function isImage(file) {
  return /^(png|jpg|jpeg|gif|webp|bmp|svg|avif)$/i.test(file.extension);
}

/* Remote viewer broadcast. --------------------------------------------------
   One PeerJS peer, registered under the room ID from settings, serves both
   screens. Each player tab says which screen it wants ("main" or "ambient")
   when it connects, so a single link covers everything: the viewer page opens
   its own ambient window against the same room. Content is pushed over
   WebRTC data channels, so nothing is hosted or stored anywhere. PeerJS is
   pulled from a CDN at runtime rather than vendored, since broadcasting is
   only meaningful when online anyway. */

const PEERJS_SRCS = [
  "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js",
  "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js",
];

// Injects the PeerJS <script> exactly once for the whole plugin. Loading the
// bundle twice re-evaluates PeerJS's Parcel runtime and clobbers any peer
// already built against it. Tries each CDN in turn, and resolves false rather
// than throwing if none load, so an offline vault just loses broadcast.
let peerJsLoadPromise = null;
function loadPeerJsOnce() {
  if (window.Peer) return Promise.resolve(true);
  if (peerJsLoadPromise) return peerJsLoadPromise;
  const tryLoad = (i) => new Promise((resolve) => {
    if (i >= PEERJS_SRCS.length) { resolve(false); return; }
    const s = document.createElement("script");
    s.src = PEERJS_SRCS[i];
    s.onload = () => resolve(!!window.Peer);
    s.onerror = () => { s.remove(); resolve(tryLoad(i + 1)); };
    document.head.appendChild(s);
  });
  peerJsLoadPromise = tryLoad(0).then((ok) => {
    if (!ok) peerJsLoadPromise = null; // let a later attempt try again
    return ok;
  });
  return peerJsLoadPromise;
}

// Images are chunked by hand so a failure on the player's end is never a
// mystery. 16000 keeps each packed chunk (bytes plus its small header) under
// PeerJS's own 16300-byte limit, so PeerJS never splits it a second time.
const BROADCAST_CHUNK = 16000;

// Keep at most this much queued in the channel before pausing the send loop.
// Chrome throws once the buffer passes ~16MB, so back off well before that.
const BROADCAST_BUFFER_CAP = 4 * 1024 * 1024;

// Both ends ping every HEARTBEAT_MS, and a link silent for DEAD_MS is treated
// as gone. PeerJS never reports a data channel that dies with a sleeping
// laptop or dropped wifi, it just goes quiet, so without this a dead player
// lingers as "connected" forever.
const HEARTBEAT_MS = 10000;
const DEAD_MS = 35000;

function mimeForExtension(ext) {
  const map = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif",
  };
  return map[String(ext || "").toLowerCase()] || "application/octet-stream";
}

function makeRoomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "dv-" + hex;
}

// Owns the one peer and every player connection, and keeps the room alive.
// Recovery prefers peer.reconnect(): it reuses the same broker token, so the
// broker hands the room back even if it hasn't noticed the old socket died,
// and every player's open data channel survives. Tearing the peer down and
// registering the ID afresh is the last resort, because a fresh peer is
// refused ("unavailable-id") for as long as the broker still holds the old
// registration.
class RemoteHub {
  constructor(plugin) {
    this.plugin = plugin;
    this.peer = null;
    this.conns = new Set();   // open connections; conn._dvView is "main" or "ambient"
    this.channels = {};       // view -> RemoteChannel
    this.state = "off";       // off | connecting | online | reconnecting
    this.wanted = false;      // between start() and stop()
    this.destroyed = false;
    this._loading = false;
    this._peerStartedAt = 0;
    this._failures = 0;       // consecutive broker failures; drives the backoff
    this._idTaken = 0;
    this._healTimer = null;
    this._tick = null;
  }

  channel(view, config) {
    const ch = new RemoteChannel(this, view, config);
    this.channels[view] = ch;
    return ch;
  }

  playerCount(view) {
    let n = 0;
    for (const c of this.conns) if (c._dvView === view) n += 1;
    return n;
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.plugin.refreshControllerStatus();
  }

  syncState() {
    const p = this.peer;
    if (!this.wanted) this.setState("off");
    else if (p && p.open) this.setState("online");
    else if (!p || p.destroyed || p.disconnected) this.setState("reconnecting");
    else this.setState("connecting");
  }

  async start() {
    if (this.destroyed) return;
    this.wanted = true;
    if (!this._tick) this._tick = window.setInterval(() => this.tick(), HEARTBEAT_MS);
    if (this.peer && this.peer.destroyed) this.peer = null;
    if (this.peer || this._loading) return;
    if (this.state === "off") this.setState("connecting");
    this._loading = true;
    const ok = await loadPeerJsOnce();
    this._loading = false;
    if (!this.wanted || this.destroyed || this.peer) return;
    if (!ok || !window.Peer) {
      if (this._failures === 0) {
        new Notice("Dual View: couldn't load PeerJS (offline?). Will keep retrying.", 6000);
      }
      this.setState("reconnecting");
      this.scheduleHeal();
      return;
    }
    this.openPeer();
  }

  openPeer() {
    const peer = new window.Peer(this.plugin.settings.broadcastRoomId);
    this.peer = peer;
    this._peerStartedAt = Date.now();
    this.syncState();
    peer.on("open", () => {
      if (peer !== this.peer) return;
      this._failures = 0;
      this._idTaken = 0;
      this.syncState();
    });
    peer.on("connection", (conn) => {
      if (peer === this.peer) this.handleConnection(conn);
    });
    // The broker link dropped. Players already connected keep receiving;
    // only new joins need the broker, so heal it in the background.
    peer.on("disconnected", () => {
      if (peer !== this.peer) return;
      this.syncState();
      this.scheduleHeal();
    });
    peer.on("error", (err) => {
      if (peer !== this.peer) return;
      const type = err && err.type;
      // Errors from one player's WebRTC setup land here too. They don't
      // affect the room, and that player's own page retries.
      if (type === "peer-unavailable" || type === "webrtc") return;
      if (type === "unavailable-id") {
        // Almost always the broker still holding this room from a link that
        // died uncleanly. It lets go after a minute or so; keep retrying.
        this._idTaken += 1;
        if (this._idTaken === 3) {
          new Notice("Dual View: the player room is still held from an earlier connection. Still retrying; \"New player link\" starts a fresh room straight away.", 10000);
        }
      }
      this.syncState();
      this.scheduleHeal();
    });
  }

  scheduleHeal() {
    if (this._healTimer || !this.wanted || this.destroyed) return;
    // 2s, 4s, 8s, 16s, then every 30s.
    const delay = Math.min(30000, 2000 * Math.pow(2, this._failures));
    this._healTimer = window.setTimeout(() => this.heal(), delay);
  }

  heal() {
    this._healTimer = null;
    if (!this.wanted || this.destroyed) return;
    const p = this.peer;
    // Healthy, or still registering: nothing to do.
    if (p && !p.destroyed && !p.disconnected) { this.syncState(); return; }
    this._failures += 1;
    // Keep reconnecting while players are connected, since a rebuild would
    // cut them off; with nobody connected, rebuild after a few failures.
    if (p && !p.destroyed && (this._failures <= 3 || this.conns.size)) {
      try { p.reconnect(); this.syncState(); return; } catch (e) {}
    }
    this.peer = null;
    if (p) { try { p.destroy(); } catch (e) {} }
    this.start();
  }

  // Heartbeat plus watchdog. Pings every player, drops ones that have gone
  // silent, and restarts the room if it is down with no recovery pending.
  tick() {
    const now = Date.now();
    for (const conn of this.conns) {
      // Only players that ping are held to the heartbeat, so an older cached
      // viewer page that never pings isn't cut off every 35 seconds.
      if (!conn.open || (conn._dvPings && now - conn._dvSeen > DEAD_MS)) {
        try { conn.close(); } catch (e) {}
        this.drop(conn);
        continue;
      }
      try { conn.send({ k: "ping" }); } catch (e) {}
    }
    if (!this.wanted || this.destroyed || this._healTimer || this._loading) return;
    const p = this.peer;
    if (!p || p.destroyed || p.disconnected) {
      this.scheduleHeal();
    } else if (!p.open && now - this._peerStartedAt > 30000) {
      // Stuck registering with the broker. Start over.
      this.peer = null;
      try { p.destroy(); } catch (e) {}
      this.start();
    }
  }

  handleConnection(conn) {
    const view = conn.metadata && conn.metadata.view === "ambient" ? "ambient" : "main";
    let opened = false;
    conn.on("open", () => {
      opened = true;
      conn._dvView = view;
      conn._dvSeen = Date.now();
      conn._dvPings = false;
      this.conns.add(conn);
      new Notice("Dual View: player connected (" + view + ").", 2500);
      this.plugin.refreshControllerStatus();
      this.sendHello(conn);
      const ch = this.channels[view];
      if (ch && ch.last) ch.sendTo(conn, ch.last);
    });
    conn.on("data", (msg) => {
      conn._dvSeen = Date.now();
      if (msg && msg.k === "ping") conn._dvPings = true;
    });
    conn.on("close", () => this.drop(conn));
    conn.on("error", () => this.drop(conn));
    // A connection whose WebRTC setup stalls fires neither open nor close.
    // Close it so it doesn't hold a peer connection open forever.
    window.setTimeout(() => {
      if (!opened) { try { conn.close(); } catch (e) {} }
    }, 20000);
  }

  drop(conn) {
    if (!this.conns.delete(conn)) return;
    new Notice("Dual View: player disconnected (" + conn._dvView + ").", 2500);
    this.plugin.refreshControllerStatus();
  }

  // Tells a player which screen it's on and where the map lives. Sent on
  // connect, and again to everyone when the Owlbear link changes.
  sendHello(conn) {
    try {
      conn.send({ k: "hello", view: conn._dvView, owlbear: this.plugin.settings.owlbearUrl || "" });
    } catch (e) {}
  }

  helloAll() {
    for (const conn of this.conns) this.sendHello(conn);
  }

  // Closes the peer but leaves the hub reusable (settings toggle, new room).
  stop() {
    this.wanted = false;
    if (this._healTimer) { window.clearTimeout(this._healTimer); this._healTimer = null; }
    if (this._tick) { window.clearInterval(this._tick); this._tick = null; }
    const p = this.peer;
    this.peer = null;
    if (p) { try { p.destroy(); } catch (e) {} }
    this.conns.clear();
    this._failures = 0;
    this._idTaken = 0;
    this.setState("off");
  }

  restart() {
    this.stop();
    if (this.plugin.settings.broadcast) this.start();
  }

  destroy() {
    this.destroyed = true;
    this.stop();
  }
}

// One screen's worth of broadcast: what that screen last showed, pushed to
// the players watching it. The main and ambient windows each hold one.
class RemoteChannel {
  constructor(hub, view, config) {
    this.hub = hub;
    this.view = view;
    this.config = config;    // settings bag for this screen's colours and broadcast flag
    this.last = null;        // last payload, resent to late joiners and refreshes
    this.transferId = 0;     // bumps on every send; stale image sends abort themselves
  }

  targets() {
    const out = [];
    for (const conn of this.hub.conns) if (conn._dvView === this.view) out.push(conn);
    return out;
  }

  async broadcastImage(file) {
    if (!this.config.broadcast) return;
    let buf;
    try {
      buf = await this.hub.plugin.app.vault.readBinary(file);
    } catch (e) {
      return;
    }
    this.transferId += 1;
    this.last = {
      kind: "image",
      id: this.transferId,
      name: file.name,
      mime: mimeForExtension(file.extension),
      buf,
      backgroundColor: this.config.backgroundColor,
    };
    this.sendAll();
  }

  broadcastText(text) {
    if (!this.config.broadcast) return;
    const s = this.config;
    this.transferId += 1;
    this.last = {
      kind: "text",
      id: this.transferId,
      text,
      backgroundColor: s.backgroundColor,
      textColor: s.textColor,
      fontFamily: s.fontFamily,
    };
    this.sendAll();
  }

  sendAll() {
    for (const conn of this.targets()) this.sendTo(conn, this.last);
  }

  // Pushes one payload down one connection. Text goes as a single message;
  // images go as header, chunks, end marker. The loop yields whenever the
  // channel's buffer fills, and abandons itself if a newer send has started.
  async sendTo(conn, payload) {
    if (!payload) return;
    try {
      if (payload.kind === "text") {
        conn.send({
          k: "text",
          id: payload.id,
          text: payload.text,
          backgroundColor: payload.backgroundColor,
          textColor: payload.textColor,
          fontFamily: payload.fontFamily,
        });
        return;
      }
      const total = Math.max(1, Math.ceil(payload.buf.byteLength / BROADCAST_CHUNK));
      conn.send({
        k: "head",
        id: payload.id,
        name: payload.name,
        mime: payload.mime,
        size: payload.buf.byteLength,
        chunks: total,
        backgroundColor: payload.backgroundColor,
      });
      for (let i = 0; i < total; i++) {
        while (
          conn.open &&
          conn.dataChannel &&
          conn.dataChannel.bufferedAmount > BROADCAST_BUFFER_CAP
        ) {
          await new Promise((r) => setTimeout(r, 50));
        }
        // A newer send superseded this one, or the player left. Stop quietly;
        // the viewer discards partial transfers on its own.
        if (!conn.open || payload.id !== this.transferId) return;
        conn.send({
          k: "chunk",
          id: payload.id,
          i,
          b: payload.buf.slice(i * BROADCAST_CHUNK, (i + 1) * BROADCAST_CHUNK),
        });
      }
      conn.send({ k: "end", id: payload.id });
    } catch (e) {}
  }

  // Pushes this screen's current colours and font to its players without
  // resending the content, and keeps the stored payload in step so late
  // joiners get the same.
  refreshStyle() {
    const s = this.config;
    if (this.last) {
      this.last.backgroundColor = s.backgroundColor;
      if (this.last.kind === "text") {
        this.last.textColor = s.textColor;
        this.last.fontFamily = s.fontFamily;
      }
    }
    if (!s.broadcast) return;
    const msg = {
      k: "style",
      backgroundColor: s.backgroundColor,
      textColor: s.textColor,
      fontFamily: s.fontFamily,
    };
    for (const conn of this.targets()) {
      try { conn.send(msg); } catch (e) {}
    }
  }

  // Blanks this screen's players and forgets the last payload, so neither
  // current nor late-joining players keep seeing content the table has
  // closed. Bumping transferId also aborts any in-flight image send.
  clearRemote() {
    this.transferId += 1;
    this.last = null;
    for (const conn of this.targets()) {
      try { conn.send({ k: "clear" }); } catch (e) {}
    }
  }
}

/* Owns one popout window and renders the dual rotated view inside it. ------ */
class DualWindow {
  constructor(plugin, config, remote) {
    this.plugin = plugin;
    this.config = config || plugin.settings;   // this window's own settings bag
    this.remote = remote || null;              // this window's RemoteChannel
    this.leaf = null;
    this.container = null;   // WorkspaceWindow (electron window + rootEl)
    this.doc = null;
    this.popup = null;       // the popout's window object
    this.observer = null;
    this.mode = "dual";        // "dual" or "single"
    this.contentKind = null;   // "image" or "text" \u2014 which render path is active
    this.imgs = [];            // content elements (img or text div) that get updated
    this.currentText = null;   // text currently shown, if the active item is text

    // Shared pan/zoom state, expressed in image space (before rotation).
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this._drag = null;

    this.boundSize = () => { this.size(); this.applyTransforms(); this.fitText(); };
    this.onWheel = (e) => this.handleWheel(e);
    this.onPointerDown = (e) => this.handlePointerDown(e);
    this.onPointerMove = (e) => this.handlePointerMove(e);
    this.onPointerUp = (e) => this.handlePointerUp(e);
    this.onDblClick = (e) => { if (e) e.stopPropagation(); this.resetView(); };
  }

  electron() {
    try {
      return this.container && this.container.win && this.container.win.electronWindow;
    } catch (e) {
      return null;
    }
  }

  // Creates the popout window and wires up styling, position memory, and the
  // observer, if it doesn't exist yet. Safe to call repeatedly; a no-op once
  // the window is already open. Shared by both the image and text paths.
  async ensurePopout() {
    const app = this.plugin.app;
    if (this.container) return;

    this.leaf = app.workspace.openPopoutLeaf();

    // The leaf can come back with a deferred (lazy-load stub) view. The
    // image path never hits this because openFile() forces it to resolve;
    // the text path touches contentEl directly with nothing to force that,
    // so without this the real view can swap in later and silently drop
    // whatever we attached to the stub.
    if (this.leaf.isDeferred) {
      try { await this.leaf.loadIfDeferred(); } catch (e) {}
    }

    this.container = this.leaf.getContainer();
    this.doc = this.container?.win?.document || this.leaf.view?.containerEl?.ownerDocument;
    this.popup = this.container?.win || this.doc?.defaultView;

    // Make sure the popout document carries our (current) styles.
    if (this.doc) {
      let s = this.doc.getElementById("drm-style");
      if (!s) {
        s = this.doc.createElement("style");
        s.id = "drm-style";
        this.doc.head.appendChild(s);
      }
      s.textContent = STYLE;
    }

    // Restore saved position/size for this computer, if any.
    const saved = this.config.hosts[os.hostname()];
    const ew = this.electron();
    if (saved && ew) {
      try {
        ew.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
        ew.setFullScreen(!!saved.fullscreen);
        if (saved.maximized) ew.maximize();
      } catch (e) {}
    }

    if (ew) {
      const save = debounce(() => this.savePosition(), 500, true);
      ew.on("move", save);
      ew.on("resize", save);
      ew.on("enter-full-screen", save);
      ew.on("leave-full-screen", save);
      ew.on("close", () => this.cleanup());
    }
    // Obsidian's own window-close event is handled once, in the plugin's
    // onload, rather than registered again every time a popout opens.

    // Only ever meant to catch Obsidian's async image-src assignment.
    // Gated on contentKind so a leftover (hidden) real <img> from an
    // earlier tab can't cause a text tab to get silently rebuilt as image.
    this.observer = new MutationObserver(() => {
      if (this.contentKind !== "image") return;
      this.apply();
    });
    this.connectObserver();
    this.popup.addEventListener("resize", this.boundSize);

    // Strip the chrome so content fills the window. Works even with no file
    // open yet (empty-state view still has these elements).
    try { this.leaf.parent.tabHeaderContainerEl.empty(); } catch (e) {}
    try { this.leaf.view.headerEl && this.leaf.view.headerEl.empty(); } catch (e) {}
    try { this.container.rootEl.querySelector(".status-bar").detach(); } catch (e) {}
  }

  async loadFile(file, mode) {
    const app = this.plugin.app;
    if (!(app.vault.adapter instanceof FileSystemAdapter)) return;

    this.mode = mode === "single" ? "single" : "dual";
    this.currentText = null;
    this.contentKind = "image";
    this.resetViewState();

    await this.ensurePopout();
    await this.leaf.openFile(file, { state: { mode: "preview" } });

    // Strip the chrome so the image fills the window.
    try { this.leaf.parent.tabHeaderContainerEl.empty(); } catch (e) {}
    try { this.leaf.view.headerEl.empty(); } catch (e) {}
    try { this.container.rootEl.querySelector(".status-bar").detach(); } catch (e) {}

    const ew = this.electron();
    if (ew) { try { ew.setTitle(file.name); } catch (e) {} }

    // Bust the native image view's cache. openFile() no-ops when this file
    // is already open in the leaf, so a re-sent image whose contents changed
    // on disk (e.g. the zoom map bridge overwriting its PNG) kept showing
    // the old version. getResourcePath() embeds the file mtime, so rewriting
    // src forces a reload; the observer and apply() propagate it to the overlay.
    try {
      const real = this.leaf.view.contentEl.querySelector("img:not(.drm-img):not(.drm-single-img)");
      if (real) real.src = app.vault.getResourcePath(file);
    } catch (e) {}

    // Apply now, plus a couple of retries in case the image renders a tick late.
    this.apply();
    this.popup.requestAnimationFrame(() => this.apply());
    this.popup.setTimeout(() => this.apply(), 60);

    // Mirror to the remote viewer. Fire and forget; a slow or absent viewer
    // must never hold up the table.
    if (this.remote) this.remote.broadcastImage(file);
  }

  connectObserver() {
    if (!this.observer || !this.doc) return;
    this.observer.observe(this.doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }

  // Find the image view's content element and confirm it holds an image.
  getViewContent() {
    const sel = "img:not(.drm-img):not(.drm-single-img)";
    const ce = this.leaf && this.leaf.view && this.leaf.view.contentEl;
    if (ce && ce.querySelector(sel)) return ce;
    if (this.doc) {
      for (const vc of this.doc.querySelectorAll(".view-content")) {
        if (vc.querySelector(sel)) return vc;
      }
    }
    return null;
  }

  apply() {
    const vc = this.getViewContent();
    if (!vc) return;
    const real = vc.querySelector("img:not(.drm-img):not(.drm-single-img)");
    if (!real) return;
    const src = real.getAttribute("src") || real.src;
    if (!src) return;

    this.observer.disconnect();
    try {
      vc.classList.add("drm-active");

      let overlay = vc.querySelector(":scope > .drm-overlay");
      // If the window is switching between dual and single, or between an
      // image and text tab, discard the old overlay and rebuild it.
      if (overlay && (overlay.dataset.mode !== this.mode || overlay.dataset.kind !== "image")) {
        overlay.remove();
        overlay = null;
      }
      if (!overlay) {
        overlay = this.doc.createElement("div");
        overlay.className = "drm-overlay";
        overlay.dataset.mode = this.mode;
        overlay.dataset.kind = "image";
        this.imgs = [];
        if (this.mode === "single") {
          overlay.classList.add("drm-single");
          const img = this.doc.createElement("img");
          img.className = "drm-content drm-single-img";
          img.dataset.role = "single";
          img.draggable = false;
          img.addEventListener("load", this.boundSize);
          overlay.appendChild(img);
          this.imgs.push(img);
        } else {
          const mk = (role) => {
            const half = this.doc.createElement("div");
            half.className = "drm-half";
            const img = this.doc.createElement("img");
            img.className = "drm-content drm-img";
            img.dataset.role = role;
            img.draggable = false;
            img.addEventListener("load", this.boundSize);
            half.appendChild(img);
            overlay.appendChild(half);
            this.imgs.push(img);
          };
          mk("a");
          mk("b");
        }
        this.attachViewportListeners(overlay);
        vc.appendChild(overlay);
      } else {
        this.imgs = Array.from(overlay.querySelectorAll(".drm-content"));
      }

      this.applySplit(overlay);
      overlay.classList.toggle("drm-swap", !!this.config.swap);
	  overlay.style.setProperty("--dual-view-background", this.config.backgroundColor);
      for (const img of this.imgs) {
        if (img.getAttribute("src") !== src) img.setAttribute("src", src);
      }

      this.size();
      this.applyTransforms();
      this.popup.requestAnimationFrame(this.boundSize);
    } finally {
      this.connectObserver();
    }
  }

  // Same idea as loadFile(), but for a plain string instead of a vault image.
  // Opens the popout on its own if nothing's open yet.
  async showText(text, mode) {
    this.mode = mode === "single" ? "single" : "dual";
    this.currentText = text;
    this.contentKind = "text";
    this.resetViewState();
    await this.ensurePopout();
    this.applyText();
    this.popup.requestAnimationFrame(() => this.applyText());
    this.popup.setTimeout(() => this.applyText(), 60);

    // Mirror to the remote viewer, same as loadFile().
    if (this.remote) this.remote.broadcastText(text);
  }

  // The element our overlay should attach to. getViewContent() only matches
  // when a real (non-ours) <img> is present, which is never true for a
  // text-only tab, so fall back to the leaf's own content element.
  contentHost() {
    const vc = this.getViewContent();
    if (vc) return vc;
    return (this.leaf && this.leaf.view && this.leaf.view.contentEl) || null;
  }

  applyText() {
    const vc = this.contentHost();
    if (!vc) return;

    this.observer.disconnect();
    try {
      vc.classList.add("drm-active");

      let overlay = vc.querySelector(":scope > .drm-overlay");
      if (overlay && (overlay.dataset.mode !== this.mode || overlay.dataset.kind !== "text")) {
        overlay.remove();
        overlay = null;
      }
      if (!overlay) {
        overlay = this.doc.createElement("div");
        overlay.className = "drm-overlay";
        overlay.dataset.mode = this.mode;
        overlay.dataset.kind = "text";
        this.imgs = [];
        if (this.mode === "single") {
          overlay.classList.add("drm-single");
          const el = this.doc.createElement("div");
          el.className = "drm-content drm-single-text";
          el.dataset.role = "single";
          overlay.appendChild(el);
          this.imgs.push(el);
        } else {
          const mk = (role) => {
            const half = this.doc.createElement("div");
            half.className = "drm-half";
            const el = this.doc.createElement("div");
            el.className = "drm-content drm-text";
            el.dataset.role = role;
            half.appendChild(el);
            overlay.appendChild(half);
            this.imgs.push(el);
          };
          mk("a");
          mk("b");
        }
        this.attachViewportListeners(overlay);
        vc.appendChild(overlay);
      } else {
        this.imgs = Array.from(overlay.querySelectorAll(".drm-content"));
      }

      this.applySplit(overlay);
      overlay.classList.toggle("drm-swap", !!this.config.swap);
      overlay.style.setProperty("--dual-view-background", this.config.backgroundColor);
      overlay.style.setProperty("--dual-view-text-color", this.config.textColor);
      overlay.style.setProperty("--dual-view-font", this.config.fontFamily);
      for (const el of this.imgs) {
        el.textContent = this.currentText || "";
      }

      this.size();
      this.applyTransforms();
      this.fitText();
      this.popup.requestAnimationFrame(this.boundSize);
    } finally {
      this.connectObserver();
    }
  }

  // Shrinks font-size until the text fits its box with no overflow, so
  // riddles never need scrolling. Bounded iterations, plain binary search.
  fitText() {
    if (!this.imgs.length) return;
    const isText = this.imgs[0].classList.contains("drm-text") || this.imgs[0].classList.contains("drm-single-text");
    if (!isText) return;
    for (const el of this.imgs) {
      let lo = 12, hi = 96;
      el.style.fontSize = hi + "px";
      if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) continue;
      for (let i = 0; i < 8; i++) {
        const mid = Math.round((lo + hi) / 2);
        el.style.fontSize = mid + "px";
        const fits = el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth;
        if (fits) lo = mid; else hi = mid;
      }
      el.style.fontSize = lo + "px";
    }
  }

  // Size each image to its container, transposing only when it is quarter-
  // turned (90/270), so the rotation lands it exactly inside its panel.
  size() {
    const overlay = this.currentOverlay();
    if (!overlay) return;
    overlay.querySelectorAll(".drm-content").forEach((img) => {
      const container = img.parentElement;
      if (!container) return;
      const a = ((this.angleFor(img) % 360) + 360) % 360;
      const odd = (a === 90 || a === 270);
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const w = (odd ? ch : cw) + "px";
      const h = (odd ? cw : ch) + "px";
      if (img.style.width !== w) img.style.width = w;
      if (img.style.height !== h) img.style.height = h;
    });
  }

  currentOverlay() {
    const vc = this.contentHost();
    return vc ? vc.querySelector(":scope > .drm-overlay") : null;
  }

  // Effective rotation for an image, given its role, the base 90 rotation,
  // and the swap setting. Dual halves are always 180 apart.
  angleFor(img) {
    const landscape = this.config.orientation === "landscape";
    const flip = this.config.swap ? 180 : 0;
    switch (img.dataset.role) {
      // Single view depends on screen orientation: upright in landscape,
      // quarter-turned in portrait. Dual halves are always 180 apart at
      // +/-90; only the split direction changes with orientation.
      case "single": return (landscape ? 0 : 90) + flip;
      case "a":      return 90 + flip;
      case "b":      return 270 + flip;
      default:       return 0;
    }
  }

  // rotate (display) -> translate (pan, image space) -> scale (zoom).
  applyTransforms() {
    const overlay = this.currentOverlay();
    if (!overlay) return;
    overlay.querySelectorAll(".drm-content").forEach((img) => {
      const angle = this.angleFor(img);
      img.style.transform =
        "rotate(" + angle + "deg) translate(" + this.panX + "px, " + this.panY + "px) scale(" + this.scale + ")";
    });
  }

  // Inverse-rotate a screen-space delta into image space. Angles are always
  // right angles here, so this is an exact axis swap / sign flip.
  static rotateDelta(dx, dy, angle) {
    const a = ((angle % 360) + 360) % 360;
    if (a === 0) return { x: dx, y: dy };
    if (a === 90) return { x: dy, y: -dx };
    if (a === 180) return { x: -dx, y: -dy };
    if (a === 270) return { x: -dy, y: dx };
    const r = (-a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  // The element the pointer is over: a half in dual, the overlay in single.
  surfaceForEvent(e) {
    if (this.mode === "single") return this.currentOverlay();
    return (e.target && e.target.closest && e.target.closest(".drm-half")) || this.currentOverlay();
  }

  angleForSurface(surface) {
    if (!surface) return 0;
    const img = surface.querySelector(".drm-content");
    return img ? this.angleFor(img) : 0;
  }

  attachViewportListeners(overlay) {
    overlay.addEventListener("wheel", this.onWheel, { passive: false });
    overlay.addEventListener("pointerdown", this.onPointerDown);
    overlay.addEventListener("pointermove", this.onPointerMove);
    overlay.addEventListener("pointerup", this.onPointerUp);
    overlay.addEventListener("pointercancel", this.onPointerUp);
    overlay.addEventListener("dblclick", this.onDblClick);
  }

  handleWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    const MIN = 1, MAX = 8;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.min(MAX, Math.max(MIN, this.scale * factor));
    if (newScale === this.scale) return;

    const surface = this.surfaceForEvent(e);
    if (!surface) return;
    const angle = this.angleForSurface(surface);
    const rect = surface.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Keep the map point under the cursor fixed while zooming.
    const w = DualWindow.rotateDelta(e.clientX - cx, e.clientY - cy, angle);
    const k = newScale / this.scale;
    this.panX = (1 - k) * w.x + k * this.panX;
    this.panY = (1 - k) * w.y + k * this.panY;
    this.scale = newScale;
    this.applyTransforms();
  }

  handlePointerDown(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const surface = this.surfaceForEvent(e);
    this._drag = { x: e.clientX, y: e.clientY, angle: this.angleForSurface(surface) };
    const overlay = this.currentOverlay();
    if (overlay) {
      overlay.classList.add("drm-dragging");
      try { overlay.setPointerCapture(e.pointerId); } catch (err) {}
    }
  }

  handlePointerMove(e) {
    if (!this._drag) return;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    this._drag.x = e.clientX;
    this._drag.y = e.clientY;
    // Convert screen movement into "view-relative" movement
    const angle = this._drag.angle;
    // Invert rotation so movement matches what the user sees
    const d = DualWindow.rotateDelta(dx, dy, angle);
    this.panX += d.x;
    this.panY += d.y;
    this.applyTransforms();
  }

  handlePointerUp(e) {
    this._drag = null;
    const overlay = this.currentOverlay();
    if (overlay) {
      overlay.classList.remove("drm-dragging");
      try { overlay.releasePointerCapture(e.pointerId); } catch (err) {}
    }
  }

  resetViewState() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this._drag = null;
  }

  resetView() {
    this.resetViewState();
    this.applyTransforms();
  }

  relayout() {
    this.size();
    this.applyTransforms();
    this.fitText();
  }

  refreshSwap() {
    const overlay = this.currentOverlay();
    if (overlay) overlay.classList.toggle("drm-swap", !!this.config.swap);
    this.relayout();
  }

  // Split direction as an inline style, so it never depends on the injected
  // stylesheet. Row = left/right (landscape dual); column = top/bottom or single.
  applySplit(overlay) {
    const row = this.mode === "dual" && this.config.orientation === "landscape";
    overlay.style.flexDirection = row ? "row" : "column";
  }

  refreshOrientation() {
    const overlay = this.currentOverlay();
    if (overlay) this.applySplit(overlay);
    this.relayout();
  }
  // The refresh* methods restyle the popout live and push the same change
  // to players, so remote colours no longer wait for the next send.
  refreshBackground() {
    const vc = this.contentHost();
    const overlay = vc && vc.querySelector(":scope > .drm-overlay");

    if (overlay) {
      overlay.style.setProperty(
        "--dual-view-background",
        this.config.backgroundColor
      );
    }
    if (this.remote) this.remote.refreshStyle();
  }
  refreshTextColor() {
    const vc = this.contentHost();
    const overlay = vc && vc.querySelector(":scope > .drm-overlay");
    if (overlay) {
      overlay.style.setProperty("--dual-view-text-color", this.config.textColor);
    }
    if (this.remote) this.remote.refreshStyle();
  }
  refreshFont() {
    const vc = this.contentHost();
    const overlay = vc && vc.querySelector(":scope > .drm-overlay");
    if (overlay) {
      overlay.style.setProperty("--dual-view-font", this.config.fontFamily);
    }
    if (this.remote) this.remote.refreshStyle();
    // A font swap changes how much space the text needs, so re-fit it.
    this.relayout();
  }
  savePosition() {
    if (!this.config.rememberPosition) return;
    const ew = this.electron();
    if (!ew) return;
    try {
      const pos = ew.getPosition();
      const sz = ew.getSize();
      this.config.hosts[os.hostname()] = {
        x: pos[0],
        y: pos[1],
        width: sz[0],
        height: sz[1],
        fullscreen: ew.isFullScreen(),
        maximized: ew.isMaximized(),
      };
      this.plugin.saveSettings();
    } catch (e) {}
  }

  cleanup() {
    // The popout is gone, however that happened (close button, window X,
    // window-close event), so the remote shouldn't keep showing its content.
    if (this.remote) this.remote.clearRemote();
    if (this.observer) this.observer.disconnect();
    if (this.popup) {
      try { this.popup.removeEventListener("resize", this.boundSize); } catch (e) {}
    }
    this._drag = null;
    this.leaf = null;
    this.container = null;
    this.doc = null;
    this.popup = null;
    this.observer = null;
  }

  // Blank the window to just its background colour, keeping the popout open.
  // Used by "Clear ambient" so a scene can be dropped without closing the
  // second screen. No-op if the window isn't open. Does not touch the remote;
  // callers clear that separately so the two stay in step.
  showBlank() {
    if (!this.container) return;
    this.contentKind = "blank";
    this.currentText = null;
    const vc = this.contentHost();
    if (!vc || !this.doc) return;
    vc.classList.add("drm-active");
    const existing = vc.querySelector(":scope > .drm-overlay");
    if (existing) existing.remove();
    const overlay = this.doc.createElement("div");
    overlay.className = "drm-overlay drm-single";
    overlay.dataset.mode = this.mode;
    overlay.dataset.kind = "blank";
    overlay.style.setProperty("--dual-view-background", this.config.backgroundColor);
    vc.appendChild(overlay);
  }

  close() {
    const ew = this.electron();
    if (ew) { try { ew.close(); } catch (e) {} }
    this.cleanup();
  }
}

// Simple yes/no prompt, used before anything that would cut players off.
// Calls onResult(true) on confirm, onResult(false) however else it closes.
class ConfirmModal extends Modal {
  constructor(app, message, cta, onResult) {
    super(app);
    this.message = message;
    this.cta = cta;
    this.onResult = onResult;
    this.confirmed = false;
  }

  onOpen() {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText(this.cta).setCta().onClick(() => {
          this.confirmed = true;
          this.close();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
    this.onResult(this.confirmed);
  }
}

// Fuzzy search over every image in the vault, like the wikilink picker.
class ImagePickerModal extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Search for an image\u2026");
  }

  getItems() {
    return this.app.vault.getFiles().filter(isImage);
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    this.onChoose(file);
  }
}

// Docked tab in the main window, in three fixed sections: the player link,
// the main screen (one sub-tab per sent image/text item plus its look), and
// the ambient screen. Each screen's buttons only ever drive that screen, so
// there's no hidden "which window am I controlling" mode to trip over.
// Session-only: nothing here is persisted except the settings it edits.
class DualViewController extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.opened = false;
    this.linkStatusEl = null;
  }

  getViewType() { return VIEW_TYPE_CONTROLLER; }
  getDisplayText() { return "Dual View controller"; }
  getIcon() { return "layout-dashboard"; }

  async onOpen() {
    this.opened = true;
    this.contentEl.addClass("dual-view-controller");
    this.render();
  }

  onClose() {
    this.opened = false;
    this.linkStatusEl = null;
    return Promise.resolve();
  }

  // Rebuilds everything from current plugin state. Cheap enough to call
  // after every change rather than diffing.
  render() {
    if (!this.opened) return;
    const root = this.contentEl;
    root.empty();
    this.renderPlayers(root);
    this.renderMain(root);
    this.renderAmbient(root);
  }

  section(parent, title, kind) {
    const el = parent.createDiv({
      cls: "dual-view-controller__section dual-view-controller__section--" + kind,
    });
    el.createEl("h4", { cls: "dual-view-controller__heading", text: title });
    return el;
  }

  renderPlayers(root) {
    const plugin = this.plugin;
    const sec = this.section(root, "Players", "players");
    const row = sec.createDiv({ cls: "dual-view-controller__row" });
    const newBtn = row.createEl("button", { cls: "mod-cta", text: "New player link" });
    newBtn.title = "Starts a fresh room and copies its link. Anyone on the old link is disconnected.";
    newBtn.onclick = () => plugin.newPlayerLink();
    const copyBtn = row.createEl("button", { text: "Copy current link" });
    copyBtn.onclick = () => plugin.copyPlayerLink();
    this.linkStatusEl = sec.createDiv({ cls: "dual-view-controller__status" });
    this.updateLinkStatus();
  }

  // Updated in place as players come and go, so a colour picker mid-drag
  // isn't torn down by a full re-render.
  updateLinkStatus() {
    if (!this.linkStatusEl) return;
    const plugin = this.plugin;
    const s = plugin.settings;
    let text;
    if (!(s.viewerBaseUrl || "").trim()) {
      text = "Set the viewer page URL in Dual View settings first.";
    } else if (!s.broadcast) {
      text = "Broadcast is off. \"New player link\" turns it on.";
    } else {
      const hub = plugin.hub;
      const state = {
        online: "Room online",
        connecting: "Opening room\u2026",
        reconnecting: "Reconnecting\u2026",
        off: "Room closed",
      }[hub.state] || hub.state;
      text = state + " \u00B7 " + hub.playerCount("main") + " on main, " +
        hub.playerCount("ambient") + " on ambient";
      if (!(s.owlbearUrl || "").trim()) text += " \u00B7 no Owlbear link set";
    }
    this.linkStatusEl.setText(text);
  }

  // One sub-tab per item sent to a screen, plus a "Showing" line. Clicking
  // a tab puts it back up; the cross only removes it from the list.
  renderTabs(sec, items, currentId, activate, close, emptyText) {
    const tabs = sec.createDiv({ cls: "dual-view-controller__tabs" });
    if (!items.length) {
      tabs.createDiv({ cls: "dual-view-controller__empty", text: emptyText });
    } else {
      for (const item of items) {
        const tab = tabs.createDiv({
          cls: "dual-view-controller__tab" + (item.id === currentId ? " is-active" : ""),
        });
        const main = tab.createEl("button", { cls: "dual-view-controller__tab-main", text: item.title });
        main.onclick = () => activate(item.id);
        const x = tab.createEl("button", { cls: "dual-view-controller__tab-close", text: "\u00D7" });
        x.onclick = (e) => { e.preventDefault(); e.stopPropagation(); close(item.id); };
      }
    }
    const current = items.find((i) => i.id === currentId);
    sec.createDiv({
      cls: "dual-view-controller__status",
      text: current ? "Showing: " + current.title : "No active item.",
    });
  }

  renderMain(root) {
    const plugin = this.plugin;
    const sec = this.section(root, "Main screen", "main");

    this.renderTabs(sec, plugin.screenItems, plugin.currentItemId,
      (id) => plugin.activateItem(id), (id) => plugin.closeItem(id), "Nothing sent yet.");

    this.renderWindowControls(sec, plugin.dual, plugin.settings, false);

    const saveRow = sec.createDiv({ cls: "dual-view-controller__row" });
    const presetNameInput = saveRow.createEl("input", { attr: { type: "text", placeholder: "New preset name" } });
    const savePresetBtn = saveRow.createEl("button", { text: "Save as preset" });
    savePresetBtn.onclick = async () => {
      const name = presetNameInput.value.trim();
      if (!name) {
        new Notice("Enter a preset name first.", 1500);
        return;
      }
      const cfg = plugin.settings;
      plugin.settings.presets[name] = {
        backgroundColor: cfg.backgroundColor,
        textColor: cfg.textColor,
        fontFamily: cfg.fontFamily,
      };
      await plugin.saveSettings();
      this.render();
    };
  }

  renderAmbient(root) {
    const plugin = this.plugin;
    const sec = this.section(root, "Ambient screen", "ambient");

    this.renderTabs(sec, plugin.ambientItems, plugin.currentAmbientId,
      (id) => plugin.activateAmbientItem(id), (id) => plugin.closeAmbientItem(id), "No scenes yet.");

    // Premade scenes from settings. Picking one puts it up straight away.
    const sceneRow = sec.createDiv({ cls: "dual-view-controller__row" });
    sceneRow.createSpan({ text: "Scene:" });
    const scenes = plugin.settings.ambient.scenes;
    const sceneSelect = sceneRow.createEl("select");
    sceneSelect.createEl("option", {
      text: scenes.length ? "Choose a premade scene\u2026" : "No premade scenes (add in settings)",
      value: "",
    });
    scenes.forEach((scene, i) => {
      sceneSelect.createEl("option", { text: scene.name || scene.path || "Untitled", value: String(i) });
    });
    sceneSelect.disabled = !scenes.length;
    sceneSelect.onchange = () => {
      const scene = scenes[Number(sceneSelect.value)];
      if (scene) plugin.sendAmbientScene(scene);
    };
    const clearBtn = sceneRow.createEl("button", { text: "Clear scene" });
    clearBtn.onclick = () => plugin.clearAmbient();

    this.renderWindowControls(sec, plugin.ambient, plugin.settings.ambient, true);
  }

  // The buttons, colours and preset picker for one screen. Text colour and
  // font only apply to text tabs, which never reach the image-only ambient
  // screen, so they're main-only.
  renderWindowControls(sec, win, cfg, isAmbient) {
    const plugin = this.plugin;
    const which = isAmbient ? "ambient" : "main";

    const row = sec.createDiv({ cls: "dual-view-controller__row" });

    const swapBtn = row.createEl("button", { text: "Swap sides: " + (cfg.swap ? "On" : "Off") });
    swapBtn.onclick = async () => {
      cfg.swap = !cfg.swap;
      await plugin.saveSettings();
      win.refreshSwap();
      this.render();
    };

    const modeBtn = row.createEl("button", { text: "Mode: " + (win.mode === "single" ? "Single" : "Dual") });
    modeBtn.onclick = async () => {
      if (isAmbient) await plugin.toggleAmbientMode();
      else await plugin.toggleMode();
      this.render();
    };

    const orientBtn = row.createEl("button", {
      text: "Orientation: " + (cfg.orientation === "landscape" ? "Landscape" : "Portrait"),
    });
    orientBtn.onclick = async () => {
      cfg.orientation = cfg.orientation === "landscape" ? "portrait" : "landscape";
      await plugin.saveSettings();
      win.refreshOrientation();
      this.render();
    };

    const closeBtn = row.createEl("button", { text: "Close " + which + " window" });
    closeBtn.onclick = () => {
      if (isAmbient) plugin.closeAmbient();
      else win.close();
      this.render();
    };

    const colorRow = sec.createDiv({ cls: "dual-view-controller__row" });
    colorRow.createSpan({ text: "Background:" });
    const colorInput = colorRow.createEl("input", { attr: { type: "color" } });
    colorInput.value = cfg.backgroundColor;
    colorInput.oninput = () => {
      cfg.backgroundColor = colorInput.value;
      plugin.saveSettingsSoon();
      win.refreshBackground();
    };

    if (!isAmbient) {
      colorRow.createSpan({ text: "Text:" });
      const textColorInput = colorRow.createEl("input", { attr: { type: "color" } });
      textColorInput.value = cfg.textColor;
      textColorInput.oninput = () => {
        cfg.textColor = textColorInput.value;
        plugin.saveSettingsSoon();
        win.refreshTextColor();
      };

      const fontRow = sec.createDiv({ cls: "dual-view-controller__row" });
      fontRow.createSpan({ text: "Font:" });
      const fontKnown = FONT_OPTIONS.some(([v]) => v === cfg.fontFamily);
      const fontSelect = fontRow.createEl("select");
      for (const [value, label] of FONT_OPTIONS) {
        const opt = fontSelect.createEl("option", { text: label, value });
        if (fontKnown && value === cfg.fontFamily) opt.selected = true;
      }
      const customFontOpt = fontSelect.createEl("option", { text: "Custom\u2026", value: "custom" });
      if (!fontKnown) customFontOpt.selected = true;
      fontSelect.onchange = async () => {
        const value = fontSelect.value;
        if (value !== "custom") {
          cfg.fontFamily = value;
        } else if (fontKnown) {
          cfg.fontFamily = "";
        }
        await plugin.saveSettings();
        win.refreshFont();
        this.render();
      };
      if (!fontKnown) {
        const customFontInput = fontRow.createEl("input", { attr: { type: "text", placeholder: "Font name" } });
        customFontInput.value = cfg.fontFamily === "inherit" ? "" : cfg.fontFamily;
        customFontInput.oninput = () => {
          cfg.fontFamily = customFontInput.value.trim() || "inherit";
          plugin.saveSettingsSoon();
          win.refreshFont();
        };
      }
    }

    // Presets are global. On the ambient screen only the background applies.
    const presetRow = sec.createDiv({ cls: "dual-view-controller__row" });
    presetRow.createSpan({ text: "Preset:" });
    const presetNames = Object.keys(plugin.settings.presets).sort();
    const presetSelect = presetRow.createEl("select");
    presetSelect.createEl("option", { text: presetNames.length ? "Choose\u2026" : "No presets saved", value: "" });
    for (const name of presetNames) {
      presetSelect.createEl("option", { text: name, value: name });
    }
    presetSelect.disabled = !presetNames.length;
    presetSelect.onchange = async () => {
      const name = presetSelect.value;
      const preset = name && plugin.settings.presets[name];
      if (!preset) return;
      cfg.backgroundColor = preset.backgroundColor;
      win.refreshBackground();
      if (!isAmbient) {
        cfg.textColor = preset.textColor;
        cfg.fontFamily = preset.fontFamily;
        win.refreshTextColor();
        win.refreshFont();
      }
      await plugin.saveSettings();
      this.render();
    };
  }
}

module.exports = class DualViewPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // Sent-item history for the controller tab strip. Session-only by
    // design: it resets whenever Obsidian restarts, same as Player Screen.
    this.screenItems = [];
    this.currentItemId = null;

    // Same idea for the ambient screen: every scene set this session, each
    // remembering its own mode, so earlier scenes are one click away.
    this.ambientItems = [];
    this.currentAmbientId = null;

    // For colour pickers and other rapid-fire inputs: one disk write once
    // the input settles, not one per tick of the drag.
    this.saveSettingsSoon = debounce(() => this.saveSettings(), 500, true);

    this.registerView(VIEW_TYPE_CONTROLLER, (leaf) => new DualViewController(leaf, this));

    // One player room for both windows. Each window gets its own channel,
    // reading its own settings bag, so the main and ambient screens stay
    // independent while players need only one link.
    this.hub = new RemoteHub(this);
    this.dual = new DualWindow(this, this.settings, this.hub.channel("main", this.settings));
    this.ambient = new DualWindow(this, this.settings.ambient, this.hub.channel("ambient", this.settings.ambient));
    // Ambient scene art defaults to a single upright image, not the split.
    this.ambient.mode = "single";

    // Premade scenes store a vault path, so follow the image (or a folder
    // above it) when it's renamed or moved rather than silently breaking.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        let changed = false;
        for (const scene of this.settings.ambient.scenes) {
          if (file instanceof TFile && scene.path === oldPath) {
            scene.path = file.path;
            changed = true;
          } else if (file instanceof TFolder && scene.path.startsWith(oldPath + "/")) {
            scene.path = file.path + scene.path.slice(oldPath.length);
            changed = true;
          }
        }
        if (changed) {
          this.saveSettings();
          this.refreshController();
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("window-close", (w) => {
        for (const win of [this.dual, this.ambient]) {
          if (w === win.container) win.cleanup();
        }
      })
    );

    const styleEl = document.createElement("style");
    styleEl.id = "dual-view-controller-style";
    styleEl.textContent = CONTROLLER_STYLE;
    document.head.appendChild(styleEl);
    this.register(() => styleEl.remove());

    // Right-click an image file in the explorer or a tab (shared menu, no clash).
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (
          this.app.vault.adapter instanceof FileSystemAdapter &&
          file instanceof TFile &&
          isImage(file)
        ) {
          menu.addItem((i) =>
            i.setTitle("Open in dual view").setIcon("monitor").onClick(() => this.sendImage(file, "dual"))
          );
          menu.addItem((i) =>
            i.setTitle("Open in single view").setIcon("image").onClick(() => this.sendImage(file, "single"))
          );
          menu.addItem((i) =>
            i.setTitle("Set as ambient scene").setIcon("sunrise").onClick(() => this.sendAmbientImage(file))
          );
        }
      })
    );

    // Right-click an image embedded in a note (including Meta Bind renders).
    // preventDefault only suppresses the native menu; we deliberately never
    // call stopPropagation or stopImmediatePropagation, so Meta Bind's own
    // handling of this event is untouched and bound inputs keep saving.
    // With Second Window also enabled, its listener fires too and the two
    // menus can occasionally clash; this is a known trade-off, not a bug.
    this.registerDomEvent(document, "contextmenu", (e) => {
      const t = e.target;
      if (!t) return;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;

      // Image path: unchanged from before.
      if (t.localName === "img") {
        const src = t.currentSrc || t.src;
        let file = null;
        try { file = this.app.vault.resolveFileUrl(src); } catch (err) { file = null; }
        if (file instanceof TFile) {
          e.preventDefault();
          const menu = new Menu();
          menu.addItem((i) =>
            i.setTitle("Open in dual view").setIcon("monitor").onClick(() => this.sendImage(file, "dual"))
          );
          menu.addItem((i) =>
            i.setTitle("Open in single view").setIcon("image").onClick(() => this.sendImage(file, "single"))
          );
          menu.addItem((i) =>
            i.setTitle("Set as ambient scene").setIcon("sunrise").onClick(() => this.sendAmbientImage(file))
          );
          this.addSecondWindowItems(menu, file);
          menu.showAtPosition({ x: e.pageX, y: e.pageY });
          return;
        }
      }

      // Text-selection path: Reading mode only, since the editing surface
      // is excluded by the contenteditable check above (deliberately, to
      // stay clear of the Meta Bind issue). Edit mode gets its own hook
      // via the editor-menu event instead, registered separately below.
      const selected = window.getSelection ? window.getSelection().toString().trim() : "";
      if (selected) {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((i) =>
          i.setTitle("Send selection to Dual View").setIcon("monitor-up").onClick(() => this.sendText(selected))
        );
        menu.showAtPosition({ x: e.pageX, y: e.pageY });
      }
    });

    // Edit-mode equivalent. This is Obsidian's own menu-construction hook
    // for the editor's right-click menu, entirely separate from the raw DOM
    // listener above, so it doesn't risk the same propagation conflict
    // that broke Meta Bind's input commits previously.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selected = editor.getSelection();
        if (!selected || !selected.trim()) return;
        const text = selected.trim();
        menu.addItem((i) =>
          i.setTitle("Send selection to Dual View").setIcon("monitor-up").onClick(() => this.sendText(text))
        );
      })
    );

    this.addCommand({
      id: "open-active-in-dual-view",
      name: "Open current image in dual view",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = file instanceof TFile && isImage(file);
        if (ok && !checking) this.sendImage(file, "dual");
        return ok;
      },
    });

    this.addCommand({
      id: "open-active-in-single-view",
      name: "Open current image in single view",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = file instanceof TFile && isImage(file);
        if (ok && !checking) this.sendImage(file, "single");
        return ok;
      },
    });

    this.addCommand({
      id: "send-selection-to-dual-view",
      name: "Send selected text to Dual View",
      editorCallback: (editor) => {
        const text = editor.getSelection();
        if (!text || !text.trim()) {
          new Notice("No text selected.", 1500);
          return;
        }
        this.sendText(text.trim());
      },
    });

    this.addCommand({
      id: "toggle-swap-sides",
      name: "Toggle swap sides",
      callback: () => {
        this.settings.swap = !this.settings.swap;
        this.saveSettings();
        this.dual.refreshSwap();
        this.refreshController();
      },
    });

    this.addCommand({
      id: "toggle-screen-orientation",
      name: "Toggle screen orientation (portrait/landscape)",
      callback: () => {
        this.settings.orientation =
          this.settings.orientation === "landscape" ? "portrait" : "landscape";
        this.saveSettings();
        this.dual.refreshOrientation();
        this.refreshController();
      },
    });

    this.addSettingTab(new DualViewSettings(this.app, this));

    // Player room. Deferred to layout-ready so a slow CDN or broker
    // handshake can't drag out Obsidian's startup.
    if (this.settings.broadcast) {
      this.app.workspace.onLayoutReady(() => this.hub.start());
    }

    this.addCommand({
      id: "clear-remote-viewer",
      name: "Clear remote viewer",
      callback: () => {
        this.dual.remote.clearRemote();
        new Notice("Remote viewer cleared.", 2000);
      },
    });

    this.addCommand({
      id: "copy-remote-viewer-link",
      name: "Copy player link",
      callback: () => this.copyPlayerLink(),
    });

    this.addCommand({
      id: "new-player-link",
      name: "New player link (copies it)",
      callback: () => this.newPlayerLink(),
    });

    this.addCommand({
      id: "set-active-as-ambient-scene",
      name: "Set current image as ambient scene",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = file instanceof TFile && isImage(file);
        if (ok && !checking) this.sendAmbientImage(file);
        return ok;
      },
    });

    this.addCommand({
      id: "clear-ambient",
      name: "Clear ambient scene",
      callback: () => this.clearAmbient(),
    });

    this.addCommand({
      id: "close-ambient-window",
      name: "Close ambient window",
      callback: () => this.closeAmbient(),
    });
  }

  // The one link players open: the hosted viewer page plus this session's
  // room. The Owlbear Rodeo room rides along so its button works even before
  // the room connects. The viewer page opens the ambient screen itself.
  viewerLink() {
    const base = (this.settings.viewerBaseUrl || "").trim();
    if (!base) return null;
    let url = base + (base.includes("?") ? "&" : "?") +
      "room=" + encodeURIComponent(this.settings.broadcastRoomId);
    const owlbear = (this.settings.owlbearUrl || "").trim();
    if (owlbear) url += "&obr=" + encodeURIComponent(owlbear);
    return url;
  }

  async copyPlayerLink(message) {
    const url = this.viewerLink();
    if (!url) {
      new Notice("Set the viewer page URL in Dual View settings first.", 4000);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      new Notice(message || "Player link copied.", 2500);
    } catch (e) {
      new Notice("Couldn't reach the clipboard. Player link: " + url, 15000);
    }
  }

  // Starts a fresh room and copies its link, ready to paste to players. A
  // brand-new room ID can't still be held by the broker from an earlier
  // session, which sidesteps the "already in use" stall. Asks first if
  // anyone is connected, since the old link stops working.
  async newPlayerLink() {
    if (!(this.settings.viewerBaseUrl || "").trim()) {
      new Notice("Set the viewer page URL in Dual View settings first.", 4000);
      return;
    }
    const n = this.hub.conns.size;
    if (n) {
      const ok = await new Promise((resolve) => new ConfirmModal(
        this.app,
        n + (n === 1 ? " player is" : " players are") + " connected. A new link disconnects them until they open it.",
        "New link",
        resolve
      ).open());
      if (!ok) return;
    }
    this.settings.broadcastRoomId = makeRoomId();
    this.settings.broadcast = true;
    await this.saveSettings();
    this.hub.restart();
    await this.copyPlayerLink("New player link copied.");
    this.refreshController();
  }

  // --- Ambient window (manual, image-only, fully independent) --------

  // Sends an image to the ambient screen and records it in this session's
  // scene list, reusing the entry if that image was already sent.
  // Deliberately separate from sendImage/sendText so nothing that feeds the
  // main window (right-click, commands, or other plugins via sendImage) can
  // ever land here. The mode is, in order: the one asked for (a premade
  // scene's), the one this image last used, the window's current one.
  async sendAmbientImage(file, mode, title) {
    if (!(file instanceof TFile) || !isImage(file)) return;
    const signature = "image:" + file.path;
    let item = this.ambientItems.find((i) => i.signature === signature);
    const useMode = mode || (item && item.mode) ||
      (this.ambient.container ? this.ambient.mode : "single");
    if (item) {
      item.mode = useMode;
      if (title) item.title = title;
    } else {
      item = { id: makeItemId(), title: title || file.basename, signature, file, mode: useMode };
      this.ambientItems.push(item);
    }
    this.currentAmbientId = item.id;
    await this.ensureControllerLeaf();
    this.refreshController();
    await this.ambient.loadFile(file, useMode);
    new Notice("Ambient scene: " + item.title, 2000);
  }

  // Puts up a premade scene from settings, in its own mode.
  async sendAmbientScene(scene) {
    const file = this.app.vault.getAbstractFileByPath(scene.path || "");
    if (!(file instanceof TFile) || !isImage(file)) {
      new Notice("Ambient scene \"" + (scene.name || "Untitled") + "\": image not found at " + (scene.path || "(no path)") + ".", 5000);
      this.refreshController();
      return;
    }
    await this.sendAmbientImage(file, scene.mode === "dual" ? "dual" : "single", scene.name || file.basename);
  }

  // Switches the ambient screen back to a scene from earlier this session.
  async activateAmbientItem(id) {
    const item = this.ambientItems.find((i) => i.id === id);
    if (!item) return;
    await this.sendAmbientImage(item.file, item.mode, item.title);
  }

  // Removes a scene from the list. The screen keeps showing it if it's up,
  // same as the main screen's tabs.
  closeAmbientItem(id) {
    const idx = this.ambientItems.findIndex((i) => i.id === id);
    if (idx < 0) return;
    if (this.ambientItems[idx].id === this.currentAmbientId) this.currentAmbientId = null;
    this.ambientItems.splice(idx, 1);
    this.refreshController();
  }

  // Blanks the ambient screen to its background and clears its remote room,
  // leaving the window open for the next scene. No-op if it isn't open.
  clearAmbient() {
    this.ambient.remote.clearRemote();
    if (this.ambient.container) this.ambient.showBlank();
    this.currentAmbientId = null;
    this.refreshController();
  }

  closeAmbient() {
    this.ambient.close();
    this.currentAmbientId = null;
    this.refreshController();
  }

  // Flips the ambient window between single and dual. With a scene up, that
  // scene is re-sent in the new mode and remembers it; otherwise it just sets
  // what the next scene will use.
  async toggleAmbientMode() {
    const newMode = this.ambient.mode === "single" ? "dual" : "single";
    const current = this.ambientItems.find((i) => i.id === this.currentAmbientId);
    if (current) {
      current.mode = newMode;
      await this.ambient.loadFile(current.file, newMode);
    } else {
      this.ambient.mode = newMode;
    }
    this.refreshController();
  }

  onunload() {
    if (this.hub) this.hub.destroy();
    if (this.dual) this.dual.close();
    if (this.ambient) this.ambient.close();
  }

  // --- Controller tab management ------------------------------------

  // Finds any open controller leaf, or opens one as a new tab in the main
  // window. There's only ever meant to be one.
  async ensureControllerLeaf() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTROLLER);
    if (existing.length) {
      await this.app.workspace.revealLeaf(existing[0]);
      return existing[0];
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CONTROLLER, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  // Tells any open controller view to redraw. Cheap, so callers don't need
  // to worry about batching.
  refreshController() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTROLLER)) {
      if (leaf.view && typeof leaf.view.render === "function") leaf.view.render();
    }
  }

  // Just the player status line, for room and connection changes.
  refreshControllerStatus() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTROLLER)) {
      if (leaf.view && typeof leaf.view.updateLinkStatus === "function") leaf.view.updateLinkStatus();
    }
  }

  // Sends an image, creating a new tab or reusing the existing one for that
  // file. `mode` becomes that item's own dual/single setting, restored
  // whenever you switch back to it.
  async sendImage(file, mode) {
    const signature = "image:" + file.path;
    let item = this.screenItems.find((i) => i.signature === signature);
    if (item) {
      item.title = file.basename;
      item.data = { file, mode };
    } else {
      item = { id: makeItemId(), kind: "image", title: file.basename, signature, data: { file, mode } };
      this.screenItems.push(item);
    }
    this.currentItemId = item.id;
    await this.ensureControllerLeaf();
    this.refreshController();
    await this.dual.loadFile(file, mode);
  }

  // Sends a text snippet. Always creates a new tab, since two sends are
  // almost always two different riddles, not edits to the same one. Uses
  // whatever dual/single mode the window is already in (or "dual" if it
  // isn't open yet), per the "text mirrors current state" rule.
  async sendText(text) {
    const item = {
      id: makeItemId(),
      kind: "text",
      title: titleForText(text),
      signature: null,
      data: { text },
    };
    this.screenItems.push(item);
    this.currentItemId = item.id;
    await this.ensureControllerLeaf();
    this.refreshController();
    const mode = this.dual.container ? this.dual.mode : "dual";
    await this.dual.showText(text, mode);
  }

  // Switches the popout to a different sent item without re-sending it.
  async activateItem(id) {
    const item = this.screenItems.find((i) => i.id === id);
    if (!item) return;
    this.currentItemId = id;
    this.refreshController();
    if (item.kind === "image") {
      await this.dual.loadFile(item.data.file, item.data.mode);
    } else {
      const mode = this.dual.container ? this.dual.mode : "dual";
      await this.dual.showText(item.data.text, mode);
    }
  }

  // Flips dual/single for whatever's currently showing. For an image, this
  // becomes the tab's new remembered mode going forward. For text, there's
  // nothing to remember, it just changes the window's live mode. With
  // nothing active yet, it just sets what the next thing sent will use.
  async toggleMode() {
    const current = this.screenItems.find((i) => i.id === this.currentItemId);
    const newMode = this.dual.mode === "single" ? "dual" : "single";
    if (!current) {
      this.dual.mode = newMode;
    } else if (current.kind === "image") {
      current.data.mode = newMode;
      await this.dual.loadFile(current.data.file, newMode);
    } else {
      await this.dual.showText(current.data.text, newMode);
    }
    this.refreshController();
  }

  // Removes a tab. Per your call: if it wasn't the active one, the popout
  // is untouched. If it was, the popout just keeps showing its last frame
  // until you pick a different tab — no auto-blank.
  closeItem(id) {
    const idx = this.screenItems.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const wasCurrent = this.screenItems[idx].id === this.currentItemId;
    this.screenItems.splice(idx, 1);
    if (wasCurrent) this.currentItemId = null;
    this.refreshController();
  }

  // Locate the Second Window plugin by the shape of its API, not its id.
  findSecondWindow() {
    const ps = this.app.plugins && this.app.plugins.plugins;
    if (!ps) return null;
    for (const id in ps) {
      const p = ps[id];
      if (p && p.defaultWindow && typeof p.defaultWindow.loadFile === "function") return p;
    }
    return null;
  }

  // Mirror Second Window's own image menu items into our single menu.
  addSecondWindowItems(menu, file) {
    const sw = this.findSecondWindow();
    if (!sw) return;
    try {
      if (sw.defaultWindow && typeof sw.defaultWindow.loadFile === "function") {
        menu.addItem((i) =>
          i.setTitle("Open in new window")
            .setIcon("open-elsewhere-glyph")
            .onClick(() => sw.defaultWindow.loadFile(file))
        );
      }
      const wins = sw.settings && sw.settings.windows;
      if (wins) {
        for (const name of Object.keys(wins)) {
          if (name === "Second Window") continue; // the default, already added above
          const entry = wins[name];
          const inst = sw.windows && sw.windows.get && sw.windows.get(entry.id);
          if (inst && typeof inst.loadFile === "function") {
            menu.addItem((i) =>
              i.setTitle(`Open in window '${name}'`)
                .setIcon("open-elsewhere-glyph")
                .onClick(() => inst.loadFile(file))
            );
          }
        }
      }
    } catch (err) {}
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    if (!this.settings.hosts) this.settings.hosts = {};
    // The native colour input only accepts a strict #rrggbb hex string.
    // If an older or hand-edited value (e.g. a named colour) snuck into
    // storage, fall back to the default rather than leaving the picker
    // in a desynced state.
    if (!/^#[0-9a-fA-F]{6}$/.test(this.settings.backgroundColor)) {
      this.settings.backgroundColor = DEFAULTS.backgroundColor;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(this.settings.textColor)) {
      this.settings.textColor = DEFAULTS.textColor;
    }
    if (!this.settings.fontFamily || !this.settings.fontFamily.trim()) {
      this.settings.fontFamily = DEFAULTS.fontFamily;
    }
    if (!this.settings.presets || typeof this.settings.presets !== "object") {
      this.settings.presets = {};
    }
    if (typeof this.settings.broadcast !== "boolean") {
      this.settings.broadcast = DEFAULTS.broadcast;
    }
    if (typeof this.settings.viewerBaseUrl !== "string") {
      this.settings.viewerBaseUrl = "";
    }
    if (typeof this.settings.owlbearUrl !== "string") {
      this.settings.owlbearUrl = "";
    }
    // Generated once, then stable forever so the player's bookmark keeps
    // working. Regeneration is an explicit button in settings.
    if (!this.settings.broadcastRoomId) {
      this.settings.broadcastRoomId = makeRoomId();
      await this.saveData(this.settings);
    }

    // Ambient window's own bag. Filled from AMBIENT_DEFAULTS on first run,
    // then validated the same way as the main settings above so its colour
    // pickers stay well-formed.
    this.settings.ambient = Object.assign({}, AMBIENT_DEFAULTS, this.settings.ambient || {});
    // Ambient used to have a room of its own; it now shares the main one.
    delete this.settings.ambient.broadcastRoomId;
    if (!this.settings.ambient.hosts || typeof this.settings.ambient.hosts !== "object") {
      this.settings.ambient.hosts = {};
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(this.settings.ambient.backgroundColor)) {
      this.settings.ambient.backgroundColor = AMBIENT_DEFAULTS.backgroundColor;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(this.settings.ambient.textColor)) {
      this.settings.ambient.textColor = AMBIENT_DEFAULTS.textColor;
    }
    if (!this.settings.ambient.fontFamily || !this.settings.ambient.fontFamily.trim()) {
      this.settings.ambient.fontFamily = AMBIENT_DEFAULTS.fontFamily;
    }
    if (typeof this.settings.ambient.broadcast !== "boolean") {
      this.settings.ambient.broadcast = AMBIENT_DEFAULTS.broadcast;
    }
    // Premade scenes: keep well-formed entries only, each with a mode.
    const scenes = Array.isArray(this.settings.ambient.scenes) ? this.settings.ambient.scenes : [];
    this.settings.ambient.scenes = scenes
      .filter((sc) => sc && typeof sc === "object")
      .map((sc) => ({
        name: typeof sc.name === "string" ? sc.name : "",
        path: typeof sc.path === "string" ? sc.path : "",
        mode: sc.mode === "dual" ? "dual" : "single",
      }));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};

class DualViewSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
	
	new Setting(containerEl)
	  .setName("Background colour")
      .setDesc("Background colour shown behind the image.")
	  .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings.backgroundColor)
          .onChange(async (value) => {
		    this.plugin.settings.backgroundColor = value;
            await this.plugin.saveSettings();
            this.plugin.dual.refreshBackground();
            this.plugin.refreshController();
        })
      );
    new Setting(containerEl)
      .setName("Text colour")
      .setDesc("Colour of text sent to Dual View. Independent of the background colour.")
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings.textColor)
          .onChange(async (value) => {
            this.plugin.settings.textColor = value;
            await this.plugin.saveSettings();
            this.plugin.dual.refreshTextColor();
            this.plugin.refreshController();
        })
      );

    const knownFont = FONT_OPTIONS.some(([v]) => v === this.plugin.settings.fontFamily);
    new Setting(containerEl)
      .setName("Font")
      .setDesc("Font used for text sent to Dual View. Obsidian default inherits your current theme's font.")
      .addDropdown((dd) => {
        for (const [value, label] of FONT_OPTIONS) dd.addOption(value, label);
        dd.addOption("custom", "Custom\u2026");
        dd.setValue(knownFont ? this.plugin.settings.fontFamily : "custom");
        dd.onChange(async (value) => {
          if (value !== "custom") {
            this.plugin.settings.fontFamily = value;
          } else if (knownFont) {
            // Switching into custom mode from a known value: clear it so
            // the custom field starts empty rather than re-snapping back.
            this.plugin.settings.fontFamily = "";
          }
          await this.plugin.saveSettings();
          this.plugin.dual.refreshFont();
          this.plugin.refreshController();
          this.display(); // redraw to show/hide the custom field
        });
      });

    if (!knownFont) {
      new Setting(containerEl)
        .setName("Custom font name")
        .setDesc("Any font-family value, e.g. a font installed on this computer.")
        .addText((t) =>
          t
            .setPlaceholder("e.g. 'Cormorant Garamond', serif")
            .setValue(this.plugin.settings.fontFamily === "inherit" ? "" : this.plugin.settings.fontFamily)
            .onChange(async (value) => {
              this.plugin.settings.fontFamily = value.trim() || "inherit";
              await this.plugin.saveSettings();
              this.plugin.dual.refreshFont();
              this.plugin.refreshController();
            })
        );
    }

    new Setting(containerEl)
      .setName("Swap sides")
      .setDesc("Dual view: flips which half rotates which way. Single view: rotates the image 180 degrees.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.swap).onChange(async (v) => {
          this.plugin.settings.swap = v;
          await this.plugin.saveSettings();
          this.plugin.dual.refreshSwap();
          this.plugin.refreshController();
        })
      );

    new Setting(containerEl)
      .setName("Landscape orientation")
      .setDesc("On for a landscape screen: single view is upright, dual view splits left/right. Off for portrait: single view is quarter-turned, dual view splits top/bottom.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.orientation === "landscape").onChange(async (v) => {
          this.plugin.settings.orientation = v ? "landscape" : "portrait";
          await this.plugin.saveSettings();
          this.plugin.dual.refreshOrientation();
          this.plugin.refreshController();
        })
      );

    new Setting(containerEl)
      .setName("Remember window position")
      .setDesc("Save the dual view window position and size per computer, so it reopens on the same monitor.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.rememberPosition).onChange(async (v) => {
          this.plugin.settings.rememberPosition = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Players").setHeading();

    new Setting(containerEl)
      .setName("Broadcast to players")
      .setDesc("Everything sent to the popouts is also pushed to anyone with the player link. Nothing is stored on their machine or any server.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.broadcast).onChange(async (v) => {
          this.plugin.settings.broadcast = v;
          await this.plugin.saveSettings();
          if (v) {
            this.plugin.hub.start();
          } else {
            this.plugin.hub.stop();
          }
          this.plugin.refreshControllerStatus();
        })
      );

    new Setting(containerEl)
      .setName("Mirror ambient screen")
      .setDesc("Players can open the ambient screen from the viewer page. Turn off to keep ambient scenes on your table only.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.ambient.broadcast).onChange(async (v) => {
          this.plugin.settings.ambient.broadcast = v;
          await this.plugin.saveSettings();
          if (!v) this.plugin.ambient.remote.clearRemote();
        })
      );

    new Setting(containerEl)
      .setName("Viewer page URL")
      .setDesc("Where the viewer page is hosted, e.g. your GitHub Pages address. Used to build the player link.")
      .addText((t) =>
        t
          .setPlaceholder("https://username.github.io/dual-view-viewer/")
          .setValue(this.plugin.settings.viewerBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.viewerBaseUrl = value.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshControllerStatus();
          })
      );

    new Setting(containerEl)
      .setName("Owlbear Rodeo URL")
      .setDesc("Your Owlbear Rodeo room. Players get an \"Open Owlbear Rodeo\" button on the viewer page, so it's one link for everything.")
      .addText((t) =>
        t
          .setPlaceholder("https://www.owlbear.rodeo/room/...")
          .setValue(this.plugin.settings.owlbearUrl)
          .onChange(async (value) => {
            this.plugin.settings.owlbearUrl = value.trim();
            await this.plugin.saveSettings();
            this.plugin.hub.helloAll();
            this.plugin.refreshControllerStatus();
          })
      );

    new Setting(containerEl)
      .setName("Player link")
      .setDesc("Room: " + this.plugin.settings.broadcastRoomId + ". \"New link\" starts a fresh room and copies it; anyone on the old link is disconnected.")
      .addButton((b) =>
        b.setButtonText("Copy link").onClick(() => this.plugin.copyPlayerLink())
      )
      .addButton((b) =>
        b.setButtonText("New link").setCta().onClick(async () => {
          await this.plugin.newPlayerLink();
          this.display();
        })
      );

    new Setting(containerEl).setName("Ambient scenes").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Premade scenes for the ambient screen, picked from the controller's Scene dropdown. Each has a name, an image from your vault and the mode it opens in.",
    });

    const scenes = this.plugin.settings.ambient.scenes;
    const saveScenes = async (redraw) => {
      await this.plugin.saveSettings();
      this.plugin.refreshController();
      if (redraw) this.display();
    };
    const pickImage = (onPick) => new ImagePickerModal(this.app, onPick).open();

    scenes.forEach((scene, i) => {
      const file = scene.path ? this.app.vault.getAbstractFileByPath(scene.path) : null;
      const found = file instanceof TFile;
      new Setting(containerEl)
        .setDesc(!scene.path ? "No image chosen" : found ? scene.path : "Image not found: " + scene.path)
        .addText((t) =>
          t
            .setPlaceholder("Scene name")
            .setValue(scene.name)
            .onChange((v) => {
              scene.name = v.trim();
              this.plugin.saveSettingsSoon();
              this.plugin.refreshController();
            })
        )
        .addButton((b) =>
          b.setButtonText(found ? "Change image" : "Choose image").onClick(() =>
            pickImage((f) => {
              scene.path = f.path;
              if (!scene.name) scene.name = f.basename;
              saveScenes(true);
            })
          )
        )
        .addDropdown((d) =>
          d
            .addOption("single", "Single")
            .addOption("dual", "Dual")
            .setValue(scene.mode)
            .onChange((v) => {
              scene.mode = v === "dual" ? "dual" : "single";
              saveScenes(false);
            })
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip("Delete scene").onClick(() => {
            scenes.splice(i, 1);
            saveScenes(true);
          })
        );
    });

    // Adding starts with the picker, so a new scene always has an image; the
    // name defaults to the file name and can be edited in its row.
    new Setting(containerEl)
      .setDesc(scenes.length ? "" : "No premade scenes yet.")
      .addButton((b) =>
        b.setButtonText("Add scene").setCta().onClick(() =>
          pickImage((f) => {
            scenes.push({ name: f.basename, path: f.path, mode: "single" });
            saveScenes(true);
          })
        )
      );

    new Setting(containerEl).setName("Presets").setHeading();

    let newPresetName = "";
    new Setting(containerEl)
      .setName("Save current as preset")
      .setDesc("Saves the current background, text colour, and font under this name. Saving under an existing name overwrites it.")
      .addText((t) => t.setPlaceholder("Preset name").onChange((v) => { newPresetName = v; }))
      .addButton((b) =>
        b.setButtonText("Save").onClick(async () => {
          const name = newPresetName.trim();
          if (!name) {
            new Notice("Enter a preset name first.", 1500);
            return;
          }
          this.plugin.settings.presets[name] = {
            backgroundColor: this.plugin.settings.backgroundColor,
            textColor: this.plugin.settings.textColor,
            fontFamily: this.plugin.settings.fontFamily,
          };
          await this.plugin.saveSettings();
          this.plugin.refreshController();
          this.display();
        })
      );

    const presetNames = Object.keys(this.plugin.settings.presets).sort();
    if (!presetNames.length) {
      containerEl.createEl("p", { text: "No presets saved yet.", cls: "setting-item-description" });
    } else {
      for (const name of presetNames) {
        const preset = this.plugin.settings.presets[name];
        let renameValue = name;
        new Setting(containerEl)
          .setName(name)
          .addText((t) => t.setValue(name).onChange((v) => { renameValue = v; }))
          .addButton((b) =>
            b.setButtonText("Rename").onClick(async () => {
              const newName = renameValue.trim();
              if (!newName || newName === name) return;
              if (this.plugin.settings.presets[newName]) {
                new Notice("A preset with that name already exists.", 1500);
                return;
              }
              this.plugin.settings.presets[newName] = this.plugin.settings.presets[name];
              delete this.plugin.settings.presets[name];
              await this.plugin.saveSettings();
              this.plugin.refreshController();
              this.display();
            })
          )
          .addButton((b) =>
            b.setButtonText("Apply").onClick(async () => {
              this.plugin.settings.backgroundColor = preset.backgroundColor;
              this.plugin.settings.textColor = preset.textColor;
              this.plugin.settings.fontFamily = preset.fontFamily;
              await this.plugin.saveSettings();
              this.plugin.dual.refreshBackground();
              this.plugin.dual.refreshTextColor();
              this.plugin.dual.refreshFont();
              this.plugin.refreshController();
              this.display();
            })
          )
          .addButton((b) =>
            b.setButtonText("Delete").onClick(async () => {
              delete this.plugin.settings.presets[name];
              await this.plugin.saveSettings();
              this.plugin.refreshController();
              this.display();
            })
          );
      }
    }
  }
}
