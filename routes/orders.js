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
  
  // Place Order (Broadcast to Online Agents)
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
      let restaurantName = null;
      try {
        // Support both legacy (lat/lng) and full (latitude/longitude) column names
        const [rows] = await db.execute(
          "SELECT name, COALESCE(lat, latitude) AS lat, COALESCE(lng, longitude) AS lng FROM restaurants WHERE id = ? LIMIT 1",
          [restaurant_id]
        );
        if (rows && rows.length) {
          if (rows[0].lat != null && rows[0].lng != null) {
            rlat = Number(rows[0].lat); rlng = Number(rows[0].lng);
          }
          restaurantName = rows[0].name;
        }
      } catch (_) {}
      if (rlat == null || rlng == null) {
        if (isFinite(Number(rest_lat)) && isFinite(Number(rest_lng))) {
          rlat = Number(rest_lat); rlng = Number(rest_lng);
        }
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

      // Save order with status "waiting_for_agent" - NO auto-assignment
      const [result] = await db.execute(
        "INSERT INTO orders (user_id, restaurant_id, items, total, agent_id, status, order_id, payment_type, estimated_delivery, delivery_address, delivery_lat, delivery_lng) VALUES (?, ?, ?, ?, NULL, 'waiting_for_agent', ?, ?, ?, ?, ?, ?)",
        [user_id, restaurant_id, JSON.stringify(items), total, uniqueOrderId, payment_type || null, estimated_delivery || null, delivery_address || null, delivery_lat || null, delivery_lng || null]
      );

      // Calculate distance estimate if coordinates available
      let distanceKm = null;
      if (rlat && rlng && delivery_lat && delivery_lng) {
        const toRad = (d) => (d * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(Number(delivery_lat) - rlat);
        const dLng = toRad(Number(delivery_lng) - rlng);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(rlat)) * Math.cos(toRad(Number(delivery_lat))) * Math.sin(dLng / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distanceKm = (R * c).toFixed(2);
      }

      const newOrder = { 
        id: result.insertId,
        order_id: uniqueOrderId,
        user_id, 
        restaurant_id,
        restaurant_name: restaurantName,
        restaurant_lat: rlat,
        restaurant_lng: rlng,
        items, 
        total, 
        agent_id: null, 
        status: 'waiting_for_agent',
        payment_type: payment_type || null,
        estimated_delivery: estimated_delivery || null,
        delivery_address: delivery_address || null,
        delivery_lat: delivery_lat || null,
        delivery_lng: delivery_lng || null,
        distance_km: distanceKm,
        payout_estimate: (Number(total) * 0.15).toFixed(2) // 15% of order total
      };

      // Fetch ALL ACTIVE ONLINE agents with their complete location data for maps
      const [onlineAgents] = await db.execute(
        `SELECT 
          id, 
          name, 
          phone, 
          lat, 
          lng, 
          vehicle_type,
          status,
          is_online,
          is_busy,
          (
            6371 * acos(
              cos(radians(?)) * cos(radians(lat)) * cos(radians(lng) - radians(?)) +
              sin(radians(?)) * sin(radians(lat))
            )
          ) as distance_from_delivery_km
        FROM agents 
        WHERE is_online = TRUE 
          AND is_busy = FALSE 
          AND status = 'Active'
          AND lat IS NOT NULL 
          AND lng IS NOT NULL
        ORDER BY distance_from_delivery_km ASC`,
        [delivery_lat, delivery_lng, delivery_lat]
      );

      console.log(`📡 Broadcasting order #${result.insertId} to ${onlineAgents.length} ACTIVE online agents`);
      console.log(`   Restaurant: [${rlat}, ${rlng}] → Delivery: [${delivery_lat}, ${delivery_lng}]`);

      // Broadcast to ALL active online agents with enriched order data
      if (onlineAgents.length > 0) {
        // Create enriched order object with maps data for each agent
        onlineAgents.forEach((agent, index) => {
          const enrichedOrder = {
            ...newOrder,
            id: result.insertId,
            // Maps data for delivery location
            delivery_maps: {
              lat: delivery_lat,
              lng: delivery_lng,
              address: delivery_address,
              zoom: 15
            },
            // Maps data for restaurant (pickup location)
            restaurant_maps: {
              lat: rlat,
              lng: rlng,
              name: restaurantName,
              zoom: 15
            },
            // Agent's current location
            agent_current_location: {
              lat: agent.lat,
              lng: agent.lng
            },
            // Distance from agent to delivery
            distance_to_delivery_km: parseFloat(agent.distance_from_delivery_km || 0).toFixed(2),
            // Rank this agent by proximity
            agent_rank: index + 1,
            // All available agents count
            total_agents_notified: onlineAgents.length,
            // Estimated arrival
            estimated_arrival_mins: Math.round(parseFloat(agent.distance_from_delivery_km || 0) / 15 * 60) // Assuming 15 km/h avg
          };
          
          io.emit(`agent_${agent.id}_new_order`, enrichedOrder);
          console.log(`  ✅ Sent to agent ${agent.id} (${agent.name}) - Rank: ${index + 1}/${onlineAgents.length} - Distance: ${enrichedOrder.distance_to_delivery_km}km - ETA: ${enrichedOrder.estimated_arrival_mins}min`);
        });
      } else {
        console.warn(`⚠️ No active online agents available to broadcast order #${result.insertId}`);
      }

      // General broadcast for admin/monitoring
      io.emit("newOrder", newOrder);
      io.emit("newAvailableOrder", newOrder);
      io.emit(`orderForRestaurant_${restaurant_id}`, newOrder);

      res.json({ message: "✅ Order placed and broadcast to agents", order: newOrder });
    } catch (err) {
      console.error("Order creation error:", err);
      res.status(500).json({ error: "Order failed", details: err.message });
    }
  });

  // ============================================
  // AGENT ACCEPTS ORDER (ATOMIC ASSIGNMENT)
  // ============================================
  router.post("/accept-order", async (req, res) => {
    const { order_id, agent_id } = req.body;

    if (!order_id || !agent_id) {
      return res.status(400).json({ error: "order_id and agent_id required" });
    }

    try {
      // Check if agent is online and not busy
      const [agents] = await db.execute(
        "SELECT id, name, is_online, is_busy FROM agents WHERE id = ? LIMIT 1",
        [agent_id]
      );

      if (!agents || agents.length === 0) {
        return res.status(404).json({ error: "Agent not found" });
      }

      const agent = agents[0];

      if (!agent.is_online) {
        return res.status(403).json({ error: "You are offline. Please go online to accept orders." });
      }

      if (agent.is_busy) {
        return res.status(403).json({ error: "You already have an active order. Complete it first." });
      }

      // ATOMIC UPDATE: Only assign if still waiting_for_agent (race condition protection)
      const [result] = await db.execute(
        `UPDATE orders 
         SET agent_id = ?, status = 'agent_assigned', updated_at = NOW() 
         WHERE id = ? AND agent_id IS NULL AND status = 'waiting_for_agent'`,
        [agent_id, order_id]
      );

      if (result.affectedRows === 0) {
        // Order already taken by another agent
        return res.status(409).json({ 
          error: "Order already accepted by another agent",
          code: "ORDER_TAKEN"
        });
      }

      // Mark agent as busy
      await db.execute(
        "UPDATE agents SET is_busy = TRUE WHERE id = ?",
        [agent_id]
      );

      // Fetch complete order details
      const [orders] = await db.execute(
        `SELECT o.*, r.name as restaurant_name, r.lat as restaurant_lat, r.lng as restaurant_lng
         FROM orders o
         LEFT JOIN restaurants r ON o.restaurant_id = r.id
         WHERE o.id = ? LIMIT 1`,
        [order_id]
      );

      const order = orders[0];

      console.log(`✅ Order #${order_id} accepted by agent ${agent_id} (${agent.name})`);

      // Notify the agent who got the order
      io.emit(`agent_${agent_id}_order_assigned`, {
        success: true,
        order: order,
        message: "Order assigned successfully"
      });

      // Notify ALL other online agents that this order is taken
      const [otherAgents] = await db.execute(
        "SELECT id FROM agents WHERE is_online = TRUE AND id != ?",
        [agent_id]
      );

      otherAgents.forEach(otherAgent => {
        io.emit(`agent_${otherAgent.id}_order_taken`, {
          order_id: order_id,
          message: "This order was accepted by another agent"
        });
      });

      // General broadcast for tracking/admin
      io.emit("orderUpdate", { order_id, status: "agent_assigned", agent_id });
      io.emit(`order_${order_id}_assigned`, { agent_id, agent_name: agent.name });

      res.json({ 
        success: true, 
        message: "Order accepted successfully",
        order: order
      });

    } catch (err) {
      console.error("Order acceptance error:", err);
      res.status(500).json({ error: "Failed to accept order", details: err.message });
    }
  });

  // ============================================
  // AGENT REJECTS ORDER
  // ============================================
  router.post("/reject-order", async (req, res) => {
    const { order_id, agent_id, reason } = req.body;

    if (!order_id || !agent_id) {
      return res.status(400).json({ error: "order_id and agent_id required" });
    }

    try {
      console.log(`❌ Agent ${agent_id} rejected order #${order_id}. Reason: ${reason || 'Not specified'}`);

      // Just log the rejection - order remains available for other agents
      // Optionally: store rejection in a separate table for analytics

      res.json({ 
        success: true, 
        message: "Order rejected. It remains available for other agents."
      });

    } catch (err) {
      console.error("Order rejection error:", err);
      res.status(500).json({ error: "Failed to reject order", details: err.message });
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

      // Respond to client with created order
      return res.status(201).json({ message: "Order created", order: payload });

    } catch (err) {
      console.error("Error creating order (POST /new):", err);
      return res.status(500).json({ error: "Failed to create order", details: err.message });
    }
  });

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

