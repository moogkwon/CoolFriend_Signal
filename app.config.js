module.exports = {
  apps: [
    {
      name: "signaling",
      script: "./server.js",
      env: {
        watch: true,
        "NODE_ENV": "development"
      },
      env_production: {
        watch: false,
        "NODE_ENV": "production",
      }
    }
  ]
}