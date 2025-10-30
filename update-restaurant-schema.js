const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function updateRestaurantSchema() {
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

    // Update restaurants table to support approval system
    console.log('🔄 Updating restaurants table schema...');
    
    // Add new columns if they don't exist
    const [restaurantColumns] = await connection.query("DESCRIBE restaurants");
    const columnNames = restaurantColumns.map(col => col.Field);
    
    if (!columnNames.includes('image_url')) {
      await connection.query("ALTER TABLE restaurants ADD COLUMN image_url VARCHAR(500) AFTER email");
      console.log('✅ Added image_url column to restaurants table');
    }
    
    if (!columnNames.includes('rating')) {
      await connection.query("ALTER TABLE restaurants ADD COLUMN rating DECIMAL(3, 2) DEFAULT 4.0 AFTER image_url");
      console.log('✅ Added rating column to restaurants table');
    }
    
    if (!columnNames.includes('eta')) {
      await connection.query("ALTER TABLE restaurants ADD COLUMN eta INT DEFAULT 30 AFTER rating");
      console.log('✅ Added eta column to restaurants table');
    }
    
    if (!columnNames.includes('cuisine')) {
      await connection.query("ALTER TABLE restaurants ADD COLUMN cuisine VARCHAR(100) AFTER eta");
      console.log('✅ Added cuisine column to restaurants table');
    }

    // Update status enum to include approval states
    try {
      await connection.query("ALTER TABLE restaurants MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'active', 'inactive') DEFAULT 'pending'");
      console.log('✅ Updated status enum in restaurants table');
    } catch (err) {
      console.log('⚠️ Status enum update failed (may already be updated):', err.message);
    }

    // Rename menu_items table to menu if it exists
    const [tables] = await connection.query("SHOW TABLES LIKE 'menu_items'");
    if (tables.length > 0) {
      try {
        await connection.query("RENAME TABLE menu_items TO menu");
        console.log('✅ Renamed menu_items table to menu');
      } catch (err) {
        console.log('⚠️ Table rename failed (may already be renamed):', err.message);
      }
    }

    // Update menu table column names if needed
    const [menuColumns] = await connection.query("DESCRIBE menu");
    const menuColumnNames = menuColumns.map(col => col.Field);
    
    if (menuColumnNames.includes('name') && !menuColumnNames.includes('item_name')) {
      await connection.query("ALTER TABLE menu CHANGE COLUMN name item_name VARCHAR(255) NOT NULL");
      console.log('✅ Renamed name column to item_name in menu table');
    }

    // Add user_id column to restaurants table if it doesn't exist
    if (!columnNames.includes('user_id')) {
      await connection.query("ALTER TABLE restaurants ADD COLUMN user_id INT AFTER id");
      console.log('✅ Added user_id column to restaurants table');
    }

    // Update sample restaurants to have approved status
    await connection.query("UPDATE restaurants SET status='approved' WHERE status='active' OR status IS NULL");
    console.log('✅ Updated existing restaurants to approved status');

    console.log('✅ Restaurant schema update completed successfully!');

  } catch (error) {
    console.error('❌ Restaurant schema update failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the update
updateRestaurantSchema();
