# Tool dock

Supersedes the Addons menu described in [Optional editor layouts](2026-09-13-editor-layout-design.md) and the Addons paragraph in [Desk and tool interaction design](../../interaction-design.md). The Dockview host, stable editor portals, per-page saved arrangements, single-editor default, and narrow-viewport rules from those documents remain in force.

## Problem

Adding a second tool currently requires opening the Addons popover and reading a four-by-three matrix of placement icons. Users must decide beside, below, tab, or float before seeing the result, and the placement is always relative to the focused editor. The keyboard resize arrows move an editor forty pixels per click and duplicate what the sash already does. Nothing in the header shows which tools are open.

## Design

The Addons button is replaced by a tool dock in the header's editor controls area. The dock lists Whiteboard, Python, Journal, and Spreadsheet as compact chips with an icon and label, in the same order as the desk objects and Alt shortcuts. Output appears as a fifth chip only while Python is open, since it has no meaning without a source editor. Each chip reflects state: dimmed for hidden, filled for visible, and outlined for the focused editor. The dock is hidden on the desk.

Clicking a hidden chip adds that tool as a tab in the focused group and makes it active. The workspace never collapses to one tool as a side effect of a click. Clicking a visible chip focuses it, revealing its tab if it sits behind another. Clicking the focused chip does nothing. Clicking the Output chip while Output is embedded detaches it as a tab beside Python's group, matching the existing "Tab with source" placement; clicking it while detached focuses it.

Dragging a chip places the tool precisely. While a chip drags, the workspace shows drop targets. In the docked view these are Dockview's own group overlays: the four edges split beside or below the target group, and the center adds a tab. The dock accepts the drag through Dockview's unhandled drag-over hook and reads the tool id from the drag payload on drop, then issues the same open command the menu used, with the group under the pointer as the reference and the drop position as the placement. Dropping on the workspace margin outside any group, or on the dock itself, floats the tool at the default floating bounds. Dragging a chip whose tool is already visible moves that tool rather than duplicating it. Dropping anywhere else cancels with no change.

The single-editor view has no Dockview instance, so it draws its own lightweight overlay with the same five regions over the editor while a chip drags. Dropping there switches the page to the docked view through the existing start command, with the current editor as the reference and the region as the placement. This keeps Dockview unmounted until a second tool actually opens, preserving the current default-view toolbars and cost.

Rearranging after the first placement uses Dockview's existing tab drag, so there is one gesture for both adding and moving. Group headers keep float, dock, and close, and gain a maximize toggle for the group, replacing the menu's Maximize item. Native drags use the HTML drag-and-drop API with a custom drag image showing the tool icon and label. Touch uses pointer events with the same payload, matching Dockview's own touch handling.

An overflow button at the end of the dock, labelled with an ellipsis and named Arrangement, holds the remaining housekeeping actions: Show only the focused tool, Restore previous arrangement when one is saved, and Reset. The keyboard resize arrows are removed. Sash resizing is a pointer path only; Dockview provides no keyboard sash handling, so keyboard users size editors through maximize, Show only, and tab arrangement. A future keyboard resize command belongs in a command palette, not in this menu.

Keyboard access mirrors the pointer paths. Chips are buttons in the tab order, so Enter or Space performs the click behavior. Alt+1 through Alt+4 keep opening a tool alone, matching the desk. Alt+Shift+1 through Alt+Shift+4 add the tool as a tab in the focused group, equivalent to clicking its chip. Each chip announces its state to assistive technology through a pressed attribute and a title such as "Journal, hidden. Click to add as a tab, drag to place."

Narrow viewports already force the single-editor view. There, chips remain plain buttons that switch to the tool, drag is disabled, and the overflow keeps only Restore previous arrangement disabled with the existing wider-window hint. Nothing in the saved desktop arrangement changes.

Visual treatment follows the existing sage and cream palette, compact system typography, and quiet buttons. Chips are icon plus label at header height with a two-pixel state ring rather than a filled pill, so the header stays calm. Drop overlays use the sage tint already used for Dockview's overlay theme.

## Components

The layout controller gains one method: place the tool by group id and drop position, which wraps the existing open command and drag-to-move. LayoutControls becomes ToolDock, receiving the visible, opened, and focused panel lists it already gets plus a drag-start callback. A DropOverlay component for the single view owns the five regions and reports the chosen placement. DockedEditors registers the unhandled drag-over and did-drop handlers and forwards them to the controller. OutputLayoutControls keeps its Move output menu, since it also covers returning output to the embedded area.

## Testing

Playwright covers: chip state after opening each tool by click, by drag to each edge and center in the docked view, and by drag to each region in the single view; floating by dropping on the margin; moving an already visible tool by drag; the Output chip appearing and disappearing with Python; Alt+Shift shortcuts; keyboard activation of chips; the overflow actions; narrow-viewport fallbacks; and that saved page arrangements from the Addons era still restore. Unit tests cover the placement mapping from drop position to open command and the controller's move-versus-add decision. Run the existing unit suite, typecheck, and production build.
