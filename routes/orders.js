const express = require("express");
const db = require("../db");
const router = express.Router();

// Pass io for sockets
module.exports = (io) => {
  // Configurable assignment settings via environment
  const ASSIGN_MAX_KM = Number(process.env.ASSIGN_MAX_KM) || 10;
  const ASSIGN_LOAD_STATUSES = (process.env.ASSIGN_LOAD_STATUSES || 'Pending,Confirmed,Picked')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Small helper: pick nearest active agent to a point (lat,lng) with optional max distance and load balancing
  const pickNearestAgent = async (db, lat, lng, opts = {}) => {
    const maxKm = Number.isFinite(opts.maxKm) ? Number(opts.maxKm) : ASSIGN_MAX_KM; // default from env
    if (lat == null || lng == null) return null;
    const [agents] = await db.execute(
      "SELECT id, lat, lng FROM agents WHERE status = 'Active' AND lat IS NOT NULL AND lng IS NOT NULL"
    );
    if (!agents || !agents.length) return null;
    // Load current workload for active/in-progress orders
    let loadMap = new Map();
    try {
      const placeholders = ASSIGN_LOAD_STATUSES.map(() => '?').join(',');
      const [loads] = await db.execute(
        `SELECT agent_id, COUNT(*) AS cnt FROM orders WHERE status IN (${placeholders}) AND agent_id IS NOT NULL GROUP BY agent_id`,
        ASSIGN_LOAD_STATUSES
      );
      loads.forEach(r => loadMap.set(r.agent_id, Number(r.cnt)));
    } catch (_) {}
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371;
    const dist = (aLat, aLng, bLat, bLng) => {
      const dLat = toRad(bLat - aLat);
      const dLng = toRad(bLng - aLng);
      const sa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
      return R * c;
    };
    // Build candidate list with distance and load
    let candidates = agents.map(a => {
      const d = dist(Number(lat), Number(lng), Number(a.lat), Number(a.lng));
      const load = loadMap.get(a.id) ?? 0;
      return { id: a.id, d, load };
    });
    // Apply max distance filter if configured
    if (Number.isFinite(maxKm) && maxKm > 0) {
      candidates = candidates.filter(c => c.d <= maxKm);
      if (!candidates.length) return null; // none within range
    }
    // Sort by load then distance
    candidates.sort((a,b)=> a.load - b.load || a.d - b.d);
    return candidates[0]?.id || null;
  };
  
  // Place Order (Auto-Assign Delivery)
  router.post("/", async (req, res) => {
    const { user_id, restaurant_id, items, total, rest_lat, rest_lng, payment_type, estimated_delivery, delivery_address, delivery_lat, delivery_lng } = req.body;

    // Validate request payload
    if (!user_id || !restaurant_id || !items || !total) {
      return res.status(400).json({ error: "Missing required fields: user_id, restaurant_id, items, total" });
    }

    // Log the incoming request payload
    console.log("Order payload:", req.body);

    try {
      // Determine restaurant coordinates: prefer DB, fallback to provided rest_lat/rest_lng
      let rlat = null, rlng = null;
      try {
        // Support both legacy (lat/lng) and full (latitude/longitude) column names
        const [rows] = await db.execute(
          "SELECT COALESCE(lat, latitude) AS lat, COALESCE(lng, longitude) AS lng FROM restaurants WHERE id = ? LIMIT 1",
          [restaurant_id]
        );
        if (rows && rows.length && rows[0].lat != null && rows[0].lng != null) {
          rlat = Number(rows[0].lat); rlng = Number(rows[0].lng);
        }
      } catch (_) {}
      if (rlat == null || rlng == null) {
        if (isFinite(Number(rest_lat)) && isFinite(Number(rest_lng))) {
          rlat = Number(rest_lat); rlng = Number(rest_lng);
        }
      }

      // Pick nearest active agent (if coordinates known); else fallback to any Active
  let agent_id = await pickNearestAgent(db, rlat, rlng);
      if (!agent_id) {
        try {
          const [agents] = await db.execute("SELECT id FROM agents WHERE status='Active' ORDER BY id ASC LIMIT 1");
          if (agents && agents.length) agent_id = agents[0].id;
        } catch (_) {}
      }

      // Generate unique 12-digit order ID
      let uniqueOrderId = null;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (!uniqueOrderId && attempts < maxAttempts) {
        // Generate random 12-digit number (100000000000 to 999999999999)
        const randomOrderId = Math.floor(100000000000 + Math.random() * 900000000000).toString();
        
        // Check if this order_id already exists
        const [existing] = await db.execute("SELECT id FROM orders WHERE order_id = ? LIMIT 1", [randomOrderId]);
        
        if (!existing || existing.length === 0) {
          uniqueOrderId = randomOrderId;
        }
        attempts++;
      }
      
      // Fallback to timestamp-based ID if random generation fails
      if (!uniqueOrderId) {
        uniqueOrderId = Date.now().toString().padStart(12, '0').slice(-12);
      }

      const statusVar = agent_id ? 'Confirmed' : 'Pending';
      const [result] = await db.execute(
        "INSERT INTO orders (user_id, restaurant_id, items, total, agent_id, status, order_id, payment_type, estimated_delivery, delivery_address, delivery_lat, delivery_lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [user_id, restaurant_id, JSON.stringify(items), total, agent_id, statusVar, uniqueOrderId, payment_type || null, estimated_delivery || null, delivery_address || null, delivery_lat || null, delivery_lng || null]
      );

      const newOrder = { 
        id: result.insertId,
        order_id: uniqueOrderId,
        user_id, 
        restaurant_id, 
        items, 
        total, 
        agent_id, 
        status: statusVar,
        payment_type: payment_type || null,
        estimated_delivery: estimated_delivery || null,
        delivery_address: delivery_address || null
      };
      io.emit("newOrder", newOrder);
      if (agent_id) io.emit(`orderForAgent_${agent_id}`, newOrder);
      res.json({ message: "✅ Order placed", order: newOrder });
    } catch (err) {
      console.error("Order creation error:", err);
      res.status(500).json({ error: "Order failed", details: err.message });
    }
  });

  // Get all orders
  router.get("/", (req, res) => {
    db.execute("SELECT * FROM orders ORDER BY created_at DESC")
    .then(([orders]) => {
      res.json(orders);
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch orders" });
    });
  });
  
  // ===== Get Orders for Specific Restaurant =====
  router.get("/restaurant/:id", (req, res) => {
    const { id } = req.params;
    db.execute("SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC", [id])
      .then(([orders]) => res.json(orders))
      .catch(err => {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch restaurant orders" });
      });
  });

  // ===== Get Orders for Specific Delivery Agent =====
  router.get("/agent/:id", (req, res) => {
    const { id } = req.params;
    db.execute("SELECT * FROM orders WHERE agent_id = ? ORDER BY created_at DESC", [id])
      .then(([orders]) => res.json(orders))
      .catch(err => {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch agent orders" });
      });
  });

  // ===== Update Order Status =====
  router.post("/update", (req, res) => {
    const { order_id, status } = req.body;
    db.execute("UPDATE orders SET status=? WHERE id=?", [status, order_id])
      .then(() => res.json({ message: "Order updated successfully" }))
      .catch(err => {
        console.error(err);
        res.status(500).json({ error: "Failed to update order status" });
      });
  });

  // Save Order Details
  router.post("/save", (req, res) => {
    const { orderId, paymentType, estimatedDelivery } = req.body;

    if (!orderId || !paymentType || !estimatedDelivery) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    db.execute(
      "INSERT INTO orders (order_id, payment_type, estimated_delivery, user_id, restaurant_id, items, total, agent_id, status, delivery_address, delivery_lat, delivery_lng) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'Pending', NULL, NULL, NULL)",
      [orderId, paymentType, estimatedDelivery]
    )
      .then(() => res.status(201).json({ message: "Order saved successfully" }))
      .catch((err) => {
        console.error("Error saving order:", err);
        res.status(500).json({ error: "Failed to save order" });
      });
  });

  // Endpoint to update order details (final path: /api/orders/update-details)
  router.post("/update-details", async (req, res) => {
    const { orderId, paymentType, estimatedDelivery } = req.body;

    if (!orderId || !paymentType || !estimatedDelivery) {
      return res.status(400).json({ error: "Missing required fields" });
    }

  // Log incoming request data for debugging
  console.log("Incoming order details for update-details:", req.body);

    try {
      const query = `UPDATE orders SET payment_type = ?, estimated_delivery = ? WHERE order_id = ?`;
      const [result] = await db.execute(query, [paymentType, estimatedDelivery, orderId]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.status(200).json({ message: "Order details updated successfully" });
    } catch (error) {
      console.error("Error updating order details:", error);
      res.status(500).json({ error: "Failed to update order details" });
    }
  });
  // ===== Create Order (used by frontend success page) =====
  router.post("/new", async (req, res) => {
    try {
      const { user_id, restaurant_id, items, total_price, address, lat, lng, payment_method } = req.body;

      if (!user_id || !restaurant_id || !items || !total_price) {
        return res.status(400).json({ error: "Missing required order details" });
      }

      const uid = Number(user_id);
      const rid = Number(restaurant_id);
      const totalVal = Number(total_price);
      const safeAddress = typeof address === 'string' ? address : '';
      const latVal = isFinite(Number(lat)) ? Number(lat) : null;
      const lngVal = isFinite(Number(lng)) ? Number(lng) : null;
      const payType = payment_method || null;

      const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
      const d = new Date();
      const ymd = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
      const rand = Math.floor(1000 + Math.random() * 9000);
      const orderCode = `TND-${ymd}-${rand}`;

      // Pre-compute nearest agent and status before insert
      let assignedAgentId = null;
      try {
        // Get restaurant coordinates (support legacy and full column names)
        let rlat = null, rlng = null;
        const [rrows] = await db.execute(
          "SELECT COALESCE(lat, latitude) AS lat, COALESCE(lng, longitude) AS lng FROM restaurants WHERE id = ? LIMIT 1",
          [rid]
        );
        if (rrows && rrows.length && rrows[0].lat != null && rrows[0].lng != null) {
          rlat = Number(rrows[0].lat); rlng = Number(rrows[0].lng);
        }
        if (rlat != null && rlng != null) {
          assignedAgentId = await pickNearestAgent(db, rlat, rlng);
        }
        // Fallback to any Active
        if (!assignedAgentId) {
          const [agents] = await db.execute("SELECT id FROM agents WHERE status='Active' ORDER BY id ASC LIMIT 1");
          if (agents && agents.length) assignedAgentId = agents[0].id;
        }
      } catch (_) { /* ignore */ }

      const statusVar2 = assignedAgentId ? 'Confirmed' : 'Pending';
      const [result] = await db.execute(
        `INSERT INTO orders 
         (user_id, restaurant_id, items, total, delivery_address, delivery_lat, delivery_lng, payment_type, status, created_at, order_id, agent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
        [uid, rid, JSON.stringify(items || []), totalVal, safeAddress, latVal, lngVal, payType, statusVar2, orderCode, assignedAgentId]
      );
      console.log('DB insert result:', result);

      // assignedAgentId already computed above and inserted with order

      const payload = {
        id: result.insertId,
        user_id: uid,
        restaurant_id: rid,
        items,
        total_price: totalVal,
        delivery_address: safeAddress,
        delivery_lat: latVal,
        delivery_lng: lngVal,
        payment_method: payType,
  status: statusVar2,
  agent_id: assignedAgentId,
        order_code: orderCode
      };
      // Debug logs: confirm the server is emitting socket events for new orders
      try {
        console.log('📡 Emitting socket events for new order:', { orderId: result.insertId, agent_id: assignedAgentId, restaurant_id: rid });
        
        // Emit to all connected users/admins
        io.emit("newOrder", payload);
        
        // Emit to the specific assigned agent (if any)
        if (assignedAgentId) {
          console.log(`📨 Emitting orderForAgent_${assignedAgentId}`);
          io.emit(`orderForAgent_${assignedAgentId}`, payload);
        }
        
        // Emit to the specific restaurant
        console.log(`📨 Emitting orderForRestaurant_${rid}`);
        io.emit(`orderForRestaurant_${rid}`, payload);
        
        // NEW: Emit to ALL online agents so they can see available orders
        console.log(`📨 Broadcasting order to all online agents`);
        io.emit("newAvailableOrder", payload);
        
      } catch (emitErr) {
        console.error('Socket emit failed for new order:', emitErr);
      }

  // ============================================
  // UPDATE ORDER DELIVERY STATE
  // ============================================
  router.put("/:orderId/status", async (req, res) => {
    const { orderId } = req.params;
    const { tracking_status, latitude, longitude } = req.body;
    const agentId = req.user?.agent_id || req.user?.user_id;

    try {
      // Validate tracking_status
      const validStatuses = [
        'waiting',
        'agent_assigned',
        'agent_going_to_restaurant',
        'arrived_at_restaurant',
        'picked_up',
        'in_transit',
        'delivered'
      ];

      if (!tracking_status || !validStatuses.includes(tracking_status)) {
        return res.status(400).json({ 
          error: "Invalid tracking status. Valid values: " + validStatuses.join(", ")
        });
      }

      // Get current order
      const [orders] = await db.execute(
        "SELECT id, user_id, agent_id, restaurant_id, status FROM orders WHERE id = ?",
        [orderId]
      );

      if (!orders || orders.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orders[0];

      // Security: Verify agent can only update own orders
      if (req.user.role === 'delivery_agent' && order.agent_id !== agentId) {
        return res.status(403).json({ error: "You can only update your assigned orders" });
      }

      // Build update query based on status
      let updateQuery = "UPDATE orders SET tracking_status = ?";
      let params = [tracking_status];

      // Update related timestamp columns
      if (tracking_status === 'agent_assigned') {
        updateQuery += ", agent_assigned_at = NOW(), status = 'Confirmed'";
      } else if (tracking_status === 'picked_up') {
        updateQuery += ", picked_up_at = NOW(), status = 'Picked Up'";
      } else if (tracking_status === 'delivered') {
        updateQuery += ", delivered_at = NOW(), status = 'Delivered'";
      } else if (tracking_status === 'agent_going_to_restaurant') {
        // Keep as "Confirmed" status
      } else if (tracking_status === 'arrived_at_restaurant') {
        // Keep as "Confirmed" or "Preparing" 
      } else if (tracking_status === 'in_transit') {
        updateQuery += ", status = 'In Transit'";
      }

      // Add order ID to WHERE clause
      updateQuery += " WHERE id = ?";
      params.push(orderId);

      // Execute update
      await db.execute(updateQuery, params);

      // Log tracking event
      await db.execute(
        `INSERT INTO order_tracking_events (order_id, event_type, event_data, latitude, longitude) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          orderId,
          tracking_status,
          JSON.stringify({ agent_id: agentId }),
          latitude || null,
          longitude || null
        ]
      );

      // Get updated order details for response
      const [updatedOrders] = await db.execute(
        `SELECT o.*, 
                r.name as restaurant_name, r.lat as restaurant_lat, r.lng as restaurant_lng,
                a.name as agent_name, a.phone as agent_phone,
                u.name as customer_name, u.phone as customer_phone
         FROM orders o
         LEFT JOIN restaurants r ON o.restaurant_id = r.id
         LEFT JOIN agents a ON o.agent_id = a.id
         LEFT JOIN users u ON o.user_id = u.id
         WHERE o.id = ?`,
        [orderId]
      );

      const updatedOrder = updatedOrders[0];

      // Emit Socket.IO event to all listeners
      io.emit(`order_${orderId}_status_update`, {
        order_id: orderId,
        tracking_status,
        status: updatedOrder.status,
        agent_id: order.agent_id,
        user_id: order.user_id,
        latitude,
        longitude,
        timestamp: new Date().toISOString()
      });

      // Emit specific events based on status
      if (tracking_status === 'delivered') {
        // Notify user that order is delivered
        io.emit(`order_${orderId}_delivered`, {
          order_id: orderId,
          message: "Your order has been delivered",
          timestamp: new Date().toISOString()
        });
      } else if (tracking_status === 'picked_up') {
        // Notify user that agent picked up order from restaurant
        io.emit(`order_${orderId}_picked_up`, {
          order_id: orderId,
          message: "Agent has picked up your order",
          agent_name: updatedOrder.agent_name,
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        order_id: orderId,
        tracking_status,
        order: updatedOrder
      });
    } catch (err) {
      console.error("Update order status error:", err);
      res.status(500).json({ 
        error: "Failed to update order status",
        details: err.message 
      });
    }
  });

  return router;
};

