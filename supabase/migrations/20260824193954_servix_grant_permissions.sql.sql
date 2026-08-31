-- Grant necessary privileges on new columns and appointments table
GRANT UPDATE (financial_status) ON cars TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON appointments TO anon, authenticated;