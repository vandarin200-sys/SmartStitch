const { handleUploadCleanup, sendJson } = require('../server');

module.exports = async function uploadCleanupHandler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Gunakan POST untuk /api/upload-cleanup.' });
    return;
  }
  await handleUploadCleanup(req, res);
};
