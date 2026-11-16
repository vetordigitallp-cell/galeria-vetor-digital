// Gera as prévias públicas com marca-d'água "queimada" nos pixels.
// O arquivo original nunca é alterado e vai direto para o armazenamento privado.

const V_LEFT = [[0, 78], [90, 78], [145, 178], [145, 328]];
const V_RIGHT = [[145, 178], [246, 0], [335, 0], [145, 328]];

function drawLogo(ctx, cx, cy, size, alpha) {
  const s = size / 336;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx - (336 * s) / 2, cy - (329 * s) / 2);
  ctx.scale(s, s);
  const poly = (pts, color) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); };
  poly(V_LEFT, '#f4f6fa');
  poly(V_RIGHT, '#c6ef3e');
  ctx.restore();
}

function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i++) { h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

// Camadas pensadas para dificultar remoção automática (IA/inpainting):
//  1) texto denso em duas diagonais cruzadas, com contorno escuro + preenchimento claro (aparece em fundo claro e escuro)
//  2) logos repetidos por toda a imagem
//  3) linhas onduladas finas cobrindo tudo (padrão de segurança)
//  4) logo grande no centro e faixa inferior
// A posição varia por foto (semente), então não há padrão idêntico entre imagens para "subtrair".
function applyWatermark(ctx, w, h, text, strength = 1, seed = '') {
  const label = (text || 'VETOR DIGITAL').toUpperCase();
  const base = Math.max(w, h);
  const rand = rng(seed || label);

  const tile = (angle, fs, alphaFill, alphaStroke, gapX, gapY, phase) => {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    ctx.font = `800 ${fs}px "Bricolage Grotesque", "Arial Black", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.2, fs * 0.09);
    const stepX = ctx.measureText(label).width + fs * gapX;
    const stepY = fs * gapY;
    const span = base * 1.4;
    for (let y = -span + phase * stepY, row = 0; y <= span; y += stepY, row++) {
      for (let x = -span + ((row % 2) * stepX) / 2 + phase * stepX; x <= span; x += stepX) {
        ctx.strokeStyle = `rgba(10,17,28,${alphaStroke * strength})`;
        ctx.strokeText(label, x, y);
        ctx.fillStyle = `rgba(255,255,255,${alphaFill * strength})`;
        ctx.fillText(label, x, y);
      }
    }
    ctx.restore();
  };
  const fs = Math.max(11, Math.round(base * 0.03));
  tile(-Math.PI / 6 + (rand() - 0.5) * 0.1, fs, 0.34, 0.30, 1.4, 2.0, rand());
  tile(Math.PI / 5 + (rand() - 0.5) * 0.1, Math.round(fs * 0.8), 0.26, 0.24, 1.8, 2.6, rand());

  // linhas onduladas finas por toda a imagem
  ctx.save();
  ctx.lineWidth = Math.max(1, base * 0.0016);
  const lines = 26;
  for (let i = 0; i < lines; i++) {
    const y0 = (h / lines) * i + rand() * (h / lines);
    const amp = h * (0.012 + rand() * 0.02);
    const freq = 2 + rand() * 4;
    const ph = rand() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const y = y0 + Math.sin((x / w) * Math.PI * 2 * freq + ph) * amp;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = i % 2 ? `rgba(255,255,255,${0.20 * strength})` : `rgba(10,17,28,${0.16 * strength})`;
    ctx.stroke();
  }
  ctx.restore();

  // logos pequenos repetidos
  const ls = Math.min(w, h) * 0.12;
  const gx = ls * 2.6, gy = ls * 2.6;
  const ox = rand() * gx, oy = rand() * gy;
  for (let y = -gy + oy, r = 0; y < h + gy; y += gy, r++) {
    for (let x = -gx + ox + (r % 2) * (gx / 2); x < w + gx; x += gx) drawLogo(ctx, x, y, ls, 0.26 * strength);
  }

  // logo grande central
  drawLogo(ctx, w / 2, h / 2, Math.min(w, h) * 0.36, 0.50 * strength);

  // faixa inferior
  const bh = Math.max(18, Math.round(h * 0.05));
  ctx.fillStyle = 'rgba(10,17,28,.78)';
  ctx.fillRect(0, h - bh, w, bh);
  ctx.fillStyle = '#c6ef3e';
  ctx.font = `600 ${Math.round(bh * 0.46)}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`PRÉVIA · ${label} · GALERIA`, Math.round(bh * 0.5), h - bh / 2);
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))), 'image/jpeg', quality));
}

function scaled(bmp, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { canvas: c, ctx };
}

/**
 * Processa um arquivo original e devolve:
 *  preview (1100px, com marca-d'água), thumb (520px, com marca-d'água),
 *  detect (canvas limpo de até 1920px, usado só para achar rostos, não é enviado)
 */
export async function buildVariants(file, watermarkText) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const p = scaled(bmp, 1100);
    applyWatermark(p.ctx, p.canvas.width, p.canvas.height, watermarkText, 1, file.name + file.size);
    const t = scaled(bmp, 520);
    applyWatermark(t.ctx, t.canvas.width, t.canvas.height, watermarkText, 0.9, file.name + file.size + 't');
    const d = scaled(bmp, 1920);
    return {
      width: bmp.width,
      height: bmp.height,
      preview: await toBlob(p.canvas, 0.82),
      thumb: await toBlob(t.canvas, 0.76),
      detect: d.canvas
    };
  } finally {
    bmp.close && bmp.close();
  }
}

export async function canvasFromBlob(blob, maxSide = 1920) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try { return scaled(bmp, maxSide).canvas; } finally { bmp.close && bmp.close(); }
}
