# Slate Pitch Deck

A 1920x1080 HTML pitch deck for Slate, modelled on the Stats Engine launch deck.

## Files

- `Slate Pitch Deck.html` - the deck. Open in any modern browser.
- `deck-stage.js` - the runtime (web component for slide navigation, scaling, print). Copied verbatim from the Stats Engine deck; no Slate-specific changes.
- `screens/` - drop screenshots here.

## How to view

Just open `Slate Pitch Deck.html` in Chrome / Safari. It auto-scales to fit the viewport, letterboxed.

- **Arrow keys / Space / PgUp / PgDn** - navigate
- **Number keys** - jump to slide N
- **R** - reset to slide 1
- **Print -> Save as PDF** - one slide per page, full quality (the deck's print CSS handles this)
- Bottom-right gear icon - open the Tweaks panel (motion, pacing, auto-advance)

## Screenshots

The deck references 5 screenshots that are not yet present. Until you drop them in, each empty window shows a hatch-pattern placeholder with the filename you need.

| File | What to capture |
|---|---|
| `screens/dashboard.png` | The Dashboard at `/` - hero card + KPIs + funnel + cards |
| `screens/candidate-detail.png` | A candidate detail page at `/candidates/<id>` with a fully populated pipeline |
| `screens/semantic-search.png` | The Smart-search dialog on `/candidates` with a query + ranked results |
| `screens/reports.png` | `/reports` showing the heatmap + stage breakdown |
| `screens/candidate-status.png` | The public status page at `/c/<token>` |

Recommended capture settings:

- Window width **1440px** or **1600px** (Chrome devtools at 1440 works well)
- Use a candidate / role with real-looking data; the demo seed in `supabase/demo/seed_demo_data.sql` is ideal
- PNG, retina if your display supports it (the deck handles 2x crisply)
- Save into this `screens/` folder with the exact filenames above

Once a PNG is in place the deck picks it up automatically - no edits to the HTML.

## Editing copy

All copy is inline in `Slate Pitch Deck.html` inside `<section class="slide">` blocks. Speaker notes (read aloud during walkthroughs) live in the `<script id="speaker-notes">` JSON at the bottom of the file.
