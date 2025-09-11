import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      cycleDay, 
      dueDay,
      cycleDateType = 'same_day',
      cycleDaysBeforeEnd,
      dueDateType = 'same_day', 
      dueDaysBeforeEnd
    } = await request.json();

    // Validate input based on date type
    if (cycleDateType === 'same_day') {
      if (!cycleDay || cycleDay < 1 || cycleDay > 31) {
        return NextResponse.json(
          { error: 'Cycle day must be between 1 and 31' },
          { status: 400 }
        );
      }
    } else if (cycleDateType === 'days_before_end') {
      if (cycleDaysBeforeEnd === undefined || cycleDaysBeforeEnd < 1 || cycleDaysBeforeEnd > 31) {
        return NextResponse.json(
          { error: 'Cycle days before end must be between 1 and 31' },
          { status: 400 }
        );
      }
    } else if (cycleDateType === 'dynamic_anchor') {
      if (!cycleDay || cycleDay < 1 || cycleDay > 31) {
        return NextResponse.json(
          { error: 'Anchor day must be between 1 and 31' },
          { status: 400 }
        );
      }
    }

    if (dueDateType === 'same_day') {
      if (!dueDay || dueDay < 1 || dueDay > 31) {
        return NextResponse.json(
          { error: 'Due day must be between 1 and 31' },
          { status: 400 }
        );
      }
    } else if (dueDateType === 'days_before_end') {
      if (dueDaysBeforeEnd === undefined || dueDaysBeforeEnd < 1 || dueDaysBeforeEnd > 31) {
        return NextResponse.json(
          { error: 'Due days before end must be between 1 and 31' },
          { status: 400 }
        );
      }
    } else if (dueDateType === 'dynamic_anchor') {
      if (!dueDay || dueDay < 1 || dueDay > 31) {
        return NextResponse.json(
          { error: 'Due date anchor must be between 1 and 31' },
          { status: 400 }
        );
      }
    }

    // Verify the card belongs to the user
    const { data: card, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('plaidItemId')
      .eq('id', params.id)
      .single();

    if (cardError || !card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    // Verify ownership through plaid_items
    const { data: plaidItem, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('userId')
      .eq('id', card.plaidItemId)
      .single();

    if (plaidError || !plaidItem || plaidItem.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Helper function to calculate date based on type
    const calculateDate = (
      year: number, 
      month: number, 
      dateType: 'same_day' | 'days_before_end' | 'dynamic_anchor', 
      dayOfMonth?: number, 
      daysBeforeEnd?: number
    ): Date => {
      if (dateType === 'same_day' && dayOfMonth) {
        return new Date(year, month, dayOfMonth);
      } else if (dateType === 'days_before_end' && daysBeforeEnd !== undefined) {
        // Get last day of the month
        const lastDay = new Date(year, month + 1, 0).getDate();
        const calculatedDay = lastDay - daysBeforeEnd;
        return new Date(year, month, Math.max(1, calculatedDay));
      } else if (dateType === 'dynamic_anchor' && dayOfMonth) {
        // For dynamic anchor, use the day of month as the target anchor
        // This is a simplified version - the actual dynamic logic happens in billingCycles.ts
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const anchorDay = Math.min(dayOfMonth, daysInMonth);
        return new Date(year, month, anchorDay);
      }
      throw new Error('Invalid date calculation parameters');
    };

    // Calculate the next statement and due dates based on the manual configuration
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    // Calculate last statement date
    let lastStatementDate = calculateDate(currentYear, currentMonth, cycleDateType, cycleDay, cycleDaysBeforeEnd);
    if (lastStatementDate > today) {
      // Statement day hasn't occurred this month, use last month
      lastStatementDate = calculateDate(currentYear, currentMonth - 1, cycleDateType, cycleDay, cycleDaysBeforeEnd);
    }

    // Calculate next due date (typically 25 days after statement, but use user's preference)
    let nextDueDate: Date;
    
    // Start with the same month as statement
    try {
      nextDueDate = calculateDate(
        lastStatementDate.getFullYear(), 
        lastStatementDate.getMonth(), 
        dueDateType, 
        dueDay, 
        dueDaysBeforeEnd
      );
      
      // If due date is before or same as statement date, move to next month
      if (nextDueDate <= lastStatementDate) {
        nextDueDate = calculateDate(
          lastStatementDate.getFullYear(), 
          lastStatementDate.getMonth() + 1, 
          dueDateType, 
          dueDay, 
          dueDaysBeforeEnd
        );
      }
    } catch (error) {
      // Fallback: due date in next month
      nextDueDate = calculateDate(
        lastStatementDate.getFullYear(), 
        lastStatementDate.getMonth() + 1, 
        dueDateType, 
        dueDay, 
        dueDaysBeforeEnd
      );
    }

    // If the due date has already passed, move to next cycle
    if (nextDueDate < today) {
      lastStatementDate = calculateDate(
        lastStatementDate.getFullYear(), 
        lastStatementDate.getMonth() + 1, 
        cycleDateType, 
        cycleDay, 
        cycleDaysBeforeEnd
      );
      nextDueDate = calculateDate(
        nextDueDate.getFullYear(), 
        nextDueDate.getMonth() + 1, 
        dueDateType, 
        dueDay, 
        dueDaysBeforeEnd
      );
    }

    // Update the credit card with manual dates
    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('credit_cards')
      .update({
        manual_cycle_day: (cycleDateType === 'same_day' || cycleDateType === 'dynamic_anchor') ? cycleDay : null,
        manual_due_day: (dueDateType === 'same_day' || dueDateType === 'dynamic_anchor') ? dueDay : null,
        cycle_date_type: cycleDateType,
        cycle_days_before_end: cycleDateType === 'days_before_end' ? cycleDaysBeforeEnd : null,
        due_date_type: dueDateType,
        due_days_before_end: dueDateType === 'days_before_end' ? dueDaysBeforeEnd : null,
        manual_dates_configured: true,
        lastStatementIssueDate: lastStatementDate.toISOString(),
        nextPaymentDueDate: nextDueDate.toISOString(),
        updatedAt: new Date().toISOString()
      })
      .eq('id', params.id)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update card:', updateError);
      return NextResponse.json(
        { error: 'Failed to update cycle dates' },
        { status: 500 }
      );
    }

    // Trigger billing cycle recalculation and background transaction refresh for this card's item
    try {
      const { calculateBillingCycles } = await import('@/utils/billingCycles');
      await calculateBillingCycles(params.id);

      // Fire-and-forget full transactions refresh for this card's item
      (async () => {
        try {
          const { data: fullCard } = await supabaseAdmin
            .from('credit_cards')
            .select('plaidItemId, plaid_items!inner(id, itemId, institutionName, accessToken)')
            .eq('id', params.id)
            .single();
          const item = (fullCard as any)?.plaid_items;
          if (item?.accessToken) {
            const { decrypt } = await import('@/lib/encryption');
            const { plaidService } = await import('@/services/plaid');
            const accessToken = decrypt(item.accessToken);
            await plaidService.syncTransactions({
              id: item.id,
              itemId: item.itemId,
              institutionName: item.institutionName,
            } as any, accessToken);
            await calculateBillingCycles(params.id);
          }
        } catch (e) {
          console.warn('Background full refresh after manual dates failed:', e);
        }
      })();
    } catch (cycleError) {
      console.error('Failed to recalculate cycles:', cycleError);
      // Don't fail the request if cycle calculation fails
    }

    return NextResponse.json({
      success: true,
      card: updatedCard,
      message: 'Cycle dates updated successfully'
    });

  } catch (error) {
    console.error('Error updating cycle dates:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
