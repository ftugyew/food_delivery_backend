-- Migration: Add missing columns to restaurants table
-- Run this if you're getting errors about 'featured' or 'is_top' columns

USE food_delivery;

-- Add featured column if it doesn't exist
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'food_delivery' 
  AND TABLE_NAME = 'restaurants' 
  AND COLUMN_NAME = 'featured';

SET @sql = IF(@col_exists = 0, 
  'ALTER TABLE restaurants ADD COLUMN featured BOOLEAN DEFAULT FALSE AFTER status',
  'SELECT "Column featured already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add is_top column if it doesn't exist
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'food_delivery' 
  AND TABLE_NAME = 'restaurants' 
  AND COLUMN_NAME = 'is_top';

SET @sql = IF(@col_exists = 0, 
  'ALTER TABLE restaurants ADD COLUMN is_top BOOLEAN DEFAULT FALSE AFTER featured',
  'SELECT "Column is_top already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration complete! Columns added successfully.' AS result;
