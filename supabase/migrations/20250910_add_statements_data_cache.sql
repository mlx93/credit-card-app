-- Add statements data caching to plaid_items table
-- This prevents repeated API calls by storing statements list data

ALTER TABLE plaid_items 
ADD COLUMN statements_data JSONB DEFAULT NULL,
ADD COLUMN statements_data_updated TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add index for efficient queries on statements data freshness
CREATE INDEX idx_plaid_items_statements_data_updated ON plaid_items(statements_data_updated) WHERE statements_data_updated IS NOT NULL;

-- Comment explaining the fields
COMMENT ON COLUMN plaid_items.statements_data IS 'Cached statements list from Plaid API (JSON array of statement objects)';
COMMENT ON COLUMN plaid_items.statements_data_updated IS 'When statements data was last fetched from Plaid API';