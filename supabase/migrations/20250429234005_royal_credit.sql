/*
  # Create bills and scraping_stats tables

  1. New Tables
    - `bills`
      - `id` (uuid, primary key)
      - `bill_url` (text, unique)
      - `measure_status` (text)
      - `current_status` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `scraping_stats`
      - `id` (uuid, primary key)
      - `last_scrape_time` (timestamptz)
      - `bills_scraped` (integer)
      - `success` (boolean)
      - `error_message` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users
*/

-- Create bills table
CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_url text UNIQUE NOT NULL,
  measure_status text NOT NULL,
  current_status text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create scraping_stats table
CREATE TABLE IF NOT EXISTS scraping_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  last_scrape_time timestamptz NOT NULL,
  bills_scraped integer DEFAULT 0,
  success boolean DEFAULT true,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_stats ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
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
  USING (true);

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

-- Create index on bill_url for faster lookups
CREATE INDEX IF NOT EXISTS bills_bill_url_idx ON bills(bill_url);

-- Create index on last_scrape_time for faster ordering
CREATE INDEX IF NOT EXISTS scraping_stats_last_scrape_time_idx ON scraping_stats(last_scrape_time);