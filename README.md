# ArcheAge Chronicles — Trading Post Info & Route Estimator

An interactive web-based trade run calculator, route visualizer, and profit estimator for **ArcheAge Chronicles**. Built with vanilla HTML, CSS, and JavaScript, it pulls live data directly from a published Google Sheet CSV to help players plan optimal trade routes and maximize wagon profitability.

---

## Current Features

### 1. Live Google Sheet Sync
- **Real-Time CSV Fetching**: Automatically fetches and parses Trading Post sales, dispatch regions, buy/packing costs, required materials, and crafting recipes (`Craft/Recipes` tab) from a published Google Sheet.
- **Manual Refresh**: Reload live spreadsheet data at any time via the **Refresh Sheet** button or the `R` keyboard shortcut.

### 2. Route & Profit Estimator
- **Flexible Route Selection**: Filter by **Departure / Dispatch Outpost**, **Trade Good (Pack)**, and **Arrival Trading Post**, or quickly invert your route using **Swap Outposts** (`X`).
- **Gross & Net Profit Breakdown**: Displays min/max/average gold payouts, material/item reward ranges (`100%` base up to `140%` max), gold buy/packing costs, net profit margins, and ROI percentages.
- **Destination Comparison Table**: Compares payouts and net profits for the selected pack across all Trading Posts at a glance. Click any row to switch your arrival destination.

### 3. Recursive Crafting Tree & Wagon Material Estimator
- **Pack Crafting Breakdown Modal (`Show details`)**: Expands any pack's crafting dependencies recursively through intermediate sub-components down to raw base materials, showing total gold cost, crafting gold cost, and packing/buy cost.
- **Full 7-Pack Wagon Craft Totals**: Aggregates intermediate sub-components, total raw base materials, and cumulative crafting/packing gold costs across the active wagon loadout.

### 4. Interactive World Map & Route Overlays
- **Pan & Zoom Navigation**: Smooth mouse-wheel zoom, click-and-drag panning, `Fit` auto-centering, and an expandable viewport (`⤢`).
- **Outpost Markers**: Displays Trading Post icons (`outpost.webp`) anchored to native `(x, y)` coordinates on `worldmap.webp` (`6232 × 4712`). Click an outpost to set it as Arrival, or `Shift + Click` to set it as Departure.
- **Transparent Route Overlays**: Automatically overlays route path graphics when a valid departure and arrival pair is selected.
- **Built-in Coordinate Picker**: Hover over the map to read live `(x, y)` pixel coordinates or click the map background to copy `{ x, y }` directly to your clipboard.

### 5. Trade Run Simulation (7-Pack Wagon)
- **Full Wagon Loadout**: Simulate mixed or single-pack runs up to the 7-pack wagon capacity (`+ Add Selected Pack`, `Fill ×7 with Selected`, or remove individual slots).
- **Aggregated Run Totals**: Calculates total gold buy cost, min/max/average gross gold payout, average net profit, overall ROI, total item/material rewards, and wagon-wide crafting costs/materials.

### 6. Search, Filtering & Keyboard Shortcuts
- **Sidebar Pack Filter**: Filter destination sales by **All**, **Gold Only**, or **Items / Mats**, and search by pack or region name.
- **Keyboard Shortcuts**:
  - `R` — Reload Google Sheet CSV
  - `X` — Swap Departure & Arrival Outposts
  - `/` — Focus pack/region search input

---

## Roadmap & Planned Features

- **Job Proficiency Levels (`Novice` / `Apprentice`/ `Journeyman` /`Expert` / `Master`)**:
  - Add profeciency level selection per processing type (such as `Food`, `Wildcraft`, and other processing methods) inside the calculator.
  - Apply reduced ingredient consumption and increased yield/output for higher ranks on **Tier 1 (`Standard`)** and **Tier 2 (`Fine`)** materials once the higher-tier recipe/ingredient tables are updated.

---

## Project Structure

```text
├── index.html              # Main application layout, craft modal, and UI structure
├── style.css               # Dark RPG-inspired theme, fixed header/footer, and responsive grid
├── crafting-estimator.js   # Recursive recipe tree resolver and 7-pack wagon material estimator
├── app.js                  # CSV parser, profit & run calculations, and interactive map engine
└── imgs/                   # Map assets, outpost markers, route overlays, and pack icons
    ├── worldmap.webp       # Full-resolution world map (6232 x 4712)
    ├── outpost.webp        # Trading Post map marker icon
    ├── routes/             # Transparent route overlay images (<origin>_to_<dest>.svg/.webp)
    └── tradepacks/         # Trade Packs images (<tradepack>.webp)
```

---

## Local Setup

Because browsers restrict `fetch()` requests to external CSV URLs over the `file://` protocol (CORS), serve the project using a local HTTP server when testing locally:

```bash
# Using Python 3
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.
