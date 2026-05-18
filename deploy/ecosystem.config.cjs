module.exports = {
  apps: [{
    name: 'pnl-app',
    script: 'src/index.js',
    cwd: '/var/www/pnl/backend',
    interpreter: 'node',
    interpreter_args: '--experimental-vm-modules',
    env: {
      NODE_ENV: 'production',
    },
    log_file: '/var/log/pnl/app.log',
    error_file: '/var/log/pnl/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_restarts: 10,
    restart_delay: 5000,
  }],
};
