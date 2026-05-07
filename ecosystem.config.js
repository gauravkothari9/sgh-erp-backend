// =====================================================================
// PM2 process file for the SGH ERP backend.
// Used by:  pm2 start ecosystem.config.js
// =====================================================================

module.exports = {
  apps: [
    {
      name: 'sgh-erp-api',
      script: 'server.js',
      cwd: __dirname,

      // One process is enough for a single-PC deployment. Bump to 'max' to
      // use all CPU cores once the load justifies it.
      instances: 1,
      exec_mode: 'fork',

      // Restart on crash, with backoff so a bad bug can't burn the CPU.
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,

      // Restart automatically if the process leaks past 500 MB.
      max_memory_restart: '500M',

      // Log files land in backend/logs/ (created on first run).
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      time: true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
