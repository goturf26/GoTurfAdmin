// admin-backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({}, { strict: false }); // we only need to read access
module.exports = mongoose.model('User', userSchema, 'users'); // force collection name