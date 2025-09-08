import { plaidClient } from '@/lib/plaid';
import { 
  StatementsListRequest,
  StatementsDownloadRequest,
  StatementsRefreshRequest,
  Statement
} from 'plaid';
import { supabaseAdmin } from '@/lib/supabase';

interface StatementDates {
  statementDate: Date;
  dueDate: Date | null;
  openDate: Date | null;
  closeDate: Date | null;
  confidence: number;
  source: string;
}

/**
 * Fetches statement metadata for credit card accounts
 * This is the primary method for getting accurate billing dates from Robinhood
 */
export async function getStatementDates(
  accessToken: string,
  accountId: string
): Promise<StatementDates | null> {
  try {
    console.log('📄 Fetching statement metadata from Plaid Statements API...');
    
    // Check if statements product is available
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    
    const hasStatements = itemResponse.data.item.products.includes('statements') ||
                          itemResponse.data.item.consented_products?.includes('statements');
    
    if (!hasStatements) {
      console.log('⚠️ Statements product not available for this item');
      return null;
    }
    
    // Fetch statement list
    const request: StatementsListRequest = {
      access_token: accessToken,
      // Get statements from the last 6 months
      start_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0]
    };
    
    const response = await plaidClient.statementsList(request);
    const statements = response.data.statements;
    
    console.log(`Found ${statements.length} statements`);
    
    // Filter for the specific account
    const accountStatements = statements.filter(s => s.account_id === accountId);
    
    if (accountStatements.length === 0) {
      console.log('No statements found for this account');
      return null;
    }
    
    // Sort by date to get most recent
    const sortedStatements = accountStatements.sort((a, b) => 
      new Date(b.year + '-' + b.month.padStart(2, '0') + '-01').getTime() - 
      new Date(a.year + '-' + a.month.padStart(2, '0') + '-01').getTime()
    );
    
    const mostRecent = sortedStatements[0];
    
    // Extract dates from statement metadata
    const statementDate = parseStatementDate(mostRecent);
    const dueDate = calculateDueDate(statementDate);
    
    // For open/close dates, we need to look at the statement period
    // The statement typically covers a period ending on the statement date
    const closeDate = statementDate;
    const openDate = new Date(closeDate);
    openDate.setMonth(openDate.getMonth() - 1);
    openDate.setDate(openDate.getDate() + 1);
    
    console.log('✅ Statement dates extracted:');
    console.log(`   Statement: ${statementDate.toISOString().split('T')[0]}`);
    console.log(`   Period: ${openDate.toISOString().split('T')[0]} to ${closeDate.toISOString().split('T')[0]}`);
    console.log(`   Due: ${dueDate?.toISOString().split('T')[0]}`);
    
    return {
      statementDate,
      dueDate,
      openDate,
      closeDate,
      confidence: 0.95, // High confidence from official statements
      source: 'statements_api'
    };
    
  } catch (error: any) {
    console.error('Error fetching statements:', error);
    
    // Check if it's a product not supported error
    if (error.response?.data?.error_code === 'PRODUCT_NOT_READY' ||
        error.response?.data?.error_code === 'PRODUCT_NOT_SUPPORTED') {
      console.log('ℹ️ Statements product not supported for this institution');
    }
    
    return null;
  }
}

/**
 * Parse statement metadata to extract the actual statement date
 */
function parseStatementDate(statement: Statement): Date {
  // If date_posted is available, use it
  if (statement.date_posted) {
    return new Date(statement.date_posted);
  }
  
  // Otherwise, estimate from month/year
  // Statements typically close at the end of the month
  const year = parseInt(statement.year);
  const month = parseInt(statement.month) - 1; // JS months are 0-indexed
  
  // Get the last day of the statement month
  const date = new Date(year, month + 1, 0); // Day 0 of next month = last day of current month
  
  return date;
}

/**
 * Calculate due date from statement date (typically 25 days later)
 */
function calculateDueDate(statementDate: Date): Date {
  const dueDate = new Date(statementDate);
  dueDate.setDate(dueDate.getDate() + 25);
  return dueDate;
}

/**
 * Refresh statements to get the latest data
 */
export async function refreshStatements(
  accessToken: string,
  startDate?: Date,
  endDate?: Date
): Promise<boolean> {
  try {
    console.log('🔄 Refreshing statements...');
    
    const request: StatementsRefreshRequest = {
      access_token: accessToken,
      start_date: (startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
        .toISOString().split('T')[0],
      end_date: (endDate || new Date()).toISOString().split('T')[0]
    };
    
    const response = await plaidClient.statementsRefresh(request);
    
    console.log('✅ Statement refresh initiated');
    console.log(`   Request ID: ${response.data.request_id}`);
    
    return true;
    
  } catch (error) {
    console.error('Error refreshing statements:', error);
    return false;
  }
}

/**
 * Update Robinhood credit card with statement-based dates
 */
export async function updateRobinhoodFromStatements(
  accessToken: string,
  accountId: string,
  creditCardId: string
): Promise<boolean> {
  try {
    const statementDates = await getStatementDates(accessToken, accountId);
    
    if (!statementDates) {
      console.log('⚠️ No statement data available');
      return false;
    }
    
    const updateData: any = {
      lastStatementIssueDate: statementDates.statementDate.toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (statementDates.dueDate) {
      updateData.nextPaymentDueDate = statementDates.dueDate.toISOString();
    }
    
    // Also update open date if we have it
    if (statementDates.openDate) {
      // This would be the cycle open date, not card open date
      // We could use this to improve billing cycle calculations
      console.log(`📅 Current cycle: ${statementDates.openDate.toISOString().split('T')[0]} to ${statementDates.closeDate?.toISOString().split('T')[0]}`);
    }
    
    const { error } = await supabaseAdmin
      .from('credit_cards')
      .update(updateData)
      .eq('id', creditCardId);
    
    if (error) {
      console.error('Failed to update credit card:', error);
      return false;
    }
    
    console.log(`✅ Updated Robinhood card with statement dates (${(statementDates.confidence * 100).toFixed(0)}% confidence)`);
    return true;
    
  } catch (error) {
    console.error('Error updating from statements:', error);
    return false;
  }
}

/**
 * Download and parse statement PDF (optional - for more detailed extraction)
 */
export async function downloadStatementPDF(
  accessToken: string,
  statementId: string
): Promise<Buffer | null> {
  try {
    console.log('📥 Downloading statement PDF...');
    
    const request: StatementsDownloadRequest = {
      access_token: accessToken,
      statement_id: statementId
    };
    
    const response = await plaidClient.statementsDownload(request);
    
    // The response contains the PDF as a buffer
    // You would need a PDF parser to extract specific fields
    console.log('✅ Statement PDF downloaded');
    
    return response.data as any; // Type assertion needed as Plaid types might not be complete
    
  } catch (error) {
    console.error('Error downloading statement:', error);
    return null;
  }
}

/**
 * Check if an item has statements support and try to enable it
 */
export async function checkStatementsSupport(accessToken: string): Promise<{
  supported: boolean;
  available: boolean;
  enabled: boolean;
}> {
  try {
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    
    const item = itemResponse.data.item;
    
    return {
      supported: item.available_products?.includes('statements') || false,
      available: item.consented_products?.includes('statements') || false,
      enabled: item.products.includes('statements')
    };
    
  } catch (error) {
    console.error('Error checking statements support:', error);
    return {
      supported: false,
      available: false,
      enabled: false
    };
  }
}