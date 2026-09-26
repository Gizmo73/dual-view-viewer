# Dual View

A standalone Obsidian plugin. It does not depend on Second Window and does not
touch it. You can run both side by side.

Right-click an image (in the file explorer, or embedded in a note, including
Meta Bind renders) to open it in a popout window on your second monitor, either
split for two viewers or full-screen for one, with the image rotated to suit
however that screen is physically set up.

## The four screen setups

Two settings, mode (dual or single) and screen orientation (portrait or
landscape), cover every physical arrangement:

| # | Mode   | Orientation | Result                                                          |
|---|--------|-------------|------------------------------------------------------------------|
| 1 | Dual   | Portrait    | Split top/bottom, each half rotated ±90°, for players either side of the long edge (default) |
| 2 | Single | Landscape   | One image, upright, for a wall-mounted or single-viewer screen  |
| 3 | Single | Portrait    | One image, rotated 90°, so it reads landscape to that viewer    |
| 4 | Dual   | Landscape   | Split left/right, each half rotated ±90°, for players either side of the short edge |

"Swap sides" flips which way each half (or the single image) is rotated, for
when the physical setup is mirrored from the default.

## Zoom and pan

- Scroll to zoom, centred on the cursor (1x-8x).
- Click and drag to pan.
- Double-click to reset to fit.
- In dual view, zoom and pan are shared: dragging or scrolling on either half
  moves both in sync, since they're showing the same region of the same image.

## Install

With [BRAT](https://github.com/TfTHacker/obsidian42-brat) (recommended, it
keeps the plugin updated):

1. Install and enable BRAT from Community plugins.
2. Run "BRAT: Add a beta plugin for testing" and enter `Gizmo73/dual-view-viewer`.
3. Enable Dual View under Community plugins.

BRAT then checks for new releases on startup, or on demand with "BRAT: Check
for updates to all beta plugins". Your settings are kept across updates.

By hand: copy `main.js` and `manifest.json` from the latest
[release](https://github.com/Gizmo73/dual-view-viewer/releases) into
`<your vault>/.obsidian/plugins/dual-view/`, then reload Community plugins.

## Releasing

Bump `version` in `plugin/manifest.json` (e.g. `2.2.0` to `2.3.0`) in the
same PR as the change, then merge it. The "Release plugin" GitHub Action
publishes a release with `main.js` and `manifest.json` attached, tagged with
that version, and BRAT picks it up. A version with a suffix, like
`2.3.0-beta.1`, goes out as a pre-release. Merges that don't change the
version publish nothing.

## Use

- Right-click an image and pick "Open in dual view" or "Open in single view".
- Or use the commands: "Open current image in dual view" / "...in single view".
- Mid-session, without opening settings: "Toggle swap sides" and "Toggle screen
  orientation (portrait/landscape)" commands both update the open window live.

## First time on the second monitor

The first open lands in a default spot. Drag the window onto your second
monitor and maximise it. The plugin remembers that position per computer, so
it reopens there from then on.

## Settings

- **Landscape orientation**: off for portrait (cases 1 & 3 above), on for
  landscape (cases 2 & 4). Also available as a command for quick switching.
- **Swap sides**: flips the rotation, for a mirrored physical setup. Also
  available as a command.
- **Background colour**: shown behind the image (letterboxing).
- **Remember window position**: on by default.

## Players (remote viewer)

Everything you send can also be mirrored to players in their own browser,
with one link covering the main screen, the ambient screen and your Owlbear
Rodeo room.

1. In settings, set **Viewer page URL** (where this repo's `index.html` is
   hosted) and, optionally, **Owlbear Rodeo URL**.
2. At the start of a session, press **New player link** at the top of the
   controller (or run the "New player link" command). It opens a fresh room
   and copies the link; paste it to your players.
3. Players open the link in a desktop browser. The page shows your main
   screen, with buttons to open Owlbear Rodeo and the ambient screen (in a
   new tab, which they can drag out onto a second monitor).

**Copy current link** re-sends the same link without disconnecting anyone.
The controller's Players section shows whether the room is online and how
many players are on each screen.

## Controller

Open it with the dashboard icon in the left ribbon, or the "Open controller"
command; it opens in the right sidebar. It also opens by itself the first time
you send something.

The controller has three fixed sections: **Players**, **Main screen** and
**Ambient screen**. Each screen's buttons only ever drive that screen.

Both screens keep a list of what's been sent this session (for the ambient
screen, ad hoc scenes only; premade scenes stay in their dropdown). Click an
entry to put it back up in the mode it last used; the cross just removes it
from the list.

## Ambient scenes

In settings, **Ambient scenes** holds premade scenes: a name, an image from
your vault (picked with a search box, like linking a file) and the mode it
opens in. **Add scene** starts with the image search. The controller's
**Scene** dropdown puts one up straight away; they don't get added to the
ad hoc scene list. Scenes follow their image if you rename or move it.
