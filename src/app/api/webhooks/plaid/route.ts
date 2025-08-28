import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { prisma } from '@/lib/db';
import { plaidService } from '@/services/plaid';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { webhook_type, webhook_code, item_id, error } = body;

    console.log('Plaid webhook received:', { webhook_type, webhook_code, item_id });

    if (error) {
      console.error('Plaid webhook error:', error);
      return NextResponse.json({ error: 'Webhook error' }, { status: 400 });
    }

    switch (webhook_type) {
      case 'TRANSACTIONS':
        await handleTransactionWebhook(webhook_code, item_id);
        break;
      case 'LIABILITIES':
        await handleLiabilitiesWebhook(webhook_code, item_id);
        break;
      case 'ITEM':
        await handleItemWebhook(webhook_code, item_id);
        break;
      default:
        console.log(`Unhandled webhook type: ${webhook_type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleTransactionWebhook(webhookCode: string, itemId: string) {
  switch (webhookCode) {
    case 'INITIAL_UPDATE':
    case 'HISTORICAL_UPDATE':
    case 'DEFAULT_UPDATE':
      console.log(`Processing transaction update for item: ${itemId}`);
      await plaidService.syncTransactions(itemId);
      break;
    case 'TRANSACTIONS_REMOVED':
      console.log(`Transactions removed for item: ${itemId}`);
      break;
    default:
      console.log(`Unhandled transaction webhook code: ${webhookCode}`);
  }
}

async function handleLiabilitiesWebhook(webhookCode: string, itemId: string) {
  switch (webhookCode) {
    case 'DEFAULT_UPDATE':
      console.log(`Processing liabilities update for item: ${itemId}`);
      const plaidItem = await prisma.plaidItem.findUnique({
        where: { itemId },
      });

      if (plaidItem) {
        await plaidService.syncAccounts(plaidItem.accessToken, itemId);
      }
      break;
    default:
      console.log(`Unhandled liabilities webhook code: ${webhookCode}`);
  }
}

async function handleItemWebhook(webhookCode: string, itemId: string) {
  switch (webhookCode) {
    case 'ERROR':
      console.log(`Item error for: ${itemId}`);
      await prisma.plaidItem.update({
        where: { itemId },
        data: { updatedAt: new Date() },
      });
      break;
    case 'PENDING_EXPIRATION':
      console.log(`Item pending expiration: ${itemId}`);
      break;
    case 'USER_PERMISSION_REVOKED':
      console.log(`User permission revoked for item: ${itemId}`);
      await prisma.plaidItem.delete({
        where: { itemId },
      });
      break;
    default:
      console.log(`Unhandled item webhook code: ${webhookCode}`);
  }
}