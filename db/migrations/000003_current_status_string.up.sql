ALTER TABLE bills
  RENAME COLUMN current_status TO current_status_string;

ALTER TABLE bills
  ADD COLUMN current_status VARCHAR(50);