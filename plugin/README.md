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

1. Copy this `dual-view` folder into:
   `<your vault>\.obsidian\plugins\dual-view\`
2. Settings, Community plugins, reload, then enable Dual View.

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
   screen, with buttons to open Owlbear Rodeo and the ambient screen (in its
   own window, ready to drag onto a second monitor).

**Copy current link** re-sends the same link without disconnecting anyone.
The controller's Players section shows whether the room is online and how
many players are on each screen.

## Controller

The controller tab has three fixed sections: **Players**, **Main screen** and
**Ambient screen**. Each screen's buttons only ever drive that screen.
