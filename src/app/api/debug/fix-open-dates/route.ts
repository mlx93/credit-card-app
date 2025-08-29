import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST() {
  try {
    console.log('🔧 FIX OPEN DATES ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    
    // Find cards with future open dates
    const cardsWithFutureDates = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        },
        openDate: {
          gt: now // Greater than current date = future date
        }
      },
      include: {
        plaidItem: true
      }
    });

    console.log(`Found ${cardsWithFutureDates.length} cards with future open dates`);

    const fixes = [];
    
    for (const card of cardsWithFutureDates) {
      const currentOpenDate = card.openDate;
      
      if (currentOpenDate) {
        // Fix common year mistakes: 2025 -> 2024, 2026 -> 2024, etc.
        const correctedDate = new Date(currentOpenDate);
        
        // If the year is 2025 or later, change it to 2024
        if (correctedDate.getFullYear() >= 2025) {
          correctedDate.setFullYear(2024);
          
          // If the corrected date is still in the future (later this year), 
          // move it to the same date last year
          if (correctedDate > now) {
            correctedDate.setFullYear(2023);
          }
          
          console.log(`Fixing ${card.name}: ${currentOpenDate.toDateString()} -> ${correctedDate.toDateString()}`);
          
          // Update the card with the corrected date
          await prisma.creditCard.update({
            where: { id: card.id },
            data: { openDate: correctedDate }
          });
          
          fixes.push({
            cardName: card.name,
            originalDate: currentOpenDate.toDateString(),
            correctedDate: correctedDate.toDateString(),
            originalYear: currentOpenDate.getFullYear(),
            correctedYear: correctedDate.getFullYear()
          });
        }
      }
    }

    console.log('🔧 OPEN DATE FIXES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Open dates fixed successfully',
      fixesApplied: fixes.length,
      fixes
    });
  } catch (error) {
    console.error('🔧 FIX OPEN DATES ERROR:', error);
    return NextResponse.json({ error: 'Failed to fix open dates' }, { status: 500 });
  }
}