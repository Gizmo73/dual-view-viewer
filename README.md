# dual-view-viewer

The player-side viewer for the Dual View Obsidian plugin, hosted on GitHub
Pages. Players open the single link the DM copies from the plugin; the page
shows the DM's main screen and offers buttons for Owlbear Rodeo and the
ambient screen.

- `index.html`: the viewer page. `?room=` is the DM's room, `?obr=` their
  Owlbear Rodeo room, `?view=ambient` the ambient window it opens itself.
- `vendor/peerjs.min.js`: PeerJS 1.5.4 (MIT, see `vendor/PEERJS-LICENSE`),
  served from here so the page doesn't depend on a CDN.
- `plugin/`: the Obsidian plugin. Copy `main.js` and `manifest.json` into
  `<vault>/.obsidian/plugins/dual-view/`.
