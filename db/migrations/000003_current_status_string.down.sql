ALTER TABLE bills
  DROP COLUMN IF EXISTS current_status;

ALTER TABLE bills
  RENAME COLUMN current_status_string TO current_status;