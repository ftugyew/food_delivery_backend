-- Food Delivery Database Schema
-- Run this script in your MySQL database to create all necessary tables

CREATE DATABASE IF NOT EXISTS food_delivery;
USE food_delivery;

-- Users table (customers, restaurant owners, delivery agents)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password VARCHAR(255),
    role ENUM('customer', 'restaurant', 'delivery_agent', 'admin') DEFAULT 'customer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    address VARCHAR(500),
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    phone VARCHAR(20),
    email VARCHAR(255),
    image_url VARCHAR(500),
    rating DECIMAL(3, 2) DEFAULT 4.0,
    eta INT DEFAULT 30,
    cuisine VARCHAR(100),
    status ENUM('pending', 'approved', 'rejected', 'active', 'inactive') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Menu items table
CREATE TABLE IF NOT EXISTS menu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    category VARCHAR(100),
    image_url VARCHAR(500),
    status ENUM('available', 'unavailable') DEFAULT 'available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- Delivery agents table
CREATE TABLE IF NOT EXISTS agents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    status ENUM('Active', 'Inactive', 'Busy') DEFAULT 'Inactive',
    vehicle_type VARCHAR(50),
    aadhar VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    restaurant_id INT NOT NULL,
    agent_id INT,
    items JSON NOT NULL,
    total DECIMAL(10, 2) NOT NULL,
    order_id VARCHAR(255) UNIQUE,
    payment_type VARCHAR(50),
    estimated_delivery VARCHAR(50),
    status ENUM('Pending', 'Confirmed', 'Preparing', 'Ready', 'Picked Up', 'Delivered', 'Cancelled') DEFAULT 'Pending',
    delivery_address VARCHAR(500),
    delivery_lat DECIMAL(10, 8),
    delivery_lng DECIMAL(11, 8),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('cash', 'card', 'upi', 'wallet') NOT NULL,
    status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
    transaction_id VARCHAR(255),
    razorpay_order_id VARCHAR(255),
    razorpay_payment_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Order tracking table
CREATE TABLE IF NOT EXISTS order_tracking (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    description TEXT,
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Create user-addresses table
CREATE TABLE IF NOT EXISTS user_addresses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    landmark VARCHAR(255),
    pincode VARCHAR(10) NOT NULL,
    lat DECIMAL(10, 8),
    lon DECIMAL(11, 8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Insert sample data
INSERT INTO users (name, email, phone, password, role) VALUES
('Admin User', 'admin@fooddelivery.com', '1234567890', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin'),
('John Doe', 'john@example.com', '9876543210', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'customer'),
('Jane Smith', 'jane@example.com', '9876543211', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'customer');

INSERT INTO restaurants (name, description, address, lat, lng, phone, email) VALUES
('Pizza Palace', 'Best pizza in town with fresh ingredients', '123 Main St, City', 40.7128, -74.0060, '555-0101', 'info@pizzapalace.com'),
('Burger King', 'Delicious burgers and fries', '456 Oak Ave, City', 40.7589, -73.9851, '555-0102', 'info@burgerking.com'),
('Sushi Master', 'Authentic Japanese sushi', '789 Pine St, City', 40.7505, -73.9934, '555-0103', 'info@sushimaster.com');

INSERT INTO menu (restaurant_id, item_name, description, price, category) VALUES
(1, 'Margherita Pizza', 'Classic tomato and mozzarella pizza', 12.99, 'Pizza'),
(1, 'Pepperoni Pizza', 'Pizza with pepperoni and cheese', 14.99, 'Pizza'),
(1, 'Caesar Salad', 'Fresh romaine lettuce with caesar dressing', 8.99, 'Salad'),
(2, 'Classic Burger', 'Beef patty with lettuce, tomato, and onion', 9.99, 'Burgers'),
(2, 'Chicken Burger', 'Grilled chicken breast with vegetables', 10.99, 'Burgers'),
(2, 'French Fries', 'Crispy golden fries', 4.99, 'Sides'),
(3, 'California Roll', 'Crab, avocado, and cucumber roll', 8.99, 'Sushi'),
(3, 'Salmon Nigiri', 'Fresh salmon over sushi rice', 6.99, 'Sushi'),
(3, 'Miso Soup', 'Traditional Japanese soup', 3.99, 'Soup');

INSERT INTO agents (name, phone, lat, lng, status, vehicle_type) VALUES
('Mike Johnson', '555-1001', 40.7128, -74.0060, 'Active', 'Bicycle'),
('Sarah Wilson', '555-1002', 40.7589, -73.9851, 'Active', 'Motorcycle'),
('David Brown', '555-1003', 40.7505, -73.9934, 'Inactive', 'Car');

-- Create indexes for better performance
-- Proof of Delivery table
CREATE TABLE IF NOT EXISTS delivery_proofs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    agent_id INT NOT NULL,
    proof_type ENUM('photo', 'signature') NOT NULL,
    proof_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
-- Top Restaurants table
CREATE TABLE IF NOT EXISTS top_restaurants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    position INT DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

-- Featured Restaurants table
CREATE TABLE IF NOT EXISTS featured_restaurants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    position INT DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_restaurant_id ON orders(restaurant_id);
CREATE INDEX idx_orders_agent_id ON orders(agent_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_menu_items_restaurant_id ON menu_items(restaurant_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_order_tracking_order_id ON order_tracking(order_id);

-- Popup Banners table (for homepage modal)
CREATE TABLE IF NOT EXISTS banners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    image_url VARCHAR(500) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
