// Writes env.json from the gitignored `accesstoken` file, falling back to the bare example's.
const fs = require('fs');
const path = require('path');

const tokenPaths = [
  path.join(__dirname, '..', 'accesstoken'),
  path.join(__dirname, '..', '..', 'example', 'accesstoken'),
];
const envPath = path.join(__dirname, '..', 'env.json');

const tokenPath = tokenPaths.find((p) => fs.existsSync(p));
let accessToken = '';
if (tokenPath) {
  accessToken = fs.readFileSync(tokenPath, 'utf8').trim();
} else {
  console.warn(
    `[set_access_token] ${tokenPaths[0]} not found; put your Mapbox access token there and re-run yarn.`
  );
}

fs.writeFileSync(envPath, JSON.stringify({ accessToken }, null, 2) + '\n');
