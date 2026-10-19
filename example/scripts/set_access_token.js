// Writes env.json from the gitignored `accesstoken` file, like the @rnmapbox/maps example.
const fs = require('fs');
const path = require('path');

const tokenPath = path.join(__dirname, '..', 'accesstoken');
const envPath = path.join(__dirname, '..', 'env.json');

let accessToken = '';
if (fs.existsSync(tokenPath)) {
  accessToken = fs.readFileSync(tokenPath, 'utf8').trim();
} else {
  console.warn(
    `[set_access_token] ${tokenPath} not found; put your Mapbox access token there and re-run yarn.`
  );
}

fs.writeFileSync(envPath, JSON.stringify({ accessToken }, null, 2) + '\n');
