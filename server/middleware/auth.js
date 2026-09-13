const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mess_management_super_secret_jwt_key_2026';

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, message: 'Invalid authorization format.' });
  }

  const token = parts[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }
}

const { db } = require('../database');

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Manager privileges required.' });
  }
  
  // Real-time database check for active status and owner privileges
  try {
    const adminRecord = db.prepare('SELECT status, is_owner, permissions FROM users WHERE id = ?').get(req.user.id);
    if (!adminRecord || adminRecord.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Admin account is deactivated. Please contact the Mess Owner.' });
    }
    req.user.is_owner = adminRecord.is_owner || 0;
    req.user.permissions = adminRecord.permissions || 'all';
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error verifying administrator status.' });
  }
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Manager privileges required.' });
  }

  try {
    const adminRecord = db.prepare('SELECT status, is_owner FROM users WHERE id = ?').get(req.user.id);
    if (!adminRecord || adminRecord.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Admin account is deactivated.' });
    }
    if (adminRecord.is_owner !== 1) {
      return res.status(403).json({ success: false, message: 'Access denied. Only the primary Mess Owner can perform this action.' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error verifying owner status.' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      try {
        const decoded = jwt.verify(parts[1], JWT_SECRET);
        req.user = decoded;
      } catch (err) {}
    }
  }
  next();
}

module.exports = {
  verifyToken,
  optionalAuth,
  requireAdmin,
  requireOwner,
  JWT_SECRET
};
