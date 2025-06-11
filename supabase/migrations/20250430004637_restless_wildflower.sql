/*
  # Update bills table schema
  
  1. Changes
    - Rename measure_status to description
    - Add new columns:
      - bill_title (text)
      - introducer (text)
      - bill_number (text)
  
  2. Security
    - Maintain existing RLS policies
    - Update policies to include new fields
*/

-- Rename measure_status to description
ALTER TABLE bills RENAME COLUMN measure_status TO description;

-- Add new columns
ALTER TABLE bills 
ADD COLUMN IF NOT EXISTS bill_title text,
ADD COLUMN IF NOT EXISTS introducer text,
ADD COLUMN IF NOT EXISTS bill_number text;

-- Recreate policies to ensure they work with renamed column
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bills;
DROP POLICY IF EXISTS "Enable read for authenticated users" ON bills;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON bills;

CREATE POLICY "Enable insert for authenticated users"
ON bills
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable read for authenticated users"
ON bills
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable update for authenticated users"
ON bills
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);