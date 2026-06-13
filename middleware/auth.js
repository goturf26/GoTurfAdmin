// middleware/auth.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  console.log(`[AUTH] ${req.method} ${req.originalUrl}`);

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!authHeader || !token) {
    console.log('[AUTH] → No token / malformed header');
    return res.status(401).json({
      success: false,
      message: 'Authentication required - no token provided'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log('[AUTH] → Invalid/expired token:', err.message);
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Success logging with more details
    console.log('[AUTH] → Success, user:', decoded.id, 'role:', decoded.role || 'unknown');

    // Attach decoded data to req.admin
    req.admin = decoded;

    // IMPORTANT FIX: Set super admin flag based on role
    req.isSuperAdmin = (decoded.role === 'super_admin');

    // Optional: Extra debug log for super admin detection
    if (req.isSuperAdmin) {
      console.log('[AUTH] → SUPER ADMIN DETECTED (role: super_admin)');
    } else {
      console.log('[AUTH] → Normal admin / role not super_admin');
    }

    next();
  });
};