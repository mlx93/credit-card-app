// Quick test of Capital One detection logic
function isCapitalOneCard(institutionName, cardName) {
  const capitalOneIndicators = ['capital one', 'quicksilver', 'venture', 'savor', 'spark'];
  const institutionMatch = institutionName?.toLowerCase().includes('capital one') || false;
  const cardMatch = capitalOneIndicators.some(indicator => 
    cardName?.toLowerCase().includes(indicator)
  ) || false;
  
  return institutionMatch || cardMatch;
}

// Test with actual Amex data
const amexTest = isCapitalOneCard('American Express', 'Platinum Card®');
console.log('Amex test result:', amexTest);
console.log('Should be false');

// Test with actual Capital One data  
const capOneTest = isCapitalOneCard('Capital One', 'Quicksilver');
console.log('Capital One test result:', capOneTest);
console.log('Should be true');