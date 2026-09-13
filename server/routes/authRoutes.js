const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db, recalculateAllBills } = require('../database');
const { verifyToken, JWT_SECRET } = require('../middleware/auth');

// Helper to normalize Indian 10-digit phone number
function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  const digits = rawPhone.toString().replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

// =========================================================================
// 1. FORGOT PASSWORD: REQUEST TO ADMIN FOR NEW PASSWORD
// =========================================================================

// Student submits request to admin for new password
router.post('/request-password-reset', async (req, res) => {
  try {
    const { identifier, message } = req.body;
    if (!identifier || !identifier.trim()) {
      return res.status(400).json({ success: false, message: 'Registered email address or mobile number is required.' });
    }

    const cleanInput = identifier.trim();
    const cleanPhone = normalizePhone(cleanInput);

    // Find student by email or mobile number
    let user = null;
    if (cleanPhone && cleanPhone.length === 10) {
      user = db.prepare(`
        SELECT id, name, email, phone, room_no, role, status
        FROM users
        WHERE LOWER(email) = LOWER(?) OR phone LIKE ? OR phone LIKE ?
      `).get(cleanInput, `%${cleanPhone}%`, cleanPhone);
    } else {
      user = db.prepare(`
        SELECT id, name, email, phone, room_no, role, status
        FROM users
        WHERE LOWER(email) = LOWER(?)
      `).get(cleanInput);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No registered account found with that email address or mobile number. Please check your details or register as a new student.'
      });
    }

    // Check if an active pending request already exists for this student
    const existingPending = db.prepare(`
      SELECT id, created_at FROM password_reset_requests
      WHERE user_id = ? AND status = 'pending'
      ORDER BY id DESC LIMIT 1
    `).get(user.id);

    if (existingPending) {
      return res.json({
        success: true,
        alreadyPending: true,
        message: `Your password reset request for ${user.name} (${user.email}) is already submitted and pending Admin approval. The Mess Manager will set your new password shortly.`
      });
    }

    // Insert new pending password reset request
    db.prepare(`
      INSERT INTO password_reset_requests (user_id, name, email, phone, room_no, request_message, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      user.id,
      user.name,
      user.email,
      user.phone || null,
      user.room_no || null,
      message ? message.trim() : 'Student forgot password and requested new password from Admin'
    );

    return res.json({
      success: true,
      message: `Password reset request submitted successfully for ${user.name}! The Mess Manager / Admin will review your request and assign a new password.`
    });
  } catch (err) {
    console.error('request-password-reset error:', err);
    return res.status(500).json({ success: false, message: 'Server error while submitting password reset request.' });
  }
});

// =========================================================================
// 2. REGISTER (DIRECT STUDENT SIGNUP - NO OTP)
// =========================================================================
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, room_no, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    let cleanPhone = null;
    if (phone) {
      cleanPhone = normalizePhone(phone);
      if (cleanPhone.length !== 10) {
        return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
      }

      const existingPhone = db.prepare('SELECT id FROM users WHERE phone LIKE ? OR phone LIKE ?').get(`%${cleanPhone}%`, cleanPhone);
      if (existingPhone) {
        return res.status(400).json({ success: false, message: 'An account with this mobile number already exists.' });
      }
    }

    const trimmedEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const password_hash = bcrypt.hashSync(password, salt);

    const stmt = db.prepare(`
      INSERT INTO users (name, email, phone, room_no, password_hash, role, status)
      VALUES (?, ?, ?, ?, ?, 'user', 'pending')
    `);

    const info = stmt.run(name.trim(), trimmedEmail, cleanPhone, room_no ? room_no.trim() : null, password_hash);
    const newUserId = info.lastInsertRowid;

    return res.status(201).json({
      success: true,
      pendingApproval: true,
      message: 'Registration submitted successfully! Your account is pending approval by the Mess Manager. Once approved, you will be able to log in with your email and password.',
      user: {
        id: newUserId,
        name: name.trim(),
        email: trimmedEmail,
        phone: cleanPhone,
        room_no: room_no ? room_no.trim() : null,
        role: 'user',
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// Check account approval status by email or mobile number (for live student polling)
router.get('/check-status', (req, res) => {
  try {
    const rawIdentifier = (req.query.identifier || '').trim();
    if (!rawIdentifier) {
      return res.status(400).json({ success: false, message: 'Email or mobile number is required.' });
    }

    const cleanPhone = normalizePhone(rawIdentifier);
    let user = null;
    if (cleanPhone && cleanPhone.length === 10) {
      user = db.prepare(`
        SELECT id, name, email, phone, role, status
        FROM users
        WHERE LOWER(email) = LOWER(?) OR phone LIKE ? OR phone LIKE ?
      `).get(rawIdentifier, `%${cleanPhone}%`, cleanPhone);
    } else {
      user = db.prepare(`
        SELECT id, name, email, phone, role, status
        FROM users
        WHERE LOWER(email) = LOWER(?)
      `).get(rawIdentifier);
    }

    if (!user) {
      return res.json({ success: true, exists: false, status: 'not_found', message: 'Account not found.' });
    }

    const st = (user.status || '').toLowerCase();
    const isApproved = st === 'active' || st === 'approved';

    return res.json({
      success: true,
      exists: true,
      id: user.id,
      name: user.name,
      email: user.email,
      status: st,
      isApproved,
      message: isApproved
        ? `Account approved! You can now log in as ${user.name}.`
        : (st === 'pending' ? 'Your account is waiting for Mess Manager approval.' : `Account status: ${st}`)
    });
  } catch (err) {
    console.error('Check status error:', err);
    return res.status(500).json({ success: false, message: 'Server error checking status.' });
  }
});

// Login (Supports Email OR Mobile Number)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email/mobile number and password are required.' });
    }

    const rawIdentifier = email.trim();
    const cleanPhone = normalizePhone(rawIdentifier);

    let user = null;
    if (cleanPhone && cleanPhone.length === 10) {
      user = db.prepare(`
        SELECT * FROM users
        WHERE LOWER(email) = LOWER(?) OR phone LIKE ? OR phone LIKE ?
      `).get(rawIdentifier, `%${cleanPhone}%`, cleanPhone);
    } else {
      user = db.prepare(`
        SELECT * FROM users
        WHERE LOWER(email) = LOWER(?)
      `).get(rawIdentifier);
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Incorrect email/mobile number or password. Please check your credentials.' });
    }

    let isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch && password.trim() !== password) {
      // Fallback for mobile keyboard autofill space
      isMatch = bcrypt.compareSync(password.trim(), user.password_hash);
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect email/mobile number or password. Please check your credentials.' });
    }

    const userStatus = (user.status || '').toLowerCase();

    // Role-based approval status check
    if (user.role === 'admin') {
      if (userStatus !== 'active' && userStatus !== 'approved') {
        return res.status(403).json({
          success: false,
          message: 'This administrator account has been deactivated. Please contact the Mess Owner.'
        });
      }
    } else if (user.role === 'user') {
      if (userStatus === 'pending') {
        return res.status(403).json({
          success: false,
          isPending: true,
          email: user.email,
          message: 'Your account is pending approval by the Mess Manager. Please wait for the admin to approve your account before logging in.'
        });
      }
      if (userStatus === 'rejected') {
        return res.status(403).json({
          success: false,
          message: 'Your registration was rejected by the Mess Manager. Please contact administration.'
        });
      }
      if (userStatus !== 'active' && userStatus !== 'approved') {
        return res.status(403).json({
          success: false,
          message: 'Your account is currently inactive. Please contact the Mess Manager.'
        });
      }
    }

    // Generate JWT with is_owner and permissions
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        room_no: user.room_no,
        is_owner: user.is_owner || 0,
        permissions: user.permissions || 'all'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        room_no: user.room_no || '',
        role: user.role,
        is_owner: user.is_owner || 0,
        permissions: user.permissions || 'all'
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// Current user profile
router.get('/me', verifyToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, name, email, phone, room_no, role, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error retrieving user details.' });
  }
});

module.exports = router;
