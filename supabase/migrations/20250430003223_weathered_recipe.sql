/*
  # Update RLS policies for bills table

  1. Changes
    - Update INSERT policy to properly handle batch uploads
    - Update UPDATE policy to handle upserts during CSV upload
    - Policies still require authentication for all operations

  2. Security
    - Maintains RLS enabled
    - All operations still require authentication
    - Policies are permissive by default
*/

-- Drop existing policies to recreate them
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON "public"."bills";
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON "public"."bills";

-- Create new INSERT policy
CREATE POLICY "Enable insert access for authenticated users"
ON "public"."bills"
FOR INSERT
TO authenticated
WITH CHECK (auth.role() = 'authenticated');

-- Create new UPDATE policy that handles upserts
CREATE POLICY "Enable update access for authenticated users"
ON "public"."bills"
FOR UPDATE
TO authenticated
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');