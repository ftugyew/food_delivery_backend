-- Agent Auto-Assignment: SQL Helper Script
-- This script helps set up test data and verify the implementation

-- ============================================
-- 1. VERIFY DATABASE SCHEMA
-- ============================================

-- Check orders table has required columns
SELECT COLUMN_NAME, COLUMN_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'orders' 
AND COLUMN_NAME IN ('id', 'agent_id', 'status', 'delivery_lat', 'delivery_lng', 'restaurant_id');

-- Check agents table has required columns
SELECT COLUMN_NAME, COLUMN_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'agents' 
AND COLUMN_NAME IN ('id', 'is_online', 'is_busy', 'status', 'lat', 'lng');

-- Check restaurants table has required columns
SELECT COLUMN_NAME, COLUMN_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'restaurants' 
AND COLUMN_NAME IN ('id', 'lat', 'lng', 'latitude', 'longitude');

-- ============================================
-- 2. CREATE TEST DATA (if needed)
-- ============================================

-- Create a test order waiting for agent assignment
-- Note: Adjust user_id and restaurant_id to match your test data
INSERT INTO orders (
  user_id, 
  restaurant_id, 
  delivery_lat, 
  delivery_lng, 
  status, 
  delivery_address,
  items,
  total
) VALUES (
  1,                              -- Replace with valid user_id
  1,                              -- Replace with valid restaurant_id
  28.6139,                        -- Delhi coordinates example
  77.2090, 
  'waiting_for_agent',
  '123 Test Street, Delhi 110001',
  '[{"name":"Biryani","quantity":2}]',
  499.99
);

-- Get the new order ID
SELECT LAST_INSERT_ID() as new_order_id;

-- Create or update test agent to be available
-- Note: Adjust lat/lng to be different from delivery location for distance calculation
UPDATE agents SET 
  is_online = 1,
  is_busy = 0,
  status = 'Active',
  lat = 28.5355,                  -- Different location for distance calculation
  lng = 77.3910
WHERE id = 1;                     -- Adjust agent ID as needed

-- Verify test data
SELECT 'ORDER DATA:' as section;
SELECT id, agent_id, status, delivery_lat, delivery_lng 
FROM orders 
WHERE status = 'waiting_for_agent' 
LIMIT 5;

SELECT 'AVAILABLE AGENTS:' as section;
SELECT id, name, is_online, is_busy, status, lat, lng 
FROM agents 
WHERE is_online = 1 AND is_busy = 0 AND status = 'Active';

-- ============================================
-- 3. VERIFY HAVERSINE DISTANCE CALCULATION
-- ============================================

-- Test Haversine formula with sample coordinates
-- This should return distance between two points in km
SELECT 
  6371 * acos(
    cos(radians(28.6139)) * 
    cos(radians(28.5355)) * 
    cos(radians(77.3910) - radians(77.2090)) +
    sin(radians(28.6139)) * 
    sin(radians(28.5355))
  ) as distance_km_test;

-- Real example: Calculate distance from order to nearest agent
SELECT 
  a.id as agent_id,
  a.name,
  6371 * acos(
    cos(radians(o.delivery_lat)) * 
    cos(radians(a.lat)) * 
    cos(radians(a.lng) - radians(o.delivery_lng)) +
    sin(radians(o.delivery_lat)) * 
    sin(radians(a.lat))
  ) as distance_km
FROM orders o
CROSS JOIN agents a
WHERE o.id = 1                    -- Replace with test order ID
  AND a.is_online = 1
  AND a.is_busy = 0
  AND a.status = 'Active'
ORDER BY distance_km ASC;

-- ============================================
-- 4. CHECK TRANSACTION SUPPORT
-- ============================================

-- Verify MySQL supports transactions (should return 0 or negative)
SELECT @@autocommit;

-- Test transaction capabilities
START TRANSACTION;
SELECT 'Transaction started' as status;
ROLLBACK;
SELECT 'Transaction rolled back' as status;

-- ============================================
-- 5. VERIFY ASSIGNMENT RESULTS
-- ============================================

-- After calling the API, check the order was updated
SELECT 
  'ORDER STATUS AFTER ASSIGNMENT:' as section;
SELECT 
  id,
  order_id,
  agent_id,
  status,
  delivery_lat,
  delivery_lng,
  updated_at
FROM orders 
WHERE status = 'agent_assigned' 
ORDER BY updated_at DESC 
LIMIT 5;

-- Check agent was marked as busy
SELECT 
  'AGENT STATUS AFTER ASSIGNMENT:' as section;
SELECT 
  id,
  name,
  is_busy,
  status,
  updated_at
FROM agents 
WHERE is_busy = 1 
ORDER BY updated_at DESC 
LIMIT 5;

-- ============================================
-- 6. PERFORMANCE CHECKS
-- ============================================

-- Check if recommended indexes exist
SELECT 
  INDEX_NAME,
  COLUMN_NAME
FROM INFORMATION_SCHEMA.STATISTICS 
WHERE TABLE_NAME = 'agents' 
  AND COLUMN_NAME IN ('is_online', 'is_busy', 'status');

SELECT 
  INDEX_NAME,
  COLUMN_NAME
FROM INFORMATION_SCHEMA.STATISTICS 
WHERE TABLE_NAME = 'orders' 
  AND COLUMN_NAME IN ('status', 'agent_id');

-- Create recommended indexes if they don't exist
-- (Safe: IF NOT EXISTS prevents errors if already created)
ALTER TABLE agents ADD INDEX idx_agents_availability (is_online, is_busy, status);
ALTER TABLE orders ADD INDEX idx_orders_status_agent (status, agent_id);

-- ============================================
-- 7. CLEANUP (OPTIONAL)
-- ============================================

-- To reset test data, run these commands:

-- Mark agent as not busy again
UPDATE agents SET is_busy = 0, status = 'Active' WHERE id = 1;

-- Delete test order (or just set agent_id back to NULL)
-- DELETE FROM orders WHERE status = 'agent_assigned' AND created_at > NOW() - INTERVAL 1 HOUR;
-- OR just reset the assignment:
-- UPDATE orders SET agent_id = NULL, status = 'waiting_for_agent' WHERE status = 'agent_assigned' AND created_at > NOW() - INTERVAL 1 HOUR;

-- ============================================
-- 8. MONITORING & DEBUGGING
-- ============================================

-- Count orders by status
SELECT 
  status,
  COUNT(*) as count
FROM orders
GROUP BY status
ORDER BY count DESC;

-- Show currently busy agents
SELECT 
  id,
  name,
  phone,
  status,
  is_busy,
  is_online
FROM agents
WHERE is_busy = 1;

-- Show orders awaiting assignment
SELECT 
  id,
  order_id,
  restaurant_id,
  agent_id,
  status,
  created_at
FROM orders
WHERE status = 'waiting_for_agent'
ORDER BY created_at ASC;

-- Show assignments made in last hour
SELECT 
  id,
  order_id,
  agent_id,
  status,
  updated_at,
  (SELECT name FROM agents WHERE id = orders.agent_id) as agent_name
FROM orders
WHERE status = 'agent_assigned'
  AND updated_at > NOW() - INTERVAL 1 HOUR
ORDER BY updated_at DESC;

-- ============================================
-- 9. COMMON ISSUES DIAGNOSIS
-- ============================================

-- Issue: No available agents found
-- Diagnosis: Check what agents look like
SELECT 
  id,
  name,
  is_online,
  is_busy,
  status,
  lat IS NULL as missing_lat,
  lng IS NULL as missing_lng
FROM agents
ORDER BY id;

-- Issue: Order coordinates are invalid
-- Diagnosis: Check delivery coordinates
SELECT 
  id,
  order_id,
  delivery_lat,
  delivery_lng,
  delivery_lat IS NULL as missing_lat,
  delivery_lng IS NULL as missing_lng
FROM orders
WHERE status IN ('waiting_for_agent', 'agent_assigned')
ORDER BY id DESC
LIMIT 10;

-- Issue: Restaurant coordinates missing
-- Diagnosis: Check restaurant data
SELECT 
  id,
  name,
  lat,
  lng,
  latitude,
  longitude,
  lat IS NULL as missing_lat,
  lng IS NULL as missing_lng,
  latitude IS NULL as missing_latitude,
  longitude IS NULL as missing_longitude
FROM restaurants
ORDER BY id;

-- ============================================
-- 10. SAMPLE DATA GENERATOR (optional)
-- ============================================

-- If you need to create multiple test orders:
INSERT INTO orders (user_id, restaurant_id, delivery_lat, delivery_lng, status, delivery_address, items, total) VALUES
(1, 1, 28.6139, 77.2090, 'waiting_for_agent', 'Address 1', '[{"name":"Item1","quantity":1}]', 299.99),
(2, 1, 28.6240, 77.2150, 'waiting_for_agent', 'Address 2', '[{"name":"Item2","quantity":2}]', 399.99),
(1, 2, 28.5900, 77.1900, 'waiting_for_agent', 'Address 3', '[{"name":"Item3","quantity":1}]', 499.99);

-- If you need multiple available agents:
UPDATE agents SET is_online=1, is_busy=0, status='Active', lat=28.6239, lng=77.2150 WHERE id=2;
UPDATE agents SET is_online=1, is_busy=0, status='Active', lat=28.5850, lng=77.1850 WHERE id=3;
UPDATE agents SET is_online=1, is_busy=0, status='Active', lat=28.6539, lng=77.2450 WHERE id=4;

-- ============================================
-- Notes:
-- - Replace coordinate values with your actual data
-- - Adjust user_id and restaurant_id references
-- - Test in development environment first
-- - Monitor logs during first production run
-- ============================================
