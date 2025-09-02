import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-current-cards',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    // Get BOA card specifically for debugging
    const { data: boaCards, error } = await supabaseAdmin
      .from('credit_cards')
      .select(`
        *,
        plaid_items!inner (
          id,
          item_id,
          institution_name,
          status,
          last_sync_at,
          error_code,
          error_message,
          users!inner(email)
        )
      `)
      .eq('name', 'Customized Cash Rewards Visa Signature')
      .eq('plaid_items.users.email', 'mylesethan93@gmail.com')
      .limit(1);
    
    if (error) {
      console.error('Error fetching BOA card:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }
    
    const boaCard = boaCards?.[0];

    if (!boaCard) {
      return NextResponse.json({ error: 'BOA card not found' }, { status: 404 });
    }

    // Calculate staleness using same logic as frontend
    const lastSyncDaysAgo = boaCard.plaid_items?.last_sync_at ? 
      Math.floor((new Date().getTime() - new Date(boaCard.plaid_items.last_sync_at).getTime()) / (1000 * 60 * 60 * 24)) : null;
    const connectionStatus = boaCard.plaid_items?.status || 'unknown';
    const hasConnectionIssue = ['error', 'expired', 'disconnected'].includes(connectionStatus);
    const isStale = lastSyncDaysAgo !== null && lastSyncDaysAgo > 14;

    return NextResponse.json({
      cardData: {
        name: boaCard.name,
        id: boaCard.id,
        plaidItem: boaCard.plaid_items ? {
          id: boaCard.plaid_items.id,
          itemId: boaCard.plaid_items.item_id,
          institutionName: boaCard.plaid_items.institution_name,
          status: boaCard.plaid_items.status,
          lastSyncAt: boaCard.plaid_items.last_sync_at,
          errorCode: boaCard.plaid_items.error_code,
          errorMessage: boaCard.plaid_items.error_message
        } : null
      },
      frontendLogic: {
        connectionStatus,
        hasConnectionIssue,
        lastSyncDaysAgo,
        isStale,
        shouldShowWarning: hasConnectionIssue || isStale,
        warningType: hasConnectionIssue ? 'RED (Connection Issue)' : isStale ? 'YELLOW (Stale Data)' : 'NONE'
      },
      debug: {
        currentTime: new Date().toISOString(),
        rawLastSync: boaCard.plaid_items?.last_sync_at ? new Date(boaCard.plaid_items.last_sync_at).toISOString() : null
      }
    });
  } catch (error) {
    console.error('Debug API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}