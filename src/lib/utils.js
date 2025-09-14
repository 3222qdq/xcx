const { PermissionsBitField, MessageFlags } = require('discord.js');
function mentionUser(id) { return `<@${id}>`; }
function mentionRole(id) { return `<@&${id}>`; }
function topRole(member) { return member?.roles?.highest ?? null; }
function roleManageableBy(actorMember, botMember, role) {
  if (!role || role.managed) return false;
  const actorTop = topRole(actorMember), botTop = topRole(botMember);
  if (!actorTop || !botTop) return false;
  if (role.id === actorMember.guild.id) return false;
  return role.position < actorTop.position && role.position < botTop.position;
}
function canEditTarget(actorMember, targetMember) {
  const aTop = topRole(actorMember), tTop = topRole(targetMember);
  if (!aTop || !tTop) return false;
  return tTop.position < aTop.position;
}
function chunk(arr, size) { const out=[]; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function truncate(text, limit=1024) { if (!text) return text; return text.length>limit? text.slice(0,limit-5)+' …': text; }
function hasBotRolePerms(guild, me) { return me && me.permissions.has(PermissionsBitField.Flags.ManageRoles); }
function shortId() { return Math.random().toString(36).slice(2,10); }
function buildList(items, bullet='• ') { if (!items?.length) return 'Aucun'; return items.map(s=>`${bullet}${s}`).join('\n'); }
function eph(contentOrObj) { return typeof contentOrObj === 'string' ? { content: contentOrObj, flags: MessageFlags.Ephemeral } : { ...contentOrObj, flags: MessageFlags.Ephemeral }; }
module.exports = { mentionUser, mentionRole, topRole, roleManageableBy, canEditTarget, chunk, truncate, hasBotRolePerms, shortId, buildList, eph };