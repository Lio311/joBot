/**
 * Job locations are free text ("Tel Aviv-Yafo, Israel · Tel Aviv District", "ת"א והמרכז", "TLV").
 * This small gazetteer resolves them to a city (or a region) with coordinates for the map.
 */

export interface Place {
  /** Hebrew name shown on the map. */
  name: string;
  lat: number;
  lng: number;
  /** Lowercase spellings matched as whole words (Hebrew and English). */
  aliases: string[];
}

export const PLACES = {
  "tel-aviv": {
    name: "תל אביב",
    lat: 32.0853,
    lng: 34.7818,
    aliases: ["tel aviv", "tel-aviv", "telaviv", "tlv", "jaffa", "yafo", "gush dan", "תל אביב", "תל-אביב", 'ת"א', "ת״א", "יפו", "גוש דן", "המרכז", "מרכז", "central israel", "central district"],
  },
  "ramat-gan": { name: "רמת גן", lat: 32.07, lng: 34.8236, aliases: ["ramat gan", "ramat-gan", "רמת גן", "רמת-גן", "בורסה"] },
  givatayim: { name: "גבעתיים", lat: 32.0716, lng: 34.8105, aliases: ["givatayim", "giv'atayim", "גבעתיים"] },
  "bnei-brak": { name: "בני ברק", lat: 32.0846, lng: 34.8338, aliases: ["bnei brak", "bnei-brak", "בני ברק"] },
  holon: { name: "חולון", lat: 32.0158, lng: 34.7874, aliases: ["holon", "חולון"] },
  "bat-yam": { name: "בת ים", lat: 32.0167, lng: 34.75, aliases: ["bat yam", "bat-yam", "בת ים"] },
  "petah-tikva": {
    name: "פתח תקווה",
    lat: 32.0917,
    lng: 34.8878,
    aliases: ["petah tikva", "petah tiqva", "petach tikva", "petach tikvah", "petah-tikva", "פתח תקווה", "פתח תקוה", 'פ"ת', "פ״ת"],
  },
  "rosh-haayin": { name: "ראש העין", lat: 32.0956, lng: 34.9566, aliases: ["rosh haayin", "rosh ha'ayin", "rosh ha-ayin", "ראש העין"] },
  yehud: { name: "יהוד", lat: 32.0333, lng: 34.8889, aliases: ["yehud", "יהוד"] },
  "or-yehuda": { name: "אור יהודה", lat: 32.0306, lng: 34.8533, aliases: ["or yehuda", "אור יהודה"] },
  airport: { name: "איירפורט סיטי", lat: 32.0, lng: 34.8875, aliases: ["airport city", "איירפורט סיטי", "קריית שדה התעופה"] },
  "kiryat-ono": { name: "קריית אונו", lat: 32.0636, lng: 34.8553, aliases: ["kiryat ono", "קריית אונו", "קרית אונו"] },
  herzliya: { name: "הרצליה", lat: 32.1624, lng: 34.8085, aliases: ["herzliya", "herzlia", "herzeliya", "הרצליה", "הרצליה פיתוח"] },
  "ramat-hasharon": { name: "רמת השרון", lat: 32.1461, lng: 34.8394, aliases: ["ramat hasharon", "ramat ha-sharon", "ramat ha sharon", "רמת השרון"] },
  raanana: { name: "רעננה", lat: 32.1848, lng: 34.8713, aliases: ["raanana", "ra'anana", "ra’anana", "רעננה"] },
  "kfar-saba": { name: "כפר סבא", lat: 32.175, lng: 34.9069, aliases: ["kfar saba", "kfar-saba", "kefar sava", "כפר סבא"] },
  "hod-hasharon": { name: "הוד השרון", lat: 32.1593, lng: 34.8932, aliases: ["hod hasharon", "hod ha-sharon", "hod ha sharon", "הוד השרון"] },
  netanya: { name: "נתניה", lat: 32.3215, lng: 34.8532, aliases: ["netanya", "natanya", "נתניה"] },
  "even-yehuda": { name: "אבן יהודה", lat: 32.27, lng: 34.8875, aliases: ["even yehuda", "אבן יהודה"] },
  sharon: { name: "השרון", lat: 32.215, lng: 34.875, aliases: ["sharon", "hasharon", "השרון", "אזור השרון"] },
  "rishon-lezion": {
    name: "ראשון לציון",
    lat: 31.9642,
    lng: 34.8044,
    aliases: ["rishon lezion", "rishon le zion", "rishon letsiyon", "rishon le-zion", "ראשון לציון", 'ראשל"צ', "ראשל״צ"],
  },
  "nes-ziona": { name: "נס ציונה", lat: 31.9293, lng: 34.7987, aliases: ["nes ziona", "ness ziona", "נס ציונה"] },
  rehovot: { name: "רחובות", lat: 31.8928, lng: 34.8113, aliases: ["rehovot", "rechovot", "רחובות"] },
  lod: { name: "לוד", lat: 31.9516, lng: 34.8953, aliases: ["lod", "לוד"] },
  ramla: { name: "רמלה", lat: 31.9293, lng: 34.8656, aliases: ["ramla", "רמלה"] },
  modiin: { name: "מודיעין", lat: 31.8969, lng: 35.0104, aliases: ["modiin", "modi'in", "modi’in", "מודיעין"] },
  shoham: { name: "שוהם", lat: 31.9986, lng: 34.9461, aliases: ["shoham", "שוהם"] },
  yokneam: { name: "יקנעם", lat: 32.6594, lng: 35.1094, aliases: ["yokneam", "yoqneam", "yokne'am", "יקנעם", "יוקנעם"] },
  haifa: { name: "חיפה", lat: 32.794, lng: 34.9896, aliases: ["haifa", "חיפה", "matam", 'מת"ם', "מת״ם", "north district", "northern israel", "הצפון", "צפון"] },
  caesarea: { name: "קיסריה", lat: 32.5, lng: 34.9, aliases: ["caesarea", "קיסריה"] },
  hadera: { name: "חדרה", lat: 32.434, lng: 34.9196, aliases: ["hadera", "חדרה"] },
  "migdal-haemek": { name: "מגדל העמק", lat: 32.6719, lng: 35.2406, aliases: ["migdal haemek", "migdal ha'emek", "מגדל העמק"] },
  nazareth: { name: "נצרת", lat: 32.6996, lng: 35.3035, aliases: ["nazareth", "נצרת"] },
  karmiel: { name: "כרמיאל", lat: 32.9171, lng: 35.305, aliases: ["karmiel", "כרמיאל"] },
  jerusalem: { name: "ירושלים", lat: 31.7683, lng: 35.2137, aliases: ["jerusalem", "ירושלים", "jerusalem district"] },
  "beer-sheva": {
    name: "באר שבע",
    lat: 31.2518,
    lng: 34.7913,
    aliases: ["beer sheva", "be'er sheva", "beersheba", "beer-sheva", "באר שבע", 'ב"ש', "south district", "southern israel", "הדרום", "דרום"],
  },
  ashdod: { name: "אשדוד", lat: 31.8044, lng: 34.6553, aliases: ["ashdod", "אשדוד"] },
  ashkelon: { name: "אשקלון", lat: 31.6688, lng: 34.5743, aliases: ["ashkelon", "אשקלון"] },
} satisfies Record<string, Place>;

export type PlaceKey = keyof typeof PLACES;

const HEBREW = /[֐-׿]/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word matchers. Hebrew aliases may carry a one-letter prefix (ב/ל/מ/ו/ה: "בתל אביב").
const MATCHERS: { key: PlaceKey; re: RegExp; len: number }[] = (Object.entries(PLACES) as [PlaceKey, Place][]).flatMap(([key, p]) =>
  p.aliases.map((a) => ({
    key,
    len: a.length,
    re: HEBREW.test(a)
      ? new RegExp(`(?:^|[^\\u0590-\\u05FF])[בלמוה]?${escape(a)}(?![\\u0590-\\u05FF])`)
      : new RegExp(`(?:^|[^a-z])${escape(a)}(?![a-z])`),
  })),
);

/** The place a location string names first ("Tel Aviv/ Netanya" → Tel Aviv), or null for "Israel", "Remote"... */
export function placeOf(location: string | null | undefined): PlaceKey | null {
  if (!location) return null;
  const text = location.toLowerCase().replace(/[‐-―]/g, "-");
  let best: { key: PlaceKey; at: number; len: number } | null = null;
  for (const m of MATCHERS) {
    const hit = m.re.exec(text);
    if (!hit) continue;
    const at = hit.index + hit[0].length - m.len; // where the alias itself starts
    if (!best || at < best.at || (at === best.at && m.len > best.len)) best = { key: m.key, at, len: m.len };
  }
  return best?.key ?? null;
}
