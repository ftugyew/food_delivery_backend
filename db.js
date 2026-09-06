const { Pool } = require('pg');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure the PostgreSQL connection string in Render.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

function convertPlaceholders(sql) {
  let parameter = 0;
  let quote = null;
  let converted = '';

  for (const character of sql) {
    if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote ? null : character;
    }
    if (character === '?' && !quote) {
      converted += `$${++parameter}`;
    } else {
      converted += character;
    }
  }

  return converted
    .replace(/ON DUPLICATE KEY UPDATE\s+otp\s*=\s*\$\d+,\s*created_at\s*=\s*NOW\(\)/i,
      'ON CONFLICT (phone) DO UPDATE SET otp = EXCLUDED.otp, created_at = NOW()')
    .replace(/"([^"\n]+)"/g, "'$1'");
}

async function execute(sql, params = []) {
  const statement = convertPlaceholders(sql);
  const result = await pool.query(statement, params);
  return [result.rows, { ...result, insertId: result.rows[0]?.id }];
}

function query(sql, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = [];
  }

  pool.query(convertPlaceholders(sql), params || [])
    .then((result) => callback?.(null, result.rows, result))
    .catch((error) => callback?.(error));
}

const db = { execute, query, pool };

// Test the connection
const testConnection = async () => {
  try {
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connected successfully');
  } catch (error) {
    console.error('❌ PostgreSQL connection error:', error.code || error.message || error);
  }
};

// Initialize connection test
testConnection();

module.exports = db;