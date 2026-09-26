const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const { eventBus } = require('../events');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Fetch user record by email or mobile number
    const userRes = await db.execute({
      sql: 'SELECT * FROM users WHERE LOWER(email) = ? OR phone = ?',
      args: [trimmedEmail, trimmedEmail]
    });

    if (userRes.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Incorrect email/mobile number or password.' });
    }

    const user = userRes.rows[0];

    // Check approval status for non-admin students
    if (user.role !== 'admin' && user.status === 'pending') {
      return res.status(403).json({
        success: false,
        isPending: true,
        email: user.email,
        message: 'Your account is pending Mess Manager approval.'
      });
    }

    // Verify Password (supports password_hash or direct hash)
    const hashToTest = user.password_hash || user.password;
    const isValidPassword = await bcrypt.compare(password, hashToTest);

    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: 'Incorrect email/mobile number or password.' });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'messmate_secret_key_2026',
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Login successful!',
      token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        room_no: user.room_no,
        phone: user.phone
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during authentication.' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, room_no, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const cleanPhone = phone ? phone.trim() : null;

    // Check existing user
    const existingUserRes = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [trimmedEmail]
    });

    if (existingUserRes.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Hash Password & Insert User with status = 'pending'
    const password_hash = await bcrypt.hash(password, 10);
    const insertRes = await db.execute({
      sql: `
        INSERT INTO users (name, email, phone, room_no, password_hash, role, status)
        VALUES (?, ?, ?, ?, ?, 'user', 'pending')
      `,
      args: [name.trim(), trimmedEmail, cleanPhone, room_no ? room_no.trim() : null, password_hash]
    });

    const newUserId = Number(insertRes.lastInsertRowid);
    const newUser = {
      id: newUserId,
      name: name.trim(),
      email: trimmedEmail,
      phone: cleanPhone,
      room_no: room_no ? room_no.trim() : null,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    // Emit real-time events for SSE / Admin notification
    try {
      if (eventBus) {
        eventBus.emit('NEW_STUDENT_REGISTERED', { student: newUser });
        eventBus.emit('USER_REGISTERED', { user: newUser });
      }
    } catch (e) {
      console.error('eventBus emit error:', e);
    }

    return res.status(201).json({
      success: true,
      pendingApproval: true,
      message: 'Registration successful! Your account is pending admin approval before you can log in.',
      user: newUser
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// GET /api/auth/check-status
router.get('/check-status', async (req, res) => {
  try {
    const identifier = req.query.identifier;
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Identifier is required.' });
    }

    const result = await db.execute({
      sql: 'SELECT name, email, status FROM users WHERE LOWER(email) = ? OR phone = ?',
      args: [identifier.trim().toLowerCase(), identifier.trim()]
    });

    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'User not found.' });
    }

    const user = result.rows[0];
    return res.json({
      success: true,
      status: user.status,
      isApproved: user.status === 'active',
      name: user.name,
      email: user.email
    });
  } catch (err) {
    console.error('Check status error:', err);
    return res.status(500).json({ success: false, message: 'Error checking approval status.' });
  }
});

module.exports = router;