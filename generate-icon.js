// Скрипт для создания иконки HabitForge
// Запусти: node generate-icon.js

const fs = require('fs');
const path = require('path');

// Проверяем наличие canvas
let canvas;
try {
  canvas = require('canvas');
} catch (e) {
  console.log('Библиотека canvas не установлена. Устанавливаю...');
  console.log('Запусти: npm install canvas');
  console.log('\nИли открой generate-icon.html в браузере для создания иконки вручную.');
  process.exit(1);
}

const { createCanvas } = canvas;

function createIcon(size = 1024) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Фиолетовый фон
  ctx.fillStyle = '#7C3AED';
  ctx.fillRect(0, 0, size, size);
  
  // Белые буквы HF
  ctx.fillStyle = '#FFFFFF';
  const fontSize = Math.round(size * 0.6);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HF', size / 2, size / 2);
  
  return canvas;
}

// Создаём иконки разных размеров
const sizes = {
  'icon.png': 1024,
  'adaptive-icon.png': 1024,
  'splash-icon.png': 2048, // Для splash screen можно сделать больше
};

console.log('Создаю иконки...');

for (const [filename, size] of Object.entries(sizes)) {
  const canvas = createIcon(size);
  const buffer = canvas.toBuffer('image/png');
  const filepath = path.join(__dirname, 'assets', filename);
  
  fs.writeFileSync(filepath, buffer);
  console.log(`✓ Создан ${filename} (${size}x${size})`);
}

console.log('\n✓ Все иконки созданы!');

