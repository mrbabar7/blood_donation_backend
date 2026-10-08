const Block = require("../models/blockModel");

// Ids of every user that has a block with `userId` in EITHER direction.
const blockedEitherWay = async (userId) => {
  const rows = await Block.find({ $or: [{ blockerId: userId }, { blockedId: userId }] }).select("blockerId blockedId").lean();
  const me = String(userId);
  const ids = new Set();
  rows.forEach((r) => ids.add(String(r.blockerId) === me ? String(r.blockedId) : String(r.blockerId)));
  return [...ids];
};

const isBlockedBetween = async (a, b) => !!(await Block.exists({ $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }));

module.exports = { blockedEitherWay, isBlockedBetween };
