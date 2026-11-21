const { allowedApps } = require('../lib/postprocess');
const { sendJson } = require('../server');

module.exports = function configHandler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Gunakan GET untuk /api/config.' });
    return;
  }
  sendJson(res, 200, { postprocessApps: allowedApps() });
};
