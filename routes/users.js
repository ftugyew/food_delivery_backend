const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * POST /api/users/location
 * 
 * Update user's delivery location (lat, lng, address) in users table
 * 
 * This is CRITICAL for order placement because:
 * - POST /api/orders fetches delivery location from users table
 * - If users.lat or users.lng is NULL, order creation fails
 * 
 * Frontend: user-address.html captures GPS location
 * Backend: This endpoint saves it to users table
 * Order flow: POST /api/orders reads from users table
 */
router.post('/location', async (req, res) => {
  const { user_id, lat, lng, address } = req.body;

  // Validate required fields
  if (!user_id) {
    return res.status(400).json({ 
      error: 'Missing user_id',
      message: 'user_id is required'
    });
  }

  if (!lat || !lng) {
    return res.status(400).json({ 
      error: 'Missing coordinates',
      message: 'lat and lng are required'
    });
  }

  // Validate coordinates are numeric
  const latitude = Number(lat);
  const longitude = Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ 
      error: 'Invalid coordinates',
      message: 'lat and lng must be valid numbers'
    });
  }

  // Validate coordinate ranges
  if (latitude < -90 || latitude > 90) {
    return res.status(400).json({ 
      error: 'Invalid latitude',
      message: 'Latitude must be between -90 and 90'
    });
  }

  if (longitude < -180 || longitude > 180) {
    return res.status(400).json({ 
      error: 'Invalid longitude',
      message: 'Longitude must be between -180 and 180'
    });
  }

  try {
    // Check if user exists
    const [userRows] = await db.execute(
      'SELECT id, name, email FROM users WHERE id = ?',
      [user_id]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ 
        error: 'User not found',
        message: `No user found with id ${user_id}`
      });
    }

    // Update user location in users table
    const updateQuery = `
      UPDATE users
      SET lat = ?,
          lng = ?,
          address = ?
      WHERE id = ?
    `;

    await db.execute(updateQuery, [
      latitude,
      longitude,
      address || null,
      user_id
    ]);

    // Fetch updated user data to confirm
    const [updatedUser] = await db.execute(
      'SELECT id, name, email, lat, lng, address FROM users WHERE id = ?',
      [user_id]
    );

    console.log(`✅ Location updated for user ${user_id}:`, {
      lat: latitude,
      lng: longitude,
      address: address || 'not provided'
    });

    return res.status(200).json({
      success: true,
      message: 'Location saved successfully',
      user: updatedUser[0]
    });

  } catch (error) {
    console.error('❌ Error updating user location:', error);
    return res.status(500).json({ 
      error: 'Database error',
      message: 'Failed to save location. Please try again.',
      details: error.message
    });
  }
});

/**
 * GET /api/users/:userId/location
 * 
 * Get user's current delivery location
 * Used to check if user has set their location before allowing orders
 */
router.get('/:userId/location', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ 
      error: 'Missing userId',
      message: 'userId parameter is required'
    });
  }

  try {
    const [userRows] = await db.execute(
      'SELECT id, name, email, lat, lng, address FROM users WHERE id = ?',
      [userId]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ 
        error: 'User not found',
        message: `No user found with id ${userId}`
      });
    }

    const user = userRows[0];

    // Check if location is set
    const hasLocation = user.lat !== null && user.lng !== null;

    return res.status(200).json({
      success: true,
      hasLocation,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        lat: user.lat,
        lng: user.lng,
        address: user.address
      }
    });

  } catch (error) {
    console.error('❌ Error fetching user location:', error);
    return res.status(500).json({ 
      error: 'Database error',
      message: 'Failed to fetch location',
      details: error.message
    });
  }
});

module.exports = router;
