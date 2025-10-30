const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function migrateDatabase() {
  let connection;
  
  try {
    // Connect to MySQL server
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'food_delivery'
    });

    console.log('✅ Connected to MySQL database');

    // Check if description column exists in restaurants table
    const [restaurantColumns] = await connection.query("DESCRIBE restaurants");
    const hasDescription = restaurantColumns.some(col => col.Field === 'description');
    
    if (!hasDescription) {
      await connection.query("ALTER TABLE restaurants ADD COLUMN description TEXT AFTER name");
      console.log('✅ Added description column to restaurants table');
    } else {
      console.log('✅ Description column already exists in restaurants table');
    }

    // Check if description column exists in menu_items table
    const [menuColumns] = await connection.query("DESCRIBE menu_items");
    const hasMenuDescription = menuColumns.some(col => col.Field === 'description');
    
    if (!hasMenuDescription) {
      await connection.query("ALTER TABLE menu_items ADD COLUMN description TEXT AFTER name");
      console.log('✅ Added description column to menu_items table');
    } else {
      console.log('✅ Description column already exists in menu_items table');
    }

    // Check if vehicle_type column exists in agents table
    const [agentColumns] = await connection.query("DESCRIBE agents");
    const hasVehicleType = agentColumns.some(col => col.Field === 'vehicle_type');
    const hasAadhar = agentColumns.some(col => col.Field === 'aadhar');
    
    if (!hasVehicleType) {
      await connection.query("ALTER TABLE agents ADD COLUMN vehicle_type VARCHAR(50) AFTER status");
      console.log('✅ Added vehicle_type column to agents table');
    } else {
      console.log('✅ Vehicle_type column already exists in agents table');
    }

    if (!hasAadhar) {
      try {
        await connection.query("ALTER TABLE agents ADD COLUMN aadhar VARCHAR(20) AFTER vehicle_type");
        console.log('✅ Added aadhar column to agents table');
      } catch (e) {
        console.log('⚠️  Could not add aadhar column to agents table:', e.message);
      }
    } else {
      console.log('✅ aadhar column already exists in agents table');
    }

    // Ensure user_addresses lat/lon columns exist
    try {
      const [addrCols] = await connection.query("DESCRIBE user_addresses");
      const hasLat = addrCols.some(col => col.Field === 'lat');
      const hasLon = addrCols.some(col => col.Field === 'lon');
      if (!hasLat) {
        await connection.query("ALTER TABLE user_addresses ADD COLUMN lat DECIMAL(10,8) AFTER pincode");
        console.log('✅ Added lat column to user_addresses');
      }
      if (!hasLon) {
        await connection.query("ALTER TABLE user_addresses ADD COLUMN lon DECIMAL(11,8) AFTER lat");
        console.log('✅ Added lon column to user_addresses');
      }
    } catch (e) {
      console.log('⚠️  Could not ensure lat/lon on user_addresses:', e.message);
    }

    // Check if order_tracking table exists
    const [tables] = await connection.query("SHOW TABLES LIKE 'order_tracking'");
    if (tables.length === 0) {
      await connection.query(`
        CREATE TABLE order_tracking (
          id INT AUTO_INCREMENT PRIMARY KEY,
          order_id INT NOT NULL,
          status VARCHAR(50) NOT NULL,
          description TEXT,
          location_lat DECIMAL(10, 8),
          location_lng DECIMAL(11, 8),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )
      `);
      console.log('✅ Created order_tracking table');
    } else {
      console.log('✅ Order_tracking table already exists');
    }

    // Ensure banners table exists
    try {
      const [bn] = await connection.query("SHOW TABLES LIKE 'banners'");
      if (bn.length === 0) {
        await connection.query(`
          CREATE TABLE banners (
            id INT AUTO_INCREMENT PRIMARY KEY,
            image_url VARCHAR(500) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created banners table');
      } else {
        console.log('✅ banners table already exists');
      }
    } catch (e) {
      console.log('⚠️  Could not ensure banners table:', e.message);
    }

    // Ensure reviews table exists
    try {
      const [rv] = await connection.query("SHOW TABLES LIKE 'reviews'");
      if (rv.length === 0) {
        await connection.query(`
          CREATE TABLE reviews (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            user_id INT NULL,
            restaurant_id INT NOT NULL,
            rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
            comment TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_order (order_id),
            INDEX idx_restaurant (restaurant_id),
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
          )
        `);
        console.log('✅ Created reviews table');
      } else {
        console.log('✅ reviews table already exists');
      }
    } catch (e) {
      console.log('⚠️  Could not ensure reviews table:', e.message);
    }

    console.log('✅ Database migration completed successfully!');

  } catch (error) {
    console.error('❌ Database migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the migration
migrateDatabase();
