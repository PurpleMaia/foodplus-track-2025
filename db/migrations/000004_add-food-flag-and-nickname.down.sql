ALTER TABLE bills   
    DROP COLUMN IF EXISTS nickname;

ALTER TABLE bills
    DROP COLUMN IF EXISTS food_related;