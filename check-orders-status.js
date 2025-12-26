// Quick script to check orders in the database
const db = require("./db");

async function checkOrders() {
  try {
    console.log("🔍 Checking orders in database...\n");
    
    // Get all orders
    const [allOrders] = await db.execute("SELECT id, order_id, status, agent_id, restaurant_id, created_at FROM orders ORDER BY created_at DESC LIMIT 20");
    
    console.log(`📊 Total orders found: ${allOrders.length}\n`);
    
    if (allOrders.length === 0) {
      console.log("⚠️  No orders found in database!");
      process.exit(0);
    }
    
    // Count by status
    const statusCounts = {};
    allOrders.forEach(order => {
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
    });
    
    console.log("📈 Orders by status:");
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });
    console.log();
    
    // Show waiting_for_agent orders
    const waitingOrders = allOrders.filter(o => o.status === 'waiting_for_agent');
    if (waitingOrders.length > 0) {
      console.log(`✅ Found ${waitingOrders.length} orders with status 'waiting_for_agent':`);
      waitingOrders.forEach(order => {
        console.log(`   Order ID: ${order.id} | Order #: ${order.order_id} | Agent: ${order.agent_id || 'None'} | Created: ${order.created_at}`);
      });
    } else {
      console.log("⚠️  No orders with status 'waiting_for_agent' found!");
      console.log("\n📋 Latest orders:");
      allOrders.slice(0, 5).forEach(order => {
        console.log(`   Order ID: ${order.id} | Status: ${order.status} | Agent: ${order.agent_id || 'None'} | Created: ${order.created_at}`);
      });
    }
    
    console.log("\n✅ Check complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

checkOrders();
