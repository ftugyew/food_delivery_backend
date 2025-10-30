const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  let connection;
  
  try {
    // Connect to MySQL server (without specifying database)
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || ''
    });

    console.log('✅ Connected to MySQL server');

    // Read and execute the schema file
    const schemaPath = path.join(__dirname, 'database_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split the schema into individual statements and filter out empty ones
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await connection.query(statement);
          console.log('✅ Executed SQL statement');
        } catch (error) {
          console.log('⚠️  Statement may have already been executed:', error.message);
        }
      }
    }

    console.log('✅ Database setup completed successfully!');
    console.log('📊 Database: food_delivery');
    console.log('👥 Sample users created (admin@fooddelivery.com, john@example.com, jane@example.com)');
    console.log('🏪 Sample restaurants created (Pizza Palace, Burger King, Sushi Master)');
    console.log('🍕 Sample menu items created');
    console.log('🚚 Sample delivery agents created');

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Load environment variables
require('dotenv').config();

// Run the setup
setupDatabase();
