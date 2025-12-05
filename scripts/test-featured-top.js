// Simple test script to check Featured and Top Restaurants APIs
// Usage: node backend/scripts/test-featured-top.js

const axios = require('axios');

const BASE = process.env.BASE_URL || 'https://food-delivery-backend-cw3m.onrender.com';

async function run() {
  try {
    const [featuredRes, topRes] = await Promise.all([
      axios.get(`${BASE}/api/featured-restaurants`),
      axios.get(`${BASE}/api/top-restaurants`)
    ]);
    console.log('Featured status:', featuredRes.status, 'items:', featuredRes.data.length);
    console.log('Top status:', topRes.status, 'items:', topRes.data.length);
  } catch (err) {
    if (err.response) {
      console.error('API error:', err.response.status, err.response.data);
    } else {
      console.error('Connection error:', err.message);
    }
    process.exit(1);
  }
}

run();
