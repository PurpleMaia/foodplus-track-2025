/*
  # Add committee assignment to bills table

  1. Changes
    - Add `committee_assignment` column to `bills` table
    - Update existing policies to include the new column

  2. Security
    - Maintain existing RLS policies
*/

-- Add committee_assignment column
ALTER TABLE bills 
ADD COLUMN IF NOT EXISTS committee_assignment text;

-- Ensure policies are up to date
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bills;
DROP POLICY IF EXISTS "Enable read for authenticated users" ON bills;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON bills;

-- Recreate policies
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