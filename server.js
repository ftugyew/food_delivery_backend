// server.js — Tindo Backend (Railway MySQL, cleaned)
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const bcrypt = require("bcryptjs");

dotenv.config();
const db = require("./db");
const app = express();
const server = http.createServer(app);


const allowedOrigins = [
  "https://food-ameerpet.vercel.app",
  "http://localhost:3000"
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.log("❌ CORS blocked:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"]
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions)); // Works now ✔

// 🔹 Auth Routes First
const { router: authRoutes, authMiddleware } = require("./routes/auth");
app.use("/api/auth", authRoutes);

// 🔹 Orders Routes AFTER io is defined
const orderRoutesFactory = require("./routes/orders");
const orderRoutes = orderRoutesFactory(io);
app.use("/api/orders", orderRoutes);


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


const io = new Server(server, { cors: { origin: "*" } });





// ===== Middleware =====
app.use(bodyParser.json());
app.use(express.json());
app.use("/api/restaurants", require("./routes/reviews"));

// ===== Multer (uploads) =====
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ===== Static =====
app.get("/favicon.ico", (req, res) => res.status(204).end());

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
    await db.execute("UPDATE users SET status='approved' WHERE restaurant_id=?", [req.params.id]);
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

// ===== Featured Restaurants =====
app.get("/api/featured-restaurants", async (req, res) => {
  try {
    const [results] = await db.execute(`
      SELECT fr.*, r.name, r.cuisine, r.image_url, r.status AS restaurant_status
      FROM featured_restaurants fr
      JOIN restaurants r ON fr.restaurant_id = r.id
      ORDER BY fr.position ASC
    `);
    return res.json(results);
  } catch (err) {
    console.error("Error fetching featured restaurants:", err?.message);
    return res.status(500).json({ error: "Failed to fetch featured restaurants" });
  }
});

app.post("/api/featured-restaurants", async (req, res) => {
  try {
    const { restaurant_id, position } = req.body;
    const [restaurant] = await db.execute("SELECT id FROM restaurants WHERE id = ?", [restaurant_id]);
    if (!restaurant.length) return res.status(404).json({ error: "Restaurant not found" });
    const [existing] = await db.execute("SELECT id FROM featured_restaurants WHERE restaurant_id = ?", [restaurant_id]);
    if (existing.length) return res.status(400).json({ error: "Restaurant already featured" });
    await db.execute("INSERT INTO featured_restaurants (restaurant_id, position, is_active) VALUES (?, ?, 1)", [restaurant_id, position]);
    res.json({ message: "Featured restaurant added" });
  } catch (err) {
    console.error("Error adding featured restaurant:", err);
    res.status(500).json({ error: "Failed to add featured restaurant" });
  }
});

app.get("/api/admin/featured-restaurants", async (req, res) => {
  try {
    const [results] = await db.execute(`
      SELECT fr.*, r.name, r.cuisine, r.image_url, r.status AS restaurant_status
      FROM featured_restaurants fr
      JOIN restaurants r ON fr.restaurant_id = r.id
      ORDER BY fr.position ASC
    `);
    res.json(results);
  } catch (err) {
    console.error("Error fetching featured restaurants (admin):", err);
    res.status(500).json({ error: "Failed to fetch featured restaurants" });
  }
});

app.post("/api/admin/featured-restaurants", async (req, res) => {
  try {
    const { restaurant_id, position } = req.body;
    const [restaurant] = await db.execute("SELECT id FROM restaurants WHERE id = ?", [restaurant_id]);
    if (!restaurant.length) return res.status(404).json({ error: "Restaurant not found" });
    const [existing] = await db.execute("SELECT id FROM featured_restaurants WHERE restaurant_id = ?", [restaurant_id]);
    if (existing.length) return res.status(400).json({ error: "Already featured" });
    await db.execute("INSERT INTO featured_restaurants (restaurant_id, position, is_active) VALUES (?, ?, 1)", [restaurant_id, position]);
    res.json({ message: "Featured restaurant added" });
  } catch (err) {
    console.error("Error adding featured restaurant (admin):", err);
    res.status(500).json({ error: "Failed to add featured restaurant" });
  }
});

app.put("/api/featured-restaurants/:id/toggle", async (req, res) => {
  try {
    const [current] = await db.execute("SELECT is_active FROM featured_restaurants WHERE id = ?", [req.params.id]);
    if (!current.length) return res.status(404).json({ error: "Featured restaurant not found" });
    const newStatus = !current[0].is_active;
    await db.execute("UPDATE featured_restaurants SET is_active = ? WHERE id = ?", [newStatus, req.params.id]);
    res.json({ message: `Featured ${newStatus ? 'activated' : 'deactivated'}`, is_active: newStatus });
  } catch (err) {
    console.error("Error toggling featured restaurant:", err);
    res.status(500).json({ error: "Failed to toggle" });
  }
});

app.put("/api/admin/featured-restaurants/:id/toggle", async (req, res) => {
  try {
    const [current] = await db.execute("SELECT is_active FROM featured_restaurants WHERE id = ?", [req.params.id]);
    if (!current.length) return res.status(404).json({ error: "Not found" });
    const newStatus = !current[0].is_active;
    await db.execute("UPDATE featured_restaurants SET is_active = ? WHERE id = ?", [newStatus, req.params.id]);
    res.json({ message: `Featured ${newStatus ? 'activated' : 'deactivated'}`, is_active: newStatus });
  } catch (err) {
    console.error("Error toggling featured (admin):", err);
    res.status(500).json({ error: "Failed to toggle" });
  }
});

app.delete("/api/featured-restaurants/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM featured_restaurants WHERE id = ?", [req.params.id]);
    res.json({ message: "Removed from featured restaurants" });
  } catch (err) {
    console.error("Error removing featured restaurant:", err);
    res.status(500).json({ error: "Failed to remove" });
  }
});

app.delete("/api/admin/featured-restaurants/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM featured_restaurants WHERE id = ?", [req.params.id]);
    res.json({ message: "Removed" });
  } catch (err) {
    console.error("Error removing featured (admin):", err);
    res.status(500).json({ error: "Failed to remove" });
  }
});

app.delete("/api/featured-restaurants", async (req, res) => {
  try {
    await db.execute("DELETE FROM featured_restaurants");
    res.json({ message: "All featured restaurants removed" });
  } catch (err) {
    console.error("Error clearing featured:", err);
    res.status(500).json({ error: "Failed to clear" });
  }
});

// ===== Top Restaurants =====
app.get("/api/top-restaurants", async (req, res) => {
  try {
    const [results] = await db.execute(`
      SELECT tr.*, r.name, r.cuisine, r.image_url, r.status AS restaurant_status
      FROM top_restaurants tr
      JOIN restaurants r ON tr.restaurant_id = r.id
      ORDER BY tr.position ASC
    `);
    return res.json(results);
  } catch (err) {
    console.error("Error fetching top restaurants:", err?.message);
    return res.status(500).json({ error: "Failed to fetch top restaurants" });
  }
});

app.post("/api/top-restaurants", async (req, res) => {
  try {
    const { restaurant_id, position } = req.body;
    const [restaurant] = await db.execute("SELECT id FROM restaurants WHERE id = ?", [restaurant_id]);
    if (!restaurant.length) return res.status(404).json({ error: "Restaurant not found" });
    const [existing] = await db.execute("SELECT id FROM top_restaurants WHERE restaurant_id = ?", [restaurant_id]);
    if (existing.length) return res.status(400).json({ error: "Already in top list" });
    await db.execute("INSERT INTO top_restaurants (restaurant_id, position, is_active) VALUES (?, ?, 1)", [restaurant_id, position]);
    res.json({ message: "Top restaurant added" });
  } catch (err) {
    console.error("Error adding top restaurant:", err);
    res.status(500).json({ error: "Failed to add top restaurant" });
  }
});

app.get("/api/admin/top-restaurants", async (req, res) => {
  try {
    const [results] = await db.execute(`
      SELECT tr.*, r.name, r.cuisine, r.image_url, r.status AS restaurant_status
      FROM top_restaurants tr
      JOIN restaurants r ON tr.restaurant_id = r.id
      ORDER BY tr.position ASC
    `);
    res.json(results);
  } catch (err) {
    console.error("Error fetching top restaurants (admin):", err);
    res.status(500).json({ error: "Failed to fetch top restaurants" });
  }
});

app.post("/api/admin/top-restaurants", async (req, res) => {
  try {
    const { restaurant_id, position } = req.body;
    const [restaurant] = await db.execute("SELECT id FROM restaurants WHERE id = ?", [restaurant_id]);
    if (!restaurant.length) return res.status(404).json({ error: "Restaurant not found" });
    const [existing] = await db.execute("SELECT id FROM top_restaurants WHERE restaurant_id = ?", [restaurant_id]);
    if (existing.length) return res.status(400).json({ error: "Already in top list" });
    await db.execute("INSERT INTO top_restaurants (restaurant_id, position, is_active) VALUES (?, ?, 1)", [restaurant_id, position]);
    res.json({ message: "Top restaurant added" });
  } catch (err) {
    console.error("Error adding top restaurant (admin):", err);
    res.status(500).json({ error: "Failed to add top restaurant" });
  }
});

app.put("/api/top-restaurants/:id/toggle", async (req, res) => {
  try {
    const [current] = await db.execute("SELECT is_active FROM top_restaurants WHERE id = ?", [req.params.id]);
    if (!current.length) return res.status(404).json({ error: "Top restaurant not found" });
    const newStatus = !current[0].is_active;
    await db.execute("UPDATE top_restaurants SET is_active = ? WHERE id = ?", [newStatus, req.params.id]);
    res.json({ message: `Top ${newStatus ? 'activated' : 'deactivated'}`, is_active: newStatus });
  } catch (err) {
    console.error("Error toggling top restaurant:", err);
    res.status(500).json({ error: "Failed to toggle" });
  }
});

app.put("/api/admin/top-restaurants/:id/toggle", async (req, res) => {
  try {
    const [current] = await db.execute("SELECT is_active FROM top_restaurants WHERE id = ?", [req.params.id]);
    if (!current.length) return res.status(404).json({ error: "Not found" });
    const newStatus = !current[0].is_active;
    await db.execute("UPDATE top_restaurants SET is_active = ? WHERE id = ?", [newStatus, req.params.id]);
    res.json({ message: `Top ${newStatus ? 'activated' : 'deactivated'}`, is_active: newStatus });
  } catch (err) {
    console.error("Error toggling top (admin):", err);
    res.status(500).json({ error: "Failed to toggle" });
  }
});

app.delete("/api/top-restaurants/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM top_restaurants WHERE id = ?", [req.params.id]);
    res.json({ message: "Removed from top restaurants" });
  } catch (err) {
    console.error("Error removing top restaurant:", err);
    res.status(500).json({ error: "Failed to remove" });
  }
});

app.delete("/api/admin/top-restaurants/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM top_restaurants WHERE id = ?", [req.params.id]);
    res.json({ message: "Removed" });
  } catch (err) {
    console.error("Error removing top (admin):", err);
    res.status(500).json({ error: "Failed to remove" });
  }
});

// ===== Menu =====
app.get("/api/admin/menu", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT m.*, r.name AS restaurant_name FROM menu m JOIN restaurants r ON m.restaurant_id = r.id ORDER BY m.created_at DESC");
    return res.json(rows);
  } catch (err) {
    console.error("Error fetching admin menu:", err?.message);
    return res.status(500).json({ error: "Failed to fetch admin menu" });
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

app.get("/api/menu/by-restaurant/:id", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM menu WHERE restaurant_id = ? ORDER BY created_at DESC", [req.params.id]);
    return res.json(rows);
  } catch (err) {
    console.error("Error fetching menu by restaurant:", err?.message);
    return res.status(500).json({ message: "Error fetching menu items" });
  }
});

app.post("/api/menu", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const user = req.user || {};
    if (user.role && user.role !== "restaurant") return res.status(403).json({ error: "Only restaurants can add menu items" });
    const restaurantId = user.restaurant_id || 1;
    const { item_name, price, description, category } = req.body;
    const imageUrl = req.file ? req.file.filename : null;
    if (!item_name || !price) return res.status(400).json({ error: "Missing item_name or price" });
    const [result] = await db.execute(
      "INSERT INTO menu (restaurant_id, item_name, description, price, category, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
      [restaurantId, item_name, description || "", Number(price) || 0, category || null, imageUrl]
    );
    return res.json({ message: "Dish added", id: result.insertId });
  } catch (err) {
    console.error("Error adding menu item:", err?.message);
    return res.status(500).json({ error: "Failed to add menu item", details: err.message });
  }
});

app.post("/api/menu/test-add", upload.single("image"), async (req, res) => {
  try {
    const { item_name, price, description, category } = req.body || {};
    const imageUrl = req.file ? req.file.filename : null;
    if (!item_name || !price) return res.status(400).json({ error: "Missing item_name or price" });
    const restaurantId = 1;
    const [result] = await db.execute(
      "INSERT INTO menu (restaurant_id, item_name, description, price, category, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
      [restaurantId, item_name, description || "", Number(price) || 0, category || null, imageUrl]
    );
    return res.json({ message: "Test dish added", id: result.insertId });
  } catch (err) {
    console.error("TEST_ADD error:", err?.message);
    return res.status(500).json({ error: "Test add failed", details: err.message });
  }
});

app.get("/api/menu/my", authMiddleware, async (req, res) => {
  try {
    const user = req.user || {};
    const restaurantId = user.restaurant_id || 1;
    const [rows] = await db.execute("SELECT * FROM menu WHERE restaurant_id = ? ORDER BY created_at DESC", [restaurantId]);
    return res.json(rows);
  } catch (err) {
    console.error("Error fetching my menu:", err?.message);
    return res.status(500).json({ error: "Failed to fetch menu" });
  }
});

app.delete("/api/menu/:id", authMiddleware, async (req, res) => {
  try {
    const user = req.user || {};
    const [rows] = await db.execute("SELECT restaurant_id FROM menu WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Menu item not found" });
    const ownerId = rows[0].restaurant_id;
    if (user.role && user.role !== "admin" && user.restaurant_id !== ownerId) return res.status(403).json({ error: "Not authorized" });
    await db.execute("DELETE FROM menu WHERE id = ?", [req.params.id]);
    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Error deleting menu item:", err?.message);
    return res.status(500).json({ error: "Failed to delete menu item" });
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

// ===== Route Registration =====
if (authRoutes) app.use("/api/auth", authRoutes);
if (orderRoutes) {
  const or = typeof orderRoutes === 'function' ? orderRoutes(io) : orderRoutes;
  app.use("/api/orders", or);
}
if (paymentRoutes) app.use("/api/payments", paymentRoutes);
if (trackingRoutes) app.use("/api/tracking", trackingRoutes);
if (userAddressesRoutes) app.use("/api/user-addresses", userAddressesRoutes);
if (deliveryRoutes) {
  try {
    const dr = typeof deliveryRoutes === 'function' ? deliveryRoutes(io) : deliveryRoutes;
    app.use("/api/delivery", dr);
  } catch (e) {
    console.warn("Skipping deliveryRoutes:", e?.message);
  }
}

// ===== Socket.IO =====
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
