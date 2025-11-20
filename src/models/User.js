const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // boards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Board' }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
