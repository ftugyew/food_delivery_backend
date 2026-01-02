const express = require("express");
const db = require("../db");
const {
  ORDER_STATUS,
  TRACKING_STATUS,
  ORDER_STATUS_VALUES,
  TRACKING_STATUS_VALUES
} = require("../constants/statuses");
const { assignAgentToOrder, AssignmentError } = require("../services/order-assignment");
const router = express.Router();

const assertNoLegacyOrderFields = (sql = "") => {
  const lower = String(sql).toLowerCase();
  if (!lower.includes("orders")) return;
  const forbidden = [
    "orders (lat",
    "orders (lng",
    "orders (address",
    "orders.lat",
    "orders.lng",
    "orders.address",
    "orders set lat",
    "orders set lng",
    "orders set address"
  ];
  const hit = forbidden.find((f) => lower.includes(f));
  if (hit) {
    const err = new Error(`Unsafe orders column usage detected: ${hit}`);
    err.code = "ORDERS_LEGACY_FIELDS";
    throw err;
  }
};

const wrapExecuteWithGuard = (fn) => {
  return function guardedExecute(sql, params) {
    assertNoLegacyOrderFields(sql);
    return fn.call(this, sql, params);
  };
};

// Pass io for sockets
module.exports = (io) => {
  // Global guard on pool-level execute
  if (typeof db.execute === "function" && !db.__ordersGuarded) {
    db.execute = wrapExecuteWithGuard(db.execute.bind(db));
    db.__ordersGuarded = true;
  }
  // Configurable assignment settings via environment
  const ASSIGN_MAX_KM = Number(process.env.ASSIGN_MAX_KM) || 10;
  const DEFAULT_ASSIGN_LOAD_STATUSES = [
    ORDER_STATUS.PENDING,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PICKED_UP
  ];
  const ASSIGN_LOAD_STATUSES = (process.env.ASSIGN_LOAD_STATUSES || DEFAULT_ASSIGN_LOAD_STATUSES.join(","))
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

  const normalizeOrderStatus = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    const lower = raw.toLowerCase();
    switch (lower) {
      case 'accepted':
      case 'waiting':
      case 'waiting for agent':
      case 'waiting_for_agent':
        return ORDER_STATUS.WAITING_AGENT;
      case 'assigned':
      case 'agent assigned':
      case 'agent_assigned':
        return ORDER_STATUS.AGENT_ASSIGNED;
      case 'pending':
        return ORDER_STATUS.PENDING;
      case 'confirmed':
        return ORDER_STATUS.CONFIRMED;
      case 'preparing':
        return ORDER_STATUS.PREPARING;
      case 'ready':
        return ORDER_STATUS.READY;
      case 'picked':
      case 'picked up':
      case 'picked_up':
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
      case 'waiting':
      case 'pending':
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
  
  // Place Order (Safe params with delivery snapshot from users)
  router.post("/", async (req, res) => {
    const toNum = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
    const toStr = (v) => (v === undefined || v === null ? null : String(v));
    const toJsonStr = (v, fallback = "[]") => {
      if (v === undefined || v === null) return fallback;
      try { return JSON.stringify(v); } catch (_) { return fallback; }
    };

    const userId = toNum(req.body.user_id);
    const restaurantId = toNum(req.body.restaurant_id);
    const totalVal = toNum(req.body.total);
    const paymentType = toStr(req.body.payment_type) || 'COD';
    const etaStr = toStr(req.body.estimated_delivery) || '30-35 mins';

    // ⭐ CRITICAL: Validate items BEFORE processing
    const items = req.body.items;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        error: "Order items missing",
        message: "Items array is required and must not be empty"
      });
    }

    const itemsJson = toJsonStr(items);

    if (userId == null || restaurantId == null || totalVal == null) {
      return res.status(400).json({ error: "Missing required fields: user_id, restaurant_id, total" });
    }

    const connection = await db.getConnection();
    connection.execute = wrapExecuteWithGuard(connection.execute.bind(connection));
    try {
      await connection.beginTransaction();

      const [userRows] = await connection.execute(
        "SELECT lat, lng, address FROM users WHERE id = ? LIMIT 1",
        [userId]
      );

      if (!userRows || userRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "User not found" });
      }

      const user = userRows[0];
      const snapLat = user.lat != null ? Number(user.lat) : null;
      const snapLng = user.lng != null ? Number(user.lng) : null;
      const snapAddress = user.address != null ? user.address : null;

      if (!Number.isFinite(snapLat) || !Number.isFinite(snapLng)) {
        await connection.rollback();
        return res.status(400).json({ error: "Delivery location missing" });
      }

      let uniqueOrderId = null;
      for (let i = 0; i < 10 && !uniqueOrderId; i++) {
        const randId = Math.floor(100000000000 + Math.random() * 900000000000).toString();
        const [existing] = await connection.execute("SELECT id FROM orders WHERE order_id = ? LIMIT 1", [randId]);
        if (!existing || existing.length === 0) uniqueOrderId = randId;
      }
      if (!uniqueOrderId) uniqueOrderId = Date.now().toString().padStart(12, "0").slice(-12);

      console.log('📦 Creating order with data:', {
        userId,
        restaurantId,
        itemsJson: itemsJson.substring(0, 100) + '...',
        totalVal,
        paymentType,
        etaStr,
        delivery: { lat: snapLat, lng: snapLng, address: snapAddress }
      });

      const baseInsertSql = `INSERT INTO orders (
        user_id,
        restaurant_id,
        delivery_lat,
        delivery_lng,
        delivery_address,
        items,
        total,
        order_id,
        payment_type,
        estimated_delivery,
        status,
        tracking_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting_for_agent', 'waiting')`;

      const [insertResult] = await connection.execute(baseInsertSql, [
        userId,
        restaurantId,
        snapLat,
        snapLng,
        snapAddress,
        itemsJson,
        totalVal,
        uniqueOrderId,
        paymentType,
        etaStr
      ]);

      console.log('✅ Order inserted successfully with ID:', insertResult.insertId);

      const orderDbId = insertResult.insertId;

      await connection.commit();

      const newOrder = {
        id: orderDbId,
        order_id: uniqueOrderId,
        user_id: userId,
        restaurant_id: restaurantId,
        items: req.body.items || [],
        total: totalVal,
        agent_id: null,
        status: ORDER_STATUS.WAITING_AGENT,
        tracking_status: TRACKING_STATUS.WAITING,
        payment_type: paymentType,
        estimated_delivery: etaStr,
        delivery_address: snapAddress,
        delivery_lat: snapLat,
        delivery_lng: snapLng
      };

      io.emit("newOrder", newOrder);
      io.emit(`orderForRestaurant_${restaurantId}`, newOrder);

      return res.status(201).json({ message: "Order created", order: newOrder });
    } catch (err) {
      try { await connection.rollback(); } catch (_) {}
      console.error("Order creation error:", err);
      return res.status(500).json({ error: "Order failed", details: err.message });
    } finally {
      connection.release();
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
      const { order, agent } = await assignAgentToOrder({
        db,
        orderId: order_id,
        agentId: agent_id
      });

      console.log(`✅ Order #${order_id} accepted by agent ${agent_id} (${agent.name})`);

      io.emit(`agent_${agent_id}_order_assigned`, {
        success: true,
        order,
        message: "Order assigned successfully"
      });

      const [otherAgents] = await db.execute(
        "SELECT id FROM agents WHERE is_online = TRUE AND id != ?",
        [agent_id]
      );

      otherAgents.forEach(otherAgent => {
        io.emit(`agent_${otherAgent.id}_order_taken`, {
          order_id,
          message: "This order was accepted by another agent"
        });
      });

      io.emit("orderUpdate", { order_id, status: ORDER_STATUS.AGENT_ASSIGNED, agent_id });
      io.emit(`order_${order_id}_assigned`, { agent_id, agent_name: agent.name });

      res.json({
        success: true,
        message: "Order accepted successfully",
        order
      });
    } catch (err) {
      if (err instanceof AssignmentError) {
        return res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
      }
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

  // ===== Get Order Details (Join-based, no phone duplication) =====
  router.get("/:orderId/details", async (req, res) => {
    const { orderId } = req.params;
    try {
      const [rows] = await db.execute(
        `SELECT
           o.id,
           o.status,
           o.tracking_status,
           o.delivery_lat,
           o.delivery_lng,
           o.delivery_address,
           u.name AS customer_name,
           u.phone AS customer_phone,
           r.name AS restaurant_name,
           r.phone AS restaurant_phone,
           a.name AS agent_name,
           a.phone AS agent_phone
         FROM orders o
         JOIN users u ON o.user_id = u.id
         JOIN restaurants r ON o.restaurant_id = r.id
         LEFT JOIN agents a ON o.agent_id = a.id
         WHERE o.id = ?
         LIMIT 1`,
        [orderId]
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(rows[0]);
    } catch (err) {
      console.error("Fetch order details error:", err);
      res.status(500).json({ error: "Failed to fetch order details" });
    }
  });

  // ===== Update Order Status =====
  router.post("/update", async (req, res) => {
    const { order_id, status } = req.body;
    const normalizedStatus = normalizeOrderStatus(status);

    if (!order_id || !normalizedStatus) {
      return res.status(400).json({
        error: "Invalid order_id or status",
        allowed_statuses: ORDER_STATUS_VALUES
      });
    }
    
    try {
      const setClauses = ["status = ?"];
      const params = [normalizedStatus];

      if (normalizedStatus === ORDER_STATUS.WAITING_AGENT) {
        setClauses.push("tracking_status = ?");
        params.push(TRACKING_STATUS.PENDING);
      }

      await db.execute(`UPDATE orders SET ${setClauses.join(", ")} WHERE id = ?`, [...params, order_id]);
      
      // If restaurant accepts order, trigger delivery agent assignment flow
      if (normalizedStatus === ORDER_STATUS.WAITING_AGENT) {
        console.log(`🍔 Order #${order_id} is waiting for agent assignment...`);
        
        // Get order details with restaurant location
        const [orderRows] = await db.execute(
          `SELECT o.*, r.lat as restaurant_lat, r.lng as restaurant_lng, r.name as restaurant_name
           FROM orders o
           LEFT JOIN restaurants r ON o.restaurant_id = r.id
           WHERE o.id = ?`,
          [order_id]
        );
        
        if (orderRows && orderRows.length > 0) {
          const order = orderRows[0];
          
          // Get online agents
          const [onlineAgents] = await db.execute(
            "SELECT id, name, lat, lng FROM agents WHERE is_online = TRUE AND is_busy = FALSE AND status = 'Active'"
          );
          
          if (onlineAgents && onlineAgents.length > 0) {
            console.log(`📡 Broadcasting order #${order_id} to ${onlineAgents.length} online agents`);
            
            // Broadcast to all online agents
            onlineAgents.forEach(agent => {
              io.emit(`agent_${agent.id}_new_order`, {
                ...order,
                restaurant_name: order.restaurant_name,
                restaurant_lat: order.restaurant_lat,
                restaurant_lng: order.restaurant_lng
              });
            });
            
            // Also emit general broadcast
            io.emit("newAvailableOrder", {
              ...order,
              restaurant_name: order.restaurant_name,
              restaurant_lat: order.restaurant_lat,
              restaurant_lng: order.restaurant_lng
            });
            
            console.log(`✅ Order #${order_id} broadcasted to delivery agents`);
          } else {
            console.log(`⚠️ No online agents available for order #${order_id}`);
          }
        }
      }
      
      // Emit general order update event
      io.emit("orderUpdate", { order_id, status: normalizedStatus });
      
      res.json({ message: "Order updated successfully" });
    } catch (err) {
      console.error("Error updating order:", err);
      res.status(500).json({ error: "Failed to update order status" });
    }
  });

  // Save Order Details
  router.post("/save", (req, res) => {
    const { orderId, paymentType, estimatedDelivery } = req.body;

    if (!orderId || !paymentType || !estimatedDelivery) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    db.execute(
      "INSERT INTO orders (order_id, payment_type, estimated_delivery, user_id, restaurant_id, items, total, agent_id, status, delivery_address, delivery_lat, delivery_lng) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, NULL)",
      [orderId, paymentType, estimatedDelivery, ORDER_STATUS.PENDING]
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
    const connection = await db.getConnection();
    connection.execute = wrapExecuteWithGuard(connection.execute.bind(connection));
    try {
      await connection.beginTransaction();

      const { user_id, restaurant_id, items, total_price, payment_method } = req.body;

      if (!user_id || !restaurant_id || !items || !total_price) {
        await connection.rollback();
        return res.status(400).json({ error: "Missing required order details" });
      }

      const uid = Number(user_id);
      const rid = Number(restaurant_id);
      const totalVal = Number(total_price);
      const payType = payment_method || null;

      // Snapshot delivery data from users table
      const [userRows] = await connection.execute(
        "SELECT lat, lng, address FROM users WHERE id = ? LIMIT 1",
        [uid]
      );

      if (!userRows || userRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: "User not found" });
      }

      const user = userRows[0];
      const snapLat = user.lat != null ? Number(user.lat) : null;
      const snapLng = user.lng != null ? Number(user.lng) : null;
      const snapAddress = user.address != null ? user.address : null;

      if (!Number.isFinite(snapLat) || !Number.isFinite(snapLng)) {
        await connection.rollback();
        return res.status(400).json({ error: "Delivery location missing" });
      }

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
        const [rrows] = await connection.execute(
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
          const [agents] = await connection.execute("SELECT id FROM agents WHERE status='Active' ORDER BY id ASC LIMIT 1");
          if (agents && agents.length) assignedAgentId = agents[0].id;
        }
      } catch (_) { /* ignore */ }

      const statusValue = assignedAgentId ? ORDER_STATUS.AGENT_ASSIGNED : ORDER_STATUS.WAITING_AGENT;
      const trackingValue = assignedAgentId ? TRACKING_STATUS.ACCEPTED : TRACKING_STATUS.PENDING;

      const baseInsertSql = `INSERT INTO orders (
        user_id,
        restaurant_id,
        delivery_lat,
        delivery_lng,
        delivery_address,
        status,
        tracking_status
      ) VALUES (?, ?, ?, ?, ?, 'waiting_for_agent', 'pending')`;

      const [insertResult] = await connection.execute(baseInsertSql, [
        uid,
        rid,
        snapLat,
        snapLng,
        snapAddress
      ]);

      const orderDbId = insertResult.insertId;

      const finalizeSql = `UPDATE orders
        SET items = ?, total = ?, payment_type = ?, order_id = ?, agent_id = ?, status = ?, tracking_status = ?
        WHERE id = ?`;
      await connection.execute(finalizeSql, [
        JSON.stringify(items || []),
        totalVal,
        payType,
        orderCode,
        assignedAgentId,
        statusValue,
        trackingValue,
        orderDbId
      ]);

      if (assignedAgentId) {
        try {
          await connection.execute("UPDATE agents SET is_busy = 1 WHERE id = ?", [assignedAgentId]);
        } catch (busyErr) {
          console.warn("Failed to mark agent busy for auto-assigned order:", busyErr.message);
        }
      }

      await connection.commit();
      console.log('DB insert result:', insertResult);

      const payload = {
        id: orderDbId,
        user_id: uid,
        restaurant_id: rid,
        items,
        total_price: totalVal,
        delivery_address: snapAddress,
        delivery_lat: snapLat,
        delivery_lng: snapLng,
        payment_method: payType,
        status: statusValue,
        tracking_status: trackingValue,
        agent_id: assignedAgentId,
        order_code: orderCode
      };
      // Debug logs: confirm the server is emitting socket events for new orders
      try {
        console.log('📡 Emitting socket events for new order:', { orderId: orderDbId, agent_id: assignedAgentId, restaurant_id: rid });
        
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
      try { await connection.rollback(); } catch (_) {}
      console.error("Error creating order (POST /new):", err);
      return res.status(500).json({ error: "Failed to create order", details: err.message });
    } finally {
      connection.release();
    }
  });

  // ============================================
  // UPDATE ORDER DELIVERY STATE
  // ============================================
  router.put("/:orderId/status", async (req, res) => {
    const { orderId } = req.params;
    const { tracking_status, latitude, longitude } = req.body;
    const agentId = req.user?.agent_id || req.user?.user_id;

    const normalizedTracking = normalizeTrackingStatus(tracking_status);

    try {
      if (!normalizedTracking) {
        return res.status(400).json({
          error: "Invalid tracking status",
          allowed_statuses: TRACKING_STATUS_VALUES
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
        case TRACKING_STATUS.PENDING:
          updateQuery += ", status = ?";
          params.push(ORDER_STATUS.PENDING);
          break;
        default:
          break;
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
          normalizedTracking,
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
        tracking_status: normalizedTracking,
        status: updatedOrder.status,
        agent_id: order.agent_id,
        user_id: order.user_id,
        latitude,
        longitude,
        timestamp: new Date().toISOString()
      });

      // Emit specific events based on status
      if (normalizedTracking === TRACKING_STATUS.DELIVERED) {
        // Notify user that order is delivered
        io.emit(`order_${orderId}_delivered`, {
          order_id: orderId,
          message: "Your order has been delivered",
          timestamp: new Date().toISOString()
        });
      } else if (normalizedTracking === TRACKING_STATUS.PICKED_UP) {
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

