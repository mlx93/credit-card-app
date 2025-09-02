# API Endpoint Security Audit

## 🔴 CRITICAL RISK - Debug Endpoints (40 endpoints)
These expose sensitive data and MUST be admin-only:

### `/api/debug/*` folder (38 endpoints):
- amex-filtering-debug
- amex-historical-debug
- auth-debug
- boa-billing-debug
- boa-june-check
- capital-one-full-debug
- capital-one-jsx
- capital-one-limits
- capital-one-sync
- card-open-dates
- connection-debug
- current-cards
- data-audit
- data-repair
- database ✅ SECURED
- encryption
- fix-cycles
- fix-future-dates
- fix-incorrect-open-dates
- fix-open-dates-from-transactions
- fix-open-dates
- force-fix-boa-date
- full-pipeline
- google-oauth-check
- inspect-boa-data
- link-token-test
- link-token
- plaid-api-explorer
- plaid-categories
- plaid-limits
- plaid-raw-data
- plaid-status
- plaid-transactions
- regenerate-cycles
- smart-fix-boa-cycles
- sync-capital-one
- test-link-token
- transaction-sample
- transactions
- user-stats ✅ SECURED
- verify-refresh-pipeline

### Other debug endpoints (7):
- debug-amex-date
- debug-api-response
- debug-cap-one
- debug-cards
- debug-cycle-limits
- debug-cycles
- debug-final
- debug-transactions ✅ SECURED

## 🟠 HIGH RISK - Test/Fix Endpoints (5 endpoints)
- test/transactions
- test-schema
- auth/test
- auth/test-email
- fix-cycles

## 🟡 MEDIUM RISK - Admin Operations (2 endpoints)
- billing-cycles/regenerate
- billing-cycles/status

## 🟢 LOW RISK - User-Specific Endpoints (16 endpoints)
These are already protected by authentication but should be reviewed:

### Auth endpoints (3):
- auth/[...nextauth]
- auth/send-code
- auth/verify-code

### User data endpoints (5):
- user/analytics
- user/billing-cycles
- user/credit-cards
- user/credit-cards/update-limit
- user/transactions

### Plaid integration (5):
- plaid/exchange-token
- plaid/link-token
- plaid/reconnect
- plaid/remove-connection
- plaid/update-complete

### Other (3):
- cards/[cardId]/manual-limit
- sync
- webhooks/plaid

## TOTAL: 72 endpoints
- 🔴 Critical Risk (Debug): 45 endpoints
- 🟠 High Risk (Test/Fix): 5 endpoints  
- 🟡 Medium Risk (Admin Ops): 2 endpoints
- 🟢 Low Risk (User/Auth): 20 endpoints

## SECURITY STATUS:
- ✅ Secured: 3 endpoints
- ⚠️ Need Securing: 69 endpoints