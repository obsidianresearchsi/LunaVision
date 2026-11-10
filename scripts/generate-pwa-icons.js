import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDir = fileURLToPath(new URL('../public/logo/', import.meta.url));
const sourceLogo = path.join(outputDir, 'lunar-orbit.png');

for (const size of [32, 192, 512]) {
  const mark = await sharp(sourceLogo)
    .resize(Math.round(size * 0.60), Math.round(size * 0.60), { fit: 'inside' })
    .png()
    .toBuffer();

  const filename = size === 32 ? 'favicon.png' : 'icon-' + size + 'x' + size + '.png';
  await sharp({ create: { width: size, height: size, channels: 4, background: '#101821' } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(path.join(outputDir, filename));
  console.log('Created ' + filename);
}

