/*
  # Fix RLS policies for bills table

  1. Changes
    - Drop existing RLS policies
    - Create new policies that properly handle insert and update operations
    - Ensure authenticated users can perform necessary operations

  2. Security
    - Enable RLS on bills table
    - Add policies for insert, update, and select operations
    - Maintain security while allowing necessary operations
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow authenticated users to insert bills" ON bills;
DROP POLICY IF EXISTS "Allow authenticated users to update bills" ON bills;
DROP POLICY IF EXISTS "Allow authenticated users to read bills" ON bills;

-- Create new policies
CREATE POLICY "Enable read access for authenticated users"
ON bills FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable insert access for authenticated users"
ON bills FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable update access for authenticated users"
ON bills FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Ensure RLS is enabled
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;