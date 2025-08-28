# Credit Card Manager

A comprehensive credit card management application built with Next.js and Plaid integration. Track your spending, billing cycles, due dates, and calculate APR costs across all your credit cards.

## Features

- **Secure Plaid Integration**: Connect your credit cards without storing credentials
- **Billing Cycle Tracking**: View spend by billing cycle with automatic cycle detection
- **Due Date Monitoring**: Never miss a payment with due date tracking and alerts
- **APR Calculator**: Understand the cost of carrying balances
- **Spending Analytics**: Detailed insights into spending patterns and categories
- **Real-time Updates**: Webhook integration for automatic transaction updates
- **Multi-card Aggregation**: View data across all connected credit cards

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Database**: SQLite with Prisma ORM
- **Authentication**: NextAuth.js with Google OAuth
- **Banking API**: Plaid for secure financial data access
- **UI**: Tailwind CSS with Lucide React icons
- **Language**: TypeScript

## Getting Started

### Prerequisites

1. **Plaid Account**: Sign up at [Plaid](https://plaid.com) and get your API keys
2. **Google OAuth**: Set up OAuth credentials in Google Cloud Console

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   Copy `.env.local` and update with your credentials:
   ```bash
   # Plaid Configuration
   PLAID_CLIENT_ID=your_plaid_client_id
   PLAID_SECRET=your_plaid_secret
   PLAID_ENV=sandbox # or development/production
   
   # Database
   DATABASE_URL="file:./dev.db"
   
   # NextAuth
   NEXTAUTH_SECRET=your_nextauth_secret
   NEXTAUTH_URL=http://localhost:3000
   
   # Google OAuth
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   
   # App Settings  
   APP_URL=http://localhost:3000
   ```

3. **Set up the database**:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Key Components

### Plaid Integration
- **Link Token Creation**: Secure token generation for Plaid Link
- **Account Syncing**: Automatic credit card account discovery
- **Transaction Sync**: 24 months of transaction history
- **Webhook Handling**: Real-time updates for new transactions

### Billing Cycle Logic
- **Automatic Detection**: Smart billing cycle calculation from statement dates
- **Spend Tracking**: Transaction aggregation by billing period
- **Due Date Calculation**: Estimated payment due dates

### Security Features
- **No Credential Storage**: All banking credentials handled by Plaid
- **Session Management**: Secure user authentication with NextAuth
- **Data Encryption**: Secure token storage and API communication

## API Endpoints

- `POST /api/auth/[...nextauth]` - NextAuth authentication
- `POST /api/plaid/link-token` - Generate Plaid Link token
- `POST /api/plaid/exchange-token` - Exchange public token for access token
- `POST /api/webhooks/plaid` - Handle Plaid webhooks
- `POST /api/sync` - Manual data synchronization

## Database Schema

The application uses Prisma with the following key models:
- **User**: User accounts and authentication
- **PlaidItem**: Connected financial institutions
- **CreditCard**: Credit card account details
- **Transaction**: Credit card transactions
- **BillingCycle**: Calculated billing periods
- **APR**: Annual Percentage Rate information

## Deployment

### Environment Setup
1. Set up production Plaid credentials
2. Configure production database (PostgreSQL recommended)
3. Set up webhook endpoints
4. Configure Google OAuth for production domain

### Webhook Configuration
Set your webhook URL in Plaid Dashboard:
```
https://yourdomain.com/api/webhooks/plaid
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
