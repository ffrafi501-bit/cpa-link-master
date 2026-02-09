const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user' }, // 'admin' or 'user'
    plan: { type: String, default: 'free' }, // 'free' or 'premium'
    isApproved: { type: Boolean, default: false }, // Admin approval status
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);