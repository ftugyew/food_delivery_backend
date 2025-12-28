const express = require("express");
const db = require("../db");
const multer = require("multer");
const path = require("path");
const { bannerUpload } = require("../config/multer");
const { ORDER_STATUS, TRACKING_STATUS } = require("../constants/statuses");
const router = express.Router();

// ================= USERS =================
router.get("/users", async (req, res) => {
  try {
    const [users] = await db.execute("SELECT id, name, email, role FROM users");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Users count
router.get("/users/count", async (req, res) => {
  const [rows] = await db.execute("SELECT COUNT(*) AS count FROM users");
  res.json(rows[0]);
});

// ================= RESTAURANTS =================
router.get("/restaurants", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch restaurants" });
  }
});

// Restaurants count
router.get("/restaurants/count", async (req, res) => {
  const [rows] = await db.execute("SELECT COUNT(*) AS count FROM restaurants");
  res.json(rows[0]);
});

// Pending restaurants for approval
router.get("/restaurants/pending", async (req, res) => {
  const [rows] = await db.execute("SELECT * FROM restaurants WHERE status='pending'");
  res.json(rows);
});

// Approve restaurant + linked user account
router.put("/restaurants/approve/:id", async (req, res) => {
  const id = req.params.id;
  try {
    await db.execute("UPDATE restaurants SET status='approved' WHERE id=?", [id]);
    await db.execute("UPDATE users SET status='approved' WHERE restaurant_id=?", [id]);

    res.json({ success: true, message: "Restaurant approved" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject restaurant
router.put("/restaurants/reject/:id", async (req, res) => {
  const id = req.params.id;
  try {
    await db.execute("UPDATE restaurants SET status='rejected' WHERE id=?", [id]);
    await db.execute("UPDATE users SET status='rejected' WHERE restaurant_id=?", [id]);

    res.json({ success: true, message: "Restaurant rejected" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle Top Restaurant feature
router.put("/restaurants/:id/toggle-top", async (req, res) => {
  const restId = req.params.id;
  const [rows] = await db.execute("SELECT is_top FROM restaurants WHERE id=?", [restId]);
  const newStatus = !rows[0].is_top;
  await db.execute("UPDATE restaurants SET is_top=? WHERE id=?", [newStatus, restId]);
  res.json({ message: "Updated top status", is_top: newStatus });
});

// ================= ORDERS =================
router.get("/orders/count", async (req, res) => {
  const [rows] = await db.execute("SELECT COUNT(*) AS count FROM orders");
  res.json(rows[0]);
});

router.get("/orders", async (req, res) => {
  const [rows] = await db.execute("SELECT * FROM orders WHERE status!='delivered'");
  res.json(rows);
});

// ================= AUTO-ASSIGN AGENT TO ORDER =================
/**
 * POST /api/admin/orders/:orderId/assign
 * Auto-assigns the nearest available agent to an order
 * Uses transaction with row locking for atomicity
 * Returns assigned agent details or error
 */
router.post("/orders/:orderId/assign", async (req, res) => {
  const orderId = req.params.orderId;
  const connection = await db.getConnection();
  
  try {
    // Start transaction
    await connection.beginTransaction();
    
    console.log(`📍 Attempting to assign agent for order ${orderId}`);
    
    // 1. Validate order exists and status is waiting_for_agent
    const [orderRows] = await connection.execute(
      "SELECT id, restaurant_id, delivery_lat, delivery_lng, status, agent_id FROM orders WHERE id = ?",
      [orderId]
    );
    
    if (!orderRows || orderRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: "Order not found",
        orderId
      });
    }
    
    const order = orderRows[0];
    
    // Check if order is already assigned
    if (order.agent_id) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Order is already assigned to an agent",
        orderId,
        assignedAgentId: order.agent_id
      });
    }
    
    // Check if order is in correct status
    if (order.status !== ORDER_STATUS.WAITING_AGENT) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Order status is '${order.status}', must be '${ORDER_STATUS.WAITING_AGENT}'`,
        orderId,
        currentStatus: order.status
      });
    }
    
    // 2. Get restaurant coordinates
    const [restRows] = await connection.execute(
      "SELECT id, COALESCE(lat, latitude) as lat, COALESCE(lng, longitude) as lng FROM restaurants WHERE id = ?",
      [order.restaurant_id]
    );
    
    if (!restRows || restRows.length === 0) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error: "Restaurant not found for order",
        orderId,
        restaurantId: order.restaurant_id
      });
    }
    
    const restaurant = restRows[0];
    const deliveryLat = Number(order.delivery_lat);
    const deliveryLng = Number(order.delivery_lng);
    const restLat = Number(restaurant.lat);
    const restLng = Number(restaurant.lng);
    
    // Validate coordinates
    if (!isFinite(deliveryLat) || !isFinite(deliveryLng)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Invalid delivery coordinates",
        orderId,
        coordinates: { lat: deliveryLat, lng: deliveryLng }
      });
    }
    
    // 3. Find nearest available agent using Haversine formula
    const haversineSQL = `
      SELECT 
        a.id,
        a.name,
        a.phone,
        a.lat,
        a.lng,
        a.vehicle_type,
        a.status,
        a.is_online,
        a.is_busy,
        (
          6371 * acos(
            cos(radians(?)) * cos(radians(a.lat)) * cos(radians(a.lng) - radians(?)) +
            sin(radians(?)) * sin(radians(a.lat))
          )
        ) as distance_km
      FROM agents a
      WHERE 
        a.is_online = 1
        AND a.is_busy = 0
        AND a.status = 'Active'
        AND a.lat IS NOT NULL
        AND a.lng IS NOT NULL
      ORDER BY distance_km ASC
      LIMIT 1
    `;
    
    const [agentRows] = await connection.execute(haversineSQL, [
      deliveryLat,  // latitude of delivery location
      deliveryLng,  // longitude of delivery location
      deliveryLat   // latitude again for sin calculation
    ]);
    
    if (!agentRows || agentRows.length === 0) {
      await connection.rollback();
      console.warn(`⚠️ No available agents found for order ${orderId}`);
      return res.status(503).json({
        success: false,
        error: "No available agents at the moment",
        orderId,
        message: "All delivery agents are either offline or busy. Please try again shortly."
      });
    }
    
    const agent = agentRows[0];
    const distanceKm = parseFloat(agent.distance_km).toFixed(2);
    
    console.log(`✅ Found nearest agent: ${agent.id} (${agent.name}) at ${distanceKm}km away`);
    
    // 4. Lock agent row and update is_busy (atomic operation)
    const [lockRows] = await connection.execute(
      "SELECT id FROM agents WHERE id = ? FOR UPDATE",
      [agent.id]
    );
    
    if (!lockRows || lockRows.length === 0) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to lock agent row",
        orderId,
        agentId: agent.id
      });
    }
    
    // 5. Update agent: set is_busy = 1
    await connection.execute(
      "UPDATE agents SET is_busy = 1 WHERE id = ?",
      [agent.id]
    );
    
    console.log(`🔒 Agent ${agent.id} marked as busy`);
    
    // 6. Update order: assign agent, change status to agent_assigned
    await connection.execute(
      `UPDATE orders SET agent_id = ?, status = '${ORDER_STATUS.AGENT_ASSIGNED}', tracking_status = '${TRACKING_STATUS.ACCEPTED}' WHERE id = ?`,
      [agent.id, orderId]
    );
    
    console.log(`📦 Order ${orderId} assigned to agent ${agent.id}`);
    
    // Commit transaction
    await connection.commit();
    
    // Return success response
    return res.status(200).json({
      success: true,
      message: "Agent assigned successfully",
      orderId,
      agentId: agent.id,
      agent: {
        id: agent.id,
        name: agent.name,
        phone: agent.phone,
        vehicleType: agent.vehicle_type,
        distanceKm: distanceKm,
        currentLocation: {
          lat: agent.lat,
          lng: agent.lng
        }
      }
    });
    
  } catch (err) {
    // Rollback on any error
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      console.error("Rollback error:", rollbackErr?.message);
    }
    
    console.error("Assignment error:", err?.message || err);
    return res.status(500).json({
      success: false,
      error: "Failed to assign agent",
      orderId,
      details: err?.message || "Unknown error"
    });
  } finally {
    // Release connection back to pool
    if (connection) {
      connection.release();
    }
  }
});

// ================= DELIVERY AGENTS =================
router.get("/delivery", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM agents");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

// Alias for /delivery → /agents (as per requirement)
router.get("/agents", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM agents");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch agents" });
  }
});

// Pending agents awaiting activation
router.get("/agents/pending", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM agents WHERE status != 'Active'");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch pending agents" });
  }
});

// Approve/activate delivery agent
router.put("/agents/approve/:id", async (req, res) => {
  const agentId = req.params.id;
  try {
    await db.execute("UPDATE agents SET status = 'Active' WHERE id = ?", [agentId]);
    res.json({ success: true, message: "Delivery agent activated" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to activate agent" });
  }
});

// Deactivate delivery agent
router.put("/agents/deactivate/:id", async (req, res) => {
  const agentId = req.params.id;
  try {
    await db.execute("UPDATE agents SET status = 'Inactive' WHERE id = ?", [agentId]);
    res.json({ success: true, message: "Delivery agent deactivated" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to deactivate agent" });
  }
});

// ================= TOP RESTAURANTS =================
router.get("/top-restaurants", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM restaurants WHERE is_top = 1 ORDER BY name");
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Top restaurants error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch top restaurants", details: err.message });
  }
});

// Add restaurant to top list (POST)
router.post("/top-restaurants", async (req, res) => {
  try {
    const { restaurant_id } = req.body;
    if (!restaurant_id) {
      return res.status(400).json({ success: false, error: "restaurant_id is required" });
    }
    
    // Set is_top = 1 for this restaurant
    await db.execute("UPDATE restaurants SET is_top = 1 WHERE id = ?", [restaurant_id]);
    res.json({ success: true, message: "Restaurant added to top list" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to add top restaurant" });
  }
});

// Remove restaurant from top list (DELETE)
router.delete("/top-restaurants/:id", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    await db.execute("UPDATE restaurants SET is_top = 0 WHERE id = ?", [restaurantId]);
    res.json({ success: true, message: "Restaurant removed from top list" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to remove top restaurant" });
  }
});

// Toggle top restaurant status (PUT)
router.put("/top-restaurants/:id/toggle", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const [rows] = await db.execute("SELECT is_top FROM restaurants WHERE id = ?", [restaurantId]);
    
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Restaurant not found" });
    }
    
    const newStatus = rows[0].is_top ? 0 : 1;
    await db.execute("UPDATE restaurants SET is_top = ? WHERE id = ?", [newStatus, restaurantId]);
    
    res.json({ success: true, data: { is_top: newStatus }, message: "Top status toggled" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to toggle top status" });
  }
});

// ================= FEATURED RESTAURANTS =================
router.get("/featured-restaurants", async (req, res) => {
  try {
    // Check if featured column exists, if not use the featured_restaurants table
    const [rows] = await db.execute(
      "SELECT * FROM restaurants WHERE rating >= 4.5 ORDER BY rating DESC LIMIT 10"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Featured restaurants error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch featured restaurants", details: err.message });
  }
});

// Add restaurant to featured list (POST)
router.post("/featured-restaurants", async (req, res) => {
  try {
    const { restaurant_id } = req.body;
    if (!restaurant_id) {
      return res.status(400).json({ success: false, error: "restaurant_id is required" });
    }
    
    // Use rating as featured indicator (set to 5.0 for featured)
    await db.execute("UPDATE restaurants SET rating = 5.0 WHERE id = ?", [restaurant_id]);
    res.json({ success: true, message: "Restaurant added to featured list" });
  } catch (err) {
    console.error("Add featured restaurant error:", err);
    res.status(500).json({ success: false, error: "Failed to add featured restaurant", details: err.message });
  }
});

// Remove restaurant from featured list (DELETE)
router.delete("/featured-restaurants/:id", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    await db.execute("UPDATE restaurants SET rating = 4.0 WHERE id = ?", [restaurantId]);
    res.json({ success: true, message: "Restaurant removed from featured list" });
  } catch (err) {
    console.error("Remove featured restaurant error:", err);
    res.status(500).json({ success: false, error: "Failed to remove featured restaurant", details: err.message });
  }
});

// Toggle featured restaurant status (PUT)
router.put("/featured-restaurants/:id/toggle", async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const [rows] = await db.execute("SELECT rating FROM restaurants WHERE id = ?", [restaurantId]);
    
    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Restaurant not found" });
    }
    
    const newRating = (rows[0].rating >= 4.8) ? 4.0 : 5.0;
    await db.execute("UPDATE restaurants SET rating = ? WHERE id = ?", [newRating, restaurantId]);
    
    res.json({ success: true, data: { is_active: newRating >= 4.8 }, message: "Featured status toggled" });
  } catch (err) {
    console.error("Toggle featured status error:", err);
    res.status(500).json({ success: false, error: "Failed to toggle featured status", details: err.message });
  }
});

// ================= BANNERS =================
router.get("/banners", async (req, res) => {
  try {
    // Check if banners table exists, if not create it
    await db.execute(`
      CREATE TABLE IF NOT EXISTS banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        image_url VARCHAR(500) NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    const [rows] = await db.execute("SELECT * FROM banners WHERE is_active = 1 ORDER BY created_at DESC");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch banners" });
  }
});

// Upload new banner (POST with file upload)
router.post("/banners", bannerUpload.single("banner"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    
    // Ensure banners table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        image_url VARCHAR(500) NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Store filename with banners folder prefix so it can be fetched from /uploads/banners/
    const imageUrl = `banners/${req.file.filename}`;
    await db.execute("INSERT INTO banners (image_url, is_active) VALUES (?, 1)", [imageUrl]);
    
    res.json({ success: true, message: "Banner uploaded successfully", image_url: imageUrl });
  } catch (err) {
    console.error("Banner upload error:", err);
    res.status(500).json({ success: false, error: "Failed to upload banner" });
  }
});

// Delete banner by ID
router.delete("/banners/:id", async (req, res) => {
  try {
    const bannerId = req.params.id;
    await db.execute("DELETE FROM banners WHERE id = ?", [bannerId]);
    res.json({ success: true, message: "Banner deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to delete banner" });
  }
});

// ================= MENU =================
router.get("/menu", async (req, res) => {
  try {
    // Check if menu table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS menu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        category VARCHAR(100),
        image_url VARCHAR(500),
        is_available BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      )
    `);
    
    const [rows] = await db.execute(`
      SELECT m.*, r.name as restaurant_name 
      FROM menu m 
      LEFT JOIN restaurants r ON m.restaurant_id = r.id 
      ORDER BY m.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch menu items" });
  }
});

module.exports = router;
