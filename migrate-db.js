const mongoose = require('mongoose');
require('dotenv').config();

async function fixDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get the users collection
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    console.log('Checking for existing clerkId index...');

    // Get all indexes
    const indexes = await usersCollection.indexes();
    console.log('Existing indexes:', indexes.map(idx => idx.name));

    // Find and drop the clerkId index if it exists
    const clerkIdIndex = indexes.find(idx => idx.name === 'clerkId_1');
    if (clerkIdIndex) {
      console.log('Dropping clerkId_1 index...');
      await usersCollection.dropIndex('clerkId_1');
      console.log('clerkId_1 index dropped successfully');
    } else {
      console.log('No clerkId_1 index found');
    }

    // Check if there are any documents with clerkId field
    const docsWithClerkId = await usersCollection.countDocuments({ clerkId: { $exists: true } });
    console.log(`Documents with clerkId field: ${docsWithClerkId}`);

    if (docsWithClerkId > 0) {
      console.log('Removing clerkId field from existing documents...');
      const result = await usersCollection.updateMany(
        { clerkId: { $exists: true } },
        { $unset: { clerkId: 1 } }
      );
      console.log(`Updated ${result.modifiedCount} documents`);
    }

    // Verify collection state
    const totalDocs = await usersCollection.countDocuments();
    console.log(`Total documents in users collection: ${totalDocs}`);

    // Show remaining indexes
    const finalIndexes = await usersCollection.indexes();
    console.log('Final indexes:', finalIndexes.map(idx => idx.name));

    console.log('\nDatabase migration completed successfully!');
    console.log('You can now register users without clerkId conflicts.');

  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the migration
fixDatabase();