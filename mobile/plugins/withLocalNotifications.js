const { withEntitlementsPlist } = require("expo/config-plugins");

/**
 * Timer alerts are scheduled locally; the app never registers an APNs token.
 * expo-notifications adds the remote-push entitlement by default, which would
 * require a different signing profile even though no remote push is used.
 * Register this before expo-notifications: entitlement mods are nested, so
 * this cleanup runs after that plugin adds its default. Native APIs still link.
 */
module.exports = function withLocalNotifications(config) {
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });
};
