const { handlePresign, sendJson } = require('../server');

module.exports = async function presignHandler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Gunakan POST untuk /api/presign.' });
    return;
  }
  await handlePresign(req, res);
};
