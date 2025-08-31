import { createClient } from '@supabase/supabase-js'

// Database type definitions based on Prisma schema
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          emailVerified: string | null
          name: string | null
          image: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id?: string
          email: string
          emailVerified?: string | null
          name?: string | null
          image?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Update: {
          id?: string
          email?: string
          emailVerified?: string | null
          name?: string | null
          image?: string | null
          createdAt?: string
          updatedAt?: string
        }
      }
      accounts: {
        Row: {
          id: string
          userId: string
          type: string
          provider: string
          providerAccountId: string
          refresh_token: string | null
          access_token: string | null
          expires_at: number | null
          token_type: string | null
          scope: string | null
          id_token: string | null
          session_state: string | null
        }
        Insert: {
          id?: string
          userId: string
          type: string
          provider: string
          providerAccountId: string
          refresh_token?: string | null
          access_token?: string | null
          expires_at?: number | null
          token_type?: string | null
          scope?: string | null
          id_token?: string | null
          session_state?: string | null
        }
        Update: {
          id?: string
          userId?: string
          type?: string
          provider?: string
          providerAccountId?: string
          refresh_token?: string | null
          access_token?: string | null
          expires_at?: number | null
          token_type?: string | null
          scope?: string | null
          id_token?: string | null
          session_state?: string | null
        }
      }
      sessions: {
        Row: {
          id: string
          sessionToken: string
          userId: string
          expires: string
        }
        Insert: {
          id?: string
          sessionToken: string
          userId: string
          expires: string
        }
        Update: {
          id?: string
          sessionToken?: string
          userId?: string
          expires?: string
        }
      }
      verificationtokens: {
        Row: {
          identifier: string
          token: string
          expires: string
        }
        Insert: {
          identifier: string
          token: string
          expires: string
        }
        Update: {
          identifier?: string
          token?: string
          expires?: string
        }
      }
      plaid_items: {
        Row: {
          id: string
          userId: string
          itemId: string
          accessToken: string
          institutionId: string | null
          institutionName: string | null
          status: string
          lastSyncAt: string | null
          errorCode: string | null
          errorMessage: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id?: string
          userId: string
          itemId: string
          accessToken: string
          institutionId?: string | null
          institutionName?: string | null
          status?: string
          lastSyncAt?: string | null
          errorCode?: string | null
          errorMessage?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Update: {
          id?: string
          userId?: string
          itemId?: string
          accessToken?: string
          institutionId?: string | null
          institutionName?: string | null
          status?: string
          lastSyncAt?: string | null
          errorCode?: string | null
          errorMessage?: string | null
          createdAt?: string
          updatedAt?: string
        }
      }
      credit_cards: {
        Row: {
          id: string
          plaidItemId: string
          accountId: string
          name: string
          officialName: string | null
          subtype: string | null
          mask: string | null
          balanceCurrent: number | null
          balanceAvailable: number | null
          balanceLimit: number | null
          isoCurrencyCode: string | null
          lastStatementIssueDate: string | null
          lastStatementBalance: number | null
          minimumPaymentAmount: number | null
          nextPaymentDueDate: string | null
          openDate: string | null
          annualFee: number | null
          annualFeeDueDate: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id?: string
          plaidItemId: string
          accountId: string
          name: string
          officialName?: string | null
          subtype?: string | null
          mask?: string | null
          balanceCurrent?: number | null
          balanceAvailable?: number | null
          balanceLimit?: number | null
          isoCurrencyCode?: string | null
          lastStatementIssueDate?: string | null
          lastStatementBalance?: number | null
          minimumPaymentAmount?: number | null
          nextPaymentDueDate?: string | null
          openDate?: string | null
          annualFee?: number | null
          annualFeeDueDate?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Update: {
          id?: string
          plaidItemId?: string
          accountId?: string
          name?: string
          officialName?: string | null
          subtype?: string | null
          mask?: string | null
          balanceCurrent?: number | null
          balanceAvailable?: number | null
          balanceLimit?: number | null
          isoCurrencyCode?: string | null
          lastStatementIssueDate?: string | null
          lastStatementBalance?: number | null
          minimumPaymentAmount?: number | null
          nextPaymentDueDate?: string | null
          openDate?: string | null
          annualFee?: number | null
          annualFeeDueDate?: string | null
          createdAt?: string
          updatedAt?: string
        }
      }
      aprs: {
        Row: {
          id: string
          creditCardId: string
          aprType: string
          aprPercentage: number
          balanceSubjectToApr: number | null
          interestChargeAmount: number | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id?: string
          creditCardId: string
          aprType: string
          aprPercentage: number
          balanceSubjectToApr?: number | null
          interestChargeAmount?: number | null
          createdAt?: string
          updatedAt?: string
        }
        Update: {
          id?: string
          creditCardId?: string
          aprType?: string
          aprPercentage?: number
          balanceSubjectToApr?: number | null
          interestChargeAmount?: number | null
          createdAt?: string
          updatedAt?: string
        }
      }
      billing_cycles: {
        Row: {
          id: string
          creditCardId: string
          startDate: string
          endDate: string
          statementBalance: number | null
          minimumPayment: number | null
          dueDate: string | null
          totalSpend: number | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id?: string
          creditCardId: string
          startDate: string
          endDate: string
          statementBalance?: number | null
          minimumPayment?: number | null
          dueDate?: string | null
          totalSpend?: number | null
          createdAt?: string
          updatedAt?: string
        }
        Update: {
          id?: string
          creditCardId?: string
          startDate?: string
          endDate?: string
          statementBalance?: number | null
          minimumPayment?: number | null
          dueDate?: string | null
          totalSpend?: number | null
          createdAt?: string
          updatedAt?: string
        }
      }
      transactions: {
        Row: {
          id: string
          plaidItemId: string
          creditCardId: string | null
          transactionId: string
          amount: number
          isoCurrencyCode: string | null
          date: string
          authorizedDate: string | null
          name: string
          merchantName: string | null
          category: string | null
          categoryId: string | null
          subcategory: string | null
          accountOwner: string | null
          createdAt: string
          updatedAt: string
        }
        Insert: {
          id?: string
          plaidItemId: string
          creditCardId?: string | null
          transactionId: string
          amount: number
          isoCurrencyCode?: string | null
          date: string
          authorizedDate?: string | null
          name: string
          merchantName?: string | null
          category?: string | null
          categoryId?: string | null
          subcategory?: string | null
          accountOwner?: string | null
          createdAt?: string
          updatedAt?: string
        }
        Update: {
          id?: string
          plaidItemId?: string
          creditCardId?: string | null
          transactionId?: string
          amount?: number
          isoCurrencyCode?: string | null
          date?: string
          authorizedDate?: string | null
          name?: string
          merchantName?: string | null
          category?: string | null
          categoryId?: string | null
          subcategory?: string | null
          accountOwner?: string | null
          createdAt?: string
          updatedAt?: string
        }
      }
    }
  }
}

// Get from your Supabase dashboard
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey)

// For server-side operations with service role key
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const supabaseAdmin = supabaseServiceKey 
  ? createClient<Database>(supabaseUrl, supabaseServiceKey)
  : supabase