module.exports = {
  apps: [
    {
      name: 'notion-sync',
      script: 'src/index.js',
      args: 'sync',
      cwd: __dirname,
      autorestart: false,
      cron_restart: '0 6 * * *',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
