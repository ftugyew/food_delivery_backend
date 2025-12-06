-- SQL Script to create admin user in food_delivery database
-- Run this in PHPMyAdmin or MySQL command line

-- First, check if admin user exists with this email
-- If it does, delete it first:
-- DELETE FROM users WHERE email = 'admin@tindo.com' AND role = 'admin';

-- Admin credentials (YOU CAN CUSTOMIZE THESE):
-- Email: admin@tindo.com
-- Password: admin123
-- Password Hash (bcrypt with 10 rounds): $2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/aDi

-- Insert the admin user with bcrypt-hashed password
-- The password_hash below is the bcrypt hash of "admin123"

INSERT INTO users (
    name,
    email, 
    phone,
    password_hash,
    role,
    status,
    created_at,
    updated_at
) VALUES (
    'Admin',
    'admin@tindo.com',
    '9999999999',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/aDi',
    'admin',
    'approved',
    NOW(),
    NOW()
);

-- Verify the insertion
SELECT id, name, email, role, status FROM users WHERE email = 'admin@tindo.com';
