// Minimal country/region name list for heuristic extraction.
// You can expand this list over time.
// Matching is case-insensitive and uses word-boundary-ish regex.
export const COUNTRY_ALIASES = [
  // Common abbreviations / variants
  ["United States", ["united states", "u.s.", "u.s", "us", "usa", "america"]],
  ["United Kingdom", ["united kingdom", "uk", "u.k.", "britain", "england"]],
  ["Russia", ["russia", "russian federation"]],
  ["Ukraine", ["ukraine"]],
  ["Iran", ["iran", "islamic republic of iran"]],
  ["Israel", ["israel"]],
  ["Palestine", ["palestine", "gaza", "west bank"]],
  ["China", ["china", "prc", "people's republic of china"]],
  ["Taiwan", ["taiwan"]],
  ["North Korea", ["north korea", "dprk"]],
  ["South Korea", ["south korea", "rok"]],
  ["Japan", ["japan"]],
  ["India", ["india"]],
  ["Pakistan", ["pakistan"]],
  ["Afghanistan", ["afghanistan"]],
  ["Iraq", ["iraq"]],
  ["Syria", ["syria"]],
  ["Yemen", ["yemen"]],
  ["Saudi Arabia", ["saudi arabia"]],
  ["United Arab Emirates", ["united arab emirates", "uae"]],
  ["Qatar", ["qatar"]],
  ["Turkey", ["turkey", "türkiye", "turkiye"]],
  ["Armenia", ["armenia"]],
  ["Azerbaijan", ["azerbaijan"]],
  ["Georgia", ["georgia"]],
  ["France", ["france"]],
  ["Germany", ["germany"]],
  ["Poland", ["poland"]],
  ["Belarus", ["belarus"]],
  ["Romania", ["romania"]],
  ["Moldova", ["moldova"]],
  ["Serbia", ["serbia"]],
  ["Kosovo", ["kosovo"]],
  ["Greece", ["greece"]],
  ["Italy", ["italy"]],
  ["Spain", ["spain"]],
  ["Sweden", ["sweden"]],
  ["Finland", ["finland"]],
  ["Norway", ["norway"]],
  ["Denmark", ["denmark"]],
  ["Netherlands", ["netherlands", "dutch"]],
  ["Belgium", ["belgium"]],
  ["Canada", ["canada"]],
  ["Mexico", ["mexico"]],
  ["Brazil", ["brazil"]],
  ["Argentina", ["argentina"]],
  ["Chile", ["chile"]],
  ["Colombia", ["colombia"]],
  ["Venezuela", ["venezuela"]],
  ["Ecuador", ["ecuador"]],
  ["Peru", ["peru"]],
  ["Egypt", ["egypt"]],
  ["Libya", ["libya"]],
  ["Sudan", ["sudan"]],
  ["South Sudan", ["south sudan"]],
  ["Ethiopia", ["ethiopia"]],
  ["Somalia", ["somalia"]],
  ["Kenya", ["kenya"]],
  ["Uganda", ["uganda"]],
  ["Rwanda", ["rwanda"]],
  ["Burundi", ["burundi"]],
  ["DR Congo", ["democratic republic of the congo", "drc", "dr congo", "congo-kinshasa"]],
  ["Congo", ["republic of the congo", "congo-brazzaville"]],
  ["Nigeria", ["nigeria"]],
  ["Niger", ["niger"]],
  ["Mali", ["mali"]],
  ["Burkina Faso", ["burkina faso"]],
  ["Ghana", ["ghana"]],
  ["Ivory Coast", ["ivory coast", "cote d'ivoire", "côte d’ivoire"]],
  ["Cameroon", ["cameroon"]],
  ["Central African Republic", ["central african republic", "car"]],
  ["Chad", ["chad"]],
  ["Mozambique", ["mozambique"]],
  ["South Africa", ["south africa"]],
  ["Australia", ["australia"]],
  ["New Zealand", ["new zealand"]]
];

export function extractCountries(text) {
  const t = String(text || "").toLowerCase();
  const found = new Set();

  for (const [canonical, aliases] of COUNTRY_ALIASES) {
    for (const a of aliases) {
      // crude boundary: require non-letter/number around alias
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(a)}([^a-z0-9]|$)`, "i");
      if (re.test(t)) {
        found.add(canonical);
        break;
      }
    }
  }

  return [...found];
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
