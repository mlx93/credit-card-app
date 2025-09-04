// SAVED: Original syncRecentTransactions implementation with accountId
// This version included accountId which caused schema mismatch error
// Saved for future reference in case we want to add accountId to schema

async syncRecentTransactions(plaidItemRecord: any, accessToken: string): Promise<void> {
  console.log('⚡ RECENT TRANSACTION SYNC (for instant setup)', { itemId: plaidItemRecord.itemId });
  
  // Validate access token format
  if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 10) {
    throw new Error(`Invalid access token: ${accessToken ? 'too short' : 'missing'}`);
  }
  
  console.log(`✅ Access token validation passed for recent sync`);
  
  try {
    console.log(`⚡ Starting RECENT transaction sync for itemId: ${plaidItemRecord.itemId}`);
    
    // Small delay to respect rate limits
    await this.delay(200);
    
    const isCapitalOneItem = this.isCapitalOne(plaidItemRecord.institutionName);
    const endDate = new Date();
    const startDate = new Date();
    
    if (isCapitalOneItem) {
      // Capital One: 3 months for recent sync
      startDate.setMonth(startDate.getMonth() - 3);
      console.log('⚡ Capital One: Requesting 3 months for instant setup');
    } else {
      // Standard institutions: Only 3 months for instant setup (vs 12 months for full sync)
      startDate.setMonth(startDate.getMonth() - 3);
      console.log('⚡ Standard institution: Requesting 3 months for instant setup (vs 12 for full sync)');
    }
    
    console.log(`⚡ RECENT SYNC DATE RANGE: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // Get transactions for the shorter date range
    const transactions = await this.getTransactions(
      accessToken,
      startDate,
      endDate,
      isCapitalOneItem
    );

    console.log(`⚡ Got ${transactions.length} recent transactions for instant setup`);
    
    if (transactions.length === 0) {
      console.warn('⚠️ No recent transactions found - card will show without transaction data');
    }
    
    // Store the transactions (same logic as full sync)
    if (transactions.length > 0) {
      // Batch fetch all credit cards for this plaid item
      const { data: creditCards } = await supabaseAdmin
        .from('credit_cards')
        .select('id, accountId')
        .eq('plaidItemId', plaidItemRecord.id);

      const accountToCardMap = new Map(
        (creditCards || []).map(card => [card.accountId, card.id])
      );

      // ORIGINAL SIMPLE TRANSACTION STRUCTURE (with accountId that caused error)
      const transactionRecords = transactions.map(transaction => ({
        transactionId: transaction.transaction_id,
        creditCardId: accountToCardMap.get(transaction.account_id),
        amount: transaction.amount,
        date: transaction.date,
        name: transaction.name,
        merchantName: transaction.merchant_name,
        category: transaction.personal_finance_category?.primary || 'OTHER',
        pending: transaction.pending || false,
        accountId: transaction.account_id  // <-- THIS CAUSED THE ERROR
      })).filter(t => t.creditCardId); // Only keep transactions for credit cards we have

      console.log(`⚡ Storing ${transactionRecords.length} recent transactions`);

      // Use upsert to add/update transactions
      const { error: insertError } = await supabaseAdmin
        .from('transactions')
        .upsert(transactionRecords, {
          onConflict: 'transactionId',
          ignoreDuplicates: false
        });

      if (insertError) {
        console.error('❌ Error storing recent transactions:', insertError);
        throw insertError;
      }
    }
    
    console.log('✅ Recent transaction sync completed for instant setup');
    
  } catch (error: any) {
    console.error('❌ Recent transaction sync failed:', error);
    throw error;
  }
}