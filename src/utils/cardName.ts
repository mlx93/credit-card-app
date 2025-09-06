export function truncateCardName(cardName: string): string {
  // Canonical truncation used by Billing Cycles; adopt across components
  const minLength = 18;
  const maxLength = 25;

  if (!cardName) return '';
  // Normalize common symbols and whitespace first
  let src = cardName.replace(/[®™]/g, '') // remove trademark symbols
                    .replace(/\s+/g, ' ') // collapse spaces
                    .trim();

  // Insert spaces for common camel-cased brand variants before title-casing
  // e.g., VentureOne -> Venture One, QuicksilverOne -> Quicksilver One, VentureX -> Venture X
  src = src
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2');

  // Title-case for consistency (e.g., BILT -> Bilt), while preserving known brands later
  const toTitle = (s: string) => s
    .split(' ')
    .map(w => w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)
    .join(' ');
  src = toTitle(src);

  // Preserve brand casing for known terms
  src = src
    .replace(/\bBofa\b/g, 'BofA')
    .replace(/\bAmex\b/g, 'Amex');

  // Normalize specific known product names
  src = src
    .replace(/\bVentureone\b/gi, 'Venture One')
    .replace(/\bQuicksilverone\b/gi, 'Quicksilver One')
    .replace(/\bSavorone\b/gi, 'Savor One')
    .replace(/\bVenturex\b/gi, 'Venture X');

  if (src.length <= maxLength) return src;

  const shortenPatterns = [
    // Remove network/marketing suffixes
    { from: /\bVisa Signature\b/gi, to: '' },
    { from: /\bVisa\b/gi, to: '' },
    { from: /\bMastercard\b/gi, to: '' },
    { from: /\bMasterCard\b/gi, to: '' },
    { from: /\bSignature\b/gi, to: '' },

    // Abbreviations
    { from: /\bCustomized\b/gi, to: 'Custom' },
    { from: /\bRewards\b/gi, to: 'Rewards' }, // keep "Rewards" but normalize
    { from: /\bCash Rewards\b/gi, to: 'Cash' },
    { from: /\bPreferred\b/gi, to: 'Pref' },
    { from: /\bUnlimited\b/gi, to: 'Unlmtd' },
    { from: /\bBusiness\b/gi, to: 'Biz' },

    // Bank names
    { from: /\bBank of America\b/gi, to: 'BofA' },
    { from: /\bAmerican Express\b/gi, to: 'Amex' },
  ];

  let shortened = src;
  for (const pattern of shortenPatterns) {
    shortened = shortened.replace(pattern.from, pattern.to);
  }

  shortened = shortened.replace(/\s+/g, ' ').trim();

  if (shortened.length > maxLength) {
    const truncateLength = Math.max(minLength, maxLength - 3);
    shortened = shortened.substring(0, truncateLength) + '...';
  }

  return shortened;
}

// Remove embedded last-4 patterns from names (e.g., "…8484", "•••• 8484", "(8484)", "ending in 8484")
function stripEmbeddedLast4(name: string, mask?: string): string {
  if (!name) return '';
  let out = name;
  // Remove masked markers followed by 4 digits
  out = out.replace(/(?:…|\.{2,}|•{2,}|\*{2,})\s*([0-9]{4})\b/g, '');
  if (mask && /^[0-9]{4}$/.test(mask)) {
    const m = mask;
    // (8484) at end
    out = out.replace(new RegExp(`\n?\s*\(\s*${m}\s*\)\s*$`, 'i'), '');
    // "ending in 8484"
    out = out.replace(new RegExp(`\bending\s+in\s+${m}\b`, 'i'), '');
    // Trailing separators + 8484 at end (place '-' at end of class to avoid ranges)
    const tailClass = `[\u2026.#\s-]*`;
    out = out.replace(new RegExp(`${tailClass}${m}\\s*$`, 'i'), '');
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Public helper: normalize + truncate consistently, removing any embedded last-4
export function normalizeCardDisplayName(name: string, mask?: string): string {
  const stripped = stripEmbeddedLast4(name, mask);
  return truncateCardName(stripped);
}
