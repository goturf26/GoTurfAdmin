const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const turfSchema = new mongoose.Schema({
  id: {
    type: String,
    required: [true, 'Turf ID is required'],
    unique: true,
    sparse: true,
  },
  turfName: {
    type: String,
    required: [true, 'Turf name is required'],
  },
  state: {
    type: String,
    required: [true, 'State is required'],
  },
  district: {
    type: String,
    required: [true, 'District is required'],
  },
  contactNumber: {
    type: String,
    match: [/^\+?1?\d{10,15}$/, 'Invalid phone number'],
  },
  turfAddress: {
    type: String,
    required: [true, 'Turf address is required'],
  },
  turfAddressLine2: String,
  landmark: String,
  gpsCoordinates: String,
  sports: {
    type: [String],
    required: [true, 'At least one sport is required'],
  },
  playingSurface: String,
  pricePerHour: {
    type: Number,
    required: [true, 'Price per hour is required'],
    min: [100, 'Price must be at least 100 INR'],
  },
  hasLighting: {
    type: Boolean,
    default: false,
  },
  hasWashroom: {
    type: Boolean,
    default: false,
  },
  hasParking: {
    type: Boolean,
    default: false,
  },
  hasDrinkingFacilities: {
    type: Boolean,
    default: false,
  },
  gstin: {
    type: String,
    required: [true, 'GSTIN is required'],
    match: [/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/, 'Invalid GSTIN format'],
  },
  license: {
    type: String,
    required: [true, 'License is required'],
    match: [/^IN-GOV/, 'License must start with IN-GOV'],
  },
  imageUrl: String,

  gallery: {
    type: [{
      url: { type: String, required: true },
      type: { type: String, default: 'image' },
      uploadedAt: { type: Date, default: Date.now }
    }],
    default: []
  },




  // Operational Time Fields
  operationStartTime: {
    type: String,
    default: '12:00 AM',
  },
  operationEndTime: {
    type: String,
    default: '12:00 AM',
  },

  heldSlots: {
    type: [{
      date: String,
      slot: String,
      reason: String,
      adminId: String,
      timestamp: { type: Date, default: Date.now },
    }],
    default: [],
  },
  heldDays: {
    type: [{
      date: String,
      reason: String,
      adminId: String,
      timestamp: { type: Date, default: Date.now },
    }],
    default: [],
  },

  // === FIXED TOURNAMENTS ARRAY ===
  tournaments: {
    type: [{
      tournamentId: {
        type: String,
        required: true,
   
      },
      name: {
        type: String,
        required: true,
        trim: true,
      },
      sport: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        match: [/^[A-Z\s]+$/, 'Sport name must contain only letters and spaces'],
      },
      registrationEndDate: {
        type: Date,
        required: true,
      },
      tournamentStartDate: {
        type: Date,
        required: true,
      },
      tournamentEndDate: {
        type: Date,
        required: true,
      },
      entryFee: {
        type: Number,
        required: true,
        min: [0, 'Entry fee cannot be negative'],
      },
      maxTeams: {
        type: Number,
        required: true,
        min: [2, 'At least 2 teams are required'],
        max: [64, 'Maximum 64 teams allowed'],
      },
      prizePool: {
        type: Number,
        default: 0,
      },
      description: {
        type: String,
        trim: true,
        default: '',
      },
      imageUrl: {
        type: String,
        default: '',
      },
      registeredTeams: {
        type: [{
          teamName: { type: String, required: true },
          captainName: { type: String, required: true },
          captainPhone: { type: String, required: true },
          playerNames: { type: [String], default: [] },
          userId: { type: String },
          fcmToken: { type: String, default: null },
          paymentId: { type: String },
          registeredAt: { type: Date, default: Date.now },
        }],
        default: [],
      },
      totalRegistered: {
        type: Number,
        default: 0,
      },
      status: {
        type: String,
        enum: ['upcoming', 'ongoing', 'completed', 'cancelled'],
        default: 'upcoming',
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    }],
    default: [],
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Admin Schema - currentTurf is now properly optional
const adminSchema = new mongoose.Schema({
  name: {
  type: String,
  required: [true, 'Name is required'],
  trim: true,
  minlength: [2, 'Name must be at least 2 characters'],
  maxlength: [50, 'Name cannot exceed 50 characters'],
  validate: {
    validator: function(v) {
      return /^[a-zA-Z0-9\s._@#&-]+$/.test(v);
    },
    message: props => 
      `Name can only contain letters, numbers and these symbols: . _ @ # & -`
  }
},
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    match: [/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian phone number'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    match: [/^[a-zA-Z0-9._%+-]+@gmail\.com$/, 'Email must end with @gmail.com'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
  },
  role: {
    type: String,
    enum: ['admin'],
    default: 'admin',
  },
  bankDetails: {
    bankName: {
      type: String,
      match: [/^[a-zA-Z\s]+$/, 'Bank name must contain only alphabets'],
    },
    branch: String,
    bankFirstName: String,
    bankLastName: String,
    address: String,
    city: String,
    region: String,
    accountNumber: {
      type: String,
      match: [/^\d{9,18}$/, 'Account number must be 9-18 digits'],
    },
    ifscCode: {
      type: String,
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code format'],
    },
    zipCode: {
      type: String,
      match: [/^\d{5,6}$/, 'ZIP code must be 5-6 digits'],
    },
    accountType: String,
    upiId: String,
  },
  currentTurf: {
    type: turfSchema,
    default: null,  // Explicitly allow null (no turf yet)
  },
  refreshToken: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Hash password before saving (pre-save middleware)
adminSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    // 🚨 CRITICAL FIX APPLIED HERE:
    // This logic checks if the password being saved is a raw password (not a hash)
    // by checking if it starts with the bcrypt identifier ($2b).
    // If it's already a hash (which it will be on initial signup via the router),
    // it skips hashing again.
    if (this.password && this.password.startsWith('$2b$')) {
        // Skip hashing if it appears to be an already-hashed value
        return next();
    }
    
    // Hash the password if it's a plain string
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// JWT Token Methods
adminSchema.methods.generateAuthToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, { expiresIn: '1hr' });
};

adminSchema.methods.generateRefreshToken = function () {
  return jwt.sign({ id: this._id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '90d' });
};

// Update Turf Method
adminSchema.methods.updateCurrentTurf = async function (updates) {
  try {
    const allowedUpdates = [
      'pricePerHour',
      'playingSurface',
      'sports',
      'hasLighting',
      'hasWashroom',
      'hasParking',
      'hasDrinkingFacilities',
      'operationStartTime',
      'operationEndTime',
    ];

    const updateData = {};

    allowedUpdates.forEach((field) => {
      if (updates[field] !== undefined) {
        if (['hasLighting', 'hasWashroom', 'hasParking', 'hasDrinkingFacilities'].includes(field)) {
          updateData[field] = updates[field] === 'true' ? true : updates[field] === 'false' ? false : Boolean(updates[field]);
        } else {
          updateData[field] = updates[field];
        }
      }
    });

    Object.assign(this.currentTurf, updateData);
    await this.save({ validateModifiedOnly: true });

    return {
      success: true,
      message: 'Turf details updated successfully',
      data: this.currentTurf,
    };
  } catch (error) {
    console.error('Error updating turf:', error);
    return { success: false, message: error.message };
  }
};

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;