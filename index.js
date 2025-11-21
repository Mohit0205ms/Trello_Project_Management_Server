const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./src/routes/auth')
const boardRoutes = require('./src/routes/board');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'));

app.get("/", (req, res) => {
  res.json({ message: "Hello from /" });
});
app.use('/api/auth', authRoutes.router);
app.use('/api/boards', boardRoutes);
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
