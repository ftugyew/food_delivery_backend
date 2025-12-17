// server.js — Tindo Backend (Railway MySQL, cleaned)
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const bcrypt = require("bcryptjs");
dotenv.config();
const db = require("./db");
const app = express();
const server = http.createServer(app);
const adminRoutes = require("./routes/admin");



const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "https://food-delivery-d9rhmxj1q-sravans-projects-f917a030.vercel.app",
  "https://food-delivery-backend-cw3m.onrender.com"
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow non-browser requests (Postman, mobile apps)
      if (!origin) return callback(null, true);

      // ✅ Allow all Vercel deployments
      if (origin.endsWith(".vercel.app")) {
        return callback(null, true);
      }

      // ✅ Allow local development
      if (
        origin === "http://localhost:3000" ||
        origin === "http://127.0.0.1:5500" ||
        origin === "http://127.0.0.1:5501"
      ) {
        return callback(null, true);
      }

      console.error("❌ CORS blocked:", origin);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);


// ===== 2. STATIC FILES (BEFORE parsing - public access, no auth) =====
// Reuse the same uploads root as multer to avoid mismatched paths and to support persistent disks via UPLOADS_ROOT
const { uploadsRoot } = require("./config/multer");
app.use("/uploads", express.static(uploadsRoot));

// ===== 3. BODY PARSING (BEFORE logging/auth) =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== 4. PRODUCTION LOGGING (AFTER parsing, BEFORE auth) =====
const logger = require("./middleware/logger");
app.use(logger);

// ===== 5. Initialize socket.io =====
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ===== Banner upload (multer) =====
const bannersDir = path.join(__dirname, "uploads", "banners");
try { fs.mkdirSync(bannersDir, { recursive: true }); } catch (_) {}
const bannerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, bannersDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage: bannerStorage });

// ===== 6. AUTH MIDDLEWARE =====
const { router: authRoutes, authMiddleware } = require("./routes/auth");

// ===== 7. ROUTES =====
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

const orderRoutesFactory = require("./routes/orders");
const orderRoutes = orderRoutesFactory(io);
app.use("/api/orders", orderRoutes);

const restaurantsRoutes = require("./routes/restaurants");
app.use("/api/restaurants", restaurantsRoutes);

const menuRoutes = require("./routes/menu");
app.use("/api/menu", menuRoutes);









// ===== Mappls Token Cache =====
let mapplsToken = null;
let tokenExpiry = 0;

async function getMapplsToken() {
  const now = Date.now();
  if (mapplsToken && now < tokenExpiry) return mapplsToken;

  console.log("🔄 Fetching new Mappls token...");
  const clientId = process.env.MAPPLS_CLIENT_ID || "96dHZVzsAuv7B5EkcSSzEefSELCP1aRLsL_0MY9Cp3epWMeFg2WQv1kv7dgQuGBNLnxirw5J9eWNzohDvjSp7RJ9RyXHHRXh";
  const clientSecret = process.env.MAPPLS_CLIENT_SECRET || "lrFxI-iSEg_h44hWmIUgohsKpN7AoIk-B5WjMRuvO2c6Zc7iLEnY3IG80uUUUsmbu2u2D50WT8gDIdG23f3Ph6l0lIKgdzzDpk9cdz4HlPg=";

  const resp = await axios.post("https://outpost.mappls.com/api/security/oauth/token",
    new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  mapplsToken = resp.data.access_token;
  tokenExpiry = now + (resp.data.expires_in - 300) * 1000;
  return mapplsToken;
}





// Optional routes (if files missing → ignore)
try { app.use("/api/payments", require("./routes/payments")); } catch (_) {}
try { app.use("/api/tracking", require("./routes/tracking")); } catch (_) {}
try { app.use("/api/user-addresses", require("./routes/user-addresses")); } catch (_) {}
try { app.use("/api/delivery", require("./routes/delivery")); } catch (_) {}
if (typeof authMiddleware !== "function") {
  authMiddleware = (req, _res, next) => next();
}








// ===== Static Files =====
app.get("/favicon.ico", (req, res) => res.status(204).end());

// ===== Reviews Route (keeping for backward compatibility) =====
app.use("/api/reviews", require("./routes/reviews"));

// ===== Optional Routes (safe loading) =====
const optionalRoutes = [
  { path: "/api/payments", file: "./routes/payments" },
  { path: "/api/tracking", file: "./routes/tracking" },
  { path: "/api/user-addresses", file: "./routes/user-addresses" },
  { path: "/api/delivery", file: "./routes/delivery" }
];

optionalRoutes.forEach(r => {
  try {
    const route = require(r.file);
    if (typeof route === "function") {
      app.use(r.path, route(io)); // if factory
    } else if (route) {
      app.use(r.path, route); // if router
    }
  } catch (err) {
    console.warn(`⚠️ Skipping route ${r.path}:`, err.message);
  }
});

// ===== Mappls Token =====
app.get("/api/mappls/token", async (req, res) => {
  try {
    const clientId = "96dHZVzsAuv7B5EkcSSzEefSELCP1aRLsL_0MY9Cp3epWMeFg2WQv1kv7dgQuGBNLnxirw5J9eWNzohDvjSp7RJ9RyXHHRXh";
    const clientSecret = "lrFxI-iSEg_h44hWmIUgohsKpN7AoIk-B5WjMRuvO2c6Zc7iLEnY3IG80uUUUsmbu2u2D50WT8gDIdG23f3Ph6l0lIKgdzzDpk9cdz4HlPg=";
    const tokenResponse = await axios.post("https://outpost.mappls.com/api/security/oauth/token",
      new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    console.log("✅ Mappls token generated");
    res.json({ access_token: tokenResponse.data.access_token });
  } catch (err) {
    console.error("❌ Mappls token failed:", err.message);
    res.status(500).json({ error: "Failed to fetch Mappls token" });
  }
});






// ===== Reverse Geocode (Mappls) =====
app.get("/api/mappls/reverse-geocode", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });

    const token = await getMapplsToken();
    const REST_KEY = "522d3498e3667eac0fc7f509c00ac75a";
    const mapplsURL = `https://apis.mappls.com/advancedmaps/v1/${REST_KEY}/rev_geocode?lat=${lat}&lng=${lng}`;
    const { data } = await axios.get(mapplsURL, { headers: { Authorization: `Bearer ${token}` } });

    const r = data.results?.[0] || data.result || data.address || {};
    const address = {
      formatted: r.formattedAddress || r.formatted || null,
      street: [r.poi, r.locality, r.subLocality, r.road].filter(Boolean).join(", "),
      city: r.city || r.district || r.village || "",
      state: r.state || "",
      pincode: r.pincode || "",
      country: r.country || "India",
      latitude: lat,
      longitude: lng,
    };
    res.json({ success: true, source: "Mappls", address });
  } catch (err) {
    console.error("❌ Reverse geocode failed:", err.message);
    res.status(500).json({ error: "Failed to reverse geocode", details: err.message });
  }
});

// ===== Banners =====
app.get("/api/banners", async (req, res) => {
  try {
    const wantAll = String(req.query.all || "").toLowerCase() === "true";
    if (wantAll) {
      const [rows] = await db.execute("SELECT * FROM banners ORDER BY created_at DESC");
      return res.json(rows);
    }
    const [rows] = await db.execute("SELECT * FROM banners WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1");
    return res.json(rows[0] || null);
  } catch (err) {
    console.error("Error fetching banners:", err?.message);
    return res.status(500).json({ error: "Failed to fetch banners" });
  }
});

app.post("/api/admin/banners", upload.single("banner"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const [result] = await db.execute("INSERT INTO banners (image_url, is_active, created_at) VALUES (?, 1, NOW())", [file.filename]);
    return res.json({ id: result.insertId, image_url: file.filename });
  } catch (err) {
    console.error("Error uploading banner:", err?.message);
    return res.status(500).json({ error: "Failed to upload banner" });
  }
});

app.get("/api/admin/banners", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM banners ORDER BY created_at DESC");
    return res.json(rows);
  } catch (err) {
    console.error("Error listing banners:", err?.message);
    return res.status(500).json({ error: "Failed to list banners" });
  }
});

app.delete("/api/admin/banners/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM banners WHERE id = ?", [req.params.id]);
    return res.json({ message: "Banner removed" });
  } catch (err) {
    console.error("Error deleting banner:", err?.message);
    return res.status(500).json({ error: "Failed to delete banner" });
  }
});

// ===== Restaurants =====
app.get("/api/restaurants", async (req, res) => {
  try {
    const [results] = await db.execute("SELECT * FROM restaurants WHERE status='approved' ORDER BY id DESC");
    return res.json(results);
  } catch (err) {
    console.error("Error fetching restaurants:", err?.message);
    return res.status(500).json({ error: "DB error" });
  }
});

app.post("/api/restaurants", async (req, res) => {
  try {
    const { name, description, image_url, eta } = req.body;
    const [result] = await db.execute(
      "INSERT INTO restaurants (name, description, image_url, eta, status, created_at) VALUES (?, ?, ?, ?, 'pending', NOW())",
      [name, description, image_url, eta]
    );
    res.json({ message: "Restaurant submitted, pending admin approval", id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/restaurants", async (req, res) => {
  try {
    const [results] = await db.execute("SELECT * FROM restaurants ORDER BY id DESC");
    res.json(results);
  } catch (err) {
    console.error("Error fetching all restaurants:", err.message);
    res.status(500).json({ error: "Failed to fetch restaurants" });
  }
});

app.put("/api/restaurants/approve/:id", async (req, res) => {
  try {
    await db.execute("UPDATE restaurants SET status='approved' WHERE id=?", [req.params.id]);
    await db.execute("UPDATE users SET status='approved', restaurant_id = COALESCE(restaurant_id, ?) WHERE restaurant_id=? OR (restaurant_id IS NULL AND role='restaurant' AND status='pending')", [req.params.id, req.params.id]);
    res.json({ message: "Restaurant approved ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/restaurants/reject/:id", async (req, res) => {
  try {
    await db.execute("UPDATE restaurants SET status='rejected' WHERE id=?", [req.params.id]);
    await db.execute("UPDATE users SET status='rejected' WHERE restaurant_id=?", [req.params.id]);
    res.json({ message: "Restaurant rejected ❌" });
  } catch (err) {
    console.error("Error rejecting restaurant:", err.message);
    res.status(500).json({ error: "Database error while rejecting restaurant" });
  }
});

// ===== Featured Restaurants (no legacy tables) =====
const selectFeaturedSql = `SELECT id, name, cuisine, image_url, status, featured FROM restaurants WHERE status='approved' AND featured = 1 ORDER BY rating DESC, id DESC`;
app.get("/api/featured-restaurants", async (_req, res) => {
  try {
    const [rows] = await db.execute(selectFeaturedSql);
    return res.json(rows);
  } catch (err) {
    console.error("Error fetching featured restaurants:", err?.message);
    return res.status(500).json({ error: "Failed to fetch featured restaurants" });
  }
});

app.post("/api/featured-restaurants", async (req, res) => {
  try {
    const { restaurant_id } = req.body || {};
    if (!restaurant_id) return res.status(400).json({ error: "restaurant_id required" });
    await db.execute("UPDATE restaurants SET featured = 1 WHERE id = ?", [restaurant_id]);
    return res.json({ message: "Featured restaurant added" });
  } catch (err) {
    console.error("Error adding featured restaurant:", err);
    return res.status(500).json({ error: "Failed to add featured restaurant" });
  }
});

app.get("/api/admin/featured-restaurants", async (_req, res) => {
  try {
    const [rows] = await db.execute(selectFeaturedSql);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching featured restaurants (admin):", err?.message);
    return res.status(500).json({ success: false, error: "Failed to fetch featured restaurants" });
  }
});

app.post("/api/admin/featured-restaurants", async (req, res) => {
  try {
    const { restaurant_id } = req.body || {};
    if (!restaurant_id) return res.status(400).json({ success: false, error: "restaurant_id required" });
    await db.execute("UPDATE restaurants SET featured = 1 WHERE id = ?", [restaurant_id]);
    return res.json({ success: true, message: "Featured restaurant added" });
  } catch (err) {
    console.error("Error adding featured (admin):", err?.message);
    return res.status(500).json({ success: false, error: "Failed to add featured restaurant" });
  }
});

app.delete("/api/admin/featured-restaurants/:id", async (req, res) => {
  try {
    await db.execute("UPDATE restaurants SET featured = 0 WHERE id = ?", [req.params.id]);
    return res.json({ success: true, message: "Removed from featured" });
  } catch (err) {
    console.error("Error removing featured (admin):", err?.message);
    return res.status(500).json({ success: false, error: "Failed to remove" });
  }
});

app.put("/api/admin/featured-restaurants/:id/toggle", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT featured FROM restaurants WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: "Restaurant not found" });
    const next = rows[0].featured ? 0 : 1;
    await db.execute("UPDATE restaurants SET featured = ? WHERE id = ?", [next, req.params.id]);
    return res.json({ success: true, data: { is_active: next }, message: "Toggled" });
  } catch (err) {
    console.error("Error toggling featured (admin):", err?.message);
    return res.status(500).json({ success: false, error: "Failed to toggle featured" });
  }
});

// ===== Top Restaurants (order count from orders) =====
const topRestaurantsSql = `
  SELECT r.id as restaurant_id, r.name, r.cuisine, r.image_url, r.status, r.is_top,
         COALESCE(COUNT(o.id),0) as order_count
  FROM restaurants r
  LEFT JOIN orders o ON o.restaurant_id = r.id
  WHERE r.status = 'approved'
  GROUP BY r.id
  ORDER BY order_count DESC, r.id DESC
`;
app.get("/api/top-restaurants", async (_req, res) => {
  try {
    const [rows] = await db.execute(topRestaurantsSql);
    return res.json(rows);
  } catch (err) {
    console.error("Error fetching top restaurants:", err?.message);
    return res.status(500).json({ error: "Failed to fetch top restaurants" });
  }
});

app.get("/api/admin/top-restaurants", async (_req, res) => {
  try {
    const [rows] = await db.execute(topRestaurantsSql);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching top restaurants (admin):", err?.message);
    return res.status(500).json({ success: false, error: "Failed to fetch top restaurants" });
  }
});

app.post("/api/admin/top-restaurants", async (req, res) => {
  try {
    const { restaurant_id } = req.body || {};
    if (!restaurant_id) return res.status(400).json({ success: false, error: "restaurant_id required" });
    await db.execute("UPDATE restaurants SET is_top = 1 WHERE id = ?", [restaurant_id]);
    return res.json({ success: true, message: "Restaurant marked top" });
  } catch (err) {
    console.error("Error marking top restaurant:", err?.message);
    return res.status(500).json({ success: false, error: "Failed to add top restaurant" });
  }
});

app.delete("/api/admin/top-restaurants/:id", async (req, res) => {
  try {
    await db.execute("UPDATE restaurants SET is_top = 0 WHERE id = ?", [req.params.id]);
    return res.json({ success: true, message: "Removed from top" });
  } catch (err) {
    console.error("Error removing top (admin):", err?.message);
    return res.status(500).json({ success: false, error: "Failed to remove top restaurant" });
  }
});

app.put("/api/admin/top-restaurants/:id/toggle", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT is_top FROM restaurants WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: "Restaurant not found" });
    const next = rows[0].is_top ? 0 : 1;
    await db.execute("UPDATE restaurants SET is_top = ? WHERE id = ?", [next, req.params.id]);
    return res.json({ success: true, data: { is_top: next }, message: "Toggled" });
  } catch (err) {
    console.error("Error toggling top (admin):", err?.message);
    return res.status(500).json({ success: false, error: "Failed to toggle top" });
  }
});

// ===== Menu =====
app.get("/api/admin/menu", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT m.*, r.name AS restaurant_name FROM menu m LEFT JOIN restaurants r ON m.restaurant_id = r.id ORDER BY m.id DESC"
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching admin menu:", err?.message);
    return res.status(500).json({ success: false, error: "Failed to fetch admin menu" });
  }
});
app.get("/api/restaurant/:id/menu", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM menu WHERE restaurant_id = ?", [req.params.id]);
    return res.json(rows);
  } catch (err) {
    console.error("Error fetching menus:", err?.message);
    
    return res.status(500).json({ message: "Error fetching menu items" });
  }
});


// ===== Search =====
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ results: [], total: 0 });
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const like = `%${q.toLowerCase()}%`;
    const sql = `
      SELECT m.id as menu_id, m.item_name, m.description, m.price, m.image_url as item_image,
             r.id as restaurant_id, r.name as restaurant_name, r.address as restaurant_address,
             COALESCE(r.latitude, r.lat) as latitude, COALESCE(r.longitude, r.lng) as longitude,
             r.image_url as restaurant_image, r.eta as restaurant_eta
      FROM menu m
      JOIN restaurants r ON m.restaurant_id = r.id
      WHERE LOWER(m.item_name) LIKE ? OR LOWER(m.category) LIKE ? OR LOWER(r.name) LIKE ?
      ORDER BY m.item_name ASC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.execute(sql, [like, like, like, limit, offset]);
    const countSql = `
      SELECT COUNT(*) as total FROM menu m JOIN restaurants r ON m.restaurant_id = r.id
      WHERE LOWER(m.item_name) LIKE ? OR LOWER(m.category) LIKE ? OR LOWER(r.name) LIKE ?
    `;
    const [countRows] = await db.execute(countSql, [like, like, like]);
    const total = (countRows && countRows[0] && countRows[0].total) || 0;
    res.json({ results: rows, total });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ===== Orders =====
app.get("/api/orders", authMiddleware, async (req, res) => {
  const { role, id, restaurant_id } = req.user || {};
  try {
    let query = "";
    let params = [];
    if (role === "delivery_agent") {
      query = "SELECT * FROM orders WHERE agent_id = ? ORDER BY created_at DESC";
      params = [id];
    } else if (role === "admin") {
      query = "SELECT * FROM orders ORDER BY created_at DESC";
    } else if (role === "restaurant") {
      query = "SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC";
      params = [restaurant_id];
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const [orders] = await db.execute(query, params);
    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

app.get("/api/admin/orders", async (req, res) => {
  try {
    const [orders] = await db.execute("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(orders);
  } catch (err) {
    console.error("Error fetching all orders:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// ===== Admin helpers (agents + map) =====
app.get("/api/admin/agents", async (_req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM agents ORDER BY id DESC");
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching agents:", err?.message);
    return res.status(500).json({ success: false, error: "Failed to fetch agents" });
  }
});

app.get("/api/admin/all-restaurants", async (_req, res) => {
  try {
    const [rows] = await db.execute("SELECT id, name, address, latitude as lat, longitude as lng, image_url FROM restaurants WHERE status='approved' ORDER BY id DESC");
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching all restaurants (map):", err?.message);
    return res.status(500).json({ success: false, error: "Failed to fetch restaurants" });
  }
});

app.get("/api/orders/all", async (req, res) => {
  try {
    const [orders] = await db.execute("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(orders);
  } catch (err) {
    console.error("Error fetching all orders (alias):", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

app.get("/api/orders/restaurant/:restaurantId", async (req, res) => {
  try {
    const [orders] = await db.execute("SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC", [req.params.restaurantId]);
    res.json(orders);
  } catch (error) {
    console.error("Error fetching restaurant orders:", error);
    res.status(500).json({ error: "Failed to fetch restaurant orders" });
  }
});

// ===== Delivery Agent Assignment =====
app.put('/api/orders/:orderId/assign', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { rlat, rlng, agents, loadMap, ASSIGN_MAX_KM = 10 } = req.body;
    if (!orderId || !Array.isArray(agents) || !rlat || !rlng) {
      return res.status(400).json({ error: 'Missing data for assignment' });
    }
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371;
    const dist = (aLat, aLng, bLat, bLng) => {
      const dLat = toRad(bLat - aLat);
      const dLng = toRad(bLng - aLng);
      const sa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
      return R * c;
    };
    let candidates = agents.map((a) => ({ id: a.id, d: dist(rlat, rlng, Number(a.lat), Number(a.lng)), load: loadMap?.[a.id] ?? 0 }));
    candidates = candidates.filter((c) => c.d <= ASSIGN_MAX_KM);
    if (!candidates.length) return res.status(400).json({ error: `No active agents within ${ASSIGN_MAX_KM} km` });
    candidates.sort((a, b) => a.load - b.load || a.d - b.d);
    const best = candidates[0];
    await db.execute('UPDATE orders SET agent_id = ?, status = "Confirmed" WHERE id = ?', [best.id, orderId]);
    res.json({ message: 'Agent assigned (nearest)', agent_id: best.id, distance_km: Number(best.d.toFixed(2)) });
  } catch (err) {
    console.error('Assign agent failed:', err);
    res.status(500).json({ error: 'Failed to assign agent', details: err.message });
  }
});

app.get("/api/admin/delivery", async (req, res) => {
  try {
    const showAll = String(req.query.all || '').toLowerCase() === 'true';
    const where = showAll ? '' : "WHERE a.status = 'Active'";
    const [rows] = await db.execute(`SELECT a.id, a.name, a.phone, a.status, a.latitude, a.longitude, u.email FROM agents a LEFT JOIN users u ON u.id = a.user_id ${where}`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch delivery agents' });
  }
});

// ===== Users & Auth =====
app.post("/api/users", async (req, res) => {
  try {
    const { name, email, password, role, restaurant_id } = req.body || {};
    const hashedPassword = await bcrypt.hash(password, 10);
    const status = role === "restaurant" ? "pending" : "active";
    const [result] = await db.execute(
      "INSERT INTO users (name, email, password, role, status, restaurant_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
      [name, email, hashedPassword, role, status, restaurant_id || null]
    );
    if (role === "restaurant") {
      await db.execute("INSERT INTO restaurants (name, status, created_at) VALUES (?, 'pending', NOW())", [name]);
    }
    return res.json({ message: "User registered", id: result.insertId });
  } catch (err) {
    console.error("Error registering user:", err?.message);
    return res.status(500).json({ error: "Failed to register user" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const [users] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
    if (!users.length) return res.status(401).json({ error: "Invalid email or password" });
    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: "Invalid email or password" });
    const { password: _pw, ...userInfo } = user;
    return res.json(userInfo);
  } catch (err) {
    console.error("Error logging in:", err?.message);
    return res.status(500).json({ error: "Failed to log in" });
  }
});

if (authMiddleware) {
  app.get("/api/users/profile", authMiddleware, async (req, res) => {
    try {
      const [users] = await db.execute("SELECT id, name, email, role, status FROM users WHERE id = ?", [req.user?.id || 0]);
      if (!users.length) return res.status(404).json({ error: "User not found" });
      return res.json(users[0]);
    } catch (err) {
      console.error("Error fetching user profile:", err?.message);
      return res.status(500).json({ error: "Failed to fetch user profile" });
    }
  });

  app.put("/api/users/profile", authMiddleware, async (req, res) => {
    try {
      const { name, email, password } = req.body || {};
      let hashedPassword = null;
      if (password) hashedPassword = await bcrypt.hash(password, 10);
      await db.execute("UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?", [name, email, hashedPassword, req.user?.id || 0]);
      return res.json({ message: "Profile updated" });
    } catch (err) {
      console.error("Error updating profile:", err?.message);
      return res.status(500).json({ error: "Failed to update profile" });
    }
  });
}

// ========= SOCKET.IO EVENT HANDLERS =========
const deliveryAgents = {};
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);
  socket.on("agentLocation", (data) => {
    try {
      const { agentId, lat, lng } = data || {};
      if (!agentId || typeof lat !== "number" || typeof lng !== "number") return;
      deliveryAgents[agentId] = { lat, lng };
      io.emit("locationUpdate", { agentId, lat, lng });
    } catch (e) {
      console.error("agentLocation handler error:", e.message);
    }
  });
  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);
  });
});

// ===== Server Startup =====
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = { app, server, io };
