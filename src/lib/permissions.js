function isSysPlus(db, userId) { return Array.isArray(db['sys+']) && db['sys+'].includes(userId); }
function isSys(db, userId) { return isSysPlus(db, userId) || (Array.isArray(db.sys) && db.sys.includes(userId)); }
function isOwner(db, userId) { return isSys(db, userId) || (Array.isArray(db.owner) && db.owner.includes(userId)); }
function isWL(db, userId) { return Array.isArray(db.wl) && db.wl.includes(userId); }
function canUseEditor(db, userId) { return isWL(db, userId) || isOwner(db, userId) || isSys(db, userId) || isSysPlus(db, userId); }
module.exports = { isSysPlus, isSys, isOwner, isWL, canUseEditor };