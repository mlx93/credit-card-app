import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateBillingCycles } from '@/utils/billingCycles';

export async function POST() {
  try {
    console.log('🔧 FIX CYCLES DEBUG ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all credit cards for the user
    const creditCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        }
      },
      include: {
        plaidItem: true,
        transactions: {
          orderBy: { date: 'desc' },
          take: 100 // Get sample transactions
        }
      }
    });

    console.log(`Found ${creditCards.length} credit cards`);

    const results = [];
    
    for (const card of creditCards) {
      console.log(`\n=== Processing ${card.name} ===`);
      console.log(`Card has ${card.transactions.length} sample transactions (limited to 100)`);
      
      // Get transaction date range
      if (card.transactions.length > 0) {
        const dates = card.transactions.map(t => t.date);
        console.log('Transaction date range:', {
          newest: dates[0],
          oldest: dates[dates.length - 1]
        });
      }
      
      // Delete ALL existing billing cycles for this card to force complete regeneration
      const deleteResult = await prisma.billingCycle.deleteMany({
        where: { creditCardId: card.id }
      });
      console.log(`Deleted ${deleteResult.count} existing cycles for ${card.name}`);
      
      // Regenerate cycles
      console.log('Regenerating cycles...');
      const cycles = await calculateBillingCycles(card.id);
      console.log(`Generated ${cycles.length} cycles`);
      
      // Analyze the results
      const historicalCycles = cycles.filter(c => c.statementBalance !== undefined && c.endDate < new Date());
      const uniqueAmounts = [...new Set(historicalCycles.map(c => c.statementBalance))];
      
      console.log('Cycle analysis:', {
        totalCycles: cycles.length,
        historicalCycles: historicalCycles.length,
        uniqueStatementAmounts: uniqueAmounts.length,
        amounts: uniqueAmounts.slice(0, 5) // Show first 5 unique amounts
      });
      
      // Check if all historical cycles have the same amount (the bug)
      const hasIssuue = uniqueAmounts.length === 1 && historicalCycles.length > 1;
      
      if (hasIssuue) {
        console.log('⚠️ ISSUE DETECTED: All historical cycles have the same amount:', uniqueAmounts[0]);
      } else {
        console.log('✅ Historical cycles have different amounts');
      }
      
      // Sample cycle details
      console.log('Sample historical cycles:');
      historicalCycles.slice(0, 3).forEach(c => {
        console.log({
          period: `${c.startDate.toLocaleDateString()} - ${c.endDate.toLocaleDateString()}`,
          statementBalance: c.statementBalance,
          totalSpend: c.totalSpend,
          transactionCount: c.transactionCount
        });
      });
      
      results.push({
        cardName: card.name,
        cyclesGenerated: cycles.length,
        historicalCycles: historicalCycles.length,
        uniqueAmounts: uniqueAmounts.length,
        hasIssue: hasIssuue,
        sampleAmounts: uniqueAmounts.slice(0, 5),
        lastStatementBalance: card.lastStatementBalance
      });
    }

    console.log('\n🔧 FIX CYCLES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Billing cycles fixed and regenerated',
      results 
    });
  } catch (error) {
    console.error('🔧 FIX CYCLES ERROR:', error);
    return NextResponse.json({ error: 'Failed to fix cycles' }, { status: 500 });
  }
}