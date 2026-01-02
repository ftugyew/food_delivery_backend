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

    // ===== STEP 6: Broadcast to agents (non-blocking) =====
    setImmediate(() => {
      if (restaurant.lat && restaurant.lng) {
        // Emit to all connected clients (agents)
        req.app.get("io").emit("new_order_for_agents", {
          order_id: orderId,
          restaurant_id: restaurantId,
          restaurant_name: restaurant.name,
          restaurant_lat: parseFloat(restaurant.lat),
          restaurant_lng: parseFloat(restaurant.lng),
          delivery_lat: parseFloat(order.delivery_lat),
          delivery_lng: parseFloat(order.delivery_lng),
          status: "waiting_for_agent",
          timestamp: new Date().toISOString()
        });

        console.log(`📡 Order #${orderId} from ${restaurant.name} broadcasted to agents`);
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
