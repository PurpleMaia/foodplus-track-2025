/*
  # Fix RLS policies for scraping_stats table

  1. Changes
    - Update RLS policies for scraping_stats table to allow authenticated users to insert and select data
    - Add explicit policy for inserting scraping stats
  
  2. Security
    - Maintain RLS enabled
    - Allow authenticated users to read and write scraping stats
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to read scraping_stats" ON scraping_stats;
DROP POLICY IF EXISTS "Allow authenticated users to insert scraping_stats" ON scraping_stats;

-- Create new policies with proper permissions
CREATE POLICY "Allow authenticated users to read scraping_stats"
  ON scraping_stats
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert scraping_stats"
  ON scraping_stats
  FOR INSERT
  TO authenticated
  WITH CHECK (true);