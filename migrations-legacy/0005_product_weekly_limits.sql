ALTER TABLE vb_products ADD COLUMN weekly_limit INTEGER CHECK(weekly_limit IS NULL OR (typeof(weekly_limit)='integer' AND weekly_limit BETWEEN 0 AND 10000));
