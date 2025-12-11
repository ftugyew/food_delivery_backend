const express = require("express");
const router = express.Router();
const db = require("../db"); // your DB connection
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// JWT secret (store in .env in production)
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// ===== MULTER CONFIG FOR RESTAURANT PHOTO UPLOADS =====
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp + original extension
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed (jpeg, jpg, png, gif, webp)"));
  }
});

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




// ===== Register Route with Image Upload Support =====
router.post("/register", upload.single("restaurantImage"), async (req, res) => {
  try {
    console.log("📝 Registration request received");
    console.log("Body:", req.body);
    console.log("File:", req.file);

    const { name, email, password, phone, role, restaurant_name, cuisine, description, eta, vehicle_type, aadhar } = req.body;

    // Validate required fields
    if (!name || !email || !password || !phone || !role) {
      return res.status(400).json({ error: "All fields required" });
    }

    // Check if email already exists
    const [existingUser] = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let restaurantId = null;

    // ===== Restaurant Registration with Image =====
    if (role === "restaurant") {
      if (!restaurant_name || !cuisine) {
        return res.status(400).json({ error: "Restaurant name and cuisine required" });
      }

      // Get uploaded image filename (if provided)
      const imageFilename = req.file ? req.file.filename : null;
      console.log("🖼️ Restaurant image:", imageFilename);

      // Insert restaurant into database with image_url
      const [restaurantResult] = await db.execute(
        "INSERT INTO restaurants (name, cuisine, description, eta, status, image_url) VALUES (?, ?, ?, ?, 'pending', ?)",
        [restaurant_name, cuisine, description || "", eta || 30, imageFilename]
      );
      restaurantId = restaurantResult.insertId;
      console.log("✅ Restaurant created with ID:", restaurantId);
    }

    // ===== Delivery Agent Registration =====
    if (role === "delivery_agent") {
      if (!aadhar || !vehicle_type) {
        return res.status(400).json({ error: "Aadhaar and vehicle type required" });
      }
      // You can add delivery agent specific table insertions here
    }

    // Insert user into users table
    const [userResult] = await db.execute(
      "INSERT INTO users (name, email, phone, password_hash, role, restaurant_id) VALUES (?, ?, ?, ?, ?, ?)",
      [name, email, phone, hashedPassword, role, restaurantId]
    );

    console.log("✅ User created with ID:", userResult.insertId);

    return res.json({
      success: true,
      message: role === "restaurant" 
        ? "Restaurant registered! Awaiting admin approval" 
        : "Registration successful!",
      user_id: userResult.insertId,
      restaurant_id: restaurantId,
      image_url: req.file ? req.file.filename : null
    });

  } catch (err) {
    console.error("❌ Registration Error:", err);
    return res.status(500).json({ error: "Registration failed: " + err.message });
  }
});

// ===== Login =====
router.post("/login", async (req, res) => {
  console.log("📩 LOGIN REQUEST BODY:", req.body);

  try {
    const { email, password } = req.body;
    console.log("🔍 Checking login for:", email);


    if (!email || !password) {
      console.log("⚠️ Missing fields!");
      return res.status(400).json({ error: "Email and password required" });
    }

    // Fetch user by email only
    const [rows] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
    console.log("🔎 DB Query Result:", rows); // ⭐ What user data returned?

    if (rows.length === 0) {
      console.log("❌ No user found with this email");
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    console.log("🔐 Password Match:", isPasswordValid); // ⭐ True / False

    if (!isPasswordValid) {
      console.log("❌ Wrong password entered");
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const normalizedRole = normalizeRole(user.role);
    console.log("👤 Role Detected:", normalizedRole); // ⭐ Who is logging in?


    // Restaurant owner: check restaurant status
    if (normalizedRole === 'restaurant') {
      const restaurantId = user.restaurant_id;
      if (restaurantId) {
        const [restRows] = await db.execute("SELECT status FROM restaurants WHERE id = ?", [restaurantId]);
        if (restRows.length > 0) {
          const restaurantStatus = restRows[0].status;
          
          if (restaurantStatus === 'pending') {
            return res.json({
              success: false,
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
              success: false,
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
              success: true,
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
        success: true,
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
        success: true,
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
      success: true,
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
