
CREATE TABLE IF NOT EXISTS public.status_updates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL,
  chamber text NOT NULL,
  date text NOT NULL,
  statusText text NOT NULL,
  CONSTRAINT status_updates_pkey PRIMARY KEY (id),
  CONSTRAINT fk_bill FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE
);
