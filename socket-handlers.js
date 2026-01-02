/**
 * Socket.IO Live Tracking Handler
 * ================================
 * Handles real-time location and status updates
 * - Agent location tracking (every 5 seconds)
 * - Order status transitions
 * - Delivery completion
 */

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // ===== AGENT LOCATION UPDATE =====
    socket.on("agent_location_update", async (data) => {
      const { agent_id, order_id, latitude, longitude } = data;

      // Validate input
      if (
        !agent_id ||
        !order_id ||
        latitude === null ||
        latitude === undefined ||
        longitude === null ||
        longitude === undefined
      ) {
        return socket.emit("error", {
          event: "location_update",
          message: "Invalid location data"
        });
      }

      try {
        const db = require("../db");

        // ===== STEP 1: Save location to audit trail =====
        await db.execute(
          `INSERT INTO agent_locations (agent_id, order_id, latitude, longitude, created_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [agent_id, order_id, latitude, longitude]
        );

        // ===== STEP 2: Update agent current location =====
        await db.execute(
          `UPDATE agents SET lat = ?, lng = ?, updated_at = NOW()
           WHERE id = ?`,
          [latitude, longitude, agent_id]
        );

        // ===== STEP 3: Broadcast to all watching order_id rooms =====
        io.emit(`order_${order_id}_tracking`, {
          event: "agent_location_update",
          agent_id: agent_id,
          latitude: latitude,
          longitude: longitude,
          timestamp: new Date().toISOString()
        });

        console.log(
          `📍 Agent #${agent_id} Order #${order_id}: ${latitude}, ${longitude}`
        );
      } catch (err) {
        console.error("❌ Location update error:", err);
        socket.emit("error", {
          event: "location_update",
          message: "Failed to update location"
        });
      }
    });

    // ===== TRACKING STATUS UPDATE =====
    socket.on("update_tracking_status", async (data) => {
      const { order_id, agent_id, tracking_status } = data;

      // Validate status
      const validStatuses = [
        "going_to_restaurant",
        "arrived_at_restaurant",
        "picked_up",
        "in_transit",
        "delivered"
      ];

      if (!validStatuses.includes(tracking_status)) {
        return socket.emit("error", {
          event: "status_update",
          message: `Invalid status. Valid: ${validStatuses.join(", ")}`
        });
      }

      try {
        const db = require("../db");

        // Update tracking status
        await db.execute(
          `UPDATE orders
           SET tracking_status = ?, updated_at = NOW()
           WHERE id = ? AND agent_id = ?`,
          [tracking_status, order_id, agent_id]
        );

        // Broadcast status change
        io.emit(`order_${order_id}_tracking`, {
          event: "status_change",
          tracking_status: tracking_status,
          agent_id: agent_id,
          timestamp: new Date().toISOString()
        });

        console.log(
          `🔄 Order #${order_id} status: ${tracking_status}`
        );
      } catch (err) {
        console.error("❌ Status update error:", err);
        socket.emit("error", {
          event: "status_update",
          message: "Failed to update status"
        });
      }
    });

    // ===== ORDER DELIVERED =====
    socket.on("order_delivered", async (data) => {
      const { order_id, agent_id } = data;

      if (!order_id || !agent_id) {
        return socket.emit("error", {
          event: "delivery",
          message: "Missing order_id or agent_id"
        });
      }

      const db = require("../db");
      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();

        // ===== STEP 1: Update order as delivered =====
        await connection.execute(
          `UPDATE orders
           SET status = 'Delivered',
               tracking_status = 'delivered',
               delivered_at = NOW(),
               updated_at = NOW()
           WHERE id = ? AND agent_id = ?`,
          [order_id, agent_id]
        );

        // ===== STEP 2: Free the agent =====
        await connection.execute(
          `UPDATE agents
           SET is_busy = 0, updated_at = NOW()
           WHERE id = ?`,
          [agent_id]
        );

        await connection.commit();

        // ===== STEP 3: Broadcast completion =====
        io.emit(`order_${order_id}_tracking`, {
          event: "order_completed",
          order_id: order_id,
          agent_id: agent_id,
          delivered_at: new Date().toISOString()
        });

        // Notify customer for rating
        io.emit(`order_${order_id}_customers`, {
          event: "delivered",
          message: "Order delivered! Please rate your experience.",
          timestamp: new Date().toISOString()
        });

        console.log(`✅ Order #${order_id} delivered by Agent #${agent_id}`);
      } catch (err) {
        try {
          await connection.rollback();
        } catch (_) {}
        console.error("❌ Delivery completion error:", err);
        socket.emit("error", {
          event: "delivery",
          message: "Failed to mark as delivered"
        });
      } finally {
        connection.release();
      }
    });

    // ===== JOIN ROOM =====
    socket.on("join_order_room", (data) => {
      const { order_id, role } = data;
      if (!order_id) return;

      const room = `order_${order_id}_${role}`;
      socket.join(room);
      console.log(`📍 Client joined room: ${room}`);
    });

    // ===== JOIN RESTAURANT ROOM =====
    socket.on("join_restaurant", (data) => {
      const { restaurant_id } = data;
      if (!restaurant_id) return;

      const room = `restaurant_${restaurant_id}`;
      socket.join(room);
      console.log(`🏪 Client joined restaurant room: ${room}`);
    });

    // ===== DISCONNECT =====
    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });

    // ===== ERROR HANDLING =====
    socket.on("error", (error) => {
      console.error(`🔴 Socket error for ${socket.id}:`, error);
    });
  });
};
