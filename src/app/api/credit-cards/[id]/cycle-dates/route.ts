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

    const { cycleDay, dueDay } = await request.json();

    // Validate input
    if (!cycleDay || !dueDay) {
      return NextResponse.json(
        { error: 'Both cycle day and due day are required' },
        { status: 400 }
      );
    }

    if (cycleDay < 1 || cycleDay > 31 || dueDay < 1 || dueDay > 31) {
      return NextResponse.json(
        { error: 'Days must be between 1 and 31' },
        { status: 400 }
      );
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

    // Calculate the next statement and due dates based on the manual days
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    // Calculate last statement date
    let lastStatementDate = new Date(currentYear, currentMonth, cycleDay);
    if (cycleDay > currentDay) {
      // Statement day hasn't occurred this month, use last month
      lastStatementDate.setMonth(lastStatementDate.getMonth() - 1);
    }

    // Calculate next due date
    let nextDueDate = new Date(lastStatementDate);
    if (dueDay > cycleDay) {
      // Due date is in the same month as statement
      nextDueDate.setDate(dueDay);
    } else {
      // Due date is in the following month
      nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      nextDueDate.setDate(dueDay);
    }

    // If the due date has already passed, move to next cycle
    if (nextDueDate < today) {
      lastStatementDate.setMonth(lastStatementDate.getMonth() + 1);
      nextDueDate.setMonth(nextDueDate.getMonth() + 1);
    }

    // Update the credit card with manual dates
    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('credit_cards')
      .update({
        manual_cycle_day: cycleDay,
        manual_due_day: dueDay,
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

    // Trigger billing cycle recalculation
    try {
      const { calculateBillingCycles } = await import('@/utils/billingCycles');
      await calculateBillingCycles(params.id);
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