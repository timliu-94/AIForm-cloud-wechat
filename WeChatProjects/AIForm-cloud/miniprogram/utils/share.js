const HOME_SHARE_TITLE = '签证申请表辅助填写';
const HOME_SHARE_PATH = '/pages/home/index';
const HOME_SHARE_IMAGE_URL = '/static/share-fill-cover.jpg';

function getHomeShareMessage() {
  return {
    title: HOME_SHARE_TITLE,
    path: HOME_SHARE_PATH,
    imageUrl: HOME_SHARE_IMAGE_URL,
  };
}

module.exports = {
  getHomeShareMessage,
  HOME_SHARE_PATH,
};
