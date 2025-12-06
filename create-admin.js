// create-admin.js - Create admin user with properly hashed password
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
require("dotenv").config();

async function createAdmin() {
  let connection;
  try {
    console.log("🔐 Creating admin user...");

    // Admin credentials (customize these)
    const adminEmail = "admin@tindo.com"; // Change this
    const adminPassword = "admin123"; // Change this to a strong password
    const adminName = "Admin";
    const adminPhone = "9999999999";

    // Create connection with proper credentials
    const connectionConfig = {
      host: process.env.MYSQLHOST || "localhost",
      port: process.env.MYSQLPORT || 3306,
      user: process.env.MYSQLUSER || "root",
      password: process.env.MYSQLPASSWORD || "",
      database: process.env.MYSQLDATABASE || "food_delivery",
    };

    console.log(`📡 Connecting to ${connectionConfig.host}:${connectionConfig.port}/${connectionConfig.database}...`);
    
    connection = await mysql.createConnection(connectionConfig);
    console.log("✅ Database connected!");

    // Check if admin already exists
    const [existing] = await connection.execute(
      "SELECT id, email FROM users WHERE email = ? AND role = 'admin'",
      [adminEmail]
    );
    
    if (existing.length > 0) {
      console.log(`\n⚠️  Admin user with email '${adminEmail}' already exists!`);
      console.log("\n📝 Options:");
      console.log("1. Delete the existing admin from database and run this script again");
      console.log("2. Use the existing admin credentials (if you know them)");
      console.log("3. Change the adminEmail variable in this script and run again\n");
      return;
    }

    // Hash password with bcrypt (same as registration)
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    console.log("✅ Password hashed with bcrypt");

    // Insert admin user
    const [result] = await connection.execute(
      `INSERT INTO users (name, email, phone, password_hash, role, status) 
       VALUES (?, ?, ?, ?, 'admin', 'approved')`,
      [adminName, adminEmail, adminPhone, passwordHash]
    );

    console.log("\n✅ Admin user created successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📧 Email:    ${adminEmail}`);
    console.log(`🔑 Password: ${adminPassword}`);
    console.log(`👤 Name:     ${adminName}`);
    console.log(`📱 Phone:    ${adminPhone}`);
    console.log(`🎯 Role:     admin`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n📝 Next steps:");
    console.log("1. Go to http://localhost/food-delivery/frontend/login.html");
    console.log("2. Click 'Login with Email' tab");
    console.log("3. Enter email: " + adminEmail);
    console.log("4. Enter password: " + adminPassword);
    console.log("5. You'll be redirected to admin-dashboard.html");
    console.log("\n⚠️  IMPORTANT: Change these credentials after first login!");

  } catch (err) {
    console.error("\n❌ Error creating admin user:");
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(err.message || err);
    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("\n🔧 Troubleshooting:");
      console.error("1. Check MySQL is running (XAMPP -> MySQL -> Start)");
      console.error("2. Verify .env file has correct credentials:");
      console.error(`   - MYSQLHOST=${process.env.MYSQLHOST}`);
      console.error(`   - MYSQLUSER=${process.env.MYSQLUSER}`);
      console.error(`   - MYSQLPASSWORD=${process.env.MYSQLPASSWORD || '(empty)'}`);
      console.error(`   - MYSQLDATABASE=${process.env.MYSQLDATABASE}`);
    }
  } finally {
    if (connection) await connection.end();
    process.exit(0);
  }
}

createAdmin();
