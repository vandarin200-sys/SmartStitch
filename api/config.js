const { sendJson, MAX_FILES } = require('../server');

module.exports = function configHandler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Gunakan GET untuk /api/config.' });
    return;
  }
  sendJson(res, 200, { files: { max: MAX_FILES }, zipName: { maxLength: 60 }, sliceStart: { maxLength: 9, max: 999999999 } });
};
