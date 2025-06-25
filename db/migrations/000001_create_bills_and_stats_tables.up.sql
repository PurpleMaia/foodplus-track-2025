
CREATE TABLE IF NOT EXISTS public.bills (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bill_url text NOT NULL UNIQUE,
  description text NOT NULL,
  current_status text NOT NULL,
  committee_assignment text,
  bill_title text,
  introducer text,
  bill_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bills_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.scraping_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  last_scrape_time timestamptz NOT NULL,
  error_message text,
  bills_scraped integer NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scraping_stats_pkey PRIMARY KEY (id)
);
