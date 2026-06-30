const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://siddhant310507_db_user:s1ddhant@cluster0.oyiycro.mongodb.net/')
  .then(() => {
    console.log('Connected successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('Connection error:', err);
    process.exit(1);
  });
