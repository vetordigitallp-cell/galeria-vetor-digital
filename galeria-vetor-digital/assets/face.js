// Reconhecimento facial open source (face-api, roda no navegador).
// - Selfie do atleta: processada no próprio aparelho; só um vetor de 128 números vai para a busca.
// - Fotos do evento: o painel gera os vetores no computador da equipe durante o envio.
const LIB = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/dist/face-api.js';
const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/model/';

let libPromise;
const loaded = { tiny: false, ssd: false, rec: false };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.faceapi) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar o reconhecimento facial. Verifique a conexão.'));
    document.head.append(s);
  });
}

export async function loadFaceApi(detector = 'tiny') {
  libPromise ||= loadScript(LIB).then(async () => { await window.faceapi.tf.ready(); });
  await libPromise;
  const fa = window.faceapi;
  const jobs = [];
  if (detector === 'tiny' && !loaded.tiny) jobs.push(fa.nets.tinyFaceDetector.loadFromUri(MODELS).then(() => { loaded.tiny = true; }));
  if (detector === 'ssd' && !loaded.ssd) jobs.push(fa.nets.ssdMobilenetv1.loadFromUri(MODELS).then(() => { loaded.ssd = true; }));
  if (!loaded.rec) {
    jobs.push(Promise.all([
      fa.nets.faceLandmark68Net.loadFromUri(MODELS),
      fa.nets.faceRecognitionNet.loadFromUri(MODELS)
    ]).then(() => { loaded.rec = true; }));
  }
  await Promise.all(jobs);
  return fa;
}

export async function fileToCanvas(file, maxSide) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c;
}

// Selfie: devolve o vetor do maior rosto encontrado.
export async function selfieDescriptor(file) {
  const fa = await loadFaceApi('tiny');
  const canvas = await fileToCanvas(file, 1024);
  let dets = await fa.detectAllFaces(canvas, new fa.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.45 }))
    .withFaceLandmarks().withFaceDescriptors();
  if (!dets.length) {
    await loadFaceApi('ssd');
    dets = await fa.detectAllFaces(canvas, new fa.SsdMobilenetv1Options({ minConfidence: 0.4 }))
      .withFaceLandmarks().withFaceDescriptors();
  }
  if (!dets.length) throw new Error('Não encontramos um rosto na selfie. Tente com o rosto de frente, bem iluminado e sem óculos escuros.');
  dets.sort((a, b) => b.detection.box.area - a.detection.box.area);
  const d = dets[0];
  return { descriptor: Array.from(d.descriptor), faces: dets.length, canvas };
}

// Fotos do evento: todos os rostos com tamanho mínimo (para não indexar o público ao fundo).
export async function photoFaces(canvas, minFace = 40) {
  const fa = await loadFaceApi('ssd');
  const dets = await fa.detectAllFaces(canvas, new fa.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 40 }))
    .withFaceLandmarks().withFaceDescriptors();
  return dets
    .filter((d) => Math.min(d.detection.box.width, d.detection.box.height) >= minFace)
    .map((d) => {
      const b = d.detection.box;
      return {
        descriptor: Array.from(d.descriptor),
        box: { x: b.x / canvas.width, y: b.y / canvas.height, w: b.width / canvas.width, h: b.height / canvas.height }
      };
    });
}

export const vectorLiteral = (arr) => `[${arr.map((n) => Number(n).toFixed(6)).join(',')}]`;
