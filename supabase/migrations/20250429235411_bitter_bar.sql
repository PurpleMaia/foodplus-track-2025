/*
  # Create function for inserting scraping stats

  1. New Function
    - Creates a stored procedure to handle scraping stats insertion
    - Bypasses RLS for authenticated users
    
  2. Security
    - Function executes with security definer to bypass RLS
    - Only authenticated users can call the function
*/

CREATE OR REPLACE FUNCTION insert_scraping_stats(
  p_bills_scraped INT,
  p_success BOOLEAN,
  p_error_message TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO scraping_stats (
    last_scrape_time,
    bills_scraped,
    success,
    error_message
  ) VALUES (
    now(),
    p_bills_scraped,
    p_success,
    p_error_message
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION insert_scraping_stats TO authenticated;