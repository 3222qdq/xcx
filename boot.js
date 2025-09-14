const { existsSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

function ensureNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    console.error(`❌ Node.js >= 18 requis. Version actuelle: ${process.version}`);
    process.exit(1);
  }
}
ensureNodeVersion();

const needsInstall =
  !existsSync(path.join(__dirname, 'node_modules')) ||
  !existsSync(path.join(__dirname, 'node_modules', 'discord.js'));

if (needsInstall) {
  console.log('📦 node_modules manquant → installation des dépendances…');
  const r = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--fund=false'], {
    stdio: 'inherit',
    env: process.env
  });
  if (r.status !== 0) {
    console.error('❌ Échec de `npm install`. Vérifie le réseau/permissions.');
    process.exit(r.status || 1);
  }
  console.log('✅ Dépendances installées.');
}

require('./src/index.js');