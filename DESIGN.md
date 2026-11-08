---
name: Reading Time
description: Personal reading data as an explorable map, in daylight and after dark.
colors:
  night-canvas: "#202329"
  night-surface: "#2a3038"
  night-text: "#f1f3f1"
  night-muted: "#b9c7ca"
  night-border: "#46515b"
  day-canvas: "#f1f3ef"
  day-surface: "#fafcf8"
  day-text: "#173630"
  day-muted: "#506a61"
  day-border: "#c5d8cd"
  night-accent: "#dfca9c"
  atlas-night-story: "#414257"
  atlas-day-story: "#e0e9f3"
  map-mint: "#9bd6ce"
  map-gold: "#eac77e"
  map-violet: "#c9afe2"
  map-blue: "#90bddd"
  map-sage: "#bacc9a"
typography:
  body:
    fontFamily: "Manrope, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  heading:
    fontFamily: "Manrope, Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "clamp(27px, 2.7vw, 38px)"
    fontWeight: 600
    lineHeight: 1.18
rounded:
  panel: "12px"
  action: "6px"
  control: "32px"
spacing:
  small: "12px"
  medium: "20px"
  large: "32px"
components:
  atlas-action:
    backgroundColor: "#e6d4a9"
    textColor: "#292b36"
    rounded: "{rounded.action}"
    padding: "10px 15px"
  panel:
    backgroundColor: "{colors.night-surface}"
    rounded: "{rounded.panel}"
---

# Design System: Reading Time

## Overview

**Creative North Star: "The Reading Atlas"**

An operational reading dashboard, with the map as its first meaningful object rather than another KPI grid. Night uses charcoal surfaces, a restrained slate-violet story field and luminous category routes; day keeps its pale ground and mint network with a cool slate story field. Navigation and reporting retain their familiar structure. The two themes are different lighting conditions for the same information, not a simple inversion.

**Key Characteristics:** An anchored sidebar, distinct editorial data fields, real category-hour routes, and compact report panels. Sample reports identify their source in the interface.

## Colors

The shell is quiet so the map's five category colors can carry meaning. Night pairs charcoal canvas and slate panels with light text and a soft gold action; day pairs a pale neutral canvas with near-white panels, pine text and a slate-to-mint atlas. The prominent map story surfaces deliberately avoid red and flesh tones. All colors in the frontmatter are grounded in `src/atlas.css`.

**The Route Rule.** Assign the five ranked category hues consistently within one view. Route strokes and endpoints represent category reading hours; they do not imply relationships between books.

## Typography

Manrope is served from local font files, followed by Chinese-system sans-serif fallbacks. Headlines use a restrained 600 weight; data figures use tabular numerals. Keep short labels and axis text legible rather than using color alone to convey rank.

## Layout

The fixed 224px sidebar gives way to a compact mobile top bar and navigable drawer at 760px. The atlas is a split story-and-network surface on desktop and a stacked story followed by a dedicated, proportionally scaled SVG diagram on mobile. The overview photo and copy form one column on narrow screens. The report retains the original page order and analysis workflows.

## Elevation & Depth

Tonal separation and crisp borders establish hierarchy; the principal atlas is an adjacent pair of solid color fields. Avoid ornamental glow and floating nested cards. Focus states use a visible accent outline.

## Shapes

Large report surfaces use 12px corners. The map origin has two concentric circles and curved routes; these are data geometry, not an illustration of books. Actions use compact rounded corners, while small status controls may be pills.

## Components

### Atlas

Rank the five positive-duration categories by hours. Retain a textual SVG accessible name. Small diagrams can abbreviate visual endpoint labels, but repeat complete names and durations in a readable legend. When the report has no category hours, show an explicit empty state instead of fabricated paths. The adjacent button navigates to Reading Preferences.

### Navigation and Controls

Active navigation sits on a contrasting surface and keeps its icon accent; links, buttons, inputs and the theme toggle remain keyboard-focusable. Theme changes update the shell, text, cards, chart colors and SVG together.

AI interpretations share four equal selectors: MBTI personality, recommendations, cognition, and cross-book collisions. Settings only configure the shared model and return to the selected interpretation. Each result ends with an inline disclosure for editing that interpretation's prompt and retrying, including default reset, empty-input validation and the existing consent requirement. Failed or cancelled retries keep the previous result visible.

Cognition results present up to four slices. Within each slice, quiet text headings separate the portrait, the conditional blind spot, and the original evidence. Separate the blind spot with a thin rule, not another nested panel. Quote sources and available dates come from saved highlights; missing dates remain explicit.

Cognition and collisions share a compact segmented control for selected highlights or all highlights. Show the actual quote count and maximum request count before generation; changing scope clears consent. Result coverage uses the saved execution mode, rather than the currently selected control. Distinguish local scanning from material actually sent to the model.

Place an input token estimate range after the request count. The adjacent CircleAlert icon reveals material scope and estimation details using the existing InfoTip, including focus and touch access. Keep long disclosure text out of the normal flow for these two modes. All result prose sections share the full available width; do not apply a separate character-based cap to blind-spot text. Collision units display one of three type labels and separate theatre introduction, imagined dialogue, reconciliation and the two sourced quotations with quiet headings and rules.

### Panels

Panels use calm surfaces and a compact heading. Metrics sit directly below the atlas; chart and quote panels follow in the existing report order. The atlas is the focal data field, not a card nested inside a card.

## Do's and Don'ts

### Do:
- **Do** label the origin and meaning of synthesized example data.
- **Do** preserve tabular values, keyboard focus and readable text in both themes.
- **Do** treat narrower mobile widths as a stacked report with an intact five-node diagram.

### Don't:
- **Don't** infer book-to-book links from category-hour totals.
- **Don't** change the reading totals or existing reporting calculations to fit the visual.
- **Don't** reduce the night theme to an inverted light palette or the day theme to monochrome panels.
