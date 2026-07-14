const cloud = require('wx-server-sdk');
const { success, fail } = require('./utils.js');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

function isCloudUrl(url) {
  return typeof url === 'string' && url.startsWith('cloud://');
}

async function getSingleAccessibleUrl(cloudUrl) {
  if (!isCloudUrl(cloudUrl)) {
    return success({ url: cloudUrl });
  }

  try {
    const result = await cloud.getTempFileURL({
      fileList: [cloudUrl]
    });

    const file = result && result.fileList && result.fileList[0];
    if (file && file.status === 0 && file.tempFileURL) {
      return success({ url: file.tempFileURL });
    }

    console.error('getTempFileURL failed for single:', cloudUrl, JSON.stringify(result));
    return success({ url: cloudUrl });
  } catch (err) {
    console.error('getTempFileURL error for single:', cloudUrl, err);
    return success({ url: cloudUrl });
  }
}

async function getBatchAccessibleUrls(cloudUrls) {
  if (!Array.isArray(cloudUrls)) {
    return fail('cloudUrls must be an array');
  }

  const validUrls = cloudUrls.filter(isCloudUrl);
  if (validUrls.length === 0) {
    return success({});
  }

  const urlMap = {};
  const BATCH_SIZE = 50;

  for (let i = 0; i < validUrls.length; i += BATCH_SIZE) {
    const chunk = validUrls.slice(i, i + BATCH_SIZE);

    try {
      const result = await cloud.getTempFileURL({
        fileList: chunk
      });

      const fileList = (result && result.fileList) || [];
      fileList.forEach((file) => {
        const originalUrl = file.fileID;
        if (file.status === 0 && file.tempFileURL) {
          urlMap[originalUrl] = file.tempFileURL;
        } else {
          console.error('getTempFileURL failed for batch item:', originalUrl, JSON.stringify(file));
          urlMap[originalUrl] = originalUrl;
        }
      });
    } catch (err) {
      console.error('getTempFileURL error for batch chunk:', chunk, err);
      chunk.forEach((url) => {
        urlMap[url] = url;
      });
    }
  }

  return success(urlMap);
}

exports.main = async (event, context) => {
  const { action, cloudUrl, cloudUrls } = event;
  const currentAction = action || 'single';

  if (currentAction === 'single') {
    return getSingleAccessibleUrl(cloudUrl);
  }

  if (currentAction === 'batch') {
    return getBatchAccessibleUrls(cloudUrls);
  }

  return fail(`unsupported action: ${action}`);
};
