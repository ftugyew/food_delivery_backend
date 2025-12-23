// backend/routes/tracking.js
const express = require("express");
const router = express.Router();

module.exports = (db, io) => {
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
      // Check if order exists and is not already assigned
      const [orders] = await db.execute(
        "SELECT * FROM orders WHERE id = ? LIMIT 1",
        [orderId]
      );

      if (!orders || orders.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orders[0];
      
      if (order.agent_id && order.agent_id !== agent_id) {
        return res.status(400).json({ error: "Order already assigned to another agent" });
      }

      // Update order with agent assignment
      await db.execute(
        `UPDATE orders 
         SET agent_id = ?, 
             status = 'Confirmed', 
             tracking_status = 'agent_assigned',
             agent_assigned_at = NOW()
         WHERE id = ?`,
        [agent_id, orderId]
      );

      // Get agent details
      const [agents] = await db.execute(
        "SELECT id, name, phone, vehicle_type, vehicle_number, profile_image FROM agents WHERE id = ?",
        [agent_id]
      );

      const agentData = agents[0] || {};

      // Get order details with restaurant info
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

      const fullOrder = orderDetails[0];

      // Log tracking event
      await db.execute(
        "INSERT INTO order_tracking_events (order_id, event_type, event_data) VALUES (?, ?, ?)",
        [orderId, "agent_assigned", JSON.stringify({ agent_id, agent_name: agentData.name })]
      );

      // Broadcast to user's tracking page
      io.emit(`order_${orderId}_update`, {
        type: "agent_assigned",
        order_id: orderId,
        agent: agentData,
        order: fullOrder,
        timestamp: new Date().toISOString()
      });

      // Broadcast to agent
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

    try {
      const validStatuses = [
        'agent_going_to_restaurant',
        'arrived_at_restaurant',
        'picked_up',
        'in_transit',
        'delivered'
      ];

      if (!validStatuses.includes(tracking_status)) {
        return res.status(400).json({ error: "Invalid tracking status" });
      }

      let updateQuery = "UPDATE orders SET tracking_status = ?";
      let params = [tracking_status];

      if (tracking_status === 'picked_up') {
        updateQuery += ", picked_up_at = NOW(), status = 'Picked Up'";
      } else if (tracking_status === 'delivered') {
        updateQuery += ", delivered_at = NOW(), status = 'Delivered'";
      }

      updateQuery += " WHERE id = ?";
      params.push(orderId);

      await db.execute(updateQuery, params);

      // Log event
      await db.execute(
        "INSERT INTO order_tracking_events (order_id, event_type, event_data, latitude, longitude) VALUES (?, ?, ?, ?, ?)",
        [orderId, tracking_status, JSON.stringify({ agent_id }), latitude, longitude]
      );

      // Broadcast status change
      io.emit(`order_${orderId}_update`, {
        type: "status_change",
        tracking_status,
        timestamp: new Date().toISOString()
      });

      res.json({ success: true, tracking_status });
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
         SET agent_id = NULL, status = 'Pending', tracking_status = 'waiting' 
         WHERE id = ?`,
        [orderId]
      );

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
      const [orders] = await db.execute(
        `SELECT o.*, 
                r.name as restaurant_name, r.address as restaurant_address,
                r.lat as restaurant_lat, r.lng as restaurant_lng, r.phone as restaurant_phone,
                a.name as agent_name, a.phone as agent_phone, a.vehicle_type, a.vehicle_number, a.profile_image,
                a.lat as agent_lat, a.lng as agent_lng,
                u.name as customer_name, u.phone as customer_phone
         FROM orders o
         LEFT JOIN restaurants r ON o.restaurant_id = r.id
         LEFT JOIN agents a ON o.agent_id = a.id
         LEFT JOIN users u ON o.user_id = u.id
         WHERE o.id = ?`,
        [orderId]
      );

      if (!orders || orders.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orders[0];

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
      if (order.status !== 'Delivered') return res.status(400).json({ error: "Order not delivered yet" });

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
