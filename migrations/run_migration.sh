#!/bin/bash
# ============================================
# PRODUCTION DATABASE MIGRATION SCRIPT
# Run this on your production server to fix tracking errors
# ============================================

echo "🔧 Starting database migration to fix tracking columns..."

# Get database credentials from environment or prompt
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-food_delivery}"

# Check if mysql command is available
if ! command -v mysql &> /dev/null; then
    echo "❌ Error: mysql command not found. Please install MySQL client."
    exit 1
fi

echo "📊 Database: $DB_NAME"
echo "🖥️  Host: $DB_HOST"
echo "👤 User: $DB_USER"
echo ""

# Prompt for password
echo "Please enter MySQL password:"
read -s DB_PASS

echo ""
echo "🚀 Running migration..."

# Run the migration SQL file
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < fix_tracking_columns.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration completed successfully!"
    echo ""
    echo "📋 Verifying columns..."
    
    # Verify restaurants table
    echo "Checking restaurants table..."
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SHOW COLUMNS FROM restaurants LIKE 'lat';" 2>/dev/null
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SHOW COLUMNS FROM restaurants LIKE 'lng';" 2>/dev/null
    
    # Verify agents table
    echo ""
    echo "Checking agents table..."
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SHOW COLUMNS FROM agents LIKE 'lat';" 2>/dev/null
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SHOW COLUMNS FROM agents LIKE 'lng';" 2>/dev/null
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SHOW COLUMNS FROM agents LIKE 'is_online';" 2>/dev/null
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SHOW COLUMNS FROM agents LIKE 'is_busy';" 2>/dev/null
    
    echo ""
    echo "✅ All done! Please restart your Node.js server."
    echo ""
    echo "📝 Next steps:"
    echo "   1. Restart the backend server"
    echo "   2. Test order tracking: GET /api/tracking/orders/:id/tracking"
    echo "   3. Verify no more 'Unknown column' errors"
    echo ""
else
    echo ""
    echo "❌ Migration failed! Please check the error messages above."
    echo ""
    echo "💡 Troubleshooting:"
    echo "   - Verify database credentials are correct"
    echo "   - Check if you have ALTER TABLE permissions"
    echo "   - Ensure the database exists"
    echo ""
    exit 1
fi
