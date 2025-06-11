/*
  # Update bills table policies

  1. Security
    - Update RLS policies for bills table to allow proper CRUD operations
    - Add explicit policies for insert and update operations
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Allow authenticated users to insert bills" ON bills;
DROP POLICY IF EXISTS "Allow authenticated users to read bills" ON bills;
DROP POLICY IF EXISTS "Allow authenticated users to update bills" ON bills;

-- Create comprehensive policies
CREATE POLICY "Allow authenticated users to read bills"
  ON bills
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert bills"
  ON bills
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update bills"
  ON bills
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);