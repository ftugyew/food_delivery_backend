// ============================================
// SOCKET.IO LIVE TRACKING HANDLER
// ============================================

module.exports = (io, db) => {
  // Store active tracking sessions
  const activeTracking = new Map(); // agent_id -> { orderId, intervalId }

  io.on("connection", (socket) => {
    console.log("✅ Client connected:", socket.id);

    // ============================================
    // AGENT: START LOCATION SHARING
    // ============================================
    socket.on("agent_start_tracking", async (data) => {
      const { agent_id, order_id } = data;
      
      if (!agent_id || !order_id) {
        socket.emit("tracking_error", { error: "Missing agent_id or order_id" });
        return;
      }

      console.log(`📍 Agent ${agent_id} started tracking for order ${order_id}`);

      // Verify agent is assigned to this order
      try {
        const [orders] = await db.execute(
          "SELECT * FROM orders WHERE id = ? AND agent_id = ?",
          [order_id, agent_id]
        );

        if (!orders || orders.length === 0) {
          socket.emit("tracking_error", { error: "Order not assigned to this agent" });
          return;
        }

        // Join room for this order
        socket.join(`order_${order_id}`);
        socket.join(`agent_${agent_id}`);

        // Store tracking session
        activeTracking.set(agent_id, { orderId: order_id, socketId: socket.id });

        socket.emit("tracking_started", { order_id, agent_id });
      } catch (err) {
        console.error("Start tracking error:", err);
        socket.emit("tracking_error", { error: err.message });
      }
    });

    // ============================================
    // AGENT: SEND LIVE LOCATION
    // ============================================
    socket.on("agent_location_update", async (data) => {
      const { agent_id, order_id, latitude, longitude, accuracy, speed, heading } = data;

      if (!agent_id || !order_id || !latitude || !longitude) {
        return;
      }

      try {
        // Save location to database
        await db.execute(
          `INSERT INTO agent_locations 
           (agent_id, order_id, latitude, longitude, accuracy, speed, heading) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [agent_id, order_id, latitude, longitude, accuracy || null, speed || null, heading || null]
        );

        // Update agent's current location in agents table
        await db.execute(
          "UPDATE agents SET lat = ?, lng = ? WHERE id = ?",
          [latitude, longitude, agent_id]
        );

        // Broadcast to all users tracking this order
        io.to(`order_${order_id}`).emit("live_location", {
          agent_id,
          order_id,
          latitude,
          longitude,
          accuracy,
          speed,
          heading,
          timestamp: new Date().toISOString()
        });

        console.log(`📍 Location updated: Agent ${agent_id} -> (${latitude}, ${longitude})`);
      } catch (err) {
        console.error("Location update error:", err);
      }
    });

    // ============================================
    // USER: JOIN ORDER TRACKING
    // ============================================
    socket.on("user_join_tracking", async (data) => {
      const { user_id, order_id } = data;

      if (!user_id || !order_id) {
        socket.emit("tracking_error", { error: "Missing user_id or order_id" });
        return;
      }

      try {
        // Verify user owns this order
        const [orders] = await db.execute(
          "SELECT * FROM orders WHERE id = ? AND user_id = ?",
          [order_id, user_id]
        );

        if (!orders || orders.length === 0) {
          socket.emit("tracking_error", { error: "Order not found or unauthorized" });
          return;
        }

        // Join tracking room
        socket.join(`order_${order_id}`);
        
        console.log(`👤 User ${user_id} joined tracking for order ${order_id}`);

        // Send latest agent location
        const order = orders[0];
        if (order.agent_id) {
          const [locations] = await db.execute(
            `SELECT * FROM agent_locations 
             WHERE agent_id = ? AND order_id = ? 
             ORDER BY timestamp DESC LIMIT 1`,
            [order.agent_id, order_id]
          );

          if (locations && locations.length > 0) {
            socket.emit("live_location", {
              agent_id: order.agent_id,
              order_id,
              latitude: locations[0].latitude,
              longitude: locations[0].longitude,
              accuracy: locations[0].accuracy,
              speed: locations[0].speed,
              heading: locations[0].heading,
              timestamp: locations[0].timestamp
            });
          }
        }

        socket.emit("tracking_joined", { order_id });
      } catch (err) {
        console.error("Join tracking error:", err);
        socket.emit("tracking_error", { error: err.message });
      }
    });

    // ============================================
    // AGENT: STOP TRACKING
    // ============================================
    socket.on("agent_stop_tracking", (data) => {
      const { agent_id, order_id } = data;
      
      if (activeTracking.has(agent_id)) {
        activeTracking.delete(agent_id);
        console.log(`⏹️  Agent ${agent_id} stopped tracking order ${order_id}`);
      }

      socket.leave(`order_${order_id}`);
      socket.leave(`agent_${agent_id}`);
      
      socket.emit("tracking_stopped", { order_id, agent_id });
    });

    // ============================================
    // CHAT: SEND MESSAGE
    // ============================================
    socket.on("send_chat_message", async (data) => {
      const { order_id, sender_id, sender_type, message } = data;

      if (!order_id || !sender_id || !sender_type || !message) {
        return;
      }

      try {
        const [result] = await db.execute(
          "INSERT INTO chat_messages (order_id, sender_id, sender_type, message) VALUES (?, ?, ?, ?)",
          [order_id, sender_id, sender_type, message]
        );

        const newMessage = {
          id: result.insertId,
          order_id,
          sender_id,
          sender_type,
          message,
          is_read: false,
          created_at: new Date().toISOString()
        };

        // Broadcast to order room
        io.to(`order_${order_id}`).emit("chat_message", newMessage);
      } catch (err) {
        console.error("Chat message error:", err);
      }
    });

    // ============================================
    // DISCONNECT
    // ============================================
    socket.on("disconnect", () => {
      console.log("❌ Client disconnected:", socket.id);
      
      // Clean up tracking sessions
      for (const [agent_id, session] of activeTracking.entries()) {
        if (session.socketId === socket.id) {
          activeTracking.delete(agent_id);
          console.log(`🧹 Cleaned up tracking for agent ${agent_id}`);
        }
      }
    });
  });

  return io;
};
