-- Add statements product support caching to plaid_items table
-- This prevents repeated API calls to check statements availability

ALTER TABLE plaid_items 
ADD COLUMN statements_supported BOOLEAN DEFAULT NULL,
ADD COLUMN statements_available BOOLEAN DEFAULT NULL,
ADD COLUMN statements_enabled BOOLEAN DEFAULT NULL,
ADD COLUMN statements_last_checked TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add index for efficient queries
CREATE INDEX idx_plaid_items_statements_support ON plaid_items(statements_supported, statements_enabled);

-- Comment explaining the fields
COMMENT ON COLUMN plaid_items.statements_supported IS 'Whether the institution supports statements product (from available_products)';
COMMENT ON COLUMN plaid_items.statements_available IS 'Whether statements product is consented (from consented_products)';
COMMENT ON COLUMN plaid_items.statements_enabled IS 'Whether statements product is currently enabled (from products)';
COMMENT ON COLUMN plaid_items.statements_last_checked IS 'When statements support was last verified with Plaid API';