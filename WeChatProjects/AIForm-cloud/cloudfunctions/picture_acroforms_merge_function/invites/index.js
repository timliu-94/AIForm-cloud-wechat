const cloud = require("wx-server-sdk");

const COLLECTION = "visa_invites";
// 邀请单默认有效期 7 天，写入 expireAt 便于后续按需清理。
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const db = cloud.database();

function sanitizeTemplateVersion(templateVersion) {
  if (!templateVersion || typeof templateVersion !== "object") return null;
  return {
    id: templateVersion.id || "",
    country: templateVersion.country || "",
    name: templateVersion.name || "",
    versionDir: templateVersion.versionDir || "",
    pdfFilename: templateVersion.pdfFilename || "",
    sourcePdf: templateVersion.sourcePdf || "",
    editablePdf: templateVersion.editablePdf || "",
    editableFilename: templateVersion.editableFilename || "",
    acroformSchema: templateVersion.acroformSchema || "",
    previewPattern: templateVersion.previewPattern
      || (templateVersion.assets
        && templateVersion.assets.previewImages
        && templateVersion.assets.previewImages.pattern)
      || "",
    previewPages: templateVersion.previewPages
      || (templateVersion.assets
        && templateVersion.assets.previewImages
        && templateVersion.assets.previewImages.pages)
      || [],
  };
}

async function addInvite(doc) {
  const res = await db.collection(COLLECTION).add({ data: doc });
  return res._id;
}

// 新增邀请单。集合不存在时先建集合再重试（沿用 index.js createCollection 的容错思路）。
const createInvite = async (event) => {
  const templateId = event.templateId;
  const mode = event.mode === "blank" ? "blank" : "content";
  if (!templateId) {
    return {
      success: false,
      errCode: "INVALID_INVITE_PARAMS",
      errMsg: "templateId is required",
    };
  }

  const now = Date.now();
  const doc = {
    templateId,
    templateVersion: sanitizeTemplateVersion(event.templateVersion),
    mode,
    values: mode === "content" && event.values && typeof event.values === "object"
      ? event.values
      : {},
    createdAt: new Date(now).toISOString(),
    expireAt: now + INVITE_TTL_MS,
  };

  try {
    const inviteId = await addInvite(doc);
    return { success: true, inviteId };
  } catch (e) {
    try {
      await db.createCollection(COLLECTION);
      const inviteId = await addInvite(doc);
      return { success: true, inviteId };
    } catch (retryErr) {
      return {
        success: false,
        errCode: "CREATE_INVITE_FAILED",
        errMsg: String((retryErr && retryErr.message) || retryErr || e),
      };
    }
  }
};

// 按 inviteId 读取邀请单。
const getInvite = async (event) => {
  const inviteId = event.inviteId;
  if (!inviteId) {
    return {
      success: false,
      errCode: "INVALID_INVITE_PARAMS",
      errMsg: "inviteId is required",
    };
  }

  try {
    const res = await db.collection(COLLECTION).doc(inviteId).get();
    const invite = res && res.data;
    if (!invite) {
      return { success: false, errCode: "INVITE_NOT_FOUND", errMsg: "Invite not found" };
    }
    return { success: true, invite };
  } catch (e) {
    return { success: false, errCode: "INVITE_NOT_FOUND", errMsg: String((e && e.message) || e) };
  }
};

module.exports = {
  createInvite,
  getInvite,
};
