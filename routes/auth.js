const express = require("express");
const router = express.Router();
const db = require("../db"); // your DB connection
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { restaurantUpload } = require("../middleware/upload");

// JWT secret (store in .env in production)
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// ===== Generate Token =====
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: normalizeRole(user.role),
      restaurant_id: user.restaurant_id || null
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function normalizeRole(role) {
  if (!role) return role;
  return role === "delivery_agent" ? "delivery" : role;
}

// =======================================================================
// ========== REGISTER ====================================================
// =======================================================================

router.post("/register", restaurantUpload.single("restaurantImage"), async (req, res) => {
  try {
    console.log("📝 Registration request received");
    console.log("Body:", req.body);
    console.log("File:", req.file);

    const {
      name,
      email,
      password,
      phone,
      role,
      restaurant_name,
      cuisine,
      description,
      eta,
      vehicle_type,
      aadhar
    } = req.body;

    if (!name || !email || !password || !phone || !role) {
      return res.status(400).json({ error: "All fields required" });
    }

    // Check if email already exists
    const [existingUser] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let restaurantId = null;

    // ===== RESTAURANT REGISTER =====
    if (role === "restaurant") {
      if (!restaurant_name || !cuisine) {
        return res
          .status(400)
          .json({ error: "Restaurant name and cuisine required" });
      }

      const imageUrl = req.file ? req.file.path : null;
      console.log("🖼️ Restaurant image:", imageUrl);

      const [restaurantResult] = await db.query(
        "INSERT INTO restaurants (name, cuisine, description, eta, status, image_url) VALUES (?, ?, ?, ?, 'pending', ?)",
        [restaurant_name, cuisine, description || "", eta || 30, imageUrl]
      );

      restaurantId = restaurantResult.insertId;
      console.log("✅ Restaurant created with ID:", restaurantId);
    }

    // ===== DELIVERY AGENT REGISTER =====
    if (role === "delivery_agent") {
      if (!aadhar || !vehicle_type) {
        return res
          .status(400)
          .json({ error: "Aadhaar and vehicle type required" });
      }
    }

    // Create user
    const [userResult] = await db.query(
      "INSERT INTO users (name, email, phone, password_hash, role, restaurant_id) VALUES (?, ?, ?, ?, ?, ?)",
      [name, email, phone, hashedPassword, role, restaurantId]
    );

    console.log("✅ User created with ID:", userResult.insertId);

    // If delivery agent, also create agent record linked to user
    if (role === "delivery_agent") {
      try {
        const [agentResult] = await db.query(
          "INSERT INTO agents (user_id, name, phone, status, vehicle_type, aadhar) VALUES (?, ?, ?, 'Inactive', ?, ?)",
          [userResult.insertId, name, phone, vehicle_type, aadhar]
        );
        console.log("✅ Delivery agent created with ID:", agentResult.insertId);
      } catch (e) {
        console.error("❌ Failed to create delivery agent record:", e.message);
        return res.status(500).json({ error: "Registration failed: could not create delivery agent" });
      }
    }

    return res.json({
      success: true,
      message:
        role === "restaurant"
          ? "Restaurant registered! Awaiting admin approval"
          : role === "delivery_agent"
            ? "Delivery agent registered! Awaiting activation"
            : "Registration successful!",
      user_id: userResult.insertId,
      restaurant_id: restaurantId,
      image_url: req.file ? req.file.path : null
    });
  } catch (err) {
    console.error("❌ Registration Error:", err);
    return res.status(500).json({ error: "Registration failed: " + err.message });
  }
});

// =======================================================================
// ========== LOGIN =======================================================
// =======================================================================

router.post("/login", async (req, res) => {
  console.log("📩 LOGIN REQUEST BODY:", req.body);

  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const [rows] = await db.query(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    if (rows.length === 0)
      return res.status(401).json({ error: "Invalid email or password" });

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!isPasswordValid)
      return res.status(401).json({ error: "Invalid email or password" });

    const normalizedRole = normalizeRole(user.role);

    // Restaurant owner checks
    if (normalizedRole === "restaurant") {
      const [restRows] = await db.query(
        "SELECT status FROM restaurants WHERE id = ?",
        [user.restaurant_id]
      );

      if (restRows.length > 0) {
        const status = restRows[0].status;

        if (status === "pending") {
          return res.json({
            success: false,
            status: "pending",
            message: "Waiting for admin approval"
          });
        }

        if (status === "rejected") {
          return res.json({
            success: false,
            status: "rejected",
            message: "Your restaurant was rejected"
          });
        }

        if (status === "approved") {
          const token = generateToken(user);
          return res.json({
            success: true,
            status: "approved",
            role: "restaurant",
            redirectTo: "/restaurant-dashboard.html",
            token,
            user
          });
        }
      }
    }

    // ADMIN
    if (normalizedRole === "admin") {
      const token = generateToken(user);
      return res.json({
        success: true,
        role: "admin",
        redirectTo: "/admin-dashboard.html",
        token,
        user
      });
    }

    // DELIVERY AGENT — require ACTIVE status before granting access
    if (normalizedRole === "delivery") {
      try {
        const [agentRows] = await db.query(
          "SELECT status FROM agents WHERE user_id = ?",
          [user.id]
        );

        if (!agentRows.length) {
          return res.json({
            success: false,
            status: "pending",
            message: "Delivery agent profile not found. Awaiting verification."
          });
        }

        const agentStatus = agentRows[0].status;
        if (agentStatus !== "Active") {
          return res.json({
            success: false,
            status: agentStatus?.toLowerCase?.() || "inactive",
            message: "Your delivery agent account is not active yet. Please wait for admin approval."
          });
        }

        const token = generateToken(user);
        return res.json({
          success: true,
          role: "delivery",
          redirectTo: "/delivery-dashboard-live.html",
          token,
          user
        });
      } catch (e) {
        console.error("Agent status check failed:", e.message);
        return res.status(500).json({ error: "Login failed: could not verify agent status" });
      }
    }

    // CUSTOMER
    const token = generateToken(user);
    return res.json({
      success: true,
      role: "customer",
      redirectTo: "/index.html",
      token,
      user
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// =======================================================================
// ========== AUTH MIDDLEWARE ============================================
// =======================================================================

function authMiddleware(req, res, next) {
  let token = req.headers.authorization?.split(" ")[1];

  if (!token && req.query?.token) token = req.query.token;

  if (!token)
    return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Invalid Token:", err.message);
    return res.status(403).json({ error: "Invalid token" });
  }
}

// =======================================================================
// ========== UPDATE USER LOCATION (AFTER LOGIN) =========================
// =======================================================================

router.post("/update-location", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude, accuracy } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: "Latitude and longitude required" });
    }

    console.log(`📍 User ${userId} location updated:`, { latitude, longitude });

    // Store location temporarily (will be saved to orders table when order is placed)
    // For now, just confirm receipt
    res.json({
      success: true,
      message: "Location captured successfully",
      data: { latitude, longitude, accuracy }
    });
  } catch (error) {
    console.error("❌ Update location error:", error);
    res.status(500).json({ error: "Failed to update location" });
  }
});

// =======================================================================
// ========== TOKEN VERIFICATION ENDPOINT ================================
// =======================================================================

router.get("/verify", authMiddleware, async (req, res) => {
  try {
    // Token is already verified by middleware
    res.json({
      valid: true,
      user: req.user
    });
  } catch (error) {
    res.status(403).json({ valid: false, error: "Invalid token" });
  }
});

module.exports = { router, authMiddleware };
