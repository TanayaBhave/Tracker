// Light, conservative cleanup of scanned/searched product names before using
// them as Ingredient catalog names (Feature: scanned products become
// correlation-capable ingredients). USDA Branded names are shouty and carry
// packaging noise ("365 ORGANIC TAHINI 16OZ"); the ingredient-correlation
// engine wants a stable, human "Organic Tahini".
//
// Deliberately conservative — three rules only, no attempt to singularize,
// translate marketing copy, or guess at the "real" food:
//   1. Strip a LEADING brand token, only when it exactly equals the item's
//      own brand field (case-insensitive) — never fuzzy brand matching.
//   2. Strip TRAILING size/weight/count tokens ("16OZ", "454 G", "2 PACK",
//      "12 FL OZ"), repeatedly, only at the end of the name.
//   3. Title-case the remainder (USDA Branded names are usually ALL CAPS).
//      All-caps words become Xxxx; words with digits ("365") are left as-is.

// One trailing size token: "16OZ", "16 OZ", "454G", "1.5 L", "12 FL OZ",
// "30 CT", "2 PACK", optionally preceded by a comma/dash separator.
const TRAILING_SIZE_RE =
  /[\s,\-–—]*\d+(\.\d+)?\s*(fl\s*\.?\s*oz|oz|lbs?|g|kg|mg|ml|l|ct|count|pk|pack|pc|pcs|servings?)\.?$/i;

/** Cleans a scanned/searched product name for use as an Ingredient name. */
export function cleanProductName(rawName: string, brand?: string): string {
  let name = rawName.trim();

  // 1. Leading brand token (exact, case-insensitive, must be followed by a
  //    separator or word boundary — "365" never eats into "3650").
  const b = (brand ?? '').trim();
  if (b && name.toLowerCase().startsWith(b.toLowerCase())) {
    const rest = name.slice(b.length);
    if (rest === '' || /^[\s,\-–—:]/.test(rest)) {
      name = rest.replace(/^[\s,\-–—:]+/, '');
    }
  }

  // 2. Trailing size/weight/count tokens, repeatedly ("TAHINI 16OZ 2 PACK").
  let prev;
  do {
    prev = name;
    name = name.replace(TRAILING_SIZE_RE, '').trim();
  } while (name !== prev && name.length > 0);

  // Everything stripped away (e.g. the whole name was a size)? Fall back to
  // the original rather than returning an empty ingredient name.
  if (!name) name = rawName.trim();

  // 3. Title-case. Only letters are touched; digit-bearing tokens ("365",
  //    "A2") and existing mixed-case words like "McCormick" are preserved by
  //    only re-casing words that are entirely upper- or entirely lower-case.
  name = name
    .split(/\s+/)
    .map((word) => {
      if (/\d/.test(word)) return word;
      if (word === word.toUpperCase() || word === word.toLowerCase()) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word;
    })
    .join(' ');

  return name;
}
