const { handleProcess, sendJson } = require('../server');

module.exports = async function processHandler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Gunakan POST untuk /api/process.' });
    return;
  }
  await handleProcess(req, res);
};
