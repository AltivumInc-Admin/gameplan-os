# Design

Visual system of the Game Plan OS console. Register: product (dark,
instrument-grade operations console). Source of truth: `frontend/src/styles.css`.

## Theme

Single committed dark theme: a quiet operations room at dawn. A faint green
radial glow and near-invisible scan texture give atmosphere; everything else
is restrained surface-on-surface.

## Color

| Token | Value | Role |
|---|---|---|
| `--bg0` | `#0a0e13` | Page background |
| `--bg1` | `#0f151c` | Panels, inputs |
| `--bg2` | `#141c25` | Raised surfaces |
| `--line` | `#1d2833` | Hairlines |
| `--line-strong` | `#2a3846` | Interactive borders |
| `--text` | `#d8e2ec` | Primary text |
| `--dim` | `#8698a9` | Secondary content text (AA on bg0) |
| `--faint` | `#74869a` | Chrome only: axis labels, footer (never content) |
| `--green` | `#46c083` | Accent: actions, current state, scheduled time |
| `--amber` | `#d9a84e` | Caution: warnings, blockers |
| `--red` | `#d9706c` | Errors only |

Accent discipline: green marks actions and live state, amber marks caution,
red marks failure. No decorative color.

## Typography

- `IBM Plex Mono` — machinery: labels, tags, times, numbers, buttons
- `IBM Plex Sans` — prose: body, task titles, answers
- `IBM Plex Serif` — one job: the mission statement (and gate headline)
- Base 15px; fixed rem scale, tight ratio; `tabular-nums` on all numerics

## Motion

- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (expo); exits ~75% of entrances
- Feedback 120-150ms; state changes 200-250ms; the generation ceremony is the
  single orchestrated sequence (console feed, timeline scan, one-time
  staggered reveal, mission wipe)
- Motion conveys state only. Every animation has a reduced-motion alternative.

## Components

- Five-paragraph sections: numbered mono headings with serif plain-English
  subtitles; hairline left rule
- Day timeline: scaled blocks on a ruled track, live "now" marker, reserve
  legend; hover links block to its schedule row
- Tags: P1 (solid green), P2 (green outline), P3 (neutral outline),
  drop (dashed), caution (amber outline)
- Meters: five 4px bars, filled = score
- Buttons: primary (solid green, mono uppercase), ghost (outline), mini
- Status line: pulsing dot + mono text for any in-flight AI work
- Skeleton rows for loading states; empty states that teach the loop
