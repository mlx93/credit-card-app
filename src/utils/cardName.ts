export function truncateCardName(cardName: string): string {
  // Canonical truncation used by Billing Cycles; adopt across components
  const minLength = 18;
  const maxLength = 25;

  if (!cardName) return '';
  // Normalize common symbols and whitespace first
  let src = cardName.replace(/[®™]/g, '') // remove trademark symbols
                    .replace(/\s+/g, ' ') // collapse spaces
                    .trim();

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
