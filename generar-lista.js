// Genera lista.json con los archivos de music/ y fotos/
// Uso:  node generar-lista.js
const fs = require('fs');
const path = require('path');

const AUDIO = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

const list = (folder, re) => {
  const dir = path.join(__dirname, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => re.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const data = { tracks: list('music', AUDIO), photos: list('fotos', IMAGE) };
fs.writeFileSync(path.join(__dirname, 'lista.json'), JSON.stringify(data, null, 2));
console.log(`lista.json creado: ${data.tracks.length} canciones, ${data.photos.length} fotos`);
