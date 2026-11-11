// Settings that change per build. app.json holds everything else.
//   EXPO_BASE_URL   the path the web demo is served from (GitHub Pages: "/<repository name>")
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}),
  },
});
