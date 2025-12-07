
const express = require("express");
const router = express.Router();
const db = require("../db"); // your DB connection
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
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
    const { name, email, password, phone, role, restaurant_name, cuisine, description, eta, vehicle_type, aadhar } = req.body;

    if (!name || !email || !password || !phone || !role) {
      return res.status(400).json({ error: "All fields required" });
    }

    // Check if email already exists
    const [existingUser] = await db.execute("SELECT email FROM users WHERE email = ?", [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let restaurantId = null;

    // Register Restaurant Role
    if (role === "restaurant") {
      if (!restaurant_name || !cuisine) {
        return res.status(400).json({ error: "Restaurant details missing" });
      }

      // Insert restaurant into DB
      const [rest] = await db.execute(
        "INSERT INTO restaurants(name, cuisine, description, eta, status) VALUES (?, ?, ?, ?, 'pending')",
        [restaurant_name, cuisine, description || "", eta || 30]
      );
      restaurantId = rest.insertId;
    }

    // Register Delivery Agent Role
    if (role === "delivery_agent") {
      if (!aadhar || !vehicle_type) {
        return res.status(400).json({ error: "Delivery agent details missing" });
      }
    }

    // Insert user details
    const [user] = await db.execute(
      "INSERT INTO users(name, email, phone, password_hash, role, restaurant_id) VALUES (?, ?, ?, ?, ?, ?)",
      [name, email, phone, hashedPassword, role, restaurantId]
    );

    return res.json({
      success: true,
      message:
        role === "restaurant"
          ? "Restaurant registered! Awaiting admin approval"
          : "Registration successful!",
      user_id: user.insertId
    });

  } catch (err) {
    console.error("Registration Error:", err);
    return res.status(500).json({ error: "Registration failed" });
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

    if (!phone) {
      return res.status(400).json({ error: "Phone number required" });
    }

    // Check if email already exists
    const [existing] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Hash password using bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // Create restaurant entry with photo
    const imageUrl = req.file ? req.file.filename : null;
    const [result] = await db.execute(
      `INSERT INTO restaurants (name, description, cuisine, eta, image_url, email, phone, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [restaurant_name, description || '', cuisine, parseInt(eta) || 30, imageUrl, email, phone]
    );
    const restaurantId = result.insertId;

    // Insert user with password_hash
    const [userResult] = await db.execute(
      "INSERT INTO users (name, email, phone, password_hash, role, restaurant_id, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
      [name, email, phone, passwordHash, role, restaurantId]
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
      success: true,
      message: "Restaurant registration submitted, pending admin approval", 
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });

  } catch (err) {
    console.error("Restaurant Register Error:", err);
    res.status(500).json({ error: "Restaurant registration failed" });
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
