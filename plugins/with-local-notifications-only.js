const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Personal Apple development teams cannot provision the APNs capability.
 * This app only schedules notifications locally, so remove the remote-push
 * entitlement that expo-notifications adds by default on iOS.
 */
module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (configWithEntitlements) => {
    delete configWithEntitlements.modResults['aps-environment'];
    return configWithEntitlements;
  });
};
