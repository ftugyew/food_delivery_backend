const express = require('express');
const router = express.Router();
const db = require('../db');

// Save user address
router.post('/', async (req, res) => {
  const { userId, fullName, phone, address, landmark, pincode, lat, lon } = req.body;

  if (!userId || !fullName || !phone || !address || !pincode) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const hasCoords = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
    if (hasCoords) {
      try {
        const queryWithCoords = `INSERT INTO user_addresses (user_id, full_name, phone, address, landmark, pincode, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        await db.execute(queryWithCoords, [userId, fullName, phone, address, landmark, pincode, Number(lat), Number(lon)]);
        return res.status(201).json({ message: 'Address saved successfully', withCoords: true });
      } catch (err) {
        // Fallback if columns don't exist
        if (err && (err.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(err.message || ''))) {
          console.warn('lat/lon columns not found on user_addresses, saving without coordinates');
        } else {
          throw err;
        }
      }
    }
    const query = `INSERT INTO user_addresses (user_id, full_name, phone, address, landmark, pincode) VALUES (?, ?, ?, ?, ?, ?)`;
    await db.execute(query, [userId, fullName, phone, address, landmark, pincode]);
    res.status(201).json({ message: 'Address saved successfully', withCoords: false });
  } catch (error) {
    console.error('Error saving address:', error);
    res.status(500).json({ error: 'Failed to save address' });
  }
});

// Add route to get all addresses for a user
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const query = `SELECT * FROM user_addresses WHERE user_id = ?`;
    const [addresses] = await db.execute(query, [userId]);

    res.json(addresses);
  } catch (error) {
    console.error('Error fetching addresses:', error);
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});

// Add route to update an address
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { fullName, phone, address, landmark, pincode } = req.body;

  if (!fullName || !phone || !address || !pincode) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const query = `UPDATE user_addresses SET full_name = ?, phone = ?, address = ?, landmark = ?, pincode = ? WHERE id = ?`;
    await db.execute(query, [fullName, phone, address, landmark, pincode, id]);

    res.json({ message: 'Address updated successfully' });
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({ error: 'Failed to update address' });
  }
});

// Add route to delete an address
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const query = `DELETE FROM user_addresses WHERE id = ?`;
    await db.execute(query, [id]);

    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    console.error('Error deleting address:', error);
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

module.exports = router;