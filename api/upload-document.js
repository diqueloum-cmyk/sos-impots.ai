// Upload de documents client vers Vercel Blob
// Appelé depuis le chat quand l'utilisateur dépose un fichier

import { put } from '@vercel/blob';
import { setCorsHeaders, handleCorsPreflight } from '../lib/utils.js';
import logger from '../lib/logger.js';

export const config = {
  api: {
    bodyParser: false // Nécessaire pour lire le multipart/form-data
  }
};

// Types de fichiers autorisés
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (handleCorsPreflight(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Lire le body brut (multipart)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);

    // Extraire le boundary du Content-Type
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: 'Content-Type multipart/form-data requis' });
    }
    const boundary = boundaryMatch[1];

    // Parser manuellement le multipart
    const parsed = parseMultipart(rawBody, boundary);
    if (!parsed.file) {
      return res.status(400).json({ error: 'Aucun fichier reçu' });
    }

    const { file, filename, mimeType, sessionId, clientEmail } = parsed;

    // Validation du type
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return res.status(400).json({
        error: `Type de fichier non autorisé. Types acceptés : PDF, JPG, PNG, Word, Excel`
      });
    }

    // Validation de la taille
    if (file.length > MAX_SIZE_BYTES) {
      return res.status(400).json({
        error: `Fichier trop lourd. Maximum ${MAX_SIZE_MB} Mo`
      });
    }

    // Construire le chemin dans Blob : clients/[sessionId]/[timestamp]_[filename]
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const folder = sessionId ? `clients/${sessionId}` : 'clients/anonymous';
    const blobPath = `${folder}/${timestamp}_${safeFilename}`;

    // Upload vers Vercel Blob
    const blob = await put(blobPath, file, {
      access: 'public',
      contentType: mimeType,
      addRandomSuffix: false
    });

    logger.info('Document uploadé:', { path: blobPath, size: file.length, sessionId });

    return res.status(200).json({
      success: true,
      filename: safeFilename,
      url: blob.url,
      size: file.length,
      message: 'Document déposé avec succès'
    });

  } catch (error) {
    logger.error('Erreur upload document:', error);
    return res.status(500).json({ error: 'Erreur lors du dépôt du document' });
  }
}

/**
 * Parser simple pour multipart/form-data
 */
function parseMultipart(body, boundary) {
  const result = { file: null, filename: null, mimeType: null, sessionId: null, clientEmail: null };
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts = splitBuffer(body, boundaryBuf);

  for (const part of parts) {
    if (part.length < 4) continue;

    // Trouver la séparation headers / contenu (double CRLF)
    const headerEnd = indexOfDoubleNewline(part);
    if (headerEnd === -1) continue;

    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const content = part.slice(headerEnd + 4); // +4 pour \r\n\r\n

    // Supprimer le \r\n final
    const fileContent = content.slice(0, content.length - 2);

    if (headerStr.includes('filename=')) {
      // C'est un fichier
      const nameMatch = headerStr.match(/filename="([^"]+)"/);
      const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
      result.filename = nameMatch ? nameMatch[1] : 'document';
      result.mimeType = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';
      result.file = fileContent;
    } else if (headerStr.includes('name="sessionId"')) {
      result.sessionId = fileContent.toString('utf8').trim();
    } else if (headerStr.includes('name="clientEmail"')) {
      result.clientEmail = fileContent.toString('utf8').trim();
    }
  }

  return result;
}

function splitBuffer(buf, delimiter) {
  const parts = [];
  let start = 0;
  let pos = 0;

  while (pos <= buf.length - delimiter.length) {
    let match = true;
    for (let i = 0; i < delimiter.length; i++) {
      if (buf[pos + i] !== delimiter[i]) { match = false; break; }
    }
    if (match) {
      parts.push(buf.slice(start, pos));
      start = pos + delimiter.length;
      pos = start;
    } else {
      pos++;
    }
  }
  parts.push(buf.slice(start));
  return parts;
}

function indexOfDoubleNewline(buf) {
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 13 && buf[i+1] === 10 && buf[i+2] === 13 && buf[i+3] === 10) {
      return i;
    }
  }
  return -1;
}
