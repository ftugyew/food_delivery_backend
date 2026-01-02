/**
 * Agent Order Management Controller
 * ===================================
 * Handles delivery agent order operations
 * - Accept orders (race-safe)
 * - Update location
 * - Update delivery status
 * - Mark as delivered
 */

const express = require("express");
const db = require("../db");
const router = express.Router();
const { ORDER_STATUS, TRACKING_STATUS } = require("../constants/statuses");

/**
 * POST /api/agent/orders/:orderId/accept
 * 
 * RACE-SAFE ORDER ACCEPTANCE
 * Only ONE agent can accept; others get "already taken"
 * 
 * Uses transactions + SELECT FOR UPDATE to prevent double-assignment
 */
router.post("/orders/:orderId/accept", async (req, res) => {
  const { orderId } = req.params;
  const agentId = req.user?.agent_id || req.user?.id;

  if (!agentId) {
    return res.status(401).json({ error: "Agent not identified" });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // ===== STEP 1: Lock and check agent availability =====
    const [agents] = await connection.execute(
      `SELECT id, lat, lng, is_busy FROM agents WHERE id = ? FOR UPDATE`,
      [agentId]
    );

    if (!agents || agents.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Agent not found" });
    }

    const agent = agents[0];

    // Check if agent is already busy
    if (agent.is_busy === 1) {
      await connection.rollback();
      return res.status(409).json({
        error: "You are already busy with another order",
        status: "conflict"
      });
    }

    // Check if agent has location
    if (!agent.lat || !agent.lng) {
      await connection.rollback();
      return res.status(400).json({
        error: "Agent location not available. Enable GPS first.",
        status: "bad_request"
      });
    }

    // ===== STEP 2: Lock and check order status =====
    const [orders] = await connection.execute(
      `SELECT id, restaurant_id, status, delivery_lat, delivery_lng 
       FROM orders 
       WHERE id = ? FOR UPDATE`,
      [orderId]
    );

    if (!orders || orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orders[0];

    // Order must be waiting for agent
    if (order.status !== "waiting_for_agent") {
      await connection.rollback();
      return res.status(409).json({
        error: `Order not available (status: ${order.status})`,
        current_status: order.status,
        status: "conflict"
      });
    }

    // ===== STEP 3: Atomic assignment =====
    // This is the critical moment - only first agent to commit wins
    const updateResult = await connection.execute(
      `UPDATE orders
       SET agent_id = ?, 
           status = ?,
           tracking_status = ?,
           agent_assigned_at = NOW(),
           updated_at = NOW()
       WHERE id = ? AND agent_id IS NULL`,
      [agentId, "agent_assigned", "accepted", orderId]
    );

    // Verify assignment succeeded
    if (updateResult[0].affectedRows === 0) {
      // Another agent already assigned
      await connection.rollback();
      return res.status(409).json({
        error: "Order was accepted by another agent",
        status: "conflict"
      });
    }

    // ===== STEP 4: Mark agent as busy =====
    await connection.execute(
      `UPDATE agents SET is_busy = 1, updated_at = NOW() WHERE id = ?`,
      [agentId]
    );

    await connection.commit();

    // ===== STEP 5: Broadcast notifications (non-blocking) =====
    const io = req.app.get("io");

    setImmediate(() => {
      // Notify customer
      io.emit(`order_${orderId}_customers`, {
        event: "agent_assigned",
        agent_id: agentId,
        agent_current_lat: parseFloat(agent.lat),
        agent_current_lng: parseFloat(agent.lng),
        message: "Agent accepted! Starting pickup...",
        timestamp: new Date().toISOString()
      });

      // Notify restaurant
      io.emit(`order_${orderId}_restaurant`, {
        event: "agent_assigned",
        agent_id: agentId,
        message: "Delivery agent is on the way",
        timestamp: new Date().toISOString()
      });

      // Notify admin
      io.emit(`order_${orderId}_admin`, {
        event: "agent_assigned",
        order_id: orderId,
        agent_id: agentId,
        timestamp: new Date().toISOString()
      });

      // Notify all other agents (order taken)
      io.emit("order_taken", {
        order_id: orderId,
        taken_by_agent_id: agentId,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Order #${orderId} assigned to Agent #${agentId}`);
    });

    return res.status(200).json({
      success: true,
      message: "Order accepted successfully",
      order_id: orderId,
      agent_id: agentId,
      status: "agent_assigned",
      tracking_status: "accepted",
      restaurant_location: {
        lat: parseFloat(order.delivery_lat),
        lng: parseFloat(order.delivery_lng)
      }
    });

  } catch (err) {
    try {
      await connection.rollback();
    } catch (_) {}
    console.error("❌ Agent accept error:", err);
    return res.status(500).json({
      error: "Failed to accept order",
      details: err.message
    });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/agent/orders/:orderId/status
 * Update tracking status (going_to_restaurant, arrived, etc.)
 */
router.post("/orders/:orderId/status", async (req, res) => {
  const { orderId } = req.params;
  const { tracking_status } = req.body;
  const agentId = req.user?.agent_id || req.user?.id;

  // Validate tracking status
  const validStatuses = [
    "going_to_restaurant",
    "arrived_at_restaurant",
    "picked_up",
    "in_transit",
    "delivered"
  ];

  if (!validStatuses.includes(tracking_status)) {
    return res.status(400).json({
      error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      received: tracking_status
    });
  }

  try {
    // Update order
    const result = await db.execute(
      `UPDATE orders
       SET tracking_status = ?, updated_at = NOW()
       WHERE id = ? AND agent_id = ?`,
      [tracking_status, orderId, agentId]
    );

    if (result[0].affectedRows === 0) {
      return res.status(404).json({
        error: "Order not found or not assigned to you"
      });
    }

    // Broadcast status change
    const io = req.app.get("io");
    setImmediate(() => {
      io.emit(`order_${orderId}_tracking`, {
        event: "status_change",
        tracking_status: tracking_status,
        agent_id: agentId,
        timestamp: new Date().toISOString()
      });
    });

    console.log(`🔄 Order #${orderId} status: ${tracking_status}`);

    return res.json({
      success: true,
      message: "Status updated",
      order_id: orderId,
      tracking_status: tracking_status
    });

  } catch (err) {
    console.error("❌ Status update error:", err);
    return res.status(500).json({
      error: "Failed to update status",
      details: err.message
    });
  }
});

/**
 * GET /api/agent/orders
 * Get assigned orders for agent
 */
router.get("/orders", async (req, res) => {
  const agentId = req.user?.agent_id || req.user?.id;

  try {
    const [orders] = await db.execute(
      `SELECT
         o.id, o.order_id, o.status, o.tracking_status,
         o.delivery_lat, o.delivery_lng, o.delivery_address,
         o.total, o.items, o.created_at,
         r.name as restaurant_name, r.lat as restaurant_lat, r.lng as restaurant_lng,
         u.name as customer_name, u.phone as customer_phone
       FROM orders o
       LEFT JOIN restaurants r ON o.restaurant_id = r.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.agent_id = ?
       AND o.status NOT IN ('Delivered', 'Cancelled')
       ORDER BY o.created_at DESC`,
      [agentId]
    );

    return res.json({
      success: true,
      orders: orders.map(o => ({
        ...o,
        items: JSON.parse(o.items || "[]"),
        delivery_lat: parseFloat(o.delivery_lat),
        delivery_lng: parseFloat(o.delivery_lng),
        restaurant_lat: parseFloat(o.restaurant_lat),
        restaurant_lng: parseFloat(o.restaurant_lng)
      }))
    });

  } catch (err) {
    console.error("❌ Get agent orders error:", err);
    return res.status(500).json({
      error: "Failed to fetch orders",
      details: err.message
    });
  }
});

module.exports = router;
