# ArcheAge Chronicles — Trading Post Info & Route Estimator

An interactive web-based trade run calculator, route visualizer, and profit estimator for **ArcheAge Chronicles**. Built with vanilla HTML, CSS, and JavaScript, it pulls live data directly from a published Google Sheet CSV to help players plan optimal trade routes and maximize wagon profitability.

---

## Current Features

### 1. Live Google Sheet Sync
- **Real-Time CSV Fetching**: Automatically fetches and parses Trading Post sales, dispatch regions, buy/packing costs, and required materials from a published Google Sheet.
- **Manual Refresh**: Reload live spreadsheet data at any time via the **Refresh Sheet** button or the `R` keyboard shortcut.

### 2. Route & Profit Estimator
- **Flexible Route Selection**: Filter by **Departure / Dispatch Outpost**, **Trade Good (Pack)**, and **Arrival Trading Post**, or quickly invert your route using **Swap Outposts** (`X`).
- **Gross & Net Profit Breakdown**: Displays min/max/average gold payouts, material/item reward ranges (`100%` base up to `140%` max), gold buy/packing costs, net profit margins, and ROI percentages.
- **Destination Comparison Table**: Compares payouts and net profits for the selected pack across all Trading Posts at a glance. Click any row to switch your arrival destination.

### 3. Interactive World Map & Route Overlays
- **Pan & Zoom Navigation**: Smooth mouse-wheel zoom, click-and-drag panning, `Fit` auto-centering, and an expandable viewport (`⤢`).
- **Outpost Markers**: Displays Trading Post icons (`outpost.webp`) anchored to native `(x, y)` coordinates on `worldmap.webp` (`6232 × 4712`). Click an outpost to set it as Arrival, or `Shift + Click` to set it as Departure.
- **Transparent Route Overlays**: Automatically overlays route path graphics when a valid departure and arrival pair is selected.
- **Built-in Coordinate Picker**: Hover over the map to read live `(x, y)` pixel coordinates or click the map background to copy `{ x, y }` directly to your clipboard.

### 4. Trade Run Simulation (7-Pack Wagon)
- **Full Wagon Loadout**: Simulate mixed or single-pack runs up to the 7-pack wagon capacity (`+ Add Selected Pack`, `Fill ×7 with Selected`, or remove individual slots).
- **Aggregated Run Totals**: Calculates total gold buy cost, min/max/average gross gold payout, average net profit, overall ROI, and total item/material rewards.

### 5. Search, Filtering & Keyboard Shortcuts
- **Sidebar Pack Filter**: Filter destination sales by **All**, **Gold Only**, or **Items / Mats**, and search by pack or region name.
- **Keyboard Shortcuts**:
  - `R` — Reload Google Sheet CSV
  - `X` — Swap Departure & Arrival Outposts
  - `/` — Focus pack/region search input

---

## Roadmap & Planned Features

- **Recursive Pack Crafting Tree (Sub-Requirements Breakdown)**:
  - Display the full crafting dependency tree for any Trade Good, expanding primary ingredients down through intermediate crafted materials all the way to raw base resources.
  - Estimate the total end-to-end material quantities and gold crafting fees required to produce a single pack from scratch.
- **Full Cargo Crafting & Total Resource Estimator**:
  - Aggregate total raw materials, intermediate sub-components, and cumulative crafting/packing gold costs across an entire 7-pack wagon load in the Trade Run Simulation.

---

## Project Structure

```text
├── index.html          # Main application layout and UI structure
├── style.css           # Dark RPG-inspired theme, fixed header/footer, and responsive grid
├── app.js              # CSV parser, profit & run calculations, and interactive map engine
└── imgs/               # Map assets, outpost markers, route overlays, and pack icons
    ├── worldmap.webp   # Full-resolution world map (6232 x 4712)
    ├── outpost.svg     # Trading Post map marker icon
    └── routes/         # Transparent route overlay images (<origin>_to_<dest>.webp)
    └── tradepacks/     # Trade Packs images (<tradepack>.webp)
```

---

## Local Setup

Because browsers restrict `fetch()` requests to external CSV URLs over the `file://` protocol (CORS), serve the project using a local HTTP server when testing locally:

```bash
# Using Python 3
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.
