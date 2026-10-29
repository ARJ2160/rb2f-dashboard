import multer from 'multer';

import { env } from '../config/env';

const ACCEPTED = /\.(xlsx|xls|csv)$/i;

/**
 * multipart/form-data parser shared by the Amazon and Blinkit upload endpoints: files in the `files`
 * field, kept in memory, only .xlsx / .xls / .csv names (others are silently dropped).
 */
export const receiveFiles = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: env.MAX_UPLOAD_FILES,
    fields: 10,
    fieldSize: 4 * 1024,
    parts: env.MAX_UPLOAD_FILES + 10,
  },
  fileFilter: (_req, file, cb) => cb(null, ACCEPTED.test(file.originalname)),
}).array('files', env.MAX_UPLOAD_FILES);

export { cleanFilename, looksLikeSpreadsheet } from './file-checks';
