const express = require("express");
const db = require("../db");
const router = express.Router();

module.exports = (io) => {
  // Earnings tracker for agent
  router.get('/:agent_id/earnings', (req, res) => {
    const { agent_id } = req.params;
    db.query('SELECT SUM(total) as total_earnings, COUNT(*) as total_orders FROM orders WHERE agent_id=? AND status="Delivered"', [agent_id], (err, result) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch earnings' });
      db.query('SELECT id, total, DATE(created_at) as date FROM orders WHERE agent_id=? AND status="Delivered" ORDER BY created_at DESC', [agent_id], (err2, orders) => {
        if (err2) return res.status(500).json({ error: 'Failed to fetch order earnings' });
        res.json({ summary: result[0], orders });
      });
    });
  });

  // Delivery history for agent
  router.get('/:agent_id/history', (req, res) => {
    const { agent_id } = req.params;
    db.query('SELECT * FROM orders WHERE agent_id=? AND status="Delivered" ORDER BY delivered_at DESC', [agent_id], (err, orders) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch history' });
      res.json(orders);
    });
  });

  // Proof of delivery (photo/signature)
  router.post('/proof', (req, res) => {
    const { order_id, agent_id, proof_type, proof_data } = req.body;
    db.query('INSERT INTO delivery_proofs (order_id, agent_id, proof_type, proof_data) VALUES (?, ?, ?, ?)', [order_id, agent_id, proof_type, proof_data], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to save proof' });
      res.json({ message: '✅ Proof saved' });
    });
  });

  // Break/Offline mode
  router.post('/availability', (req, res) => {
    const { agent_id, available } = req.body;
    // Map availability to enum: Active / Inactive (schema supports 'Busy' as well)
    const newStatus = available ? 'Active' : 'Inactive';
    db.query('UPDATE agents SET status=? WHERE id=?', [newStatus, agent_id], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to update availability' });
      io.emit('agentAvailability', { agent_id, available, status: newStatus });
      res.json({ message: '✅ Availability updated', status: newStatus });
    });
  });

  // Chat/Call placeholder endpoints
  router.post('/chat', (req, res) => {
    // { order_id, agent_id, customer_id, message }
    res.json({ message: '✅ Chat message sent (demo)' });
  });
  router.post('/call', (req, res) => {
    // { order_id, agent_id, customer_id }
    res.json({ message: '✅ Call initiated (demo)' });
  });

  // Update agent location
  router.post("/location", (req, res) => {
    const { agent_id, lat, lng } = req.body;
    db.query("UPDATE agents SET lat=?, lng=?, status='Active' WHERE id=?", [lat, lng, agent_id]);
    io.emit("agentLocation", { agent_id, lat, lng });
    res.json({ message: "✅ Location updated" });
  });

  // ===== NEW: Deliver Location Update (for spec compliance) =====
  router.post("/update-location", async (req, res) => {
    try {
      const { agent_id, lat, lng } = req.body;
      
      if (!agent_id || typeof lat !== "number" || typeof lng !== "number") {
        return res.status(400).json({ error: "Invalid agent_id, lat, or lng" });
      }

      // Update agent location in database
      await db.execute(
        "UPDATE agents SET lat = ?, lng = ?, status = 'Active' WHERE id = ?",
        [lat, lng, agent_id]
      );

      // Get all orders for this agent
      const [orders] = await db.execute(
        "SELECT id FROM orders WHERE agent_id = ? AND status NOT IN ('Completed', 'Cancelled')",
        [agent_id]
      );

      // Emit location update for each order
      orders.forEach(order => {
        io.emit(`trackOrder_${order.id}`, { agent_id, lat, lng });
      });

      // Also emit general location update
      io.emit("agentLocation", { agent_id, lat, lng });

      console.log(`📍 Agent ${agent_id} location updated: ${lat}, ${lng}`);
      res.json({ success: true, message: "Location updated", agent_id, lat, lng });
    } catch (err) {
      console.error("Location update error:", err);
      res.status(500).json({ error: "Failed to update location", details: err.message });
    }
  });

  // Fetch agent location by order id (for tracking page polling)
  router.get("/location/:order_id", async (req, res) => {
    try {
      const orderId = req.params.order_id;
      const [rows] = await db.execute(
        `SELECT a.id AS agent_id, a.lat, a.lng, a.name, a.phone
         FROM orders o
         LEFT JOIN agents a ON o.agent_id = a.id
         WHERE o.id = ? LIMIT 1`,
        [orderId]
      );
      if (!rows || rows.length === 0 || !rows[0].agent_id) {
        return res.status(404).json({ error: "No agent assigned" });
      }
      const r = rows[0];
      res.json({ agent_id: r.agent_id, lat: Number(r.lat), lng: Number(r.lng), name: r.name, phone: r.phone });
    } catch (e) {
      console.error("Agent location fetch error:", e);
      res.status(500).json({ error: "Failed to fetch location" });
    }
  });

  // Fetch assigned orders (include newly auto-assigned orders)
  router.get("/:agent_id/orders", (req, res) => {
    const { agent_id } = req.params;
    // Show orders that the agent needs to act on: Confirmed (auto-assigned), Pending, Preparing, Ready, Picked Up
    const statuses = ['Pending','Confirmed','Preparing','Ready','Picked Up'];
    const placeholders = statuses.map(() => '?').join(',');
    const sql = `SELECT * FROM orders WHERE agent_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC`;
    db.query(sql, [agent_id, ...statuses], (err, orders) => {
      if (err) return res.status(500).json({ error: "Failed to fetch orders" });
      res.json(orders);
    });
  });

  // Resolve agent by user_id (to map logged-in delivery user -> agent id)
  router.get("/by-user/:user_id", async (req, res) => {
    try {
      const { user_id } = req.params;
      const [rows] = await db.execute("SELECT id, user_id, name, phone, status, lat, lng FROM agents WHERE user_id=? LIMIT 1", [user_id]);
      if (!rows || !rows.length) return res.status(404).json({ error: "Agent not found for user" });
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: "Failed to resolve agent" });
    }
  });

  // Update order status
  router.post("/update-order", (req, res) => {
    const { order_id, status } = req.body;
    db.query("UPDATE orders SET status=? WHERE id=?", [status, order_id]);
    io.emit("orderUpdate", { order_id, status });
    res.json({ message: "✅ Order updated" });
  });

  return router;
};
