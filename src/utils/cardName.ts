export function truncateCardName(cardName: string): string {
  // Canonical truncation used by Billing Cycles; adopt across components
  const minLength = 18;
  const maxLength = 25;

  if (!cardName) return '';
  if (cardName.length <= maxLength) return cardName;

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

  let shortened = cardName;
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

