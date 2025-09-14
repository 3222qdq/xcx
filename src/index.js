// index.js
const path = require('path');
const {
  Client, GatewayIntentBits, Partials,
  ChannelType, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder,
  ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, PermissionsBitField,
  REST, Routes, SlashCommandBuilder
} = require('discord.js');

const { readJson, writeJsonAtomic } = require('./lib/storage');
const { isSysPlus, isSys, isOwner/* , canUseEditor */ } = require('./lib/permissions');
const {
  mentionUser, mentionRole, roleManageableBy, canEditTarget, chunk, truncate,
  hasBotRolePerms, shortId, eph
} = require('./lib/utils');
const config = require('./config.json');

const DB_PATH = path.join(__dirname, 'data', 'role-editor.json');
let db = null;
const sessions = new Map();

// ====== Constantes UI / Pagination ======
const PAGE_ROLES_BLACK = 15;     // /blackrole & /blrconfig
const PAGE_ROLE_MEMBERS = 20;    // /role member (liste des membres)
// =======================================

/**
 * db structure
 * - "sys+": string[]
 * - sys: string[]
 * - owner: string[]
 * - wl: string[]
 * - blackRoles: string[]
 * - logChannelId: string
 * - blrKeepRoles: string[]
 * - blrAddRoles: string[]
 * - blrUsers: string[]
 */

// ===== Footer par défaut sur TOUS les embeds =====
function getFooterText(){
  return (typeof config.footer === 'string' && config.footer.trim().length)
    ? config.footer.trim()
    : 'Role Manager';
}
function E(){
  const emb = new EmbedBuilder();
  emb.setFooter({ text: getFooterText() });
  return emb;
}
// =================================================

// --- Normalisation DB ---
function normalizeDbShape(o){
  const base = {
    "sys+":[], "sys":[], "owner":[], "wl":[],
    "blackRoles":[], "logChannelId":"",
    "blrKeepRoles":[], "blrAddRoles":[], "blrUsers":[]
  };
  if (!o || typeof o !== 'object') o = {};
  for (const key of Object.keys(base)) {
    if (key === 'logChannelId') {
      if (typeof o[key] !== 'string') o[key] = base[key];
    } else {
      if (!Array.isArray(o[key])) o[key] = [...base[key]];
    }
  }
  return o;
}

const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers ],
  partials: [ Partials.GuildMember, Partials.User ]
});

// === DB ===
async function loadDb() {
  const raw = await readJson(DB_PATH, {});
  db = normalizeDbShape(raw);
  await saveDb();
}
async function saveDb() { await writeJsonAtomic(DB_PATH, db); }

// === PERMS HIERARCHIE ===
const isWL = (id)=> Array.isArray(db?.wl) && db.wl.includes(id);

const canWLPlus      = (id)=> isWL(id) || isOwner(db, id) || isSys(db, id) || isSysPlus(db, id);
const canOwnerPlus   = (id)=> isOwner(db, id) || isSys(db, id) || isSysPlus(db, id);
const canSysPlus     = (id)=> isSys(db, id) || isSysPlus(db, id);
const canSysPlusOnly = (id)=> isSysPlus(db, id);

const canUseEditRoles = (id)=> canWLPlus(id);     // /edit roles -> WL+
const canCmdWL        = (id)=> canOwnerPlus(id);  // /wl -> OWNER+
const canCmdOWNER     = (id)=> canSysPlus(id);    // /owner -> SYS+
const canCmdSYS       = (id)=> canSysPlusOnly(id);// /sys -> SYS+
const canBlackRole    = (id)=> canSysPlus(id);    // /blackrole -> SYS+
const canBLR          = (id)=> canWLPlus(id);     // /blr, /unblr -> WL+
const canBLRConfig    = (id)=> canSysPlus(id);    // /blrconfig -> SYS+
const canSetLogs      = (id)=> canSysPlus(id);    // /setlogsrole -> SYS+

// ===== Slash Commands (déclaration) =====
const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche le menu d’aide'),

  new SlashCommandBuilder()
    .setName('edit')
    .setDescription('Outils d’édition')
    .addSubcommand(sc =>
      sc.setName('roles')
        .setDescription('Modifier les rôles d’un membre')
        .addUserOption(o =>
          o.setName('user')
           .setDescription('Membre cible')
           .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Gestion des rôles')
    .addSubcommand(sc =>
      sc.setName('info')
        .setDescription('Infos détaillées d’un rôle')
        .addRoleOption(o =>
          o.setName('role')
           .setDescription('Rôle visé')
           .setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName('member')
        .setDescription('Gérer les membres d’un rôle')
        .addRoleOption(o =>
          o.setName('role')
           .setDescription('Rôle visé')
           .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('addrole')
    .setDescription('Ajouter un rôle à un membre')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('Membre cible')
       .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('role')
       .setDescription('Rôle à ajouter')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('sys')
    .setDescription('Lister/Ajouter/Retirer SYS')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('Utilisateur (optionnel)')
       .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Lister/Ajouter/Retirer OWNER')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('Utilisateur (optionnel)')
       .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('wl')
    .setDescription('Lister/Ajouter/Retirer WL')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('Utilisateur (optionnel)')
       .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('blackrole')
    .setDescription('UI de gestion de la blacklist des rôles'),

  new SlashCommandBuilder()
    .setName('blr')
    .setDescription('Appliquer BLR à un membre (purge/assign)')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('Membre cible')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('unblr')
    .setDescription('Retirer BLR d’un membre')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('Membre cible')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('blrconfig')
    .setDescription('Configurer BLR (listes Conserver/Ajouter)'),

  new SlashCommandBuilder()
    .setName('setlogsrole')
    .setDescription('Définir / désactiver le salon de logs')
    .addChannelOption(o =>
      o.setName('channel')
       .setDescription('Salon texte pour les logs')
       .addChannelTypes(ChannelType.GuildText)
       .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName('off')
       .setDescription('Désactiver les logs')
       .setRequired(false)
    ),
].map(c => c.toJSON());

// === HELPERS UI ===
function prettyListUsers(ids){
  if (!ids || !ids.length) return '*Aucun*';
  return ids.map(id => `• ${mentionUser(id)} - \`${id}\``).join('\n');
}
function prettyListRoles(ids){
  if (!ids || !ids.length) return '*Aucun*';
  return ids.map(id => `• ${mentionRole(id)} - \`${id}\``).join('\n');
}

async function sendLogEmbed(guild, embed) {
  try {
    const id = db.logChannelId;
    if (!id) return;
    const chan = guild.channels.cache.get(id);
    if (!chan || chan.type !== ChannelType.GuildText) return;
    await chan.send({ embeds: [embed] });
  } catch {}
}
function logEmbed({title, color, actorId, targetId, guild, addedUserIds, removedUserIds, addedRoleIds, removedRoleIds, info}){
  const fields = [];
  if (actorId) fields.push({ name:'`👤` ▸ Acteur', value:`${mentionUser(actorId)} (\`${actorId}\`)`, inline:false });
  if (targetId) fields.push({ name:'`🎯` ▸ Cible', value:`${mentionUser(targetId)} (\`${targetId}\`)`, inline:false });
  if (addedUserIds?.length) fields.push({ name:'`✅` ▸ Ajoutés (utilisateurs)', value: prettyListUsers(addedUserIds).slice(0, 1024) });
  if (removedUserIds?.length) fields.push({ name:'`🗑️` ▸ Retirés (utilisateurs)', value: prettyListUsers(removedUserIds).slice(0, 1024) });
  if (addedRoleIds?.length) fields.push({ name:'`✅` ▸ Rôles ajoutés', value: prettyListRoles(addedRoleIds).slice(0, 1024) });
  if (removedRoleIds?.length) fields.push({ name:'`🗑️` ▸ Rôles retirés', value: prettyListRoles(removedRoleIds).slice(0, 1024) });
  if (info) fields.push({ name:'`🗒️` ▸ Info', value: info });

  return E()
    .setTitle(title)
    .setColor(color ?? 0x5865F2)
    .addFields(...fields)
    .addFields({ name:'`🏠` ▸ Guild', value: `${guild.name} (\`${guild.id}\`)` })
    .setTimestamp(new Date());
}
async function logAction(guild, title, actorId, info, color=0x5865F2){
  await sendLogEmbed(guild, logEmbed({ title, color, actorId, guild, info }));
}
async function logRoleBulkUsers(guild, actorId, roleId, { added = [], removed = [] } = {}){
  const title = '👥 Rôle • Modifications membres';
  const info = `Rôle: ${mentionRole(roleId)} (\`${roleId}\`)`;
  await sendLogEmbed(guild, logEmbed({
    title, color: removed.length && !added.length ? 0xED4245 : added.length && !removed.length ? 0x57F287 : 0xFEE75C,
    actorId, guild, addedUserIds: added, removedUserIds: removed, info
  }));
}

// === COMMANDS ===
client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === 'help') { await logAction(interaction.guild, '📖 Aide affichée', interaction.user.id); return handleHelp(interaction); }

      if (name === 'edit' && interaction.options.getSubcommand() === 'roles') return handleEditRoles(interaction);

      if (name === 'role') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'info')   return handleRoleInfo(interaction);
        if (sub === 'member') return handleRoleMembers(interaction);
      }

      if (name === 'addrole') return handleAddRole(interaction);

      if (name === 'sys')   return handleToggleListEmbed(interaction, 'sys');
      if (name === 'owner') return handleToggleListEmbed(interaction, 'owner');
      if (name === 'wl')    return handleToggleListEmbed(interaction, 'wl');

      if (name === 'blackrole') { const res = await handleBlackRoleUI(interaction); await logAction(interaction.guild, '⛔ UI Blacklist ouverte', interaction.user.id); return res; }

      if (name === 'blr')   return handleBlrUser(interaction);
      if (name === 'unblr') return handleUnblrUser(interaction);
      if (name === 'blrconfig') { const res = await handleBlrConfig(interaction); await logAction(interaction.guild, '🧰 UI BLR Config ouverte', interaction.user.id); return res; }

      if (name === 'setlogsrole') return handleSetLogsRole(interaction);
    }

    // Selects & Buttons
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isButton()) {
      const meta = parseSessionId(interaction.customId);
      if (!meta) return;

      const session = sessions.get(meta.sid);
      if (!session) return interaction.reply(eph('⏳ Session expirée. Relance la commande.'));
      if (interaction.user.id !== session.actorId) return interaction.reply(eph('⛔ Cette interface ne t’appartient pas.'));
      if (ensureSessionTimeout(meta.sid)) {
        sessions.delete(meta.sid);
        return interaction.reply(eph('⏳ Session expirée. Relance la commande.'));
      }

      if (interaction.isButton()) {
        const guild = interaction.guild;

        // Pagination
        if (['back','next','first','last'].includes(meta.action)) {
          if (meta.action === 'back')  session.page = Math.max(0, session.page - 1);
          if (meta.action === 'next')  session.page = Math.min(session.pages.length - 1, session.page + 1);
          if (meta.action === 'first') session.page = 0;
          if (meta.action === 'last')  session.page = Math.max(0, session.pages.length - 1);
          bumpSession(session);
          await refreshSessionMessage(guild, session);
          return interaction.deferUpdate();
        }

        // Switch mode (BLR config & rolemembers)
        if (meta.action === 'switch') {
          if (session.kind === 'blr') {
            session.blrMode = session.blrMode === 'keep' ? 'add' : 'keep';
          } else if (session.kind === 'rolemembers') {
            session.mode = session.mode === 'remove' ? 'add' : 'remove';
          }
          bumpSession(session);
          await refreshSessionMessage(guild, session);
          return interaction.deferUpdate();
        }

        // Search modal
        if (meta.action === 'search') {
          const modal = new ModalBuilder()
            .setCustomId(`re:modal:search:${session.id}:${session.page}`)
            .setTitle('🔎 Rechercher des rôles');
          const input = new TextInputBuilder()
            .setCustomId('q')
            .setLabel('Nom ou ID du rôle (min 2 caractères)')
            .setStyle(TextInputStyle.Short)
            .setMinLength(2)
            .setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          bumpSession(session);
          return interaction.showModal(modal);
        }

        // BLR depuis l’éditeur — confirmation
        if (meta.action === 'blr' && session.kind === 'editor') {
          if (!canBLR(session.actorId)) return interaction.reply(eph('⛔ Accès refusé à BLR.'));
          const confirm = new ButtonBuilder().setCustomId(`re:btn:confirmblr:${session.id}:${session.page}`).setLabel('✅ Confirmer BLR').setStyle(ButtonStyle.Success);
          const cancel  = new ButtonBuilder().setCustomId(`re:btn:cancelblr:${session.id}:${session.page}`).setLabel('❌ Annuler').setStyle(ButtonStyle.Danger);
          const row = new ActionRowBuilder().addComponents(confirm, cancel);
          const embed = E().setTitle('🚫 Confirmer BLR').setColor(0xED4245).setDescription(`Voulez-vous appliquer **BLR** à ${mentionUser(session.targetId)} ?\nCela purge les rôles non autorisés et ajoute ceux de la configuration.`).setTimestamp(new Date());
          return interaction.reply({ embeds:[embed], components:[row] });
        }

        if (['confirmblr','cancelblr'].includes(meta.action) && session.kind === 'editor') {
          if (meta.action === 'cancelblr') {
            const canceled = E().setTitle('❌ BLR annulé').setColor(0xED4245).setTimestamp(new Date());
            return interaction.update({ embeds: [canceled], components: [] });
          }
          const guild = interaction.guild;
          const target = await guild.members.fetch(session.targetId);
          const { added, removed } = await performBLR(guild, session.actorId, target);
          await refreshSessionMessage(guild, session);
          const done = E()
            .setTitle('✅ BLR appliqué')
            .setColor(0x57F287)
            .addFields(
              { name:'`🎯` ▸ Membre', value:`• ${mentionUser(target.id)} - \`${target.id}\`` },
              { name:'`🗑️` ▸ Rôles retirés', value: removed.length ? prettyListRoles(removed).slice(0,1024) : '*Aucun*' },
              { name:'`✅` ▸ Rôles ajoutés', value: added.length ? prettyListRoles(added).slice(0,1024) : '*Aucun*' }
            )
            .setTimestamp(new Date());
          return interaction.update({ embeds: [done], components: [] });
        }

        // Remove all (avec confirmation)
        if (meta.action === 'removeall') {
          let title = '❓ Confirmation';
          let desc = '';
          if (session.kind === 'editor') desc = `Voulez-vous vraiment **retirer tous les rôles gérables** de ${mentionUser(session.targetId)} ?`;
          if (session.kind === 'blackrole') desc = `Voulez-vous vraiment **vider entièrement** la blacklist des rôles ?`;
          if (session.kind === 'blr') desc = `Voulez-vous vraiment **retirer tous les rôles** de la liste **${session.blrMode==='keep'?'Conserver':'Ajouter'}** ?`;
          if (session.kind === 'rolemembers') desc = `Voulez-vous vraiment **retirer le rôle** à **tous les membres de la page** ?`;

          const confirm = new ButtonBuilder().setCustomId(`re:btn:confirmremoveall:${session.id}:${session.page}`).setLabel('✅ Confirmer').setStyle(ButtonStyle.Success);
          const cancel  = new ButtonBuilder().setCustomId(`re:btn:cancelremoveall:${session.id}:${session.page}`).setLabel('❌ Annuler').setStyle(ButtonStyle.Danger);
          const row = new ActionRowBuilder().addComponents(confirm, cancel);

          const embed = E().setTitle(title).setColor(0xFEE75C).setDescription(desc).setTimestamp(new Date());
          return interaction.reply({ embeds: [embed], components: [row] });
        }

        if (['confirmremoveall','cancelremoveall'].includes(meta.action)) {
          if (meta.action === 'cancelremoveall') {
            const canceled = E().setTitle('❌ Action annulée').setColor(0xED4245).setTimestamp(new Date());
            return interaction.update({ embeds: [canceled], components: [] });
          }
          const guild = interaction.guild;

          if (session.kind === 'editor') {
            const target = await guild.members.fetch(session.targetId);
            const manageable = new Set(computeManageableRoles(
              guild, await guild.members.fetch(session.actorId), guild.members.me,
              { includeBlacklisted: canSysPlus(session.actorId) }
            ).map(r=>r.id));
            const toRemove = target.roles.cache.filter(r => manageable.has(r.id)).map(r => r.id);
            const removed = [];
            for (const rid of toRemove) { try { await target.roles.remove(rid, 'Tout retirer via éditeur'); removed.push(rid); } catch {} }
            await logRoleChangeBatch(guild, session.actorId, session.targetId, [], removed, 'Tout retirer (confirmé)');
            await refreshSessionMessage(guild, session);
          }
          else if (session.kind === 'blackrole') {
            const before = db.blackRoles.slice();
            db.blackRoles = [];
            await saveDb();
            const embedLog = logEmbed({ title:'🗑️ Blacklist vidée', color:0xED4245, guild, actorId: session.actorId, removedRoleIds: before });
            await sendLogEmbed(guild, embedLog);
            await refreshSessionMessage(guild, session);
          }
          else if (session.kind === 'blr') {
            if (session.blrMode === 'keep') db.blrKeepRoles = [];
            else db.blrAddRoles = [];
            await saveDb();
            const embedLog = logEmbed({
              title:`🗑️ BLR • Liste ${session.blrMode==='keep'?'Conserver':'Ajouter'} vidée`,
              color:0xED4245, guild, actorId: session.actorId
            });
            await sendLogEmbed(guild, embedLog);
            await refreshSessionMessage(guild, session);
          }
          else if (session.kind === 'rolemembers') {
            const role = await guild.roles.fetch(session.roleId);
            const pageMembers = session.pages[session.page] || [];
            const actor = await guild.members.fetch(session.actorId);
            const removed = [];
            for (const m of pageMembers) {
              if (!canEditTarget(actor, m)) continue;
              try { await m.roles.remove(role.id, 'RoleMembers: derank page'); removed.push(m.id); } catch {}
            }
            await logRoleBulkUsers(guild, session.actorId, role.id, { removed });
            await refreshSessionMessage(guild, session);
          }

          const ok = E().setTitle('✅ Effectué').setColor(0x57F287).setTimestamp(new Date());
          return interaction.update({ embeds: [ok], components: [] });
        }
      }

      // SELECT MENUS (string)
      if (interaction.isStringSelectMenu() && meta.type === 'sel') {
        const guild = interaction.guild;

        if (session.kind === 'editor') {
          const actor = await guild.members.fetch(session.actorId);
          const target = await guild.members.fetch(session.targetId);
          const pageRoles = session.pages[meta.page] || [];
          const selected = new Set(interaction.values);
          const current = new Set(target.roles.cache.map(r => r.id));
          const toAdd = [], toRemove = [];
          for (const r of pageRoles) {
            const has = current.has(r.id);
            const now = selected.has(r.id);
            if (now && !has) toAdd.push(r.id);
            if (!now && has) toRemove.push(r.id);
          }
          const added = [], removed = [];
          for (const rid of toAdd) { try { await target.roles.add(rid, 'Éditeur (select page)'); added.push(rid); } catch {} }
          for (const rid of toRemove) { try { await target.roles.remove(rid, 'Éditeur (select page)'); removed.push(rid); } catch {} }
          await logRoleChangeBatch(guild, actor.id, target.id, added, removed, 'Sélecteur (page)');
          bumpSession(session);
          await refreshSessionMessage(guild, session);
          return interaction.deferUpdate();
        }

        if (session.kind === 'blackrole') {
          const all = session.pages[meta.page] || [];
          const selected = new Set(interaction.values);
          const set = new Set(db.blackRoles || []);
          const added = [], removed = [];
          for (const r of all) {
            const has = set.has(r.id);
            const now = selected.has(r.id);
            if (now && !has) { set.add(r.id); added.push(r.id); }
            if (!now && has) { set.delete(r.id); removed.push(r.id); }
          }
          db.blackRoles = [...set];
          await saveDb();
          const embedLog = logEmbed({
            title:'🧾 Blacklist mise à jour',
            color:0x9B59B6, guild, actorId: session.actorId,
            addedRoleIds: added, removedRoleIds: removed
          });
          await sendLogEmbed(guild, embedLog);
          bumpSession(session);
          await refreshSessionMessage(guild, session);
          return interaction.deferUpdate();
        }

        if (session.kind === 'blr') {
          const all = session.pages[meta.page] || [];
          const selected = new Set(interaction.values);
          let arr = session.blrMode === 'keep' ? (db.blrKeepRoles||[]) : (db.blrAddRoles||[]);
          const set = new Set(arr);
          const added = [], removed = [];
          for (const r of all) {
            const has = set.has(r.id);
            const now = selected.has(r.id);
            if (now && !has) { set.add(r.id); added.push(r.id); }
            if (!now && has) { set.delete(r.id); removed.push(r.id); }
          }
          if (session.blrMode === 'keep') db.blrKeepRoles = [...set];
          else db.blrAddRoles = [...set];
          await saveDb();
          const embedLog = logEmbed({
            title:`⚙️ BLR config mise à jour (${session.blrMode==='keep'?'Conserver':'Ajouter'})`,
            color:0x2F3136, guild, actorId: session.actorId,
            addedRoleIds: added, removedRoleIds: removed
          });
          await sendLogEmbed(guild, embedLog);
          bumpSession(session);
          await refreshSessionMessage(guild, session);
          return interaction.deferUpdate();
        }

        if (session.kind === 'rolemembers' && session.mode === 'remove') {
          const guild = interaction.guild;
          const role = await guild.roles.fetch(session.roleId);
          const actor = await guild.members.fetch(session.actorId);
          const users = session.pages[meta.page] || [];
          const selected = new Set(interaction.values);

          const removed = [];
          for (const m of users) {
            if (!selected.has(m.id)) continue;
            if (!canEditTarget(actor, m)) continue;
            try { await m.roles.remove(role.id, 'RoleMembers: retirer'); removed.push(m.id); } catch {}
          }
          await logRoleBulkUsers(guild, actor.id, role.id, { removed });
          bumpSession(session);
          await refreshSessionMessage(guild, session);
          return interaction.deferUpdate();
        }
      }

      // SELECT MENU (user select)
      if (interaction.isUserSelectMenu() && meta.type === 'usel') {
        const guild = interaction.guild;
        const role = await guild.roles.fetch(session.roleId);
        const actor = await guild.members.fetch(session.actorId);
        const me = guild.members.me;

        const added = [];
        for (const uid of interaction.values) {
          if (Array.isArray(db.blrUsers) && db.blrUsers.includes(uid)) continue; // éviter BLR
          const member = await guild.members.fetch(uid).catch(() => null);
          if (!member) continue;
          if (!canEditTarget(actor, member)) continue;
          try {
            if (!member.roles.cache.has(role.id) && roleManageableBy(actor, me, role)) {
              await member.roles.add(role.id, 'RoleMembers: ajouter');
              added.push(uid);
            }
          } catch {}
        }
        await logRoleBulkUsers(guild, actor.id, role.id, { added });
        bumpSession(session);
        await refreshSessionMessage(guild, session);
        return interaction.deferUpdate();
      }
    }

    // Modal submit (search)
    if (interaction.isModalSubmit()) {
      const meta = parseSessionId(interaction.customId);
      if (!meta || meta.type !== 'modal' || meta.action !== 'search') return;
      const session = sessions.get(meta.sid);
      if (!session) return interaction.reply(eph('⏳ Session expirée. Relance la commande.'));
      if (interaction.user.id !== session.actorId) return interaction.reply(eph('⛔ Cette interface ne t’appartient pas.'));
      if (ensureSessionTimeout(meta.sid)) {
        sessions.delete(meta.sid);
        return interaction.reply(eph('⏳ Session expirée. Relance la commande.'));
      }
      const guild = interaction.guild;
      const q = (interaction.fields.getTextInputValue('q') || '').trim().toLowerCase();

      let rolesPool;
      if (session.kind === 'editor') {
        const actor = await guild.members.fetch(session.actorId);
        const me = guild.members.me;
        rolesPool = computeManageableRoles(guild, actor, me, { includeBlacklisted: canSysPlus(actor.id) });
      } else {
        rolesPool = [...allGuildRolesSorted(guild).values()];
      }
      const results = rolesPool.filter(r => r.name.toLowerCase().includes(q) || r.id === q).slice(0, 25);
      if (!results.length) {
        bumpSession(session);
        return interaction.reply({ content: `🔎 Aucun rôle trouvé pour \`${q}\`.`, allowedMentions: { parse: [] } });
      }

      session._searchResults = results;

      let options;
      if (session.kind === 'editor') {
        const target = await guild.members.fetch(session.targetId);
        options = rolesToOptionsForMember(results, target).map(o => ({...o, default: o.default || false}));
      } else if (session.kind === 'blackrole') {
        const set = new Set(db.blackRoles || []);
        options = rolesToOptionsForSet(results, set).map(o => ({...o, default: !!o.default}));
      } else {
        const set = new Set(session.blrMode==='keep' ? (db.blrKeepRoles||[]) : (db.blrAddRoles||[]));
        options = rolesToOptionsForSet(results, set).map(o => ({...o, default: !!o.default}));
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`re:selsearch:${session.id}:${session.page}`)
        .setPlaceholder('Sélectionne (coché = actif)')
        .setMinValues(0)
        .setMaxValues(Math.min(25, options.length || 1))
        .addOptions(options.length ? options : [{ label:'Aucune option', value:'none' }])
        .setDisabled(options.length === 0);

      const row = new ActionRowBuilder().addComponents(menu);

      const embed = E()
        .setTitle('🔎 Résultats de recherche')
        .setColor(0x5865F2)
        .setDescription('Coche ce qui doit être **actif** dans le contexte courant.')
        .addFields({ name:'Correspondances', value: results.map(r => `• ${r.name} — ${mentionRole(r.id)} \`${r.id}\``).join('\n').slice(0,1024) })
        .setTimestamp(new Date());
      bumpSession(session);
      return interaction.reply({ embeds: [embed], components: [row] });
    }

  } catch (e) {
    try { if (interaction.isRepliable()) await interaction.reply(eph('⚠️ Erreur.')); } catch {}
  }
});

// === UTIL ===
function computeManageableRoles(guild, actorMember, botMember, { includeBlacklisted = false } = {}) {
  const blacklist = new Set(db.blackRoles || []);
  const roles = guild.roles.cache
    .filter(r => roleManageableBy(actorMember, botMember, r) && (includeBlacklisted || !blacklist.has(r.id)))
    .sort((a,b) => b.position - a.position);
  return [...roles.values()];
}
function allGuildRolesSorted(guild){
  return guild.roles.cache.filter(r => r.id !== guild.id).sort((a,b)=> b.position - a.position);
}
function rolesToOptionsForMember(roles, targetMember) {
  const current = new Set(targetMember.roles.cache.map(r => r.id));
  return roles.map(r => ({
    label: r.name.slice(0, 100),
    value: r.id,
    description: `pos:${r.position}`.slice(0, 100),
    default: current.has(r.id)
  }));
}
function rolesToOptionsForSet(roles, selectedSet) {
  return roles.map(r => ({
    label: r.name.slice(0, 100),
    value: r.id,
    description: `pos:${r.position}`.slice(0, 100),
    default: selectedSet.has(r.id)
  }));
}

// Bot peut-il gérer ce rôle ? (ignore blacklist)
function botCanManageRole(guild, role){
  try {
    const me = guild.members.me;
    if (!me) return false;
    if (!me.permissions?.has?.('ManageRoles')) return false;
    if (role.managed) return false;
    if (role.id === guild.id) return false; // @everyone
    return me.roles.highest.comparePositionTo(role) > 0;
  } catch { return false; }
}

function buildEditorEmbed(guild, targetMember, session) {
  const targetRoles = targetMember.roles.cache
    .filter(r => r.id !== guild.id)
    .sort((a,b) => b.position - a.position);
  const targetList = targetRoles.map(r => `• **${mentionRole(r.id)}** - \`${r.id}\``).join('\n') || '*Aucun*';
  return E()
    .setTitle('🛠️ Modificateur de rôles d’un membre')
    .setColor(0x5865F2)
    .addFields(
      { name:'`👤` ▸ Membre cible', value:`• ${mentionUser(session.targetId)} - \`${session.targetId}\`` },
      { name:'`🏷️` ▸ Rôles actuels', value: truncate(targetList, 1024) }
    )
    .setTimestamp(new Date());
}

function buildBlackRoleEmbed(){
  const list = db.blackRoles || [];
  return E()
    .setTitle('⛔ Gestion de la blacklist des rôles')
    .setColor(0x9B59B6)
    .addFields({ name:'`📃` ▸ Rôles blacklistés', value: prettyListRoles(list).slice(0, 1024) })
    .setTimestamp(new Date());
}

function buildBlrConfigEmbed(guild, session){
  const keep = db.blrKeepRoles || [];
  const add  = db.blrAddRoles  || [];
  const modeLabel = session.blrMode === 'keep' ? '🎒 Mode : **`Conserver`**' : '➕ Mode: **`Ajouter`**';
  return E()
    .setTitle('🧰 Configuration BLR')
    .setColor(0x2F3136)
    .setDescription(modeLabel)
    .addFields(
      { name:'`🎯` ▸ Rôles conservés', value: prettyListRoles(keep).slice(0, 1024) || '*Aucun*' },
      { name:'`➕` ▸ Rôles ajoutés',   value: prettyListRoles(add).slice(0, 1024) || '*Aucun*' }
    )
    .setTimestamp(new Date());
}

// ==== /role member UI ====
function buildRoleMembersEmbed(guild, role, session, membersOnPage){
  const list = membersOnPage.length
    ? membersOnPage.map(m => `• ${mentionUser(m.id)} - \`${m.id}\``).join('\n')
    : '*Aucun membre sur cette page*';

  return E()
    .setTitle('👥 Gestion des membres du rôle')
    .setColor(0x5865F2)
    .addFields(
      { name:'`🏷️` ▸ Rôle', value:`• ${mentionRole(role.id)} - \`${role.id}\``, inline:false },
      { name:'`#️⃣` ▸ Membres', value:`**${role.members.size}** au total`, inline:false },
      { name:`\`📄\` ▸ Page ${session.page+1}/${session.pages.length}`, value: list.slice(0, 1024) }
    )
    .setTimestamp(new Date());
}

function pagerRow(session){
  const first = new ButtonBuilder().setCustomId(`re:btn:first:${session.id}:${session.page}`).setLabel('⏪').setStyle(ButtonStyle.Secondary);
  const back  = new ButtonBuilder().setCustomId(`re:btn:back:${session.id}:${session.page}`).setLabel('◀️').setStyle(ButtonStyle.Secondary);
  const info  = new ButtonBuilder().setCustomId(`re:btn:nop:${session.id}:${session.page}`).setLabel(`Page ${session.page+1}/${session.pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true);
  const next  = new ButtonBuilder().setCustomId(`re:btn:next:${session.id}:${session.page}`).setLabel('▶️').setStyle(ButtonStyle.Secondary);
  const last  = new ButtonBuilder().setCustomId(`re:btn:last:${session.id}:${session.page}`).setLabel('⏩').setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(first, back, info, next, last);
}

function toolsRow(session, {includeSwitch=false, switchLabel=''} = {}){  
  const removeAll = new ButtonBuilder().setCustomId(`re:btn:removeall:${session.id}:${session.page}`).setLabel('🔴〡Tout Supprimer').setStyle(ButtonStyle.Danger);
  const search = new ButtonBuilder().setCustomId(`re:btn:search:${session.id}:${session.page}`).setLabel('🔎〡Recherche').setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(search, removeAll);
  if (includeSwitch){
    const sw = new ButtonBuilder().setCustomId(`re:btn:switch:${session.id}:${session.page}`).setLabel(switchLabel).setStyle(ButtonStyle.Secondary);
    row.addComponents(sw);
  }
  return row;
}

function editorComponents(session, targetMember){
  const pageRoles = session.pages[session.page] || [];
  const options = rolesToOptionsForMember(pageRoles, targetMember).slice(0,25);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`re:sel:${session.id}:${session.page}`)
    .setPlaceholder('Sélectionne pour AJOUTER/RETIRER immédiatement')
    .setMinValues(0)
    .setMaxValues(Math.min(25, options.length || 1))
    .addOptions(options.length ? options : [{ label:'Aucune option', value:'none', default:false }])
    .setDisabled(options.length === 0);

  return [
    new ActionRowBuilder().addComponents(select),
    pagerRow(session),
    toolsRow(session)
  ];
}

function blackroleComponents(session){
  const selected = new Set(db.blackRoles || []);
  const pageRoles = session.pages[session.page] || [];
  const options = rolesToOptionsForSet(pageRoles, selected).slice(0,25);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`re:sel:${session.id}:${session.page}`)
    .setPlaceholder('Blacklist: coché = DANS la blacklist')
    .setMinValues(0)
    .setMaxValues(Math.min(25, options.length || 1))
    .addOptions(options.length ? options : [{ label:'Aucune option', value:'none', default:false }])
    .setDisabled(options.length === 0);
  return [
    new ActionRowBuilder().addComponents(select),
    pagerRow(session),
    toolsRow(session)
  ];
}
function blrConfigComponents(session){
  const selected = new Set(session.blrMode === 'keep' ? (db.blrKeepRoles||[]) : (db.blrAddRoles||[]));
  const pageRoles = session.pages[session.page] || [];
  const options = rolesToOptionsForSet(pageRoles, selected).slice(0,25);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`re:sel:${session.id}:${session.page}`)
    .setPlaceholder(session.blrMode==='keep' ? 'Conserver: coché = sera CONSERVÉ' : 'Ajouter: coché = sera AJOUTÉ')
    .setMinValues(0)
    .setMaxValues(Math.min(25, options.length || 1))
    .addOptions(options.length ? options : [{ label:'Aucune option', value:'none', default:false }])
    .setDisabled(options.length === 0);
  const switchLabel = session.blrMode==='keep' ? 'Basculer ➜ Ajouter' : 'Basculer ➜ Conserver';
  return [
    new ActionRowBuilder().addComponents(select),
    pagerRow(session),
    toolsRow(session, {includeSwitch:true, switchLabel})
  ];
}

// /role member components
function roleMembersComponents(session, membersOnPage){
  if (session.mode === 'remove') {
    const opts = membersOnPage.map(m => ({
      label: (m.user?.tag || m.displayName || m.id).slice(0, 100),
      value: m.id
    })).slice(0, 25);

    // Si page vide → menu désactivé avec option factice
    const select = new StringSelectMenuBuilder()
      .setCustomId(`re:sel:${session.id}:${session.page}`)
      .setPlaceholder(opts.length ? 'Sélectionne pour RETIRER le rôle' : 'Aucun membre à retirer')
      .setMinValues(Math.min(1, Math.max(1, opts.length || 1))) // 1
      .setMaxValues(Math.min(25, Math.max(1, opts.length || 1))) // ≥1
      .addOptions(opts.length ? opts : [{ label:'(vide)', value:'none' }])
      .setDisabled(opts.length === 0);

    return [
      new ActionRowBuilder().addComponents(select),
      pagerRow(session),
      toolsRow(session, { includeSwitch: true, switchLabel: 'Basculer ➜ Ajouter des membres' })
    ];
  }

  // mode add
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(`re:usel:${session.id}:${session.page}`)
    .setPlaceholder('Choisis des membres à AJOUTER au rôle')
    .setMinValues(1)
    .setMaxValues(25);

  return [
    new ActionRowBuilder().addComponents(userSelect),
    pagerRow(session),
    toolsRow(session, { includeSwitch: true, switchLabel: 'Basculer ➜ Retirer des membres' })
  ];
}

function ensureSessionTimeout(id){ const s=sessions.get(id); return !s || (Date.now()-s.createdAt) > 5*60*1000; }
function bumpSession(s){ if (s) s.createdAt = Date.now(); }

// Parse customId helper
function parseSessionId(id){
  const p=id.split(':');
  if (p[0]!=='re') return null;
  if (p[1]==='sel') return {type:'sel', sid:p[2], page:parseInt(p[3]||'0',10)||0};
  if (p[1]==='selsearch') return {type:'selsearch', sid:p[2], page:parseInt(p[3]||'0',10)||0};
  if (p[1]==='usel') return {type:'usel', sid:p[2], page:parseInt(p[3]||'0',10)||0};
  if (p[1]==='btn') return {type:'btn', action:p[2], sid:p[3], page:parseInt(p[4]||'0',10)||0};
  if (p[1]==='modal') return {type:'modal', action:p[2], sid:p[3], page:parseInt(p[4]||'0',10)||0};
  return null;
}

// === REFRESH UI ===
async function refreshSessionMessage(interactionGuild, session){
  try {
    const channel = interactionGuild.channels.cache.get(session.channelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(session.msgId).catch(()=>null);
    if (!msg) return;

    let embeds = [], components = [];
    if (session.kind === 'editor'){
      const target = await interactionGuild.members.fetch(session.targetId);
      embeds = [ buildEditorEmbed(interactionGuild, target, session) ];
      components = editorComponents(session, target);
    } else if (session.kind === 'blackrole'){
      embeds = [ buildBlackRoleEmbed(interactionGuild) ];
      components = blackroleComponents(session);
    } else if (session.kind === 'blr'){
      embeds = [ buildBlrConfigEmbed(interactionGuild, session) ];
      components = blrConfigComponents(session);
    } else if (session.kind === 'rolemembers'){
      const role = await interactionGuild.roles.fetch(session.roleId);
      const members = [...role.members.values()];
      let pages = chunk(members, PAGE_ROLE_MEMBERS);
      if (pages.length === 0) pages = [[]];
      session.pages = pages;
      session.page = Math.min(session.page, pages.length - 1);
      const page = session.pages[session.page] || [];
      embeds = [ buildRoleMembersEmbed(interactionGuild, role, session, page) ];
      components = roleMembersComponents(session, page);
    }
    await msg.edit({ embeds, components });
  } catch {}
}

// === LOGS (roles modifs) ===
async function logRoleChangeBatch(guild, actorId, targetId, addedRoleIds = [], removedRoleIds = [], info){
  if ((!addedRoleIds || !addedRoleIds.length) && (!removedRoleIds || !removedRoleIds.length)) return;
  const embed = logEmbed({
    title: '📝 Rôles modifiés',
    color: addedRoleIds.length && !removedRoleIds.length ? 0x57F287 : removedRoleIds.length && !addedRoleIds.length ? 0xED4245 : 0xFEE75C,
    actorId, targetId, guild,
    addedRoleIds, removedRoleIds, info
  });
  await sendLogEmbed(guild, embed);
}

// === ACTIONS BLR réutilisables ===
async function performBLR(guild, actorId, target){
  const keep = new Set(db.blrKeepRoles || []);
  const manageable = new Set([...guild.roles.cache.values()]
    .filter(r => botCanManageRole(guild, r)).map(r=>r.id));

  const toRemove = target.roles.cache
    .filter(r => manageable.has(r.id) && !keep.has(r.id))
    .map(r => r.id);

  const removed = [];
  for (const rid of toRemove) { try { await target.roles.remove(rid, 'BLR - purge'); removed.push(rid); } catch {} }

  const toAdd = (db.blrAddRoles || []).filter(rid => manageable.has(rid) && !target.roles.cache.has(rid));
  const added = [];
  for (const rid of toAdd) { try { await target.roles.add(rid, 'BLR - assign'); added.push(rid); } catch {} }

  if (!Array.isArray(db.blrUsers)) db.blrUsers = [];
  if (!db.blrUsers.includes(target.id)) db.blrUsers.push(target.id);
  await saveDb();

  await sendLogEmbed(guild, logEmbed({
    title:'🚫 BLR appliqué (persistant)',
    color:0xED4245, actorId, targetId: target.id, guild,
    addedRoleIds: added, removedRoleIds: removed
  }));

  return { added, removed };
}
async function performUNBLR(guild, actorId, userId){
  if (!Array.isArray(db.blrUsers)) db.blrUsers = [];
  const idx = db.blrUsers.indexOf(userId);
  if (idx !== -1) {
    db.blrUsers.splice(idx, 1);
    await saveDb();
    await sendLogEmbed(guild, logEmbed({
      title:'✅ UNBLR effectué',
      color:0x57F287, actorId, targetId: userId, guild
    }));
    return true;
  }
  return false;
}

// === COMMAND HANDLERS ===
async function handleHelp(interaction) {
  const embed = E()
    .setTitle('❓ Aide du bot')
    .setColor(0x000000)
    .setDescription('*Bot de Gestion des Rôles*\n**Prefix : `/`**')
    .addFields(
      { name:'**__Général__**', value: [
        '\`🧭\` ▸ `/help` : Affiche ce menu',
        '\`🛠️\` ▸ `/edit roles <@User/ID>` : Éditeur de rôles',
        '\`➕\` ▸ `/addrole <@User/ID> <Role>` : Ajouter un rôle à un membre',
      ].join('\n') },
      { name:'**__Rôles__**', value: [
        '\`ℹ️\` ▸ `/role info <Role>` : Infos détaillées d’un rôle',
        '\`👥\` ▸ `/role member <Role>` : Gérer les membres du rôle',
      ].join('\n') },
      { name:'**__Permissions__**', value: [
        '\`📃\` ▸ `/wl <@User/ID>` : Liste/Ajoute/Retirer WL',
        '\`🏠\` ▸ `/owner <@User/ID>` : Liste/Ajoute/Retirer OWNER',
        '\`👑\` ▸ `/sys <@User/ID>` : Liste/Ajoute/Retirer SYS',
      ].join('\n') },
      { name:'**__Blacklist Rôles__**', value: [
        '\`🚫\` ▸ `/blackrole` : UI Blacklist',
      ].join('\n') },
      { name:'**__Blacklist Rank__**', value: [
        '\`⚪\` ▸ `/blr <@User/ID>` : Appliquer BLR',
        '\`🔓\` ▸ `/unblr <@User/ID>` : Retirer BLR',
        '\`⚫\` ▸ `/blrconfig` : Configurer listes Conserver/Ajouter',
      ].join('\n') },
      { name:'**__Logs__**', value: '📝 `/setlogsrole <#Salon> <off/true>`' }
    )
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("🔗 Support / Doc")
      .setStyle(ButtonStyle.Link)
      .setURL("https://guns.lol/d34fr")
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

async function handleEditRoles(interaction) {
  const guild = interaction.guild;
  const actor = await guild.members.fetch(interaction.user.id);
  const targetUser = interaction.options.getUser('user', true);
  const target = await guild.members.fetch(targetUser.id);
  const me = guild.members.me;

  if (!canUseEditRoles(actor.id))  return interaction.reply(eph('⛔ Accès refusé (WL requis).'));
  if (!hasBotRolePerms(guild, me))  return interaction.reply(eph('❌ Le bot a besoin de la permission **Manage Roles**.'));
  if (!canEditTarget(actor, target)) return interaction.reply(eph('⛔ Tu ne peux pas éditer ce membre.'));

  // BLR => refuse & log
  if (!Array.isArray(db.blrUsers)) db.blrUsers = [];
  if (db.blrUsers.includes(target.id)) {
    const warn = E().setTitle('🚫 Édition refusée').setColor(0xED4245).setDescription(`${mentionUser(target.id)} est **BL Rank**. Ses rôles ne peuvent pas être modifiés.`).setTimestamp(new Date());
    await interaction.reply({ embeds: [warn] });
    await sendLogEmbed(guild, logEmbed({
      title:'🛡️ Tentative d’édition d’un membre BLR',
      color:0xED4245, actorId: actor.id, targetId: target.id, guild
    }));
    return;
  }

  const manageable = computeManageableRoles(guild, actor, me, { includeBlacklisted: canSysPlus(actor.id) });
  if (!manageable.length) return interaction.reply(eph('ℹ️ Aucun rôle gérable (ou blacklist).'));

  const sid = shortId();
  const session = {
    id: sid, guildId: guild.id, actorId: actor.id, targetId: target.id,
    kind: 'editor',
    page: 0, pages: chunk(manageable, 25),
    createdAt: Date.now(),
    msgId: null, channelId: interaction.channelId,
  };
  sessions.set(sid, session);

  const embed = buildEditorEmbed(guild, target, session);
  const components = editorComponents(session, target);
  await interaction.reply({ embeds: [embed], components });
  const msg = await interaction.fetchReply();
  session.msgId = msg.id;

  await logAction(guild, '🧰 Éditeur ouvert', actor.id, `Cible: ${mentionUser(target.id)} (\`${target.id}\`)`);
}

// Toggle/list embeds for sys/owner/wl
async function handleToggleListEmbed(interaction, kind){
  const userOpt = interaction.options.getUser('user', false);
  const actorId = interaction.user.id;
  const guild = interaction.guild;

  if (kind === 'sys'   && !canCmdSYS(actorId))   return interaction.reply(eph('⛔ Accès refusé (SYS+).'));
  if (kind === 'owner' && !canCmdOWNER(actorId)) return interaction.reply(eph('⛔ Accès refusé (SYS+).'));
  if (kind === 'wl'    && !canCmdWL(actorId))    return interaction.reply(eph('⛔ Accès refusé (OWNER+).'));

  const arr = Array.isArray(db[kind]) ? db[kind] : (db[kind] = []);

  if (!userOpt) {
    const embed = E()
      .setTitle(`📋 Liste ${kind.toUpperCase()}`)
      .setColor(0x5865F2)
      .setDescription(prettyListUsers(arr))
      .setTimestamp(new Date());
    return interaction.reply({ embeds: [embed] });
  }

  const targetId = userOpt.id;
  if (kind === 'sys' && isSysPlus(db, targetId)) {
    const warn = E().setTitle('⛔ Accès refusé').setColor(0xED4245).setDescription(`${mentionUser(targetId)} est Owner Bot (SYS+).`);
    return interaction.reply({ embeds: [warn] });
  }

  const idx = arr.indexOf(targetId);
  let action;
  if (idx === -1) { arr.push(targetId); action = 'Ajout'; }
  else { arr.splice(idx, 1); action = 'Retrait'; }
  await saveDb();

  const listEmbed = E()
    .setTitle(`📋 ${kind.toUpperCase()} — Mise à jour`)
    .setColor(action==='Ajout' ? 0x57F287 : 0xED4245)
    .addFields(
      { name:'`✅` ▸ Action', value: action, inline:true },
      { name:'`📌` ▸ Groupe', value: kind.toUpperCase(), inline:true },
      { name:'`🎯` ▸ Cible', value: `• ${mentionUser(targetId)} - \`${targetId}\`` }
    )
    .addFields({ name:'`📃` ▸ Liste actuelle', value: prettyListUsers(arr).slice(0, 1024) })
    .setTimestamp(new Date());

  await interaction.reply({ embeds: [listEmbed] });

  const log = logEmbed({
    title:`🔧 Permissions modifiées — ${kind.toUpperCase()}`,
    color: action==='Ajout' ? 0x57F287 : 0xED4245,
    actorId, guild,
    [action==='Ajout'?'addedUserIds':'removedUserIds']:[targetId]
  });
  await sendLogEmbed(guild, log);
}

// === BLACKROLE UI (full) ===
async function handleBlackRoleUI(interaction){
  const actorId = interaction.user.id;
  if (!canBlackRole(actorId)) return interaction.reply(eph('⛔ Accès refusé (SYS+).'));

  const guild = interaction.guild;
  const all = [...allGuildRolesSorted(guild).values()];
  const sid = shortId();
  const session = {
    id: sid, guildId: guild.id, actorId,
    kind: 'blackrole',
    page: 0, pages: chunk(all, PAGE_ROLES_BLACK),
    createdAt: Date.now(),
    msgId: null, channelId: interaction.channelId,
  };
  sessions.set(sid, session);

  const embed = buildBlackRoleEmbed(guild);
  const components = blackroleComponents(session);
  await interaction.reply({ embeds: [embed], components });
  const msg = await interaction.fetchReply();
  session.msgId = msg.id;
}

// === BLR CONFIG ===
async function handleBlrConfig(interaction){
  const actorId = interaction.user.id;
  if (!canBLRConfig(actorId)) return interaction.reply(eph('⛔ Accès refusé (SYS+).'));
  const guild = interaction.guild;
  const all = [...allGuildRolesSorted(guild).values()];

  const sid = shortId();
  const session = {
    id: sid, guildId: guild.id, actorId,
    kind: 'blr',
    blrMode: 'keep', // keep | add
    page: 0, pages: chunk(all, PAGE_ROLES_BLACK),
    createdAt: Date.now(),
    msgId: null, channelId: interaction.channelId,
  };
  sessions.set(sid, session);

  const embed = buildBlrConfigEmbed(guild, session);
  const components = blrConfigComponents(session);
  await interaction.reply({ embeds: [embed], components });
  const msg = await interaction.fetchReply();
  session.msgId = msg.id;
}

// === BLR USER (/blr <@user>) ===
async function handleBlrUser(interaction){
  const actorId = interaction.user.id;
  if (!canBLR(actorId)) return interaction.reply(eph('⛔ Accès refusé (WL+).'));
  const guild = interaction.guild;
  const targetUser = interaction.options.getUser('user', true);
  const target = await guild.members.fetch(targetUser.id);

  const { added, removed } = await performBLR(guild, actorId, target);

  const resp = E()
    .setTitle('🚫 BLR appliqué')
    .setColor(0xED4245)
    .addFields(
      { name:'`🎯` ▸ Membre', value:`• ${mentionUser(target.id)} - \`${target.id}\`` },
      { name:'`✅` ▸ Rôles ajoutés', value: added.length ? prettyListRoles(added).slice(0,1024) : '*Aucun*' }
    )
    .setTimestamp(new Date());

  await interaction.reply({ embeds: [resp] });
}

// === UNBLR USER (/unblr <@user>) ===
async function handleUnblrUser(interaction){
  const actorId = interaction.user.id;
  if (!canBLR(actorId)) return interaction.reply(eph('⛔ Accès refusé (WL+).'));
  const guild = interaction.guild;
  const targetUser = interaction.options.getUser('user', true);

  const changed = await performUNBLR(guild, actorId, targetUser.id);
  if (!changed) {
    const warn = E().setTitle('ℹ️ Non BLR').setColor(0x5865F2).setDescription(`${mentionUser(targetUser.id)} n’est pas dans la BLR.`);
    await interaction.reply({ embeds: [warn] });
    await logAction(guild, 'ℹ️ Tentative UNBLR — utilisateur non BLR', actorId, `Cible: ${mentionUser(targetUser.id)} (\`${targetUser.id}\`)`);
    return;
  }

  const ok = E()
    .setTitle('✅ BLR retiré')
    .setColor(0x57F287)
    .addFields({ name:'`🎯` ▸ Membre', value:`• ${mentionUser(targetUser.id)} - \`${targetUser.id}\`` })
    .setTimestamp(new Date());
  await interaction.reply({ embeds: [ok] });
}

// === /role info ===
async function handleRoleInfo(interaction){
  const role = interaction.options.getRole('role', true);
  const guild = interaction.guild;

  const perms = (role.permissions instanceof PermissionsBitField)
    ? role.permissions.toArray()
    : new PermissionsBitField(role.permissions).toArray();

  const membersCount = role.members.size;

  const fields = [
    { name:'`🆔` ▸ ID', value: `\`${role.id}\``, inline: true },
    { name:'`📌` ▸ Position', value: `\`${role.position}\``, inline: true },
    { name:'`🎨` ▸ Couleur', value: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '*Aucune*', inline: true },
    { name:'`📎` ▸ Mentionnable', value: role.mentionable ? 'Oui' : 'Non', inline: true },
    { name:'`📦` ▸ Séparé (hoist)', value: role.hoist ? 'Oui' : 'Non', inline: true },
    { name:'`👥` ▸ Membres', value: `**${membersCount}**`, inline: true },
  ];

  const permList = perms.length ? perms.map(p => `• \`${p}\``).join('\n') : '*Aucune permission*';

  const embed = E()
    .setTitle(`🏷️ Infos du rôle — ${role.name}`)
    .setColor(role.color || 0x5865F2)
    .setDescription(`${mentionRole(role.id)}`)
    .addFields(...fields)
    .addFields({ name:'`🛡 Permissions`', value: permList.slice(0, 1024) })
    .setTimestamp(new Date());

  await interaction.reply({ embeds: [embed] });
  await logAction(guild, 'ℹ️ Rôle info affiché', interaction.user.id, `Rôle: ${mentionRole(role.id)} (\`${role.id}\`)`);
}

// === /role member ===
async function handleRoleMembers(interaction){
  const guild = interaction.guild;
  const role = interaction.options.getRole('role', true);
  const actorId = interaction.user.id;

  if (!canOwnerPlus(actorId)) return interaction.reply(eph('⛔ Accès refusé (OWNER+).'));
  if ((db.blackRoles || []).includes(role.id)) return interaction.reply(eph('⛔ Ce rôle est **BlackRole** et ne peut pas être géré ici.'));

  const actor = await guild.members.fetch(actorId);
  const me = guild.members.me;

  if (!roleManageableBy(actor, me, role)) return interaction.reply(eph('❌ Ni toi ni le bot ne pouvez gérer ce rôle.'));

  const members = [...role.members.values()];
  let pages = chunk(members, PAGE_ROLE_MEMBERS);
  if (pages.length === 0) pages = [[]]; // garantir ≥ 1 page

  const sid = shortId();
  const session = {
    id: sid, guildId: guild.id, actorId, kind: 'rolemembers',
    roleId: role.id,
    mode: 'remove', // remove | add
    page: 0, pages,
    createdAt: Date.now(),
    msgId: null, channelId: interaction.channelId,
  };
  sessions.set(sid, session);

  const page = session.pages[0] || [];
  const embed = buildRoleMembersEmbed(guild, role, session, page);
  const components = roleMembersComponents(session, page);

  await interaction.reply({ embeds: [embed], components });
  const msg = await interaction.fetchReply();
  session.msgId = msg.id;

  await logAction(guild, '👥 UI Rôle Membres ouverte', actorId, `Rôle: ${mentionRole(role.id)} (\`${role.id}\`)`);
}

// === /addrole ===
async function handleAddRole(interaction){
  const guild = interaction.guild;
  const actor = await guild.members.fetch(interaction.user.id);
  const me = guild.members.me;
  if (!canWLPlus(actor.id)) return interaction.reply(eph('⛔ Accès refusé (WL+).'));

  const targetUser = interaction.options.getUser('user', true);
  const role = interaction.options.getRole('role', true);
  const target = await guild.members.fetch(targetUser.id);

  if (!hasBotRolePerms(guild, me)) return interaction.reply(eph('❌ Le bot a besoin de la permission **Manage Roles**.'));
  if (Array.isArray(db.blrUsers) && db.blrUsers.includes(target.id)) return interaction.reply(eph('🚫 Ce membre est **BLR**.'));
  if ((db.blackRoles || []).includes(role.id)) return interaction.reply(eph('⛔ Ce rôle est **BlackRole**.'));

  if (!canEditTarget(actor, target)) return interaction.reply(eph('⛔ Tu ne peux pas modifier les rôles de ce membre.'));
  if (!roleManageableBy(actor, me, role)) return interaction.reply(eph('⛔ Ce rôle est au-dessus de toi ou du bot.'));

  try {
    await target.roles.add(role.id, 'Commande /addrole');
  } catch {
    return interaction.reply(eph('❌ Impossible d’ajouter ce rôle.'));
  }

  await logRoleChangeBatch(guild, actor.id, target.id, [role.id], [], 'via /addrole');

  const ok = E()
    .setTitle('✅ Rôle ajouté')
    .setColor(0x57F287)
    .addFields(
      { name:'`🎯` ▸ Membre', value:`• ${mentionUser(target.id)} - \`${target.id}\`` },
      { name:'`🏷️` ▸ Rôle', value:`• ${mentionRole(role.id)} - \`${role.id}\`` }
    )
    .setTimestamp(new Date());
  return interaction.reply({ embeds: [ok] });
}

// Ré-application BLR si l’utilisateur revient
client.on('guildMemberAdd', async (member) => {
  try {
    if (!db) return;
    if (!Array.isArray(db.blrUsers)) db.blrUsers = [];
    if (!Array.isArray(db.blrKeepRoles)) db.blrKeepRoles = [];
    if (!Array.isArray(db.blrAddRoles)) db.blrAddRoles = [];

    if (!db.blrUsers.includes(member.id)) return;
    const guild = member.guild;
    const keep = new Set(db.blrKeepRoles || []);
    const manageable = new Set([...guild.roles.cache.values()]
      .filter(r => botCanManageRole(guild, r)).map(r=>r.id));

    const toRemove = member.roles.cache.filter(r => manageable.has(r.id) && !keep.has(r.id)).map(r => r.id);
    for (const rid of toRemove) { try { await member.roles.remove(rid, 'BLR rejoin - purge'); } catch {} }

    for (const rid of (db.blrAddRoles || []).filter(rid => manageable.has(rid))) { try { await member.roles.add(rid, 'BLR rejoin - assign'); } catch {} }

    const log = logEmbed({
      title:'🔁 BLR ré-appliqué (rejoin)',
      color:0xFEE75C, guild, targetId: member.id
    });
    await sendLogEmbed(guild, log);
  } catch {}
});

// ENFORCEMENT: empêcher tout ajout de rôle non autorisé à un BLR
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    if (!db) return;
    if (!Array.isArray(db.blrUsers)) db.blrUsers = [];
    if (!db.blrUsers.includes(newMember.id)) return;

    if (!Array.isArray(db.blrKeepRoles)) db.blrKeepRoles = [];
    if (!Array.isArray(db.blrAddRoles))  db.blrAddRoles  = [];

    const guild = newMember.guild;
    const allowed = new Set([ ...(db.blrKeepRoles||[]), ...(db.blrAddRoles||[]) ]);

    const toRemove = newMember.roles.cache
      .filter(r => r.id !== guild.id && !allowed.has(r.id) && botCanManageRole(guild, r))
      .map(r => r.id);

    if (!toRemove.length) return;

    const removed = [];
    for (const rid of toRemove) {
      try { await newMember.roles.remove(rid, 'BLR — Rôle Non Autorisé'); removed.push(rid); } catch {}
    }
    if (removed.length) {
      await sendLogEmbed(guild, logEmbed({
        title:'🛡️ BLR — Rôles non autorisés retirés (enforcement)',
        color:0xED4245, guild, targetId: newMember.id, removedRoleIds: removed
      }));
    }
  } catch {}
});

// === SET LOGS ===
async function handleSetLogsRole(interaction) {
  const actorId = interaction.user.id;
  if (!canSetLogs(actorId)) return interaction.reply(eph('⛔ Accès refusé (SYS+).'));

  const off = interaction.options.getBoolean('off', false);
  const channel = interaction.options.getChannel('channel', false);

  const guild = interaction.guild;
  const oldId = db.logChannelId;

  if (off) {
    db.logChannelId = "";
    await saveDb();
    const resp = E().setTitle('📴 Logs désactivés').setColor(0xFEE75C).setTimestamp(new Date());
    await interaction.reply({ embeds: [resp] });

    if (oldId) {
      const embed = logEmbed({
        title:'🟡 Salon de logs désactivé',
        color:0xFEE75C,
        actorId, guild, info:`Ancien: ${oldId ? `<#${oldId}> (\`${oldId}\`)` : 'Aucun'}`
      });
      const chan = guild.channels.cache.get(oldId); try { if (chan) await chan.send({ embeds: [embed] }); } catch {}
    }
    return;
  }

  if (!channel) {
    const cur = db.logChannelId ? `<#${db.logChannelId}> (\`${db.logChannelId}\`)` : 'Aucun';
    const curEmbed = E().setTitle('ℹ️ Logs').setColor(0x5865F2).setDescription(`Salon de logs actuel : ${cur}\nUtilise \`/setlogsrole channel:#salon\` pour le définir, ou \`/setlogsrole off:true\` pour désactiver.`);
    return interaction.reply({ embeds: [curEmbed] });
  }

  if (channel.guild.id !== guild.id) return interaction.reply(eph('❌ Le salon doit appartenir à cette guilde.'));
  if (channel.type !== ChannelType.GuildText) return interaction.reply(eph('❌ Choisis un **salon texte**.'));
  const me = guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms || !perms.has('SendMessages') || !perms.has('EmbedLinks')) return interaction.reply(eph('❌ Le bot a besoin de **Send Messages** et **Embed Links** dans ce salon.'));

  db.logChannelId = channel.id;
  await saveDb();

  const done = E()
    .setTitle('✅ Salon de logs défini')
    .setColor(0x57F287)
    .addFields(
      { name:'`🆕` ▸ Nouveau', value: `${channel} (\`${channel.id}\`)`, inline:true },
      { name:'`📄` ▸ Ancien', value: oldId ? `<#${oldId}> (\`${oldId}\`)` : 'Aucun', inline:true }
    ).setTimestamp(new Date());
  await interaction.reply({ embeds: [done] });

  const log = logEmbed({
    title:'🛠️ Salon de logs mis à jour',
    color:0xFEE75C, actorId, guild,
    info:`Ancien: ${oldId ? `<#${oldId}> (\`${oldId}\`)` : 'Aucun'}\nNouveau: ${channel} (\`${channel.id}\`)`
  });
  try { await channel.send({ embeds: [log] }); } catch {
    const old = guild.channels.cache.get(oldId); try { if (old) await old.send({ embeds: [log] }); } catch {}
  }
}

// === READY (log simple) ===
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

// === Déploiement des commandes (multi-apps optionnel) ===
async function deployAllApps() {
  const apps = Array.isArray(config.apps) && config.apps.length
    ? config.apps
    : [{ clientId: config.clientId, token: config.token, devGuildIds: config.devGuildIds }];

  for (const app of apps) {
    if (!app.clientId || !app.token) {
      console.error('❌ clientId ou token manquant dans config/apps. Skip.');
      continue;
    }
    const rest = new REST({ version: '10' }).setToken(app.token);
    try {
      if (Array.isArray(app.devGuildIds) && app.devGuildIds.length) {
        await Promise.all(
          app.devGuildIds.map(gid =>
            rest.put(Routes.applicationGuildCommands(app.clientId, gid), { body: commands })
          )
        );
        console.log(`✅ [${app.clientId}] commandes déployées (guild: ${app.devGuildIds.join(', ')}).`);
      } else {
        await rest.put(Routes.applicationCommands(app.clientId), { body: commands });
        console.log(`✅ [${app.clientId}] commandes globales déployées.`);
      }
    } catch (e) {
      console.error(`❌ [${app.clientId}] Échec déploiement :`, e);
    }
  }
}

// === BOOT ===
(async () => {
  await loadDb();
  await deployAllApps(); // déploie les commandes (DEV: guilde(s) si devGuildIds, sinon global)
  if (!config.token) {
    console.error('❌ Token manquant dans config.json');
    process.exit(1);
  }
  await client.login(config.token);
})();
