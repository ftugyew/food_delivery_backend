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

  // Wallet balance
  router.get('/:agent_id/wallet', async (req, res) => {
    try {
      const { agent_id } = req.params;
      const [walletRows] = await db.execute("SELECT balance, updated_at FROM agent_wallets WHERE agent_id = ? LIMIT 1", [agent_id]);
      const wallet = walletRows.length ? walletRows[0] : { balance: 0, updated_at: null };
      const [payouts] = await db.execute(
        "SELECT id, amount, status, requested_at, processed_at FROM agent_payouts WHERE agent_id = ? ORDER BY requested_at DESC LIMIT 10",
        [agent_id]
      );
      res.json({ wallet, payouts });
    } catch (err) {
      console.error("Wallet fetch error:", err?.message);
      res.status(500).json({ error: 'Failed to fetch wallet' });
    }
  });

  // Request payout
  router.post('/payout', async (req, res) => {
    try {
      const { agent_id, amount } = req.body;
      if (!agent_id || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid payout request' });
      await db.execute("INSERT INTO agent_payouts (agent_id, amount, status) VALUES (?, ?, 'requested')", [agent_id, amount]);
      res.json({ message: '✅ Payout requested' });
    } catch (err) {
      console.error("Payout request error:", err?.message);
      res.status(500).json({ error: 'Failed to request payout' });
    }
  });

  // Ratings summary
  router.get('/:agent_id/ratings', async (req, res) => {
    try {
      const { agent_id } = req.params;
      const [avgRows] = await db.execute("SELECT AVG(rating) as avg_rating, COUNT(*) as total FROM agent_ratings WHERE agent_id = ?", [agent_id]);
      const summary = avgRows[0] || { avg_rating: null, total: 0 };
      const [ratings] = await db.execute("SELECT order_id, rating, feedback, created_at FROM agent_ratings WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20", [agent_id]);
      res.json({ summary, ratings });
    } catch (err) {
      console.error("Ratings fetch error:", err?.message);
      res.status(500).json({ error: 'Failed to fetch ratings' });
    }
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
        "UPDATE agents SET lat = ?, lng = ?, status = 'Active', updated_at = NOW() WHERE id = ?",
        [lat, lng, agent_id]
      );

      // Save to agent_locations table for history tracking
      try {
        // Get active orders for this agent
        const [orders] = await db.execute(
          "SELECT id FROM orders WHERE agent_id = ? AND status NOT IN ('Delivered', 'Cancelled') LIMIT 1",
          [agent_id]
        );
        
        const orderId = orders.length > 0 ? orders[0].id : null;
        
        // Insert location history
        await db.execute(
          "INSERT INTO agent_locations (agent_id, order_id, latitude, longitude, timestamp) VALUES (?, ?, ?, ?, NOW())",
          [agent_id, orderId, lat, lng]
        );
      } catch (locErr) {
        console.warn("Failed to save location history:", locErr.message);
      }

      // Get all active orders for this agent
      const [activeOrders] = await db.execute(
        "SELECT id FROM orders WHERE agent_id = ? AND status NOT IN ('Delivered', 'Cancelled')",
        [agent_id]
      );

      // Emit location update for each active order
      activeOrders.forEach(order => {
        io.emit(`trackOrder_${order.id}`, { agent_id, lat, lng, timestamp: new Date().toISOString() });
        io.emit(`order_${order.id}_location`, { 
          agent_id, 
          latitude: lat, 
          longitude: lng,
          timestamp: new Date().toISOString() 
        });
      });

      // Also emit general location update
      io.emit("agentLocation", { agent_id, lat, lng });

      console.log(`📍 Agent ${agent_id} location updated in DB: ${lat}, ${lng}`);
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
