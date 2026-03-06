const appJson = require('./app.json');

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  '';

module.exports = () => {
  const expo = appJson.expo || {};
  const android = expo.android || {};

  return {
    ...expo,
    android: {
      ...android,
      config: {
        ...(android.config || {}),
        googleMaps: {
          ...((android.config && android.config.googleMaps) || {}),
          apiKey: googleMapsApiKey,
        },
      },
    },
  };
};
