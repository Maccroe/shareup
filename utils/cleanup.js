const cron = require('node-cron');
const User = require('../models/User');
const Room = require('../models/Room');
const { deleteFromCloudinary } = require('../config/cloudinary');

// Configuration
const DEACTIVATION_PERIOD_DAYS = 90; // Delete accounts deactivated for 90 days
const CLEANUP_SCHEDULE = '0 2 * * *'; // Run daily at 2 AM
const CLEANUP_CHECK_INTERVAL = 3600000; // Check every hour (for development/testing)

let cleanupTask = null;
let isCleanupRunning = false;

/**
 * Initialize the auto-cleanup service
 * @param {Object} logger - Logger instance from server
 */
function initializeCleanupService(logger) {
  logger.essential('⏰ Initializing auto-cleanup service...');

  // Schedule the cleanup job to run daily at 2 AM
  cleanupTask = cron.schedule(CLEANUP_SCHEDULE, async () => {
    await runCleanup(logger);
  });

  logger.essential(`✅ Auto-cleanup service initialized. Schedule: ${CLEANUP_SCHEDULE}`);
  logger.info(`ℹ️  Accounts deactivated for ${DEACTIVATION_PERIOD_DAYS}+ days will be permanently deleted`);
}

/**
 * Run the cleanup process
 * @param {Object} logger - Logger instance
 */
async function runCleanup(logger) {
  if (isCleanupRunning) {
    logger.warn('⚠️  Cleanup already running, skipping this cycle');
    return;
  }

  isCleanupRunning = true;
  const startTime = Date.now();

  try {
    logger.essential('🧹 Starting account cleanup process...');

    // Calculate cutoff date (90 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DEACTIVATION_PERIOD_DAYS);

    logger.info(`📅 Cleanup cutoff date: ${cutoffDate.toISOString()}`);

    // Find all deactivated accounts that haven't been reactivated
    const deactivatedUsers = await User.find({
      isActive: false,
      deactivatedAt: { $lt: cutoffDate }
    });

    logger.info(`📊 Found ${deactivatedUsers.length} accounts eligible for cleanup`);

    if (deactivatedUsers.length === 0) {
      logger.info('✅ No accounts to clean up');
      isCleanupRunning = false;
      return;
    }

    let deletedCount = 0;
    let failureCount = 0;
    const deletedUserIds = [];

    // Process each deactivated user
    for (const user of deactivatedUsers) {
      try {
        logger.info(`🗑️  Cleaning up user: ${user.username} (ID: ${user._id})`);

        // Delete user's avatar from Cloudinary if it exists
        if (user.avatarPublicId) {
          try {
            await deleteFromCloudinary(user.avatarPublicId);
            logger.info(`  ✓ Deleted avatar from Cloudinary`);
          } catch (cloudinaryError) {
            logger.warn(`  ⚠️  Could not delete avatar from Cloudinary: ${cloudinaryError.message}`);
          }
        }

        // Delete user's rooms
        const roomDeleteResult = await Room.deleteMany({
          creator: user._id
        });
        logger.info(`  ✓ Deleted ${roomDeleteResult.deletedCount} rooms created by user`);

        // Remove user from participant list in other rooms
        await Room.updateMany(
          { 'participants.user': user._id },
          { $pull: { participants: { user: user._id } } }
        );
        logger.info(`  ✓ Removed user from participant lists`);

        // Delete the user account
        await User.deleteOne({ _id: user._id });
        logger.info(`  ✓ Deleted user account`);

        deletedUserIds.push(user._id);
        deletedCount++;

      } catch (userError) {
        logger.error(`  ❌ Error cleaning up user ${user.username}: ${userError.message}`);
        failureCount++;
      }
    }

    // Log cleanup summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.essential(`✅ Cleanup completed in ${duration}s`);
    logger.essential(`📊 Summary: ${deletedCount} accounts deleted, ${failureCount} failures`);

    if (deletedCount > 0) {
      logger.info(`🎯 Deleted user IDs: ${deletedUserIds.join(', ')}`);
    }

  } catch (error) {
    logger.error(`❌ Cleanup process failed: ${error.message}`);
    logger.error(error.stack);
  } finally {
    isCleanupRunning = false;
  }
}

/**
 * Stop the cleanup service
 * @param {Object} logger - Logger instance
 */
function stopCleanupService(logger) {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
    logger.info('✅ Cleanup service stopped');
  }
}

/**
 * Manually trigger cleanup (for testing)
 * @param {Object} logger - Logger instance
 */
async function triggerCleanupManually(logger) {
  logger.essential('🔧 Manually triggering cleanup...');
  await runCleanup(logger);
}

/**
 * Get cleanup status
 * @returns {Object} Cleanup status information
 */
function getCleanupStatus() {
  return {
    isRunning: isCleanupRunning,
    schedule: CLEANUP_SCHEDULE,
    deactivationPeriodDays: DEACTIVATION_PERIOD_DAYS,
    lastRun: null // Can be enhanced to track last run time
  };
}

module.exports = {
  initializeCleanupService,
  stopCleanupService,
  runCleanup,
  triggerCleanupManually,
  getCleanupStatus
};
