const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const authenticateToken = require('../middleware/auth');
const multer = require('multer'); // kept for handleMulterError
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const cron = require('node-cron');
require('dotenv').config();

// Cloudinary
const { cloudinary, upload } = require('../config/cloudinary');

// MongoDB connection
const mongoUri = process.env.MONGODB_URI;
const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 30000 });
console.log("🔥 AUTH ROUTES FILE LOADED");
// Firebase Admin Init
try {
    const serviceAccountPath = path.resolve(__dirname, '../service-account.json');

    admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath)),
    });

    console.log('Firebase Admin initialized');
} catch (err) {
    console.log('Firebase already initialized');
}

// === NOTIFICATION HELPER FUNCTION ===
async function sendNotificationToTopic(topic, title, body, data = {}) {
    if (!topic || !title || !body) return;
    
    const message = {
        notification: { title: title, body: body },
        data: data,
        topic: topic  
    };

    try {
        await admin.messaging().send(message);
        console.log(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] TOURNAMENT NOTIFICATION SENT to ${topic}: ${title}`);
    } catch (error) {
        console.error(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] FCM Error (Tournament Alert): ${error.message}`);
    }
}

// handleMulterError
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError || err) {
        return res.status(400).json({
            success: false,
            message: 'File upload error',
            error: err.message,
        });
    }
    next();
};

// Token Refresh + All Auth Routes (EXACT ORIGINAL)
const authenticateRefreshToken = (req, res, next) => {
    const refreshToken = req.body.refreshToken || req.headers['x-refresh-token'];
    if (!refreshToken) {
        return res.status(401).json({ success: false, message: 'Refresh token required' });
    }
    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: 'Invalid refresh token' });
        req.user = user;
        next();
    });
};

router.post('/refresh-token', authenticateRefreshToken, async (req, res) => {
    try {
        const adminUser = await Admin.findById(req.user.id);
        if (!adminUser) return res.status(404).json({ success: false, message: 'Admin not found' });

        const accessToken = jwt.sign(
            { id: adminUser._id, email: adminUser.email, role: adminUser.role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        const refreshToken = jwt.sign(
            { id: adminUser._id, email: adminUser.email, role: adminUser.role },
            process.env.REFRESH_TOKEN_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ success: true, token: accessToken, refreshToken });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

router.post('/check-existence', async (req, res) => {
  const { email, phone, name } = req.body;

  try {
    // Normalize inputs
    const trimmedEmail = email?.trim().toLowerCase() || '';
    const trimmedPhone = phone?.trim() || '';
    const trimmedName = name?.trim() || '';

    // If nothing is sent
    if (!trimmedEmail && !trimmedPhone && !trimmedName) {
      return res.json({ success: true, exists: false });
    }

    // Check each field individually
    const existingByEmail = trimmedEmail
      ? await Admin.findOne({ email: trimmedEmail })
      : null;

    const existingByPhone = trimmedPhone
      ? await Admin.findOne({ phone: trimmedPhone })
      : null;

    const existingByName = trimmedName
      ? await Admin.findOne({ name: new RegExp(`^${escapeRegExp(trimmedName)}$`, 'i') }) // Case-insensitive exact match
      : null;

    // Determine which field is conflicting
    if (existingByName) {
      return res.json({
        success: true,
        exists: true,
        field: 'name',
        message: 'This name is already in use'
      });
    }

    if (existingByEmail) {
      return res.json({
        success: true,
        exists: true,
        field: 'email',
        message: 'This email is already registered'
      });
    }

    if (existingByPhone) {
      return res.json({
        success: true,
        exists: true,
        field: 'phone',
        message: 'This phone number is already registered'
      });
    }

    // No conflicts
    res.json({ success: true, exists: false });

  } catch (error) {
    console.error('Check existence error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Helper to escape special regex characters in name
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.post('/login', async (req, res) => {
    console.log('🔥 [LOGIN ROUTE HIT] Full Body:', JSON.stringify(req.body));

    const name = req.body.name?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const rawPassword = req.body.password;
    const password = rawPassword ? rawPassword.trim() : null;

    console.log('Name received:', name);
    console.log('Email received:', email);
    console.log('Password length:', password ? password.length : 0);
    // console.log('Raw Password:', rawPassword); // Uncomment for extreme debugging only!

    // Validation
    if (!password) { // Use the trimmed version for validation
        return res.status(400).json({
            success: false,
            message: 'Password is required'
        });
    }

    if (!name && !email) {
        return res.status(400).json({
            success: false,
            message: 'Please provide name or email'
        });
    }

    try {
        let adminUser = null;

        // Step 1: Try to find by NAME (case-insensitive exact match)
        if (name) {
            console.log('Searching admin by name:', name);
            adminUser = await Admin.findOne({
                name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            });
        }

        // Step 2: If not found by name, try by EMAIL
        if (!adminUser && email) {
            console.log('Searching admin by email:', email);
            adminUser = await Admin.findOne({ email });
        }

        // Step 3: No user found
        if (!adminUser) {
            console.log('No admin found with provided name/email');
            return res.status(400).json({
                success: false,
                message: 'Invalid name or email'
            });
        }

        console.log('Admin found:', adminUser.name, adminUser.email);

        // Step 4: Compare password (now consistently trimmed)
        let isMatch = await bcrypt.compare(password, adminUser.password);
        console.log('Password match?', isMatch);

        // ❌ NOTE: The brittle fallback and auto-fix logic is REMOVED 
        // because the password is now trimmed at the start of the function.

        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'Invalid password'
            });
        }
        
        // Step 5: Generate tokens
        const token = jwt.sign(
            { id: adminUser._id, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const refreshToken = jwt.sign(
            { id: adminUser._id },
            process.env.REFRESH_TOKEN_SECRET,
            { expiresIn: '7d' }
        );

        // Step 6: SUCCESS
        console.log('LOGIN SUCCESSFUL:', adminUser.name);
        

        res.json({
            success: true,
            message: 'Login successful',
            admin: {
                id: adminUser._id.toString(),
                name: adminUser.name,
                email: adminUser.email,
                phone: adminUser.phone,
                currentTurf: adminUser.currentTurf || {}
            },
            token,
            refreshToken
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});
router.post('/google-login', async (req, res) => {
    const { idToken } = req.body;
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const adminUser = await Admin.findOne({ email: decoded.email });
        if (!adminUser) return res.status(404).json({ success: false, message: 'Admin not found' });

        const token = jwt.sign({ id: adminUser._id, email: adminUser.email, role: adminUser.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = jwt.sign({ id: adminUser._id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            admin: { id: adminUser._id, name: adminUser.name, email: adminUser.email, currentTurf: adminUser.currentTurf || {} },
            token,
            refreshToken
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
router.post('/signup', async (req, res) => {
  const { name, email, phone, password } = req.body;

  console.log('\nSIGNUP ATTEMPT');
  console.log('Name:', name);
  console.log('Email:', email);
  console.log('Phone:', phone);
  console.log('Password length:', password?.length || 0);

  try {
    // 1. Validate required fields
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();

    // 2. Check if already exists
    const existing = await Admin.findOne({
      $or: [
        { email: trimmedEmail },
        { phone: trimmedPhone },
        { name: { $regex: new RegExp(`^${trimmedName}$`, 'i') } }
      ]
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Name, email or phone already exists'
      });
    }

    // 3. CRITICAL FIX: Trim password to remove accidental leading/trailing whitespace
    const cleanPassword = password.trim();
    console.log('Clean password length after trim:', cleanPassword.length);

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);
    console.log('Password hashed successfully');

    // 4. Create admin with HASHED password
    const newAdmin = new Admin({
      name: trimmedName,
      email: trimmedEmail,
      phone: trimmedPhone,
      password: hashedPassword,
      role: 'admin'
    });

    await newAdmin.save();
    console.log('New admin saved with name:', newAdmin.name);

    // 5. Generate tokens
    const token = jwt.sign(
      { id: newAdmin._id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
      { id: newAdmin._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: '7d' }
    );

    // 6. SUCCESS
    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      admin: {
        id: newAdmin._id.toString(),
        name: newAdmin.name,
        email: newAdmin.email,
        phone: newAdmin.phone,
        currentTurf: {}
      },
      token,
      refreshToken
    });

  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});
// ——————————————————————————————————————
// UPDATE BANK DETAILS - NEW ROUTE
// ——————————————————————————————————————
router.post('/update-bank-details', authenticateToken, async (req, res) => {
  try {
    const { adminId, bankDetails } = req.body;

    // Validate adminId
    if (!adminId || adminId !== req.admin.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Invalid admin ID',
      });
    }

    // Validate required fields
    const required = [
      'bankName', 'branch', 'bankFirstName', 'bankLastName',
      'address', 'city', 'accountNumber', 'ifscCode', 'accountType'
    ];

    for (const field of required) {
      if (!bankDetails[field] || bankDetails[field].toString().trim() === '') {
        return res.status(400).json({
          success: false,
          message: `Please provide ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
        });
      }
    }

    // Validate IFSC format
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankDetails.ifscCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IFSC code (e.g., SBIN0001234)',
      });
    }

    // Update admin
    const updatedAdmin = await Admin.findByIdAndUpdate(
      adminId,
      {
        bankDetails: {
          bankName: bankDetails.bankName.trim(),
          branch: bankDetails.branch.trim(),
          bankFirstName: bankDetails.bankFirstName.trim(),
          bankLastName: bankDetails.bankLastName.trim(),
          address: bankDetails.address.trim(),
          city: bankDetails.city.trim(),
          region: bankDetails.region?.trim() || 'Tamil Nadu',
          accountNumber: bankDetails.accountNumber.trim(),
          ifscCode: bankDetails.ifscCode.trim().toUpperCase(),
          zipCode: bankDetails.zipCode?.trim() || '',
          accountType: bankDetails.accountType.trim(),
          upiId: bankDetails.upiId?.trim() || '',
        },
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedAdmin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Bank details updated successfully',
      data: updatedAdmin.bankDetails,
    });
  } catch (error) {
    console.error('Update bank details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

// ——————————————————————————————————————
// TURF ROUTES - CLOUDINARY UPDATED
// ——————————————————————————————————————

router.post('/add-turf', authenticateToken, upload.single('image'), handleMulterError, async (req, res) => {
    try {
        const {
            adminId,
            turfName,
            state = 'Tamil Nadu',
            district,
            contactNumber,
            turfAddress,
            turfAddressLine2 = '',
            landmark = '',
            gpsCoordinates = '',
            sports,
            playingSurface = '',
            pricePerHour,
            hasLighting = 'false',
            hasWashroom = 'false',
            hasParking = 'false',
            hasDrinkingFacilities = 'false',
            gstin,
            license,
            operationStartTime = '06:00 AM',
            operationEndTime = '10:00 PM'
        } = req.body;

        // Authorization check
        if (adminId !== req.admin.id.toString()) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        // Required fields validation
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Image is required' });
        }
        if (!turfName || !district || !turfAddress || !sports || !pricePerHour || !gstin || !license) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Cloudinary Full URL
        const imageUrl = req.file.path;

        // Generate unique turf ID
        const turfId = `${state.slice(0,2).toUpperCase()}${district.slice(0,3).toUpperCase()}${Math.floor(10000 + Math.random() * 90000)}`;

        // Parse sports list
        const sportsArray = sports
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        // Parse boolean amenities
        const parseBool = (val) => val === 'true' || val === true;

        const turfData = {
            id: turfId,
            turfName: turfName.trim(),
            state: state.trim(),
            district: district.trim(),
            contactNumber: contactNumber?.trim() || '',
            turfAddress: turfAddress.trim(),
            turfAddressLine2: turfAddressLine2.trim(),
            landmark: landmark.trim(),
            gpsCoordinates: gpsCoordinates.trim(),
            sports: sportsArray,
            playingSurface: playingSurface.trim(),
            pricePerHour: parseFloat(pricePerHour),
            hasLighting: parseBool(hasLighting),
            hasWashroom: parseBool(hasWashroom),
            hasParking: parseBool(hasParking),
            hasDrinkingFacilities: parseBool(hasDrinkingFacilities),
            gstin: gstin.trim(),
            license: license.trim(),
            imageUrl: imageUrl,        // ← Full Cloudinary URL
            heldSlots: [],
            heldDays: [],
            confirmedSlots: [],
            operationStartTime: operationStartTime.trim(),
            operationEndTime: operationEndTime.trim(),
            tournaments: []
        };

        const adminUser = await Admin.findById(adminId);
        if (!adminUser) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        if (adminUser.currentTurf) {
            return res.status(400).json({ success: false, message: 'Turf already exists for this admin' });
        }

        adminUser.currentTurf = turfData;
        await adminUser.save();

        console.log(`Turf registered successfully: ${turfId} by ${adminId} | Image URL: ${imageUrl}`);

        res.status(201).json({
            success: true,
            message: 'Turf registered successfully',
            turf: {
                id: turfId,
                turfName: turfData.turfName,
                imageUrl: imageUrl   // Full Cloudinary URL
            }
        });

    } catch (error) {
        console.error('Add turf error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

router.post('/update-turf', authenticateToken, async (req, res) => {
    try {
        const { turfId, pricePerHour, playingSurface, sports, hasLighting, hasWashroom, hasParking, hasDrinkingFacilities, operationStartTime, operationEndTime } = req.body;
        const adminId = req.admin.id;

        const adminUser = await Admin.findById(adminId);
        if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
            return res.status(404).json({ success: false, message: 'Turf not found' });
        }

        const updates = {
            'currentTurf.pricePerHour': parseFloat(pricePerHour),
            'currentTurf.playingSurface': playingSurface,
            'currentTurf.sports': sports ? sports.split(',').map(s => s.trim()) : adminUser.currentTurf.sports,
            'currentTurf.hasLighting': hasLighting === 'true' || hasLighting === true,
            'currentTurf.hasWashroom': hasWashroom === 'true' || hasWashroom === true,
            'currentTurf.hasParking': hasParking === 'true' || hasParking === true,
            'currentTurf.hasDrinkingFacilities': hasDrinkingFacilities === 'true' || hasDrinkingFacilities === true,
            'currentTurf.operationStartTime': operationStartTime,
            'currentTurf.operationEndTime': operationEndTime,
        };

        Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

        const updatedAdmin = await Admin.findByIdAndUpdate(
            adminId,
            { $set: updates },
            { new: true }
        );

        res.json({ success: true, turf: updatedAdmin.currentTurf });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/turf/:turfId', authenticateToken, async (req, res) => {
    const { turfId } = req.params;
    const adminId = req.admin.id;
    try {
        const adminUser = await Admin.findOne({ _id: adminId, 'currentTurf.id': turfId });
        if (!adminUser) return res.status(404).json({ success: false, message: 'Turf not found' });
        const turf = adminUser.currentTurf;
        res.json({
            success: true,
            turf: {
                adminName: adminUser.name,
                turfAddress: turf.turfAddress,
                pricePerHour: turf.pricePerHour,
                sports: turf.sports.join(', '),
                playingSurface: turf.playingSurface || 'Not specified',
                hasLighting: turf.hasLighting,
                hasWashroom: turf.hasWashroom,
                hasParking: turf.hasParking,
                hasDrinkingFacilities: turf.hasDrinkingFacilities,
                heldSlots: turf.heldSlots || [],
                heldDays: turf.heldDays || [],
                confirmedSlots: turf.confirmedSlots || [],
                operationStartTime: turf.operationStartTime || '12:00 AM',
                operationEndTime: turf.operationEndTime || '12:00 AM',
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
// USER APP: Get slot availability for a specific date - FINAL WORKING VERSION
router.get('/turf/:turfId/slots', async (req, res) => {
  console.log(`SLOTS REQUEST: ${req.params.turfId} | Date: ${req.query.date}`);

  try {
    const { turfId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ 
        success: false, 
        message: 'Date parameter is required' 
      });
    }

    const adminUser = await Admin.findOne({ 'currentTurf.id': turfId });
    if (!adminUser || !adminUser.currentTurf) {
      return res.status(404).json({ 
        success: false, 
        message: 'Turf not found' 
      });
    }

    const turf = adminUser.currentTurf;

    // RETURN EXACTLY WHAT FLUTTER EXPECTS - DO NOT FILTER/MAP UNNECESSARILY
    const heldSlotsForDate = (turf.heldSlots || [])
      .filter(h => h.date === date);

    const confirmedSlotsForDate = (turf.confirmedSlots || [])
      .filter(c => c.date === date);

    const dayHeld = (turf.heldDays || []).some(d => d.date === date);

    console.log(`Found ${heldSlotsForDate.length} held slots for ${date}`);

    res.json({
      success: true,
      operationStartTime: turf.operationStartTime || '06:00 AM',
      operationEndTime: turf.operationEndTime || '10:00 PM',
      heldSlots: heldSlotsForDate,        // ← Keep full objects (with _id, timestamp, reason)
      reservedSlots: [],                  // optional
      confirmedSlots: confirmedSlotsForDate,
      heldDays: dayHeld ? [{ date, reason: 'Maintenance or held by admin' }] : []
    });

  } catch (error) {
    console.error('Error in /turf/:id/slots:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// ——————————————————————————————————————
// DASHBOARD
// ——————————————————————————————————————
router.get('/dashboard/:adminId/:turfId', authenticateToken, async (req, res) => {
    const { adminId, turfId } = req.params;
    if (adminId !== req.admin.id) return res.status(403).json({ success: false, message: 'Unauthorized' });

    try {
        const adminUser = await Admin.findById(adminId).select('name email phone role currentTurf').lean();
        if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
            return res.status(404).json({ success: false, message: 'Turf not found' });
        }

        const turf = adminUser.currentTurf;
        res.json({
            success: true,
            data: {
                adminName: adminUser.name,
                email: adminUser.email,
                phone: adminUser.phone,
                role: adminUser.role,
                turf: {
                    id: turf.id,
                    turfName: turf.turfName,
                    turfAddress: turf.turfAddress,
                    turfAddressLine2: turf.turfAddressLine2 || '',
                    landmark: turf.landmark || '',
                    gpsCoordinates: turf.gpsCoordinates || '',
                    sports: Array.isArray(turf.sports) ? turf.sports.join(', ') : turf.sports || '',
                    playingSurface: turf.playingSurface || 'Not specified',
                    pricePerHour: turf.pricePerHour,
                    hasLighting: turf.hasLighting,
                    hasWashroom: turf.hasWashroom,
                    hasParking: turf.hasParking,
                    hasDrinkingFacilities: turf.hasDrinkingFacilities,
                    imageUrl: turf.imageUrl || '',
                    heldSlots: turf.heldSlots || [],
                    heldDays: turf.heldDays || [],
                    confirmedSlots: turf.confirmedSlots || [],
                    operationStartTime: turf.operationStartTime || '12:00 AM',
                    operationEndTime: turf.operationEndTime || '12:00 AM',
                },
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
// ==================== ROUTE: UPDATE TURF IMAGE - CLOUDINARY VERSION ====================
router.post('/update-turf-image', authenticateToken, upload.single('image'), handleMulterError, async (req, res) => {
    console.log('[/update-turf-image] Cloudinary upload started');

    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }

        const { turfId } = req.body;
        const adminId = req.admin.id;

        if (!turfId) {
            return res.status(400).json({ success: false, message: 'turfId is required' });
        }

        const adminUser = await Admin.findOne({
            _id: adminId,
            'currentTurf.id': turfId
        });

        if (!adminUser || !adminUser.currentTurf) {
            return res.status(404).json({ success: false, message: 'Turf not found or unauthorized' });
        }

        const imageUrl = req.file.path;  // Cloudinary Full URL

        adminUser.currentTurf.imageUrl = imageUrl;
        await adminUser.save();

        console.log('Turf image updated successfully to Cloudinary:', imageUrl);

        res.json({
            success: true,
            message: 'Turf image updated successfully',
            imageUrl: imageUrl
        });

    } catch (error) {
        console.error('Update turf image error:', error);
        res.status(500).json({ success: false, message: 'Failed to update turf image', error: error.message });
    }
});
// ——————————————————————————————————————
// PROFILE
// ——————————————————————————————————————
router.get('/profile/:adminId', authenticateToken, async (req, res) => {
    const { adminId } = req.params;
    if (adminId !== req.admin.id) return res.status(403).json({ success: false, message: 'Unauthorized' });
    try {
        const adminUser = await Admin.findById(adminId).select('name email phone role');
        if (!adminUser) return res.status(404).json({ success: false, message: 'Admin not found' });
        res.json({ success: true, data: { name: adminUser.name, email: adminUser.email, phone: adminUser.phone, role: adminUser.role } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ——————————————————————————————————————
// TURF DETAILS
// ——————————————————————————————————————
router.get('/turf-details/:turfId', authenticateToken, async (req, res) => {
    const { turfId } = req.params;
    const adminId = req.admin.id;
    try {
        const adminUser = await Admin.findOne({ _id: adminId, 'currentTurf.id': turfId });
        if (!adminUser) return res.status(404).json({ success: false, message: 'Turf not found' });

        await client.connect();
        const db = client.db('goturf');
        const usersCollection = db.collection('users');

        const bookingCount = await usersCollection
            .aggregate([
                { $unwind: '$upcomingBookings' },
                { $match: { 'upcomingBookings.turfId': turfId, 'upcomingBookings.status': { $regex: '^confirmed$', $options: 'i' } } },
                { $count: 'total' },
            ])
            .toArray()
            .then(r => r[0]?.total || 0);

        res.json({ success: true, data: { pricePerHour: adminUser.currentTurf.pricePerHour, bookingCount } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        await client.close();
    }
});

// ——————————————————————————————————————
// LIST ALL TURFS
// ——————————————————————————————————————
router.get('/turfs', authenticateToken, async (req, res) => {
  try {
    let turfsData = [];

    if (req.isSuperAdmin) {
      // Super admin - all turfs
      const admins = await Admin.find({ 'currentTurf.id': { $exists: true, $ne: null } })
        .select('name currentTurf')
        .lean();

      turfsData = admins.map(a => ({
        turfId: a.currentTurf.id,
        turfName: a.currentTurf.turfName,
        turfAddress: `${a.currentTurf.turfAddress}${a.currentTurf.turfAddressLine2 ? `, ${a.currentTurf.turfAddressLine2}` : ''}, ${a.currentTurf.district}, ${a.currentTurf.state}`,
        district: a.currentTurf.district,
        imageUrl: a.currentTurf.imageUrl || '',
        pricePerHour: a.currentTurf.pricePerHour || 0,
        sports: a.currentTurf.sports || [],
        ownerName: a.name || 'Unknown'
      }));

      console.log(`Super admin requested turfs → found ${turfsData.length}`);
    } else {
      // Normal admin - own turf only
      const adminUser = await Admin.findById(req.admin.id);
      if (adminUser?.currentTurf) {
        const t = adminUser.currentTurf;
        turfsData = [{
          turfId: t.id,
          turfName: t.turfName,
          turfAddress: `${t.turfAddress}${t.turfAddressLine2 ? `, ${t.turfAddressLine2}` : ''}, ${t.district}, ${t.state}`,
          district: t.district,
          imageUrl: t.imageUrl || '',
          pricePerHour: t.pricePerHour || 0,
          sports: t.sports || [],
        }];
      }
    }

    return res.json({
      success: true,
      data: turfsData,
      total: turfsData.length
    });

  } catch (error) {
    console.error('Turfs fetch error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// FINAL CREATE TOURNAMENT WITH CLOUDINARY
router.post('/create-tournament', authenticateToken, async (req, res) => {
    console.log('=== CREATE TOURNAMENT CALLED ===');

    try {
        const {
            turfId, adminId, name, sport, registrationEndDate,
            tournamentStartDate, tournamentEndDate, entryFee, maxTeams,
            prizePool, description, posterImage
        } = req.body;

        if (adminId !== req.admin.id.toString()) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const adminUser = await Admin.findById(adminId);
        if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
            return res.status(404).json({ success: false, message: 'Turf not found' });
        }

        const tournamentId = `TOUR${Date.now()}`;
        let imageUrl = '';

        // Cloudinary Upload for Poster (Base64)
        if (posterImage && typeof posterImage === 'string' && posterImage.startsWith('data:image')) {
            try {
                const uploadResult = await cloudinary.uploader.upload(posterImage, {
                    folder: 'turf_app/tournaments',
                    transformation: [{ width: 800, height: 600, crop: 'limit' }]
                });
                imageUrl = uploadResult.secure_url;
                console.log('✅ Tournament poster uploaded to Cloudinary:', imageUrl);
            } catch (imgErr) {
                console.error('Cloudinary upload failed:', imgErr.message);
                imageUrl = ''; // fallback
            }
        }

        const newTournament = {
            tournamentId,
            name: name?.trim() || 'No Name',
            sport: (sport || 'CRICKET').trim().toUpperCase(),
            registrationEndDate: new Date(registrationEndDate),
            tournamentStartDate: new Date(tournamentStartDate),
            tournamentEndDate: new Date(tournamentEndDate),
            entryFee: parseInt(entryFee) || 0,
            maxTeams: parseInt(maxTeams) || 8,
            prizePool: parseFloat(prizePool) || 0,
            description: description?.trim() || '',
            imageUrl,   // ← Cloudinary URL
            registeredTeams: [],
            totalRegistered: 0,
            status: 'upcoming',
            createdAt: new Date()
        };

        await Admin.updateOne(
            { _id: adminId, 'currentTurf.id': turfId },
            { $push: { 'currentTurf.tournaments': newTournament } }
        );

        res.status(201).json({
            success: true,
            message: 'Tournament created successfully!',
            tournament: { tournamentId, name, imageUrl }
        });

    } catch (error) {
        console.error('Create tournament error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
// ——————————————————————————————————————
// PUBLIC: GET TOURNAMENTS - FIXED
// ——————————————————————————————————————
router.get('/tournaments/:turfId', async (req, res) => {
    try {
        const { turfId } = req.params;

        const adminUser = await Admin.findOne({ 'currentTurf.id': turfId }).lean();
        if (!adminUser || !adminUser.currentTurf) {
            return res.status(404).json({ success: false, message: 'Turf not found' });
        }

        const tournaments = (adminUser.currentTurf.tournaments || []).map(t => {
            const registeredCount = Array.isArray(t.registeredTeams) ? t.registeredTeams.length : 0;

            return {
                tournamentId: t.tournamentId,
                id: t.tournamentId,
                turfId: adminUser.currentTurf.id,
                name: t.name || 'Unnamed',
                sport: (t.sport || '').toUpperCase(),
                registrationEndDate: t.registrationEndDate ? t.registrationEndDate.toISOString() : null,
                tournamentStartDate: t.tournamentStartDate ? t.tournamentStartDate.toISOString() : null,
                tournamentEndDate: t.tournamentEndDate ? t.tournamentEndDate.toISOString() : null,
                entryFee: parseInt(t.entryFee) || 0,
                prizePool: parseFloat(t.prizePool) || 0,
                maxTeams: parseInt(t.maxTeams) || 16,
                registeredTeamsCount: registeredCount,
                registeredTeams: t.registeredTeams || [],
                venue: adminUser.currentTurf.turfName,
                imageUrl: t.imageUrl || null,          
                description: t.description || ''
            };
        });

        res.json({ success: true, data: tournaments });
    } catch (error) {
        console.error('Tournament fetch error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ——————————————————————————————————————
// ADMIN: GET REGISTERED TEAMS - FINAL 100% WORKING VERSION
// ——————————————————————————————————————
router.get('/admin/tournament/:tournamentId/teams', authenticateToken, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const adminId = req.admin.id;

    console.log(`[Teams Request] Admin: ${adminId} | Tournament: ${tournamentId}`);

    // Find the admin who owns this tournament
    const adminUser = await Admin.findOne({
      _id: adminId,
      'currentTurf.tournaments.tournamentId': tournamentId
    });

    if (!adminUser || !adminUser.currentTurf) {
      return res.status(404).json({ success: false, message: 'Turf or tournament not found' });
    }

    // Extract the exact tournament
    const tournament = adminUser.currentTurf.tournaments.find(
      t => t.tournamentId === tournamentId
    );

    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    // CRITICAL FIX: Use registeredTeams array directly from the tournament
    const teams = Array.isArray(tournament.registeredTeams) ? tournament.registeredTeams : [];

    // Format response properly
    const formattedTeams = teams.map(team => ({
      teamName: team.teamName || 'Unknown Team',
      captainName: team.captainName || 'Unknown',
      captainPhone: team.captainPhone || 'N/A',
      playerNames: Array.isArray(team.playerNames) ? team.playerNames : [],
      paymentId: team.paymentId || null,
      registeredAt: team.registeredAt || new Date(),
      userId: team.userId || null
    }));

    res.json({
      success: true,
      tournament: {
        tournamentId: tournament.tournamentId,
        name: tournament.name || 'Unnamed Tournament',
        sport: tournament.sport || 'CRICKET',
        maxTeams: tournament.maxTeams || 16,
        totalRegistered: teams.length,
        status: tournament.status || 'upcoming'
      },
      data: formattedTeams,
      count: teams.length
    });

  } catch (error) {
    console.error('Error fetching tournament teams:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// ——————————————————————————————————————
// ADMIN: GET REGISTERED TEAMS - FINAL WORKING
// ——————————————————————————————————————
router.get('/tournament/:tournamentId/teams', authenticateToken, async (req, res) => {
    try {
        const { tournamentId } = req.params;
        const adminId = req.admin.id;

        console.log(`Fetching teams | Admin: ${adminId} | Tournament: ${tournamentId}`);

        // Find admin with currentTurf containing this tournamentId
        const adminUser = await Admin.findOne({
            _id: adminId,
            'currentTurf.tournaments.tournamentId': tournamentId
        });

        if (!adminUser || !adminUser.currentTurf) {
            return res.status(404).json({ success: false, message: 'Turf or tournament not found' });
        }

        const tournament = adminUser.currentTurf.tournaments.find(
            t => t.tournamentId === tournamentId
        );

        if (!tournament) {
            return res.status(404).json({ success: false, message: 'Tournament not found' });
        }

        await client.connect();
        const db = client.db('goturf');
        const usersCollection = db.collection('users');

        const teamDocs = await usersCollection
            .find({ 'registeredTournaments.tournamentId': tournamentId })
            .toArray();

        const teams = teamDocs.map(doc => {
            const reg = doc.registeredTournaments.find(r => r.tournamentId === tournamentId);
            return {
                teamName: reg.teamName || 'Unknown',
                captainName: reg.captainName || 'Unknown',
                captainPhone: reg.captainPhone || 'N/A',
                playerNames: Array.isArray(reg.playerNames) ? reg.playerNames : [],
                registeredAt: reg.registeredAt || new Date(),
                paymentId: reg.paymentId || null,
                userName: doc.userName,
                userPhone: doc.phone
            };
        });

        res.json({
            success: true,
            tournament: {
                id: tournament.tournamentId,
                name: tournament.name,
                sport: tournament.sport,
                maxTeams: tournament.maxTeams,
                totalRegistered: teams.length
            },
            data: teams,
            count: teams.length
        });

    } catch (error) {
        console.error('Team fetch error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        await client.close();
    }
});
// ——————————————————————————————————————
// REGISTER TEAM - FINAL FIXED & SAFE VERSION
// ——————————————————————————————————————
router.post('/tournament/register', async (req, res) => {
  try {
    const { tournamentId, teamName, captainName, captainPhone, playerNames, paymentId, userId } = req.body;

    if (!tournamentId || !teamName || !captainName || !captainPhone || !paymentId) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Find the turf and tournament
    const adminUser = await Admin.findOne({ 'currentTurf.tournaments.tournamentId': tournamentId });
    if (!adminUser) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    const tournamentIndex = adminUser.currentTurf.tournaments.findIndex(
      t => t.tournamentId === tournamentId
    );

    if (tournamentIndex === -1) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }

    const tournament = adminUser.currentTurf.tournaments[tournamentIndex];

    if (tournament.status !== 'upcoming') {
      return res.status(400).json({ success: false, message: 'Registration closed' });
    }

    // Initialize arrays if needed
    if (!Array.isArray(tournament.registeredTeams)) {
      tournament.registeredTeams = [];
    }

    if (tournament.registeredTeams.length >= tournament.maxTeams) {
      return res.status(400).json({ success: false, message: 'Tournament is full' });
    }

    if (tournament.registeredTeams.some(t => t.teamName === teamName)) {
      return res.status(400).json({ success: false, message: 'Team name already taken' });
    }

    // PUSH NEW TEAM
    const newTeam = {
      teamName,
      captainName,
      captainPhone,
      playerNames: Array.isArray(playerNames) ? playerNames : [],
      paymentId,
      userId: userId || null,
      fcmToken: req.body.fcmToken || null,
      registeredAt: new Date()
    };

    tournament.registeredTeams.push(newTeam);
    tournament.totalRegistered = tournament.registeredTeams.length;

    // SAVE DIRECTLY USING $set AND POSITIONAL OPERATOR
    await Admin.updateOne(
      { 
        _id: adminUser._id,
        'currentTurf.tournaments.tournamentId': tournamentId 
      },
      { 
        $set: {
          'currentTurf.tournaments.$': tournament
        }
      }
    );

    // Also save to user's registeredTournaments
    await mongoose.connection.db.collection('users').updateOne(
      { phone: captainPhone },
      {
        $push: {
          registeredTournaments: {
            tournamentId,
            tournamentName: tournament.name,
            teamName,
            captainName,
            captainPhone,
            playerNames: Array.isArray(playerNames) ? playerNames : [],
            paymentId,
            registeredAt: new Date(),
            status: 'Confirmed'
          }
        }
      }
    );

    res.json({
      success: true,
      message: 'Team registered successfully!',
      totalRegistered: tournament.registeredTeams.length
    });

  } catch (error) {
    console.error('Tournament registration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// CLEAN EMPTY/INVALID TOURNAMENTS BEFORE EVERY SAVE — THIS FIXES THE ERROR
const cleanInvalidTournaments = (admin) => {
  if (admin.currentTurf && Array.isArray(admin.currentTurf.tournaments)) {
    admin.currentTurf.tournaments = admin.currentTurf.tournaments.filter(t =>
      t &&
      t.tournamentStartDate &&
      t.tournamentEndDate &&
      t.registrationEndDate
    );
  }
};

// HOLD SINGLE SLOT - FIXED & SAFE
router.post('/hold-slot', authenticateToken, async (req, res) => {
  try {
    const { turfId, date, slot, adminId, reason = 'Held by admin' } = req.body;

    if (!turfId || !date || !slot || !adminId) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (adminId !== req.admin.id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const adminUser = await Admin.findById(adminId);
    if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
      return res.status(404).json({ success: false, message: 'Turf not found' });
    }

    const turf = adminUser.currentTurf;

    const alreadyHeld = (turf.heldSlots || []).some(h => h.date === date && h.slot === slot) ||
                        (turf.heldDays || []).some(d => d.date === date);

    const isBooked = (turf.confirmedSlots || []).some(c => c.date === date && c.slot === slot);

    if (alreadyHeld) {
      return res.status(400).json({ success: false, message: 'Slot already held' });
    }

    if (isBooked) {
      return res.status(400).json({ success: false, message: 'Cannot hold: Slot already booked by user' });
    }

    turf.heldSlots = turf.heldSlots || [];
    turf.heldSlots.push({
      date,
      slot,
      reason,
      adminId,
      timestamp: new Date()
    });

    // THIS LINE SAVES YOUR LIFE
    cleanInvalidTournaments(adminUser);

    await adminUser.save();

    res.json({ success: true, message: 'Slot held successfully' });

  } catch (error) {
    console.error('Hold slot error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// HOLD FULL DAY - FIXED
router.post('/hold-day', authenticateToken, async (req, res) => {
  try {
    const { turfId, date, adminId, reason } = req.body;

    if (!turfId || !date || !adminId || !reason) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }

    if (adminId !== req.admin.id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const adminUser = await Admin.findById(adminId);
    if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
      return res.status(404).json({ success: false, message: 'Turf not found' });
    }

    const turf = adminUser.currentTurf;

    const alreadyHeld = (turf.heldDays || []).some(d => d.date === date);
    if (alreadyHeld) {
      return res.status(400).json({ success: false, message: 'Day already held' });
    }

    const hasBookings = (turf.confirmedSlots || []).some(c => c.date === date);
    if (hasBookings) {
      return res.status(400).json({ success: false, message: 'Cannot hold full day: Some slots are booked' });
    }

    turf.heldDays = turf.heldDays || [];
    turf.heldDays.push({
      date,
      reason,
      adminId,
      timestamp: new Date()
    });

    cleanInvalidTournaments(adminUser);
    await adminUser.save();

    res.json({ success: true, message: 'Full day held successfully' });

  } catch (error) {
    console.error('Hold day error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// UNHOLD SLOT - FIXED
router.delete('/hold-slot', authenticateToken, async (req, res) => {
  try {
    const { turfId, date, slot, adminId } = req.body;

    if (!turfId || !date || !slot || !adminId) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    if (adminId !== req.admin.id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const adminUser = await Admin.findById(adminId);
    if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
      return res.status(404).json({ success: false, message: 'Turf not found' });
    }

    const initialCount = adminUser.currentTurf.heldSlots?.length || 0;

    adminUser.currentTurf.heldSlots = (adminUser.currentTurf.heldSlots || []).filter(
      h => !(h.date === date && h.slot === slot)
    );

    cleanInvalidTournaments(adminUser);
    await adminUser.save();

    if (adminUser.currentTurf.heldSlots.length === initialCount) {
      return res.status(404).json({ success: false, message: 'Slot was not held' });
    }

    res.json({ success: true, message: 'Slot released successfully' });

  } catch (error) {
    console.error('Unhold slot error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// UNHOLD FULL DAY - FIXED
router.delete('/hold-day', authenticateToken, async (req, res) => {
  try {
    const { turfId, date, adminId } = req.body;

    if (!turfId || !date || !adminId) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    if (adminId !== req.admin.id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const adminUser = await Admin.findById(adminId);
    if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
      return res.status(404).json({ success: false, message: 'Turf not found' });
    }

    const initialCount = adminUser.currentTurf.heldDays?.length || 0;

    adminUser.currentTurf.heldDays = (adminUser.currentTurf.heldDays || []).filter(
      h => h.date !== date
    );

    cleanInvalidTournaments(adminUser);
    await adminUser.save();

    if (adminUser.currentTurf.heldDays.length === initialCount) {
      return res.status(404).json({ success: false, message: 'Day was not held' });
    }

    res.json({ success: true, message: 'Full day released successfully' });

  } catch (error) {
    console.error('Unhold day error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.get('/public/turf/:turfId/held-slots', async (req, res) => {
    try {
        const { turfId } = req.params;
        const adminUser = await Admin.findOne({ 'currentTurf.id': turfId });
        if (!adminUser || !adminUser.currentTurf) return res.status(404).json({ success: false, message: 'Turf not found' });
        res.json({ success: true, heldSlots: adminUser.currentTurf.heldSlots || [], heldDays: adminUser.currentTurf.heldDays || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ——————————————————————————————————————
// BOOKED CUSTOMERS — FINAL SMART VERSION (Handles Both Formats)
// ——————————————————————————————————————
router.get('/booked-users/:turfId', authenticateToken, async (req, res) => {
  try {
    const { turfId } = req.params;

    const isSuperAdmin = req.admin.role === 'super_admin' || req.isSuperAdmin === true;

    let users;
    if (isSuperAdmin) {
      users = await User.find({
        'upcomingBookings.turfId': turfId,
        'upcomingBookings.status': { $in: ['confirmed', 'completed'] }
      })
      .select('userName phone upcomingBookings')
      .lean();
    } else {
      const adminId = req.admin.id;
      const adminUser = await Admin.findById(adminId);
      if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }
      users = await User.find({
        'upcomingBookings.turfId': turfId,
        'upcomingBookings.status': { $in: ['confirmed', 'completed'] }
      })
      .select('userName phone upcomingBookings')
      .lean();
    }

    const bookings = [];
    users.forEach(user => {
      user.upcomingBookings
        .filter(b => b.turfId === turfId)
        .forEach(booking => {
          // Smart date extraction: top-level date OR from slots array
          let playDate = booking.date;
          if (!playDate && Array.isArray(booking.slots) && booking.slots.length > 0) {
            playDate = booking.slots[0].date || booking.slots[0]; // fallback if slot is string
          }

          const bookedOn = booking.bookedAt 
            ? new Date(booking.bookedAt).toISOString().split('T')[0] 
            : 'Unknown';

          bookings.push({
            bookingId: booking.bookingId,
            userName: user.userName,
            userPhone: user.phone,
            sport: booking.sport?.toUpperCase() || 'CRICKET',
            totalAmount: booking.totalAmount || 0,
            paidAmount: booking.paidAmount || 0,
            balanceAmount: (booking.totalAmount || 0) - (booking.paidAmount || 0),
            isAdvance: booking.isAdvance || false,
            advanceAmount: booking.advanceAmount || 0,
            paymentStatus: booking.paymentStatus || 'pending',
            status: booking.status || 'confirmed',
            slots: booking.slots || [],
            playingDate: playDate || 'Not Available',     // ← Now works for both formats!
            bookedOn: bookedOn,
          });
        });
    });

    bookings.sort((a, b) => new Date(b.bookedOn) - new Date(a.bookedOn));

    res.json({
      success: true,
      count: bookings.length,
      data: bookings
    });

  } catch (error) {
    console.error('Booked users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.get('/bookings/:turfId', authenticateToken, async (req, res) => {
    try {
        const { turfId } = req.params;
        const adminId = req.admin.id;

        const adminUser = await Admin.findById(adminId);
        if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        await client.connect();
        const db = client.db('goturf');
        const usersCollection = db.collection('users');

        const bookings = await usersCollection
            .aggregate([
                { $unwind: '$upcomingBookings' },
                {
                    $match: {
                        'upcomingBookings.turfId': turfId,
                        'upcomingBookings.status': { $regex: '^(confirmed|pending)$', $options: 'i' }
                    }
                },
                {
                    $project: {
                        _id: '$upcomingBookings._id',
                        turfId: '$upcomingBookings.turfId',
                        userId: '$_id',
                        userName: '$userName',
                        date: '$upcomingBookings.date',
                        slot: '$upcomingBookings.time',
                        status: '$upcomingBookings.status',
                        orderId: '$upcomingBookings.orderId',
                        price: '$upcomingBookings.price',
                        createdAt: '$upcomingBookings.createdAt',
                        paymentId: '$upcomingBookings.paymentId'
                    }
                }
            ])
            .toArray();

        

        res.json({ success: true, data: bookings });
    } catch (error) {
        console.error('Bookings fetch error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        await client.close();
    }
});

// ——————————————————————————————————————
// TURF GALLERY — FULL CLOUDINARY VERSION
// ——————————————————————————————————————

// Middleware: Verify admin owns the turf
const verifyTurfOwner = async (req, res, next) => {
  try {
    const adminId = req.admin.id;
    const { turfId } = req.params;

    const adminUser = await Admin.findById(adminId);
    if (!adminUser || !adminUser.currentTurf || adminUser.currentTurf.id !== turfId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    req.turf = adminUser.currentTurf;
    next();
  } catch (err) {
    console.error('verifyTurfOwner error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 1. ADMIN: GET GALLERY IMAGES - FIXED
router.get('/turf/:turfId/gallery', authenticateToken, verifyTurfOwner, async (req, res) => {
  try {
    const adminUser = await Admin.findById(req.admin.id);
    
    if (!adminUser || !adminUser.currentTurf) {
      return res.status(404).json({ success: false, message: 'Turf not found' });
    }

    const gallery = adminUser.currentTurf.gallery || [];
    
    console.log(`📸 Returning ${gallery.length} gallery images for turf ${req.params.turfId}`);

    res.json({ 
      success: true, 
      data: gallery 
    });
  } catch (error) {
    console.error('Gallery fetch error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GALLERY COUNT ROUTE - CLOUDINARY VERSION
router.get('/turf/:turfId/gallery/count', authenticateToken, verifyTurfOwner, async (req, res) => {
  try {
    const adminUser = await Admin.findById(req.admin.id);
    const gallery = adminUser?.currentTurf?.gallery || [];
    
    res.json({
      success: true,
      data: {
        images: gallery.length,
        videos: 0
      }
    });
  } catch (error) {
    console.error('Gallery count error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// 2. ADMIN: UPLOAD GALLERY IMAGE TO CLOUDINARY - FIXED & DEBUGGED
router.post('/turf/:turfId/gallery/upload', authenticateToken, verifyTurfOwner, upload.single('image'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }

    const adminUser = await Admin.findById(req.admin.id);
    if (!adminUser?.currentTurf) {
      return res.status(404).json({ success: false, message: 'Turf not found' });
    }

    const imageUrl = req.file.path;

    if (!adminUser.currentTurf.gallery) {
      adminUser.currentTurf.gallery = [];
    }

    adminUser.currentTurf.gallery.push({
      url: imageUrl,
      type: 'image',
      uploadedAt: new Date()
    });

    await adminUser.save();

    console.log(`✅ Gallery image saved successfully. Total images now: ${adminUser.currentTurf.gallery.length}`);

    res.json({
      success: true,
      message: 'Gallery image uploaded successfully!',
      data: { url: imageUrl }
    });

  } catch (error) {
    console.error('Gallery upload error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 3. ADMIN: DELETE GALLERY IMAGE
router.delete('/turf/:turfId/gallery', authenticateToken, verifyTurfOwner, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ success: false, message: 'imageUrl required' });

    const adminUser = await Admin.findById(req.admin.id);
    if (!adminUser?.currentTurf?.gallery) {
      return res.status(404).json({ success: false, message: 'Gallery not found' });
    }

    adminUser.currentTurf.gallery = adminUser.currentTurf.gallery.filter(img => img.url !== imageUrl);

    await adminUser.save();

    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Gallery delete error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 4. PUBLIC: GET GALLERY (User App-க்கு)
router.get('/public/turf/:turfId/gallery', async (req, res) => {
  try {
    const { turfId } = req.params;
    const adminUser = await Admin.findOne({ 'currentTurf.id': turfId });
    
    const gallery = adminUser?.currentTurf?.gallery || [];
    
    res.json({ success: true, data: gallery });
  } catch (error) {
    console.error('Public gallery error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// === TOURNAMENT REGISTRATION REMINDERS (ONLY REGISTERED USERS - INDIVIDUAL FCM TOKENS) ===
cron.schedule('*/30 * * * *', async () => {  // Every 30 minutes
    try {
        const now = new Date();
        console.log(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] ⏰ Running tournament registration reminder (registered users only)...`);

        const reminders = [
            { hours: 1,  text: '1 hour' },
            { hours: 6,  text: '6 hours' },
            { hours: 24, text: '24 hours' }
        ];

        const admins = await Admin.find({ 'currentTurf.tournaments': { $exists: true } }).lean();

        let totalSent = 0;

        for (const admin of admins) {
            if (!admin.currentTurf || !Array.isArray(admin.currentTurf.tournaments)) continue;

            for (const tournament of admin.currentTurf.tournaments) {
                if (tournament.status !== 'upcoming') continue;

                const endDate = new Date(tournament.registrationEndDate);
                if (isNaN(endDate.getTime())) continue;

                // Skip if no registered teams
                if (!Array.isArray(tournament.registeredTeams) || tournament.registeredTeams.length === 0) continue;

                for (const r of reminders) {
                    const reminderTime = new Date(endDate.getTime() - r.hours * 60 * 60 * 1000);
                    const diffMins = Math.abs((now - reminderTime) / (1000 * 60));

                    if (diffMins <= 30) {
                        // Send individual notification to each registered team
                        for (const team of tournament.registeredTeams) {
                            if (team.fcmToken) {
                                const message = {
                                    notification: {
                                        title: `⏰ ${r.text} left to register!`,
                                        body: `${tournament.name} registration closing soon at ${admin.currentTurf.turfName}! ⚡`,
                                    },
                                    data: {
                                        type: 'tournament_registration_reminder',
                                        tournamentId: tournament.tournamentId,
                                        turfId: admin.currentTurf.id,
                                        hoursLeft: r.hours.toString()
                                    },
                                    token: team.fcmToken
                                };

                                try {
                                    await admin.messaging().send(message);
                                    totalSent++;
                                    console.log(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] Reminder sent to ${team.teamName} for "${tournament.name}"`);
                                } catch (err) {
                                    console.error(`FCM failed for token ${team.fcmToken}:`, err.message);
                                }
                            }
                        }
                    }
                }
            }
        }

        if (totalSent > 0) {
            console.log(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] ✅ Sent ${totalSent} individual tournament registration reminders`);
        }

    } catch (error) {
        console.error(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] ❌ Tournament reminder cron error:`, error.message);
    }
});
// SUPER ADMIN LOGIN ROUTE (DATABASE BASED - SECURE)
router.post('/super-admin-login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find super admin (email or phone)
    const superAdmin = await Admin.findOne({
      $or: [{ email: email?.trim().toLowerCase() }, { phone: email?.trim() }],
      isSuperAdmin: true
    });

    if (!superAdmin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, superAdmin.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: superAdmin._id, role: 'super_admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    const refreshToken = jwt.sign(
      { id: superAdmin._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      message: 'Super Admin Login Successful',
      token,
      refreshToken
    });

  } catch (error) {
    console.error('Super admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});
// SUPER ADMIN BYPASS MIDDLEWARE
const allowSuperAdmin = async (req, res, next) => {
  try {
    if (req.admin && req.admin.role === 'super_admin') {
      req.isSuperAdmin = true;
      return next();
    }
    next();
  } catch (error) {
    next();
  }
};

// Apply this middleware before all admin routes
router.use(allowSuperAdmin);


// MODIFY /turfs ROUTE - Super admin sees all
router.get('/turfs', authenticateToken, async (req, res) => {
  try {
    if (req.isSuperAdmin) {
      const admins = await Admin.find({ 'currentTurf.id': { $exists: true, $ne: null } })
        .select('name currentTurf')
        .lean();

      const turfs = admins.map(a => ({
        turfId: a.currentTurf.id,
        turfName: a.currentTurf.turfName,
        turfAddress: `${a.currentTurf.turfAddress}${a.currentTurf.turfAddressLine2 ? `, ${a.currentTurf.turfAddressLine2}` : ''}, ${a.currentTurf.district}, ${a.currentTurf.state}`,
        district: a.currentTurf.district,
        imageUrl: a.currentTurf.imageUrl || '',
        pricePerHour: a.currentTurf.pricePerHour || 0,
        sports: a.currentTurf.sports || [],
      }));

      return res.json({ success: true, data: turfs });
    }

    // Normal admin - only their turf
    const adminUser = await Admin.findById(req.admin.id);
    if (!adminUser || !adminUser.currentTurf) {
      return res.status(404).json({ success: false, message: 'No turf found' });
    }

    res.json({
      success: true,
      data: [{
        turfId: adminUser.currentTurf.id,
        turfName: adminUser.currentTurf.turfName,
        turfAddress: `${adminUser.currentTurf.turfAddress}${adminUser.currentTurf.turfAddressLine2 ? `, ${adminUser.currentTurf.turfAddressLine2}` : ''}, ${adminUser.currentTurf.district}, ${adminUser.currentTurf.state}`,
        district: adminUser.currentTurf.district,
        imageUrl: adminUser.currentTurf.imageUrl || '',
        pricePerHour: adminUser.currentTurf.pricePerHour || 0,
        sports: adminUser.currentTurf.sports || [],
      }]
    });
  } catch (error) {
    console.error('Turfs fetch error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET ALL TURFS - PUBLIC (Dynamic Host)
router.get('/public/turfs', async (req, res) => {
  try {
    const admins = await Admin.find({ 
      'currentTurf.id': { $exists: true, $ne: null } 
    }).select('currentTurf').lean();

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const turfs = admins.map(a => {
      const t = a.currentTurf || {};
      return {
        turfId: t.id,
        turfName: t.turfName,
        turfAddress: `${t.turfAddress || ''}, ${t.district || ''}, ${t.state || ''}`.trim(),
        district: t.district,
        sports: Array.isArray(t.sports) ? t.sports : [],
        pricePerHour: t.pricePerHour || 0,
        imageUrl: t.imageUrl ? `${baseUrl}${t.imageUrl}` : null,   // ← Dynamic URL
        hasLighting: t.hasLighting || false,
        hasWashroom: t.hasWashroom || false,
        hasParking: t.hasParking || false,
        hasDrinkingFacilities: t.hasDrinkingFacilities || false,
      };
    });

    res.json({ 
      success: true, 
      data: turfs,
      total: turfs.length 
    });
  } catch (error) {
    console.error('Public turfs error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;