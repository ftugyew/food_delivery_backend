const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Always load backend/.env regardless of process cwd
dotenv.config({ path: path.join(__dirname, '.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure the PostgreSQL connection string in backend/.env');
}

const needsSsl =
  process.env.DATABASE_SSL === 'true' ||
  /supabase\.com|amazonaws\.com|render\.com/i.test(process.env.DATABASE_URL || '') ||
  process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
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
    // MySQL OTP upsert → Postgres (drops the 3rd bound param from the UPDATE clause)
    .replace(
      /ON DUPLICATE KEY UPDATE\s+otp\s*=\s*\$\d+,\s*created_at\s*=\s*NOW\(\)/i,
      'ON CONFLICT (phone) DO UPDATE SET otp = EXCLUDED.otp, created_at = NOW()'
    )
    // Common MySQL boolean comparisons
    .replace(/\bis_active\s*=\s*1\b/gi, 'is_active = TRUE')
    .replace(/\bis_active\s*=\s*0\b/gi, 'is_active = FALSE')
    .replace(/"([^"\n]+)"/g, "'$1'");
}

async function execute(sql, params = []) {
  let statement = convertPlaceholders(sql);
  let values = Array.isArray(params) ? [...params] : [];

  // After OTP upsert rewrite, SQL only needs 2 params (phone, otp)
  if (/ON CONFLICT \(phone\) DO UPDATE SET otp = EXCLUDED\.otp/i.test(statement) && values.length > 2) {
    values = values.slice(0, 2);
  }

  // Trim unused trailing params if SQL has fewer $N placeholders
  const maxParam = [...statement.matchAll(/\$(\d+)/g)].reduce((m, x) => Math.max(m, Number(x[1])), 0);
  if (maxParam > 0 && values.length > maxParam) {
    values = values.slice(0, maxParam);
  }

  const result = await pool.query(statement, values);
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