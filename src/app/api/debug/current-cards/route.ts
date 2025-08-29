import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    // Get BOA card specifically for debugging
    const boaCard = await prisma.creditCard.findFirst({
      where: {
        name: 'Customized Cash Rewards Visa Signature',
        plaidItem: {
          user: {
            email: 'mylesethan93@gmail.com'
          }
        }
      },
      include: {
        plaidItem: {
          select: {
            id: true,
            itemId: true,
            institutionName: true,
            status: true,
            lastSyncAt: true,
            errorCode: true,
            errorMessage: true
          }
        }
      }
    });

    if (!boaCard) {
      return NextResponse.json({ error: 'BOA card not found' }, { status: 404 });
    }

    // Calculate staleness using same logic as frontend
    const lastSyncDaysAgo = boaCard.plaidItem?.lastSyncAt ? 
      Math.floor((new Date().getTime() - new Date(boaCard.plaidItem.lastSyncAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
    const connectionStatus = boaCard.plaidItem?.status || 'unknown';
    const hasConnectionIssue = ['error', 'expired', 'disconnected'].includes(connectionStatus);
    const isStale = lastSyncDaysAgo !== null && lastSyncDaysAgo > 14;

    return NextResponse.json({
      cardData: {
        name: boaCard.name,
        id: boaCard.id,
        plaidItem: boaCard.plaidItem
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
        rawLastSync: boaCard.plaidItem?.lastSyncAt?.toISOString()
      }
    });
  } catch (error) {
    console.error('Debug API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}