import { loadDem } from './assets.js';

const out = document.getElementById('output');
document.getElementById('loadDem').addEventListener('click', async () => {
  out.textContent = 'Loading...';
  try {
    const dem = await loadDem('terrarium-4x4');
    out.textContent = `DEM ${dem.width}x${dem.height}\nmetersPerPixel: ${dem.metersPerPixel}\nbbox: ${JSON.stringify(dem.bbox)}`;
    // show grid values
    const vals = [];
    for (let y = 0; y < dem.height; y++) {
      const row = [];
      for (let x = 0; x < dem.width; x++) row.push(dem.grid[y * dem.width + x].toFixed(2));
      vals.push(row.join('\t'));
    }
    out.textContent += '\n\n' + vals.join('\n');
  } catch (err) {
    out.textContent = 'Error: ' + err.message;
    console.error(err);
  }
});
