// backend/routes/tracking.js
const express = require("express");
const router = express.Router();
const {
  ORDER_STATUS,
  TRACKING_STATUS,
  TRACKING_STATUS_VALUES,
  ORDER_STATUS_VALUES
} = require("../constants/statuses");
const { assignAgentToOrder, AssignmentError } = require("../services/order-assignment");

module.exports = (db, io) => {
  const normalizeOrderStatus = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    const lower = raw.toLowerCase();
    switch (lower) {
      case 'pending':
        return ORDER_STATUS.PENDING;
      case 'waiting':
      case 'waiting_for_agent':
      case 'waiting for agent':
        return ORDER_STATUS.WAITING_AGENT;
      case 'assigned':
      case 'agent assigned':
      case 'agent_assigned':
        return ORDER_STATUS.AGENT_ASSIGNED;
      case 'confirmed':
        return ORDER_STATUS.CONFIRMED;
      case 'preparing':
        return ORDER_STATUS.PREPARING;
      case 'ready':
        return ORDER_STATUS.READY;
      case 'picked up':
      case 'picked_up':
      case 'picked':
        return ORDER_STATUS.PICKED_UP;
      case 'delivered':
        return ORDER_STATUS.DELIVERED;
      case 'cancelled':
      case 'canceled':
        return ORDER_STATUS.CANCELLED;
      default:
        return ORDER_STATUS_VALUES.includes(raw) ? raw : null;
    }
  };

  const normalizeTrackingStatus = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    const lower = raw.toLowerCase();
    switch (lower) {
      case 'pending':
      case 'waiting':
        return TRACKING_STATUS.PENDING;
      case 'accepted':
      case 'agent_assigned':
        return TRACKING_STATUS.ACCEPTED;
      case 'agent_going_to_restaurant':
        return TRACKING_STATUS.GOING_TO_RESTAURANT;
      case 'arrived_at_restaurant':
        return TRACKING_STATUS.ARRIVED;
      case 'picked up':
      case 'picked_up':
        return TRACKING_STATUS.PICKED_UP;
      case 'in_transit':
        return TRACKING_STATUS.IN_TRANSIT;
      case 'delivered':
        return TRACKING_STATUS.DELIVERED;
      case 'cancelled':
      case 'canceled':
        return TRACKING_STATUS.CANCELLED;
      default:
        return TRACKING_STATUS_VALUES.includes(raw) ? raw : null;
    }
  };

  // ============================================
  // ACCEPT ORDER (Delivery Agent)
  // ============================================
  router.post("/orders/:orderId/accept", async (req, res) => {
    const { orderId } = req.params;
    const { agent_id } = req.body;

    if (!agent_id) {
      return res.status(400).json({ error: "Agent ID required" });
    }

    try {
      const { order } = await assignAgentToOrder({ db, orderId, agentId: agent_id });

      const [agents] = await db.execute(
        "SELECT id, name, phone, vehicle_type, vehicle_number, profile_image FROM agents WHERE id = ?",
        [agent_id]
      );

      const agentData = agents[0] || {};

      const [orderDetails] = await db.execute(
        `SELECT o.*, r.name as restaurant_name, r.address as restaurant_address, 
                r.lat as restaurant_lat, r.lng as restaurant_lng, r.phone as restaurant_phone,
                u.name as customer_name, u.phone as customer_phone
         FROM orders o
         JOIN restaurants r ON o.restaurant_id = r.id
         JOIN users u ON o.user_id = u.id
         WHERE o.id = ?`,
        [orderId]
      );

      const fullOrder = orderDetails[0] || order;

      await db.execute(
        "INSERT INTO order_tracking_events (order_id, event_type, event_data) VALUES (?, ?, ?)",
        [orderId, TRACKING_STATUS.ACCEPTED, JSON.stringify({ agent_id, agent_name: agentData.name })]
      );

      io.emit(`order_${orderId}_update`, {
        type: TRACKING_STATUS.ACCEPTED,
        order_id: orderId,
        agent: agentData,
        order: fullOrder,
        timestamp: new Date().toISOString()
      });

      io.emit(`agent_${agent_id}_order`, {
        type: "order_accepted",
        order: fullOrder
      });

      res.json({
        success: true,
        message: "Order accepted successfully",
        order: fullOrder,
        agent: agentData
      });
    } catch (err) {
      if (err instanceof AssignmentError) {
        return res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
      }
      console.error("Accept order error:", err);
      res.status(500).json({ error: "Failed to accept order", details: err.message });
    }
  });

  // ============================================
  // UPDATE ORDER TRACKING STATUS
  // ============================================
  router.post("/orders/:orderId/status", async (req, res) => {
    const { orderId } = req.params;
    const { tracking_status, agent_id, latitude, longitude } = req.body;

    const normalizedTracking = normalizeTrackingStatus(tracking_status);

    try {
      if (!normalizedTracking) {
        return res.status(400).json({ error: "Invalid tracking status", allowed_statuses: TRACKING_STATUS_VALUES });
      }

      let updateQuery = "UPDATE orders SET tracking_status = ?";
      let params = [normalizedTracking];

      switch (normalizedTracking) {
        case TRACKING_STATUS.ACCEPTED:
          updateQuery += ", agent_assigned_at = NOW(), status = ?";
          params.push(ORDER_STATUS.AGENT_ASSIGNED);
          break;
        case TRACKING_STATUS.GOING_TO_RESTAURANT:
        case TRACKING_STATUS.ARRIVED:
          updateQuery += ", status = ?";
          params.push(ORDER_STATUS.CONFIRMED);
          break;
        case TRACKING_STATUS.PICKED_UP:
          updateQuery += ", picked_up_at = NOW(), status = ?";
          params.push(ORDER_STATUS.PICKED_UP);
          break;
        case TRACKING_STATUS.IN_TRANSIT:
          updateQuery += ", status = ?";
          params.push(ORDER_STATUS.PICKED_UP);
          break;
        case TRACKING_STATUS.DELIVERED:
          updateQuery += ", delivered_at = NOW(), status = ?";
          params.push(ORDER_STATUS.DELIVERED);
          break;
        case TRACKING_STATUS.CANCELLED:
          updateQuery += ", status = ?";
          params.push(ORDER_STATUS.CANCELLED);
          break;
        default:
          break;
      }

      updateQuery += " WHERE id = ?";
      params.push(orderId);

      await db.execute(updateQuery, params);

      // Log event
      await db.execute(
        "INSERT INTO order_tracking_events (order_id, event_type, event_data, latitude, longitude) VALUES (?, ?, ?, ?, ?)",
        [orderId, normalizedTracking, JSON.stringify({ agent_id }), latitude, longitude]
      );

      // Broadcast status change
      io.emit(`order_${orderId}_update`, {
        type: "status_change",
        tracking_status: normalizedTracking,
        timestamp: new Date().toISOString()
      });

      res.json({ success: true, tracking_status: normalizedTracking });
    } catch (err) {
      console.error("Status update error:", err);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // ============================================
  // REJECT ORDER (Agent unassigns)
  // ============================================
  router.post("/orders/:orderId/reject", async (req, res) => {
    const { orderId } = req.params;
    const { agent_id, reason } = req.body;

    if (!agent_id) {
      return res.status(400).json({ error: "Agent ID required" });
    }

    try {
      const [orders] = await db.execute(
        "SELECT agent_id, status FROM orders WHERE id = ? LIMIT 1",
        [orderId]
      );
      if (!orders || !orders.length) {
        return res.status(404).json({ error: "Order not found" });
      }
      const order = orders[0];

      if (Number(order.agent_id) !== Number(agent_id)) {
        return res.status(403).json({ error: "You are not assigned to this order" });
      }

      // Unassign agent and revert status to Pending
      await db.execute(
        `UPDATE orders 
         SET agent_id = NULL, status = ?, tracking_status = ? 
         WHERE id = ?`,
        [ORDER_STATUS.WAITING_AGENT, TRACKING_STATUS.PENDING, orderId]
      );

      await db.execute("UPDATE agents SET is_busy = 0 WHERE id = ?", [agent_id]);

      // Log tracking event
      await db.execute(
        "INSERT INTO order_tracking_events (order_id, event_type, event_data) VALUES (?, ?, ?)",
        [orderId, "agent_rejected", JSON.stringify({ agent_id, reason })]
      );

      // Broadcast to user tracking page and available agents
      io.emit(`order_${orderId}_update`, {
        type: "agent_rejected",
        order_id: orderId,
        agent_id,
        reason: reason || null,
        timestamp: new Date().toISOString()
      });

      io.emit("newAvailableOrder", { id: Number(orderId) });

      res.json({ success: true, message: "Order rejected and returned to queue" });
    } catch (err) {
      console.error("Reject order error:", err);
      res.status(500).json({ error: "Failed to reject order" });
    }
  });

  // ============================================
  // GET ORDER TRACKING DETAILS
  // ============================================
  router.get("/orders/:orderId/tracking", async (req, res) => {
    const { orderId } = req.params;

    try {
      // First, try with all columns
      let query = `SELECT o.*, 
                r.name as restaurant_name, r.address as restaurant_address,
                r.phone as restaurant_phone,
                a.name as agent_name, a.phone as agent_phone, a.vehicle_type,
                u.name as customer_name, u.phone as customer_phone
         FROM orders o
         LEFT JOIN restaurants r ON o.restaurant_id = r.id
         LEFT JOIN agents a ON o.agent_id = a.id
         LEFT JOIN users u ON o.user_id = u.id
         WHERE o.id = ?`;

      const [orders] = await db.execute(query, [orderId]);

      if (!orders || orders.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orders[0];

      // Try to get restaurant coordinates (handle if columns don't exist)
      try {
        const [restaurantCoords] = await db.execute(
          `SELECT lat as restaurant_lat, lng as restaurant_lng FROM restaurants WHERE id = ?`,
          [order.restaurant_id]
        );
        if (restaurantCoords && restaurantCoords.length > 0) {
          order.restaurant_lat = restaurantCoords[0].restaurant_lat;
          order.restaurant_lng = restaurantCoords[0].restaurant_lng;
        }
      } catch (coordErr) {
        console.warn("Restaurant coordinates not available:", coordErr.message);
        order.restaurant_lat = null;
        order.restaurant_lng = null;
      }

      // Try to get agent coordinates and details (handle if columns don't exist)
      if (order.agent_id) {
        try {
          const [agentDetails] = await db.execute(
            `SELECT lat as agent_lat, lng as agent_lng, vehicle_number, profile_image FROM agents WHERE id = ?`,
            [order.agent_id]
          );
          if (agentDetails && agentDetails.length > 0) {
            order.agent_lat = agentDetails[0].agent_lat;
            order.agent_lng = agentDetails[0].agent_lng;
            order.vehicle_number = agentDetails[0].vehicle_number;
            order.profile_image = agentDetails[0].profile_image;
          }
        } catch (agentErr) {
          console.warn("Agent coordinates not available:", agentErr.message);
          order.agent_lat = null;
          order.agent_lng = null;
        }
      }

      // Get latest agent location from tracking history
      if (order.agent_id) {
        const [locations] = await db.execute(
          `SELECT latitude, longitude, accuracy, speed, heading, timestamp 
           FROM agent_locations 
           WHERE agent_id = ? AND order_id = ?
           ORDER BY timestamp DESC LIMIT 1`,
          [order.agent_id, orderId]
        );

        if (locations && locations.length > 0) {
          order.agent_current_lat = locations[0].latitude;
          order.agent_current_lng = locations[0].longitude;
          order.agent_location_updated = locations[0].timestamp;
        }
      }

      res.json({ success: true, data: order });
    } catch (err) {
      console.error("Get tracking error:", err);
      res.status(500).json({ error: "Failed to get tracking data" });
    }
  });

  // ============================================
  // SAVE AGENT LOCATION (GPS TRACKING)
  // ============================================
  router.post("/agent-location", async (req, res) => {
    const { agent_id, order_id, latitude, longitude, accuracy, speed, heading } = req.body;

    if (!agent_id || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "Missing required fields: agent_id, latitude, longitude" });
    }

    try {
      // Verify agent exists and owns the order if order_id provided
      const [agents] = await db.execute(
        "SELECT id, name FROM agents WHERE id = ?",
        [agent_id]
      );

      if (!agents || agents.length === 0) {
        return res.status(404).json({ error: "Agent not found" });
      }

      // If order_id provided, verify agent is assigned to it
      if (order_id) {
        const [orders] = await db.execute(
          "SELECT id, agent_id FROM orders WHERE id = ? AND agent_id = ?",
          [order_id, agent_id]
        );

        if (!orders || orders.length === 0) {
          return res.status(403).json({ error: "Agent not assigned to this order" });
        }
      }

      // Store agent location
      const [result] = await db.execute(
        `INSERT INTO agent_locations (agent_id, order_id, latitude, longitude, accuracy, speed, heading, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [agent_id, order_id || null, latitude, longitude, accuracy || null, speed || null, heading || null]
      );

      // Broadcast location update via Socket.IO to tracking users
      if (order_id) {
        io.emit(`order_${order_id}_agent_location`, {
          agent_id,
          order_id,
          latitude,
          longitude,
          accuracy,
          speed,
          heading,
          timestamp: new Date().toISOString()
        });

        // Also broadcast to agent's own socket
        io.emit(`agent_${agent_id}_location_update`, {
          latitude,
          longitude,
          accuracy,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        location_id: result.insertId,
        message: "Location saved successfully"
      });
    } catch (err) {
      console.error("Save agent location error:", err);
      res.status(500).json({ error: "Failed to save location", details: err.message });
    }
  });

  // ============================================
  // GET AGENT CURRENT LOCATION
  // ============================================
  router.get("/agent/:agent_id/location", async (req, res) => {
    const { agent_id } = req.params;

    try {
      const [locations] = await db.execute(
        `SELECT latitude, longitude, accuracy, speed, heading, timestamp 
         FROM agent_locations 
         WHERE agent_id = ?
         ORDER BY timestamp DESC LIMIT 1`,
        [agent_id]
      );

      if (!locations || locations.length === 0) {
        return res.json({ 
          success: true, 
          location: null,
          message: "No location data available" 
        });
      }

      res.json({ success: true, location: locations[0] });
    } catch (err) {
      console.error("Get agent location error:", err);
      res.status(500).json({ error: "Failed to get location" });
    }
  });

  // ============================================
  // SAVE AGENT RATING (Customer after delivery)
  // ============================================
  router.post("/orders/:orderId/rating", async (req, res) => {
    const { orderId } = req.params;
    const { agent_id, rating, feedback } = req.body;

    if (!agent_id || !rating) {
      return res.status(400).json({ error: "agent_id and rating required" });
    }

    try {
      // Validate order is delivered and belongs to agent
      const [rows] = await db.execute("SELECT agent_id, status FROM orders WHERE id = ? LIMIT 1", [orderId]);
      if (!rows || !rows.length) return res.status(404).json({ error: "Order not found" });
      const order = rows[0];
      if (Number(order.agent_id) !== Number(agent_id)) return res.status(403).json({ error: "Agent mismatch" });
      if (order.status !== ORDER_STATUS.DELIVERED) return res.status(400).json({ error: "Order not delivered yet" });

      await db.execute(
        "INSERT INTO agent_ratings (agent_id, order_id, rating, feedback) VALUES (?, ?, ?, ?)",
        [agent_id, orderId, rating, feedback || null]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Save rating error:", err);
      res.status(500).json({ error: "Failed to save rating" });
    }
  });

  // ============================================
  // SAVE CHAT MESSAGE
  // ============================================
  router.post("/orders/:orderId/chat", async (req, res) => {
    const { orderId } = req.params;
    const { sender_id, sender_type, message } = req.body;

    if (!sender_id || !sender_type || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const [result] = await db.execute(
        "INSERT INTO chat_messages (order_id, sender_id, sender_type, message) VALUES (?, ?, ?, ?)",
        [orderId, sender_id, sender_type, message]
      );

      const newMessage = {
        id: result.insertId,
        order_id: orderId,
        sender_id,
        sender_type,
        message,
        is_read: false,
        created_at: new Date().toISOString()
      };

      // Broadcast to both user and agent
      io.emit(`order_${orderId}_chat`, newMessage);

      res.json({ success: true, message: newMessage });
    } catch (err) {
      console.error("Chat save error:", err);
      res.status(500).json({ error: "Failed to save message" });
    }
  });

  // ============================================
  // GET CHAT MESSAGES
  // ============================================
  router.get("/orders/:orderId/chat", async (req, res) => {
    const { orderId } = req.params;

    try {
      const [messages] = await db.execute(
        `SELECT cm.*, u.name as sender_name 
         FROM chat_messages cm
         LEFT JOIN users u ON cm.sender_id = u.id
         WHERE cm.order_id = ?
         ORDER BY cm.created_at ASC`,
        [orderId]
      );

      res.json({ success: true, messages });
    } catch (err) {
      console.error("Get chat error:", err);
      res.status(500).json({ error: "Failed to get messages" });
    }
  });

  // ============================================
  // MARK CHAT AS READ
  // ============================================
  router.post("/orders/:orderId/chat/read", async (req, res) => {
    const { orderId } = req.params;
    const { sender_type } = req.body;

    try {
      // Mark messages from opposite sender as read
      const oppositeSender = sender_type === 'user' ? 'agent' : 'user';
      await db.execute(
        "UPDATE chat_messages SET is_read = TRUE WHERE order_id = ? AND sender_type = ?",
        [orderId, oppositeSender]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("Mark read error:", err);
      res.status(500).json({ error: "Failed to mark as read" });
    }
  });

  return router;
};
