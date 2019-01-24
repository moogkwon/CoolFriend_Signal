module.exports = {
  apps: [
    {
      name: "signaling",
      script: "./server.js",
      env: {
        watch: true,
        NODE_ENV: "development"
      },
      env_production: {
        watch: false,
        instances: 0,
        exec_mode: "cluster",
        NODE_ENV: "production",
      }
    }
  ]
}