
const express = require("express");
const router = express.Router();
const db = require("../db"); // your DB connection
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");

// JWT secret (store in .env in production)
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

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

// Normalize role names for frontend friendliness
function normalizeRole(role) {
  if (!role) return role;
  return role === 'delivery_agent' ? 'delivery' : role;
}

// ===== Register =====
router.post("/register", async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      password, 
      role,
      restaurant_name,
      description,
      cuisine,
      eta
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "All fields required" });
    }

    // Check if email already exists
    const [existing] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    let restaurantId = null;

    // If restaurant → create restaurant entry too
    if (role === "restaurant") {
      const [result] = await db.execute(
        `INSERT INTO restaurants (name, description, cuisine, eta, email, phone, status, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
        [
          restaurant_name || name, 
          description || '', 
          cuisine || 'Multi Cuisine', 
          parseInt(eta) || 30, 
          email, 
          phone
        ]
      );
      restaurantId = result.insertId;
    }

    // Set status
    let status = "approved"; // default
    if (role === "restaurant" || role === "delivery" || role === "delivery_agent") {
      status = "pending"; // needs admin approval
    }

    // Insert user
    const [userResult] = await db.execute(
      "INSERT INTO users (name, email, phone, password, role, restaurant_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [name, email, phone, password, role, restaurantId, status]
    );

    const user = {
      id: userResult.insertId,
      name,
      email,
      phone,
      role,
      restaurant_id: restaurantId,
      status
    };

    // Normalize role for frontend convenience
    user.role = normalizeRole(user.role);

    // If delivery agent, create corresponding agent profile for operations
    if (role === 'delivery_agent') {
      try {
        const vehicle_type = (req.body && req.body.vehicle_type) || null;
        const aadhar = (req.body && req.body.aadhar) || null;
        // Try inserting with optional aadhar column first
        try {
          await db.execute(
            "INSERT INTO agents (user_id, name, phone, status, vehicle_type, aadhar) VALUES (?, ?, ?, 'Inactive', ?, ?)",
            [user.id, name, phone, vehicle_type, aadhar]
          );
        } catch (err) {
          if (err && (err.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(err.message || ''))) {
            // Fallback: agents table may not have aadhar column; insert without it
            await db.execute(
              "INSERT INTO agents (user_id, name, phone, status, vehicle_type) VALUES (?, ?, ?, 'Inactive', ?)",
              [user.id, name, phone, vehicle_type]
            );
          } else {
            throw err;
          }
        }
      } catch (e) {
        console.warn('Failed to create agent profile for delivery agent:', e.message || e);
      }
    }

    // Only auto-login if approved
    if (status === "approved") {
      const token = generateToken(user);
      return res.json({ token, user });
    } else {
      return res.json({ message: "Registration submitted, pending admin approval", user });
    }

  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ===== Restaurant Registration with Photo =====
router.post("/register-restaurant", upload.single("photo"), async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      password, 
      role, 
      restaurant_name, 
      description, 
      cuisine, 
      eta 
    } = req.body;

    if (!name || !email || !password || !restaurant_name || !cuisine) {
      return res.status(400).json({ error: "Required fields missing" });
    }

    // Check if email already exists
    const [existing] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Create restaurant entry with photo
    const imageUrl = req.file ? req.file.filename : null;
    const [result] = await db.execute(
      `INSERT INTO restaurants (name, description, cuisine, eta, image_url, email, phone, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [restaurant_name, description || '', cuisine, parseInt(eta) || 30, imageUrl, email, phone]
    );
    const restaurantId = result.insertId;

    // Insert user with restaurant_id
    const [userResult] = await db.execute(
      "INSERT INTO users (name, email, phone, password, role, restaurant_id, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
      [name, email, phone, password, role, restaurantId]
    );

    const user = {
      id: userResult.insertId,
      name,
      email,
      phone,
      role,
      restaurant_id: restaurantId,
      status: "pending"
    };

    // Normalize role for frontend convenience
    user.role = normalizeRole(user.role);

    res.json({ 
      message: "Restaurant registration submitted, pending admin approval", 
      user 
    });

  } catch (err) {
    console.error("Restaurant Register Error:", err);
    res.status(500).json({ error: "Restaurant registration failed" });
  }
});

// ===== Login =====
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Fetch user by email
    const [rows] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];

    // Check password (plain text for now as per requirement)
    if (user.password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Role-based login logic with status checking
    const normalizedRole = normalizeRole(user.role);

    // Restaurant owner: check restaurant status
    if (normalizedRole === 'restaurant') {
      const restaurantId = user.restaurant_id;
      if (restaurantId) {
        const [restRows] = await db.execute("SELECT status FROM restaurants WHERE id = ?", [restaurantId]);
        if (restRows.length > 0) {
          const restaurantStatus = restRows[0].status;
          
          if (restaurantStatus === 'pending') {
            return res.json({
              status: "pending",
              role: "restaurant",
              message: "Waiting for admin approval",
              user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: normalizedRole,
                restaurant_id: restaurantId
              }
            });
          } else if (restaurantStatus === 'rejected') {
            return res.json({
              status: "rejected",
              role: "restaurant",
              message: "Your restaurant was rejected",
              user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: normalizedRole,
                restaurant_id: restaurantId
              }
            });
          } else if (restaurantStatus === 'approved') {
            // Generate token and return success
            const token = generateToken(user);
            return res.json({
              status: "approved",
              role: "restaurant",
              redirectTo: "/restaurant-dashboard.html",
              token,
              user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: normalizedRole,
                restaurant_id: restaurantId
              }
            });
          }
        }
      }
    }

    // Admin: always allow
    if (normalizedRole === 'admin') {
      const token = generateToken(user);
      return res.json({
        role: "admin",
        redirectTo: "/admin-dashboard.html",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: normalizedRole
        }
      });
    }

    // Delivery agent: allow
    if (normalizedRole === 'delivery') {
      const token = generateToken(user);
      return res.json({
        role: "delivery",
        redirectTo: "/delivery-dashboard.html",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: normalizedRole
        }
      });
    }

    // Customer or unknown role: default behavior
    const token = generateToken(user);
    return res.json({
      role: "customer",
      redirectTo: "/index.html",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: normalizedRole
      }
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ===== Middleware: Protect Routes =====
function authMiddleware(req, res, next) {
  // Primary: Authorization header
  let token = req.headers.authorization?.split(" ")[1];

  // Fallbacks: query param (used when uploading multipart/form-data where headers may be stripped)
  if (!token && req.query && req.query.token) token = req.query.token;

  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, role, restaurant_id }
    next();
  } catch (err) {
    console.error('authMiddleware: token verification failed', err.message || err);
    return res.status(403).json({ error: "Invalid token" });
  }
}

module.exports = { router, authMiddleware };
