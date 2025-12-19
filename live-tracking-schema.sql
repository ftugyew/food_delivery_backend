-- ============================================
-- LIVE DELIVERY TRACKING DATABASE SCHEMA
-- ============================================

-- Add tracking columns to existing orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS tracking_status ENUM('waiting', 'agent_assigned', 'agent_going_to_restaurant', 'arrived_at_restaurant', 'picked_up', 'in_transit', 'delivered') DEFAULT 'waiting',
ADD COLUMN IF NOT EXISTS agent_assigned_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP NULL;

-- Agent locations tracking (real-time GPS data)
CREATE TABLE IF NOT EXISTS agent_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agent_id INT NOT NULL,
    order_id INT,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    accuracy DECIMAL(10, 2),
    speed DECIMAL(10, 2),
    heading DECIMAL(10, 2),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent_order (agent_id, order_id),
    INDEX idx_timestamp (timestamp),
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

-- Chat messages between user and delivery agent
CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    sender_id INT NOT NULL,
    sender_type ENUM('user', 'agent') NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order (order_id),
    INDEX idx_sender (sender_id, sender_type),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add vehicle details to agents table
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS profile_image VARCHAR(500);

-- Order tracking events log
CREATE TABLE IF NOT EXISTS order_tracking_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSON,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order (order_id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
