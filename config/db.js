const mongoose = require('mongoose');

const connectDB = async () => {
  console.log('Attempting to connect to:', process.env.MONGODB_URI);

  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log('✅ MongoDB Connected');

    const adminDb = mongoose.connection.db.admin();
    const info = await adminDb.command({ hello: 1 });

  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;