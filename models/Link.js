const mongoose = require('mongoose');

const LinkSchema = new mongoose.Schema({
    originalUrl: { type: String, required: true },
    shortCode: { type: String, required: true },
    owner: { type: String, required: true }, // Username of the creator
    clicks: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Link', LinkSchema);