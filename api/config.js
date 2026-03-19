// Configure watchlist pairs here.
// You can add more pairs over time.
export const WATCHLIST = [
  { a: "Russia", b: "Ukraine", label: "RUS–UKR" },
  { a: "Iran", b: "United States", label: "IRN–USA" }
];

// Detection window
export const WINDOW_HOURS = 24;

// These are kept for compatibility with the UI payload.
// In the new architecture, /api/refresh decides what is "active".
export const MIN_ARTICLES = 1;

// Not used by /api/refresh right now (we query event root codes instead of keywords),
// but kept in case you want a doc-based heuristic later.
export const KEYWORDS = [
  "war", "attack", "strike", "missile", "drone", "airstrike", "shelling"
];
