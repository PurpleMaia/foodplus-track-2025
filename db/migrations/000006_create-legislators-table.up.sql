CREATE TABLE IF NOT EXISTS public.legislators (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_id text NOT NULL UNIQUE,
  last_name text,
  first_name text,
  party text,
  chamber text,
  district integer,
  area text,
  room text,
  phone text,
  email text,
  in_office boolean NOT NULL DEFAULT true,
  term_ended date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legislators_pkey PRIMARY KEY (id)
);
