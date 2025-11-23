// Timezone helper utility for debugging and testing
class TimezoneHelper {
  static getSupportedTimezones() {
    return [
      'UTC',
      'America/New_York',      // Eastern Time
      'America/Chicago',       // Central Time
      'America/Denver',        // Mountain Time
      'America/Los_Angeles',   // Pacific Time
      'Europe/London',         // GMT/BST
      'Europe/Paris',          // CET/CEST
      'Europe/Berlin',         // CET/CEST
      'Asia/Tokyo',           // Japan Standard Time
      'Asia/Shanghai',        // China Standard Time
      'Asia/Kolkata',         // India Standard Time
      'Australia/Sydney',     // Australian Eastern Time
      'Australia/Perth'       // Australian Western Time
    ];
  }

  static formatTimeInTimezone(date, timezone) {
    try {
      const options = {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      };
      return date.toLocaleString('en-US', options);
    } catch (error) {
      console.error(`Invalid timezone: ${timezone}`, error);
      return date.toISOString();
    }
  }

  static getNextMidnight(timezone = 'UTC') {
    const now = new Date();

    try {
      // Create timezone-aware date for midnight calculation
      const options = { timeZone: timezone };
      const nowInTimezone = new Date(now.toLocaleString('en-US', options));
      const utcOffset = now.getTime() - nowInTimezone.getTime();

      // Calculate next midnight in the specified timezone
      const tomorrow = new Date(nowInTimezone);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      // Convert back to UTC for consistent calculation
      const tomorrowUTC = new Date(tomorrow.getTime() + utcOffset);

      return {
        utcTime: tomorrowUTC,
        localTime: tomorrow,
        timezone: timezone,
        msUntilReset: tomorrowUTC.getTime() - now.getTime()
      };
    } catch (error) {
      console.error(`Error calculating midnight for timezone ${timezone}:`, error);
      // Fallback to UTC
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      return {
        utcTime: tomorrow,
        localTime: tomorrow,
        timezone: 'UTC',
        msUntilReset: tomorrow.getTime() - now.getTime()
      };
    }
  }

  static validateTimezone(timezone) {
    try {
      // Try to format a date with the timezone
      new Date().toLocaleString('en-US', { timeZone: timezone });
      return true;
    } catch (error) {
      return false;
    }
  }

  static getTimezoneInfo(timezone = 'UTC') {
    const now = new Date();

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'long'
      });

      const parts = formatter.formatToParts(now);
      const timeZoneName = parts.find(part => part.type === 'timeZoneName')?.value || timezone;

      return {
        timezone,
        timeZoneName,
        currentTime: this.formatTimeInTimezone(now, timezone),
        isValid: this.validateTimezone(timezone)
      };
    } catch (error) {
      return {
        timezone,
        timeZoneName: 'Unknown',
        currentTime: now.toISOString(),
        isValid: false
      };
    }
  }
}

module.exports = TimezoneHelper;