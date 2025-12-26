#!/usr/bin/env node
/**
 * Test script for Agent Auto-Assignment API
 * Tests POST /api/admin/orders/:orderId/assign
 * 
 * Prerequisites:
 * - Backend server running on http://localhost:5000
 * - Database populated with test data
 * - Admin user authenticated with valid JWT token
 */

const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'your_jwt_token_here';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function testAssignmentAPI() {
  log('\n🚀 Starting Agent Auto-Assignment API Tests\n', 'cyan');
  
  const client = axios.create({
    baseURL: API_BASE,
    headers: {
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  
  try {
    // Test 1: Get available orders
    log('Test 1️⃣ : Fetching orders waiting for agent assignment...', 'blue');
    const ordersRes = await client.get('/admin/orders');
    const orders = ordersRes.data.filter(o => o.status === 'waiting_for_agent');
    
    if (orders.length === 0) {
      log('⚠️  No orders with status "waiting_for_agent" found', 'yellow');
      log('   Create a test order first using the customer app\n', 'yellow');
      return;
    }
    
    log(`✅ Found ${orders.length} orders waiting for assignment`, 'green');
    orders.forEach((o, i) => {
      log(`   ${i + 1}. Order #${o.id}: Status="${o.status}", Agent=${o.agent_id || 'None'}`, 'yellow');
    });
    
    // Test 2: Get available agents
    log('\nTest 2️⃣ : Fetching available agents...', 'blue');
    const agentsRes = await client.get('/admin/agents');
    const agents = agentsRes.data.data || agentsRes.data;
    const availableAgents = agents.filter(a => 
      a.is_online === 1 && 
      a.is_busy === 0 && 
      a.status === 'Active' && 
      a.lat && 
      a.lng
    );
    
    if (availableAgents.length === 0) {
      log('⚠️  No available agents found', 'yellow');
      log('   Make sure at least one agent is:', 'yellow');
      log('   - is_online = 1', 'yellow');
      log('   - is_busy = 0', 'yellow');
      log('   - status = "Active"', 'yellow');
      log('   - Has lat/lng coordinates\n', 'yellow');
      return;
    }
    
    log(`✅ Found ${availableAgents.length} available agents`, 'green');
    availableAgents.forEach((a, i) => {
      log(`   ${i + 1}. Agent #${a.id}: ${a.name} (${a.status}, Online: ${a.is_online})`, 'yellow');
    });
    
    // Test 3: Assign agent to first waiting order
    log('\nTest 3️⃣ : Testing agent assignment...', 'blue');
    const testOrder = orders[0];
    log(`   Assigning agent to Order #${testOrder.id}...`, 'yellow');
    
    try {
      const assignRes = await client.post(`/admin/orders/${testOrder.id}/assign`, {});
      
      if (assignRes.status === 200 && assignRes.data.success) {
        log(`✅ Assignment successful!`, 'green');
        log(`   Order ID: ${assignRes.data.orderId}`, 'green');
        log(`   Agent ID: ${assignRes.data.agentId}`, 'green');
        log(`   Agent Name: ${assignRes.data.agent.name}`, 'green');
        log(`   Distance: ${assignRes.data.agent.distanceKm} km`, 'green');
        log(`   Message: ${assignRes.data.message}`, 'green');
      }
    } catch (err) {
      if (err.response?.status === 503) {
        log(`⚠️  ${err.response.data.error}`, 'yellow');
        log(`   ${err.response.data.message}`, 'yellow');
      } else if (err.response?.status === 400) {
        log(`❌ ${err.response.data.error}`, 'red');
      } else {
        log(`❌ Assignment failed: ${err.response?.data?.error || err.message}`, 'red');
      }
    }
    
    // Test 4: Verify order was updated
    log('\nTest 4️⃣ : Verifying order update...', 'blue');
    const verifyRes = await client.get(`/admin/orders`);
    const updatedOrder = verifyRes.data.find(o => o.id === testOrder.id);
    
    if (updatedOrder && updatedOrder.agent_id) {
      log(`✅ Order successfully updated:`, 'green');
      log(`   Status: ${updatedOrder.status}`, 'green');
      log(`   Assigned Agent ID: ${updatedOrder.agent_id}`, 'green');
    } else {
      log(`❌ Order was not updated`, 'red');
    }
    
    log('\n✅ All tests completed!\n', 'green');
    
  } catch (err) {
    log(`\n❌ Test failed: ${err.message}`, 'red');
    if (err.response?.status === 401) {
      log('   Authentication failed - invalid or missing JWT token', 'red');
    }
  }
}

// Run tests
testAssignmentAPI();
