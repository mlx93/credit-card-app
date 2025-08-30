# Supabase Migration Guide

## Step 1: Create Supabase Project ✅

Project created with connection string:
```
postgres://[USERNAME]:[PASSWORD]@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x
```

## Step 2: Update Environment Variables

Update both `.env.local` and `.env` files:

```bash
# Old Prisma Cloud URL (to be replaced)
# DATABASE_URL="postgres://d4689ad2e71d1cd0f4fe972446b34ed88984e624f8ad4e7eae83fca89c44424d:[REDACTED]@db.prisma.io:5432/postgres?sslmode=require"

# New Supabase URL (pooled connection for serverless)
DATABASE_URL="postgres://[USERNAME]:[PASSWORD]@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x"
```

## Step 3: Push Schema to Supabase

```bash
# Copy env.local to .env for Prisma CLI
cp .env.local .env

# Generate Prisma client
npx prisma generate

# Push schema to Supabase
npx prisma db push

# Verify the migration worked
npx prisma studio
```

## Step 4: Update All Scripts

The following scripts need to be updated to work with Supabase:

### Package.json scripts that use Prisma:
- `build`: Uses `prisma generate` and `prisma db push`
- `postinstall`: Uses `prisma generate`
- `db:push`: Uses `prisma db push`
- `db:migrate`: Uses `prisma migrate dev`

### Debug scripts in /scripts directory:
- All scripts that connect directly to database
- Scripts using DATABASE_URL environment variable

## Step 5: Test Critical Functionality

1. **Authentication Flow**
   - Sign in with Google OAuth
   - Verify session creation
   - Check user record in database

2. **Plaid Integration**
   - Connect a new bank account
   - Sync transactions
   - Update credit card data

3. **API Endpoints**
   - `/api/user/credit-cards`
   - `/api/sync`
   - `/api/billing-cycles/regenerate`
   - All debug endpoints

## Step 6: Update Vercel Environment Variables

1. Go to Vercel Dashboard
2. Navigate to Project Settings > Environment Variables
3. Update `DATABASE_URL` with the new Supabase connection string
4. Redeploy the application

## Migration Checklist

- [ ] Update .env.local with Supabase URL
- [ ] Update .env with Supabase URL
- [ ] Run `npx prisma db push` to create tables
- [ ] Test local development with `npm run dev`
- [ ] Verify authentication works
- [ ] Test Plaid sync functionality
- [ ] Update Vercel environment variables
- [ ] Deploy to production
- [ ] Monitor for any connection issues

## Troubleshooting

### Common Issues and Solutions

1. **Connection refused**
   - Ensure you're using port 6543 for pooled connections
   - Verify SSL mode is set to `require`
   - Check if IP is whitelisted (Supabase allows all by default)

2. **Schema push fails**
   - Try `npx prisma migrate reset` first (WARNING: deletes all data)
   - Check Supabase dashboard for any conflicting tables
   - Ensure DATABASE_URL is correctly set in .env

3. **Authentication issues**
   - NextAuth sessions table might need recreation
   - Clear browser cookies and try again
   - Check if user records migrated correctly

4. **Performance issues**
   - Pooled connection (port 6543) is better for serverless
   - Consider adding indexes for frequently queried fields
   - Monitor Supabase dashboard for slow queries

## Rollback Plan

If migration fails:
1. Keep old Prisma Cloud DATABASE_URL backed up
2. Can switch back by updating environment variable
3. Data export/import may be needed for data migration

## Benefits of Supabase

- **Free tier**: 500MB database, 2GB bandwidth
- **Built-in features**: Auth, Realtime, Storage
- **Better dashboard**: SQL editor, table viewer, logs
- **Performance**: Connection pooling, better latency
- **Scalability**: Easy to upgrade when needed

## Next Steps After Migration

1. Consider migrating from NextAuth to Supabase Auth (optional)
2. Set up database backups in Supabase dashboard
3. Enable Row Level Security (RLS) for added security
4. Monitor usage in Supabase dashboard
5. Set up alerts for quota limits