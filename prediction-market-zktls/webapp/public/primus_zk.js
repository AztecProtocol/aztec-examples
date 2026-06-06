// load wasm module
Module = {};
Module_callAlgorithm = null;
Module.onRuntimeInitialized = async () => {
  console.log("Module onRuntimeInitialized");
  Module_callAlgorithm = Module.cwrap('callAlgorithm', 'string', ['string']);
};

// // support websocket
// global.WebSocket = require('ws');

// // load wasm module
// Module_callAlgorithm = null;
// const Module = require("./client_plugin.js");
// Module.onRuntimeInitialized = async () => {
//   Module_callAlgorithm = Module.cwrap('callAlgorithm', 'string', ['string']);
// }

const callPrimusAlgorithm = async (params) => {
  if (!Module_callAlgorithm) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return Module_callAlgorithm(params);
};

primusZktlsInit = async () => {
  const params = `{"method":"init","version":"1.1.1","params":{}}`;
  const result = await callPrimusAlgorithm(params);
  return JSON.parse(result);
};

primusZktlsGetAttestation = async (paramsObj) => {
  const _paramsObj = { method: "getAttestation", version: "1.1.1", params: paramsObj };
  const params = JSON.stringify(_paramsObj);
  const result = await callPrimusAlgorithm(params);
  return JSON.parse(result);
};

primusZktlsGetAttestationResult = async (timeout = 2 * 60 * 1000) => {
  const params = `{"method":"getAttestationResult","version":"1.1.1","params":{"requestid":"1"}}`;

  return new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = async () => {
      const timeGap = performance.now() - start;
      let resObj = null;
      try {
        const res = await callPrimusAlgorithm(params);
        resObj = JSON.parse(res);
      } catch (err) {
      }

      if (resObj && (resObj.retcode == "0" || resObj.retcode == "2")) {
        resolve(resObj);
      } else if (timeGap > timeout) {
        reject({
          code: 'timeout',
          data: resObj
        });
      } else {
        setTimeout(tick, 1000);
      }
    };
    tick();
  });
}

primusZktlsStartOffline = async (paramsObj) => {
  const _paramsObj = { method: "startOffline", version: "1.1.1", params: paramsObj };
  const params = JSON.stringify(_paramsObj);
  const result = await callPrimusAlgorithm(params);
  return JSON.parse(result);
};
