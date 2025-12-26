-- ============================================
-- PRODUCTION DATABASE COLUMN FIX
-- Fix missing lat/lng columns causing tracking errors
-- ============================================

-- Add lat/lng columns to restaurants table if they don't exist
ALTER TABLE restaurants 
ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS lng DECIMAL(11, 8) DEFAULT NULL;

-- Add lat/lng columns to agents table if they don't exist
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS lng DECIMAL(11, 8) DEFAULT NULL;

-- Add missing columns to agents table
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(50) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS profile_image VARCHAR(500) DEFAULT NULL;

-- Ensure orders table has all required columns
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS delivery_lat DECIMAL(10, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS delivery_lng DECIMAL(11, 8) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS delivery_address JSON DEFAULT NULL,
ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS restaurant_phone VARCHAR(20) DEFAULT NULL;

-- Add tracking status to orders if not exists
ALTER TABLE orders 
MODIFY COLUMN tracking_status ENUM(
  'pending',
  'accepted',
  'agent_going_to_restaurant',
  'arrived_at_restaurant',
  'picked_up',
  'in_transit',
  'delivered',
  'cancelled'
) DEFAULT 'pending';

-- Ensure agent_locations table exists
CREATE TABLE IF NOT EXISTS agent_locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  order_id INT DEFAULT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy DECIMAL(10, 2) DEFAULT NULL,
  speed DECIMAL(10, 2) DEFAULT NULL,
  heading DECIMAL(10, 2) DEFAULT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_order (agent_id, order_id),
  INDEX idx_timestamp (timestamp),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Ensure order_chats table exists
CREATE TABLE IF NOT EXISTS order_chats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  sender_id INT NOT NULL,
  sender_type ENUM('customer', 'agent', 'restaurant', 'admin') NOT NULL,
  message TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_status BOOLEAN DEFAULT FALSE,
  INDEX idx_order (order_id),
  INDEX idx_timestamp (timestamp),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Add is_online and is_busy to agents if not exists
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_busy BOOLEAN DEFAULT FALSE;

-- Update orders status enum to include new statuses
ALTER TABLE orders 
MODIFY COLUMN status ENUM(
  'Pending',
  'waiting_for_agent',
  'agent_assigned',
  'Confirmed',
  'Preparing',
  'Ready',
  'Picked Up',
  'Delivered',
  'Cancelled'
) DEFAULT 'Pending';

-- ============================================
-- VERIFICATION QUERIES
-- Run these to verify all columns exist
-- ============================================

-- Check restaurants columns
-- SHOW COLUMNS FROM restaurants LIKE 'lat';
-- SHOW COLUMNS FROM restaurants LIKE 'lng';

-- Check agents columns
-- SHOW COLUMNS FROM agents LIKE 'lat';
-- SHOW COLUMNS FROM agents LIKE 'lng';
-- SHOW COLUMNS FROM agents LIKE 'vehicle_number';
-- SHOW COLUMNS FROM agents LIKE 'profile_image';
-- SHOW COLUMNS FROM agents LIKE 'is_online';
-- SHOW COLUMNS FROM agents LIKE 'is_busy';

-- Check orders columns
-- SHOW COLUMNS FROM orders LIKE 'delivery_lat';
-- SHOW COLUMNS FROM orders LIKE 'delivery_lng';
-- SHOW COLUMNS FROM orders LIKE 'customer_phone';
-- SHOW COLUMNS FROM orders LIKE 'restaurant_phone';

-- ============================================
-- END OF MIGRATION
-- ============================================
