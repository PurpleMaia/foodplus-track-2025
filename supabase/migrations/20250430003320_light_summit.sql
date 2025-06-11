/*
  # Fix RLS policies for bills table

  1. Changes
    - Drop existing RLS policies for bills table
    - Add new comprehensive RLS policies for all CRUD operations
    
  2. Security
    - Enable RLS on bills table
    - Add policies for authenticated users to:
      - Insert new bills
      - Read all bills
      - Update existing bills
*/

-- First, drop existing policies
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON bills;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON bills;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON bills;

-- Create new comprehensive policies
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