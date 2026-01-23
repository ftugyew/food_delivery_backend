/**
 * Restaurant Order Management Controller
 * =====================================
 * Handles restaurant-specific order operations
 * - Accept orders from customers
 * - Prepare orders
 * - Mark as ready for delivery
 */

const express = require("express");
const db = require("../db");
const router = express.Router();
const { ORDER_STATUS, TRACKING_STATUS } = require("../constants/statuses");

/**
 * POST /api/restaurant/orders/:orderId/accept
 * Restaurant accepts an order (pending → in_preparation)
 * Broadcasts order to nearby agents
 */
router.post("/orders/:orderId/accept", async (req, res) => {
  const { orderId } = req.params;
  const restaurantId = req.user?.restaurant_id;

  if (!restaurantId) {
    return res.status(401).json({ error: "Restaurant not identified" });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // ===== STEP 1: Lock and fetch order =====
    const [orders] = await connection.execute(
      `SELECT id, restaurant_id, status, user_id, delivery_lat, delivery_lng
       FROM orders
       WHERE id = ? FOR UPDATE`,
      [orderId]
    );

    if (!orders || orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orders[0];

    // ===== STEP 2: Verify ownership =====
    if (order.restaurant_id !== restaurantId) {
      await connection.rollback();
      return res.status(403).json({ error: "Unauthorized: Not your order" });
    }

    // ===== STEP 3: Verify order state =====
    if (order.status !== "waiting_for_restaurant") {
      await connection.rollback();
      return res.status(400).json({
        error: `Order already ${order.status}. Cannot accept again.`,
        current_status: order.status
      });
    }

    // ===== STEP 4: Update order status =====
    await connection.execute(
      `UPDATE orders
       SET status = ?, updated_at = NOW()
       WHERE id = ?`,
      ["waiting_for_agent", orderId]
    );

    // ===== STEP 5: Fetch restaurant location =====
    const [restaurants] = await connection.execute(
      `SELECT id, name, lat, lng FROM restaurants WHERE id = ?`,
      [restaurantId]
    );

    const restaurant = restaurants[0];

    await connection.commit();

    // ===== STEP 6: Broadcast to ALL ACTIVE agents (non-blocking) =====
    setImmediate(async () => {
      if (restaurant.lat && restaurant.lng && order.delivery_lat && order.delivery_lng) {
        const io = req.app.get("io");
        const db = require("../db");
        
        try {
          // Fetch ALL active online agents (is_online=1, is_busy=0, status='Active')
          const [activeAgents] = await db.execute(
            `SELECT id, name, lat, lng, vehicle_type, phone
             FROM agents 
             WHERE is_online = 1 
               AND is_busy = 0 
               AND status = 'Active'
               AND lat IS NOT NULL 
               AND lng IS NOT NULL`
          );

          if (!activeAgents || activeAgents.length === 0) {
            console.log(`⚠️ No active agents available for order #${orderId}`);
            return;
          }

          // Calculate distance from each agent to delivery location (Haversine)
          const toRad = (d) => (d * Math.PI) / 180;
          const R = 6371; // Earth radius in km
          const deliveryLat = parseFloat(order.delivery_lat);
          const deliveryLng = parseFloat(order.delivery_lng);

          const agentsWithDistance = activeAgents.map(agent => {
            const agentLat = parseFloat(agent.lat);
            const agentLng = parseFloat(agent.lng);
            const dLat = toRad(deliveryLat - agentLat);
            const dLng = toRad(deliveryLng - agentLng);
            const a = Math.sin(dLat / 2) ** 2 + 
                     Math.cos(toRad(agentLat)) * Math.cos(toRad(deliveryLat)) * 
                     Math.sin(dLng / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distance = R * c;
            return { ...agent, distance_km: distance };
          });

          // Sort by distance (nearest first)
          agentsWithDistance.sort((a, b) => a.distance_km - b.distance_km);

          // Fetch full order details for broadcast
          const [orderDetails] = await db.execute(
            `SELECT o.*, u.name as customer_name, u.phone as customer_phone
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.id
             WHERE o.id = ?`,
            [orderId]
          );

          const fullOrder = orderDetails[0];

          // Broadcast enriched order to each active agent individually
          agentsWithDistance.forEach((agent, index) => {
            const enrichedOrder = {
              id: orderId,
              order_id: fullOrder?.order_id || orderId,
              restaurant_id: restaurantId,
              restaurant_name: restaurant.name,
              restaurant_lat: parseFloat(restaurant.lat),
              restaurant_lng: parseFloat(restaurant.lng),
              delivery_lat: deliveryLat,
              delivery_lng: deliveryLng,
              delivery_address: fullOrder?.delivery_address || null,
              items: fullOrder?.items ? (typeof fullOrder.items === 'string' ? JSON.parse(fullOrder.items) : fullOrder.items) : [],
              total: parseFloat(fullOrder?.total || 0),
              customer_name: fullOrder?.customer_name || 'Customer',
              customer_phone: fullOrder?.customer_phone || null,
              status: "waiting_for_agent",
              distance_to_delivery_km: agent.distance_km.toFixed(2),
              estimated_arrival_mins: Math.max(5, Math.round(agent.distance_km / 15 * 60)), // 15 km/h average
              agent_rank: index + 1,
              total_agents_notified: agentsWithDistance.length,
              timestamp: new Date().toISOString()
            };

            // Emit to specific agent
            io.emit(`agent_${agent.id}_new_order`, enrichedOrder);
            console.log(`📡 Order #${orderId} sent to Agent #${agent.id} (${agent.distance_km.toFixed(2)} km away)`);
          });

          // Also emit general broadcast for compatibility
          io.emit("new_order_for_agents", {
            order_id: orderId,
            restaurant_id: restaurantId,
            restaurant_name: restaurant.name,
            restaurant_lat: parseFloat(restaurant.lat),
            restaurant_lng: parseFloat(restaurant.lng),
            delivery_lat: deliveryLat,
            delivery_lng: deliveryLng,
            status: "waiting_for_agent",
            timestamp: new Date().toISOString()
          });

          console.log(`✅ Order #${orderId} from ${restaurant.name} broadcasted to ${agentsWithDistance.length} active agents`);
        } catch (err) {
          console.error("❌ Error broadcasting to agents:", err);
        }
      }
    });

    // ===== STEP 7: Notify customer =====
    setImmediate(() => {
      req.app.get("io").emit(`order_${orderId}_update`, {
        event: "restaurant_accepted",
        message: "Restaurant accepted your order! Finding nearest delivery agent...",
        status: "waiting_for_agent",
        timestamp: new Date().toISOString()
      });
    });

    return res.json({
      success: true,
      message: "Order accepted by restaurant",
      order_id: orderId,
      status: "waiting_for_agent",
      restaurant_name: restaurant.name
    });

  } catch (err) {
    try {
      await connection.rollback();
    } catch (_) {}
    console.error("❌ Restaurant accept error:", err);
    return res.status(500).json({
      error: "Failed to accept order",
      details: err.message
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/restaurant/orders/:orderId/ready
 * Restaurant marks order as ready for pickup
 * Updates tracking status to "ready"
 */
router.post("/orders/:orderId/ready", async (req, res) => {
  const { orderId } = req.params;
  const restaurantId = req.user?.restaurant_id;

  if (!restaurantId) {
    return res.status(401).json({ error: "Restaurant not identified" });
  }

  try {
    // ===== Verify order belongs to restaurant =====
    const [orders] = await db.execute(
      `SELECT id, restaurant_id, status, agent_id FROM orders WHERE id = ? LIMIT 1`,
      [orderId]
    );

    if (!orders || orders.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orders[0];

    if (order.restaurant_id !== restaurantId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (order.status !== "agent_assigned") {
      return res.status(400).json({
        error: "Order must be assigned to agent before marking ready",
        current_status: order.status
      });
    }

    // ===== Update to ready =====
    await db.execute(
      `UPDATE orders
       SET tracking_status = ?, updated_at = NOW()
       WHERE id = ?`,
      ["ready", orderId]
    );

    // ===== Notify agent and customer =====
    setImmediate(() => {
      const io = req.app.get("io");
      io.emit(`order_${orderId}_update`, {
        event: "order_ready",
        tracking_status: "ready",
        message: "Order is ready! Agent will pick up soon.",
        timestamp: new Date().toISOString()
      });
    });

    return res.json({
      success: true,
      message: "Order marked as ready",
      order_id: orderId,
      tracking_status: "ready"
    });

  } catch (err) {
    console.error("❌ Order ready error:", err);
    return res.status(500).json({
      error: "Failed to mark order ready",
      details: err.message
    });
  }
});

/**
 * GET /api/restaurant/orders
 * Get all orders for a restaurant with optional filtering
 */
router.get("/orders", async (req, res) => {
  const restaurantId = req.user?.restaurant_id;
  const { status } = req.query;

  if (!restaurantId) {
    return res.status(401).json({ error: "Restaurant not identified" });
  }

  try {
    let query = `SELECT 
                   o.id, o.order_id, o.status, o.tracking_status,
                   o.total, o.items, o.created_at,
                   u.name as customer_name, u.phone as customer_phone,
                   a.id as agent_id, a.name as agent_name
                 FROM orders o
                 LEFT JOIN users u ON o.user_id = u.id
                 LEFT JOIN agents a ON o.agent_id = a.id
                 WHERE o.restaurant_id = ?`;
    const params = [restaurantId];

    if (status) {
      query += ` AND o.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY o.created_at DESC LIMIT 100`;

    const [orders] = await db.execute(query, params);

    return res.json({
      success: true,
      orders: orders.map(o => ({
        ...o,
        items: JSON.parse(o.items || "[]")
      }))
    });

  } catch (err) {
    console.error("❌ Get restaurant orders error:", err);
    return res.status(500).json({
      error: "Failed to fetch orders",
      details: err.message
    });
  }
});

module.exports = router;
