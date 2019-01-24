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
        "NODE_ENV": "production",
      }
    }
  ]
}