const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { eventBus } = require('../events');

router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, room_no, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const cleanPhone = phone ? phone.trim() : null;

    // 1. Check existing user
    const existingUserRes = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [trimmedEmail]
    });

    if (existingUserRes.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    // 2. Hash Password & Insert User with status = 'pending'
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

    // 3. Emit matching events for SSE and BroadcastChannel real-time sync
    try {
      eventBus.emit('NEW_STUDENT_REGISTERED', { student: newUser });
      eventBus.emit('USER_REGISTERED', { user: newUser });
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

module.exports = router;