-- Migration: Add is_online and is_busy columns to agents table
-- Run this to update existing database

ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_busy BOOLEAN DEFAULT FALSE;

-- Update orders status enum to include waiting_for_agent and agent_assigned
ALTER TABLE orders 
MODIFY COLUMN status ENUM('Pending', 'waiting_for_agent', 'agent_assigned', 'Confirmed', 'Preparing', 'Ready', 'Picked Up', 'Delivered', 'Cancelled') DEFAULT 'Pending';

-- Set all Active agents as online by default
UPDATE agents SET is_online = TRUE WHERE status = 'Active';
