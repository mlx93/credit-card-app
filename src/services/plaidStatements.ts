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

export interface StatementPeriod {
  statementId: string;
  startDate: Date | null; // null for most recent if predecessor unknown
  endDate: Date; // statement closing/issue date
  dateSource: 'posted' | 'derived';
  dueDate?: Date | null; // parsed from PDF when available
}

/**
 * Fetches statement metadata for credit card accounts with database caching
 * This is the primary method for getting accurate billing dates from Robinhood
 */
export async function getStatementDates(
  accessToken: string,
  accountId: string,
  plaidItemId?: string
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
    
    // Get plaid item data from database
    let plaidItem: any = null;
    
    if (plaidItemId) {
      // Use provided plaid item ID (more efficient)
      const { data } = await supabaseAdmin
        .from('plaid_items')
        .select('id, statements_data, statements_data_updated')
        .eq('id', plaidItemId)
        .single();
      plaidItem = data;
    } else {
      // Fallback: find by matching decrypted access token
      const { data: allPlaidItems } = await supabaseAdmin
        .from('plaid_items')
        .select('id, access_token, statements_data, statements_data_updated');
      
      if (allPlaidItems) {
        const { decrypt } = await import('@/lib/encryption');
        for (const item of allPlaidItems) {
          try {
            const decryptedToken = decrypt(item.access_token);
            if (decryptedToken === accessToken) {
              plaidItem = item;
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
    }
    
    if (!plaidItem) {
      console.error('Could not find plaid item for access token');
      return null;
    }
    
    let statements: Statement[];
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Check if we have cached statements data that's less than 24 hours old
    if (plaidItem.statements_data && plaidItem.statements_data_updated && 
        new Date(plaidItem.statements_data_updated) > twentyFourHoursAgo) {
      console.log('📋 Using cached statements data from database');
      statements = plaidItem.statements_data as Statement[];
    } else {
      // Fetch fresh statement list from API
      console.log('🔄 Fetching fresh statements list from Plaid API and caching to database');
      const request: StatementsListRequest = {
        access_token: accessToken,
        // Note: start_date and end_date are not valid fields for statementsList
        // The API returns all available statements and we filter on the client side
      };
      
      const response = await plaidClient.statementsList(request);
      statements = response.data.statements;
      
      // Cache the result in database
      await supabaseAdmin
        .from('plaid_items')
        .update({
          statements_data: statements,
          statements_data_updated: new Date().toISOString()
        })
        .eq('id', plaidItem.id);
      
      console.log(`📄 Cached ${statements.length} statements to database`);
    }
    
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
 * List statement periods (end dates and derived start dates) for a specific account
 * - endDate prefers statement.date_posted if present; otherwise derives from year/month
 * - startDate is derived as (next statement's endDate + 1 day). For the newest statement,
 *   startDate may be null if no predecessor exists (caller may choose how to handle).
 */
export async function listStatementPeriods(
  accessToken: string,
  accountId: string,
  monthsBack: number = 13,
  issuerName?: string
): Promise<StatementPeriod[]> {
  // Compute date range for listing
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - Math.max(1, monthsBack));
  const request: StatementsListRequest = {
    access_token: accessToken,
    // Note: Removed start_date and end_date as they're not recognized by this endpoint
    // The API will return all available statements
  };

  const res = await plaidClient.statementsList(request);
  const statements = (res.data.statements || []).filter(s => s.account_id === accountId);

  if (statements.length === 0) return [];

  // Map to endDate with best available precision
  const withEnds = statements.map(s => {
    const posted = (s as any).date_posted ? new Date((s as any).date_posted) : null;
    let endDate: Date;
    let dateSource: 'posted' | 'derived';
    if (posted && !isNaN(posted.getTime())) {
      endDate = posted;
      dateSource = 'posted';
    } else {
      // Derive last day of the statement month as a fallback
      const year = parseInt(s.year, 10);
      const monthIdx = parseInt(s.month, 10) - 1; // 0-based
      // day 0 of next month is last day of current month
      endDate = new Date(year, monthIdx + 1, 0);
      dateSource = 'derived';
    }
    return { statement: s, endDate, dateSource } as const;
  })
  // Sort newest first by end date
  .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());

  // Build periods computing start from the next item (older)
  const periods: StatementPeriod[] = withEnds.map((entry, idx) => {
    const next = withEnds[idx + 1]; // older statement
    const startDate = next ? new Date(next.endDate.getFullYear(), next.endDate.getMonth(), next.endDate.getDate() + 1) : null;
    return {
      statementId: entry.statement.statement_id,
      startDate,
      endDate: entry.endDate,
      dateSource: entry.dateSource,
    };
  });

  // Enrich with PDF-parsed dates when helpful: fill newest startDate (opening date) and dueDate for historical
  try {
    // Helper: normalize PDF text
    const normalize = (buf: Buffer) =>
      buf.toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').replace(/\s+/g, ' ').trim();

    const tryParseDate = (str?: string | null): Date | null => {
      if (!str) return null;
      // Try native Date first for named months
      const d1 = new Date(str);
      if (!isNaN(d1.getTime())) return d1;
      // Try mm/dd/yyyy or mm-dd-yyyy
      const m = str.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
      if (m) {
        const mm = parseInt(m[1], 10) - 1;
        const dd = parseInt(m[2], 10);
        const yy = parseInt(m[3], 10);
        const yyyy = yy < 100 ? 2000 + yy : yy;
        const dt = new Date(yyyy, mm, dd);
        return isNaN(dt.getTime()) ? null : dt;
      }
      return null;
    };

    const parseFromText = (text: string) => {
      const findings: { opening?: Date; closing?: Date; due?: Date } = {};
      const patterns: Array<{ key: 'opening' | 'closing' | 'due'; re: RegExp[] }> = [
        {
          key: 'closing',
          re: [
            /(statement\s+closing\s+date|closing\s+date|cycle\s+end)[:\-\s]*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
            /(statement\s+date)[:\-\s]*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
          ],
        },
        {
          key: 'opening',
          re: [
            /(opening\s+date|cycle\s+start)[:\-\s]*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
            /(statement\s+period)[:\-\s]*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:to|-|–|—)\s*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
          ],
        },
        {
          key: 'due',
          re: [
            /(payment\s+due\s+date|due\s+date)[:\-\s]*([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
          ],
        },
      ];
      for (const p of patterns) {
        for (const re of p.re) {
          const m = text.match(re);
          if (m) {
            if (p.key === 'opening' && re.source.includes('statement\\s+period') && m[2] && m[3]) {
              const o = tryParseDate(m[2]);
              const c = tryParseDate(m[3]);
              if (o) findings.opening = o;
              if (c) findings.closing = c;
              break;
            }
            const d = tryParseDate(m[m.length - 1]);
            if (d) {
              findings[p.key] = d;
              break;
            }
          }
        }
      }
      return findings;
    };

    // Try newest (index 0) if it lacks startDate; also parse due dates for all
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      const needsOpening = i === 0 && !p.startDate;
      const wantsDueDate = true;
      if (!needsOpening && !wantsDueDate) continue;
      try {
        const pdf = await downloadStatementPDF(accessToken, p.statementId);
        if (!pdf) continue;
        const text = normalize(pdf);
        const found = parseFromText(text);
        if (needsOpening && found.opening) p.startDate = found.opening;
        if (wantsDueDate && found.due) p.dueDate = found.due;
        // If closing not posted and found, prefer it
        if ((withEnds[i].dateSource === 'derived') && found.closing) p.endDate = found.closing;
      } catch {}
    }
  } catch {}

  return periods;
}

/**
 * Check if an item has statements support and cache the result in database
 * This prevents repeated API calls on every page load
 */
export async function checkAndCacheStatementsSupport(
  accessToken: string, 
  plaidItemId: string,
  forceRefresh: boolean = false
): Promise<{
  supported: boolean;
  available: boolean;
  enabled: boolean;
}> {
  try {
    // Check if we have cached data that's less than 24 hours old
    if (!forceRefresh) {
      const { data: cachedItem } = await supabaseAdmin
        .from('plaid_items')
        .select('statements_supported, statements_available, statements_enabled, statements_last_checked')
        .eq('id', plaidItemId)
        .single();
      
      if (cachedItem?.statements_last_checked) {
        const lastChecked = new Date(cachedItem.statements_last_checked);
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        if (lastChecked > twentyFourHoursAgo) {
          console.log(`📋 Using cached statements support data for item ${plaidItemId}`);
          return {
            supported: cachedItem.statements_supported || false,
            available: cachedItem.statements_available || false,
            enabled: cachedItem.statements_enabled || false
          };
        }
      }
    }
    
    // Fetch fresh data from Plaid API
    console.log(`🔄 Fetching fresh statements support data for item ${plaidItemId}`);
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    
    const item = itemResponse.data.item;
    
    const result = {
      supported: item.available_products?.includes('statements') || false,
      available: item.consented_products?.includes('statements') || false,
      enabled: item.products.includes('statements')
    };
    
    // Cache the result in database
    await supabaseAdmin
      .from('plaid_items')
      .update({
        statements_supported: result.supported,
        statements_available: result.available,
        statements_enabled: result.enabled,
        statements_last_checked: new Date().toISOString()
      })
      .eq('id', plaidItemId);
    
    console.log(`✅ Cached statements support: supported=${result.supported}, available=${result.available}, enabled=${result.enabled}`);
    
    return result;
    
  } catch (error) {
    console.error('Error checking statements support:', error);
    return {
      supported: false,
      available: false,
      enabled: false
    };
  }
}

/**
 * Legacy function for backwards compatibility
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
