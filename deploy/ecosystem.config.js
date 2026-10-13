// PM2 process config for VCPeer production.
// Usage (on the box, at deploy time — NOT run by this build session):
//   pm2 start deploy/ecosystem.config.js
//   pm2 save
module.exports = {
    apps: [
        {
            name: 'vcpeer',
            script: 'app/src/server.js',
            cwd: '/home/ubuntu/vcpeer', // adjust to the actual clone path on the box
            env: {
                NODE_ENV: 'production',
                PORT: 3000,
            },
            // Box has ~956MB RAM, ~400MB free. Cap restart before OOM rather than
            // let pm2/Node take the whole box down.
            max_memory_restart: '300M',
            instances: 1, // never cluster-mode on a 1-vCPU/956MB box
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
        },
    ],
};
