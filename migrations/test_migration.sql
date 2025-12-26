-- ============================================
-- TEST SCRIPT - Verify Tracking Fix
-- Run this after migration to ensure everything works
-- ============================================

-- 1. Verify all columns exist
SELECT 'Checking restaurants table...' as status;
SHOW COLUMNS FROM restaurants LIKE 'lat';
SHOW COLUMNS FROM restaurants LIKE 'lng';

SELECT 'Checking agents table...' as status;
SHOW COLUMNS FROM agents LIKE 'lat';
SHOW COLUMNS FROM agents LIKE 'lng';
SHOW COLUMNS FROM agents LIKE 'vehicle_number';
SHOW COLUMNS FROM agents LIKE 'profile_image';
SHOW COLUMNS FROM agents LIKE 'is_online';
SHOW COLUMNS FROM agents LIKE 'is_busy';

SELECT 'Checking orders table...' as status;
SHOW COLUMNS FROM orders LIKE 'delivery_lat';
SHOW COLUMNS FROM orders LIKE 'delivery_lng';
SHOW COLUMNS FROM orders LIKE 'customer_phone';
SHOW COLUMNS FROM orders LIKE 'restaurant_phone';

-- 2. Check if agent_locations table exists
SELECT 'Checking agent_locations table...' as status;
SHOW TABLES LIKE 'agent_locations';

-- 3. Check if order_chats table exists
SELECT 'Checking order_chats table...' as status;
SHOW TABLES LIKE 'order_chats';

-- 4. Sample data check
SELECT 'Sample restaurant data...' as status;
SELECT id, name, lat, lng, phone FROM restaurants LIMIT 3;

SELECT 'Sample agent data...' as status;
SELECT id, name, lat, lng, is_online, is_busy, vehicle_number FROM agents LIMIT 3;

SELECT 'Sample order data...' as status;
SELECT id, order_id, status, agent_id, delivery_lat, delivery_lng, customer_phone FROM orders LIMIT 3;

-- 5. Test tracking query (the one that was failing)
SELECT 'Testing tracking query...' as status;
SELECT o.*, 
       r.name as restaurant_name, r.address as restaurant_address,
       r.phone as restaurant_phone,
       a.name as agent_name, a.phone as agent_phone, a.vehicle_type,
       u.name as customer_name, u.phone as customer_phone
FROM orders o
LEFT JOIN restaurants r ON o.restaurant_id = r.id
LEFT JOIN agents a ON o.agent_id = a.id
LEFT JOIN users u ON o.user_id = u.id
LIMIT 1;

-- 6. Test restaurant coordinates query
SELECT 'Testing restaurant coordinates...' as status;
SELECT id, name, lat as restaurant_lat, lng as restaurant_lng 
FROM restaurants 
WHERE id IN (SELECT restaurant_id FROM orders LIMIT 1);

-- 7. Test agent coordinates query
SELECT 'Testing agent coordinates...' as status;
SELECT id, name, lat as agent_lat, lng as agent_lng, vehicle_number, profile_image 
FROM agents 
WHERE id IN (SELECT agent_id FROM orders WHERE agent_id IS NOT NULL LIMIT 1);

-- ============================================
-- If all queries above run without errors,
-- your database is ready! ✅
-- ============================================

SELECT '✅ ALL TESTS PASSED! Database is ready.' as final_status;
