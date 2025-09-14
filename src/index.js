const { Client, GatewayIntentBits, Collection, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const { readJson, writeJsonAtomic } = require('./lib/storage');
const { isSysPlus, isSys, isOwner, isWL, canUseEditor } = require('./lib/permissions');
const { mentionUser, mentionRole, topRole, roleManageableBy, canEditTarget, chunk, truncate, hasBotRolePerms, shortId, buildList, eph } = require('./lib/utils');
const path = require('path');
require('dotenv').config();

const config = require('./config.json');
const dbPath = path.join(__dirname, 'data', 'role-editor.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

client.commands = new Collection();

// Fonction pour charger la base de données
async function loadDB() {
  return await readJson(dbPath, {
    'sys+': [],
    'sys': [],
    'owner': [],
    'wl': [],
    'blackRoles': [],
    'logChannelId': '',
    'blrKeepRoles': [],
    'blrAddRoles': [],
    'blrUsers': []
  });
}

// Fonction pour sauvegarder la base de données
async function saveDB(data) {
  await writeJsonAtomic(dbPath, data);
}

// Fonction pour logger les actions
async function logAction(guild, action, actor, details = '') {
  const db = await loadDB();
  if (!db.logChannelId) return;
  
  const channel = guild.channels.cache.get(db.logChannelId);
  if (!channel) return;
  
  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('📋 Action Role Editor')
    .addFields(
      { name: 'Action', value: action, inline: true },
      { name: 'Utilisateur', value: mentionUser(actor.id), inline: true },
      { name: 'Détails', value: details || 'Aucun', inline: false }
    )
    .setTimestamp()
    .setFooter({ text: config.footer });
  
  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Erreur lors du log:', error);
  }
}

// Fonction pour paginer les listes longues
function createPaginatedEmbed(title, items, itemsPerPage = 10, page = 0) {
  const totalPages = Math.ceil(items.length / itemsPerPage);
  const startIndex = page * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = items.slice(startIndex, endIndex);
  
  const embed = new EmbedBuilder()
    .setTitle(`${title} (Page ${page + 1}/${totalPages})`)
    .setColor('#0099ff')
    .setFooter({ text: config.footer });
  
  if (currentItems.length === 0) {
    embed.setDescription('Aucun élément à afficher.');
  } else {
    embed.setDescription(currentItems.join('\n'));
  }
  
  return { embed, totalPages, currentPage: page };
}

// Fonction pour créer les boutons de pagination
function createPaginationButtons(currentPage, totalPages, customId) {
  const row = new ActionRowBuilder();
  
  if (totalPages > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${customId}_prev_${currentPage}`)
        .setLabel('◀️ Précédent')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`${customId}_next_${currentPage}`)
        .setLabel('Suivant ▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === totalPages - 1)
    );
  }
  
  return row.components.length > 0 ? row : null;
}

// Commande /role member
const roleMemberCommand = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Gestion des rôles')
  .addSubcommand(subcommand =>
    subcommand
      .setName('member')
      .setDescription('Afficher tous les membres avec leurs rôles')
  );

// Commande /addrole
const addRoleCommand = new SlashCommandBuilder()
  .setName('addrole')
  .setDescription('Ajouter un rôle à un utilisateur')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Utilisateur à qui ajouter le rôle')
      .setRequired(true)
  )
  .addRoleOption(option =>
    option.setName('role')
      .setDescription('Rôle à ajouter')
      .setRequired(true)
  );

// Commande /editrole
const editRoleCommand = new SlashCommandBuilder()
  .setName('editrole')
  .setDescription('Modifier les rôles d\'un utilisateur')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Utilisateur dont modifier les rôles')
      .setRequired(true)
  );

// Commande /blackrole
const blackRoleCommand = new SlashCommandBuilder()
  .setName('blackrole')
  .setDescription('Gestion des rôles blacklistés')
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Ajouter un rôle à la blacklist')
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Rôle à blacklister')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Retirer un rôle de la blacklist')
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Rôle à retirer de la blacklist')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('Afficher la liste des rôles blacklistés')
  );

// Commande /blrconfig
const blrConfigCommand = new SlashCommandBuilder()
  .setName('blrconfig')
  .setDescription('Configuration du système BLR')
  .addSubcommand(subcommand =>
    subcommand
      .setName('keeproles')
      .setDescription('Gérer les rôles à conserver lors du BLR')
      .addStringOption(option =>
        option.setName('action')
          .setDescription('Action à effectuer')
          .setRequired(true)
          .addChoices(
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'list', value: 'list' }
          )
      )
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Rôle concerné')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('addroles')
      .setDescription('Gérer les rôles à ajouter lors du BLR')
      .addStringOption(option =>
        option.setName('action')
          .setDescription('Action à effectuer')
          .setRequired(true)
          .addChoices(
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'list', value: 'list' }
          )
      )
      .addRoleOption(option =>
        option.setName('role')
          .setDescription('Rôle concerné')
          .setRequired(false)
      )
  );

// Commande /blr
const blrCommand = new SlashCommandBuilder()
  .setName('blr')
  .setDescription('Gestion des utilisateurs BLR')
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Ajouter un utilisateur au BLR')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('Utilisateur à ajouter au BLR')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Retirer un utilisateur du BLR')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('Utilisateur à retirer du BLR')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('Afficher la liste des utilisateurs BLR')
  );

// Enregistrement des commandes
client.commands.set('role', roleMemberCommand);
client.commands.set('addrole', addRoleCommand);
client.commands.set('editrole', editRoleCommand);
client.commands.set('blackrole', blackRoleCommand);
client.commands.set('blrconfig', blrConfigCommand);
client.commands.set('blr', blrCommand);

client.once('ready', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  
  // Enregistrer les commandes slash
  try {
    const commands = Array.from(client.commands.values()).map(cmd => cmd.toJSON());
    await client.application.commands.set(commands);
    console.log('✅ Commandes slash enregistrées');
  } catch (error) {
    console.error('❌ Erreur lors de l\'enregistrement des commandes:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    await handleSlashCommand(interaction);
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
  }
});

async function handleSlashCommand(interaction) {
  const { commandName } = interaction;
  const db = await loadDB();
  
  // Vérification des permissions
  if (!canUseEditor(db, interaction.user.id)) {
    return interaction.reply(eph('❌ Vous n\'avez pas la permission d\'utiliser cette commande.'));
  }
  
  try {
    switch (commandName) {
      case 'role':
        await handleRoleMember(interaction, db);
        break;
      case 'addrole':
        await handleAddRole(interaction, db);
        break;
      case 'editrole':
        await handleEditRole(interaction, db);
        break;
      case 'blackrole':
        await handleBlackRole(interaction, db);
        break;
      case 'blrconfig':
        await handleBlrConfig(interaction, db);
        break;
      case 'blr':
        await handleBlr(interaction, db);
        break;
    }
  } catch (error) {
    console.error('Erreur lors du traitement de la commande:', error);
    const errorMsg = '❌ Une erreur est survenue lors du traitement de la commande.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(eph(errorMsg));
    } else {
      await interaction.reply(eph(errorMsg));
    }
  }
}

async function handleRoleMember(interaction, db) {
  await interaction.deferReply();
  
  const guild = interaction.guild;
  const members = await guild.members.fetch();
  
  const memberList = members.map(member => {
    const roles = member.roles.cache
      .filter(role => role.id !== guild.id)
      .map(role => role.name)
      .join(', ') || 'Aucun rôle';
    
    return `**${member.displayName}** (${member.user.tag})\n└ Rôles: ${roles}`;
  });
  
  if (memberList.length === 0) {
    return interaction.editReply('Aucun membre trouvé.');
  }
  
  const { embed, totalPages, currentPage } = createPaginatedEmbed(
    '👥 Liste des membres et leurs rôles',
    memberList,
    5,
    0
  );
  
  const paginationRow = createPaginationButtons(currentPage, totalPages, 'members');
  const components = paginationRow ? [paginationRow] : [];
  
  await interaction.editReply({ embeds: [embed], components });
}

async function handleAddRole(interaction, db) {
  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  const member = await interaction.guild.members.fetch(user.id);
  const actorMember = interaction.member;
  
  // Vérifications de sécurité
  if (!roleManageableBy(actorMember, interaction.guild.members.me, role)) {
    return interaction.reply(eph('❌ Je ne peux pas gérer ce rôle ou vous n\'avez pas la permission.'));
  }
  
  if (member.roles.cache.has(role.id)) {
    return interaction.reply(eph('❌ Cet utilisateur possède déjà ce rôle.'));
  }
  
  // Vérification blackrole pour sys et sys+
  if (db.blackRoles.includes(role.id) && !isSys(db, interaction.user.id)) {
    return interaction.reply(eph('❌ Ce rôle est blacklisté. Seuls les SYS et SYS+ peuvent l\'attribuer.'));
  }
  
  try {
    await member.roles.add(role);
    await interaction.reply(`✅ Rôle ${mentionRole(role.id)} ajouté à ${mentionUser(user.id)}.`);
    
    await logAction(
      interaction.guild,
      'Ajout de rôle',
      interaction.user,
      `Rôle ${role.name} ajouté à ${user.tag}`
    );
  } catch (error) {
    console.error('Erreur lors de l\'ajout du rôle:', error);
    await interaction.reply(eph('❌ Erreur lors de l\'ajout du rôle.'));
  }
}

async function handleEditRole(interaction, db) {
  const user = interaction.options.getUser('user');
  const member = await interaction.guild.members.fetch(user.id);
  const actorMember = interaction.member;
  
  if (!canEditTarget(actorMember, member)) {
    return interaction.reply(eph('❌ Vous ne pouvez pas modifier les rôles de cet utilisateur.'));
  }
  
  const roles = interaction.guild.roles.cache
    .filter(role => role.id !== interaction.guild.id && roleManageableBy(actorMember, interaction.guild.members.me, role))
    .sort((a, b) => b.position - a.position);
  
  const roleList = roles.map(role => {
    const hasRole = member.roles.cache.has(role.id);
    const isBlacklisted = db.blackRoles.includes(role.id);
    const canManage = !isBlacklisted || isSys(db, interaction.user.id);
    
    let status = hasRole ? '✅' : '❌';
    if (isBlacklisted && !isSys(db, interaction.user.id)) {
      status += ' 🚫';
    }
    
    return `${status} **${role.name}** ${canManage ? '' : '(Blacklisté)'}`;
  });
  
  if (roleList.length === 0) {
    return interaction.reply(eph('❌ Aucun rôle gérable trouvé.'));
  }
  
  const { embed, totalPages, currentPage } = createPaginatedEmbed(
    `🎭 Rôles de ${member.displayName}`,
    roleList,
    10,
    0
  );
  
  embed.setDescription(embed.data.description + '\n\n✅ = Possède le rôle | ❌ = N\'a pas le rôle | 🚫 = Blacklisté');
  
  const paginationRow = createPaginationButtons(currentPage, totalPages, `editrole_${user.id}`);
  const components = paginationRow ? [paginationRow] : [];
  
  await interaction.reply({ embeds: [embed], components });
}

async function handleBlackRole(interaction, db) {
  const subcommand = interaction.options.getSubcommand();
  
  // Seuls les SYS+ peuvent gérer les blackroles
  if (!isSysPlus(db, interaction.user.id)) {
    return interaction.reply(eph('❌ Seuls les SYS+ peuvent gérer les rôles blacklistés.'));
  }
  
  switch (subcommand) {
    case 'add':
      const roleToAdd = interaction.options.getRole('role');
      if (db.blackRoles.includes(roleToAdd.id)) {
        return interaction.reply(eph('❌ Ce rôle est déjà blacklisté.'));
      }
      
      db.blackRoles.push(roleToAdd.id);
      await saveDB(db);
      
      await interaction.reply(`✅ Rôle ${mentionRole(roleToAdd.id)} ajouté à la blacklist.`);
      await logAction(interaction.guild, 'Blacklist rôle', interaction.user, `Rôle ${roleToAdd.name} blacklisté`);
      break;
      
    case 'remove':
      const roleToRemove = interaction.options.getRole('role');
      const index = db.blackRoles.indexOf(roleToRemove.id);
      
      if (index === -1) {
        return interaction.reply(eph('❌ Ce rôle n\'est pas blacklisté.'));
      }
      
      db.blackRoles.splice(index, 1);
      await saveDB(db);
      
      await interaction.reply(`✅ Rôle ${mentionRole(roleToRemove.id)} retiré de la blacklist.`);
      await logAction(interaction.guild, 'Unblacklist rôle', interaction.user, `Rôle ${roleToRemove.name} retiré de la blacklist`);
      break;
      
    case 'list':
      if (db.blackRoles.length === 0) {
        return interaction.reply('📋 Aucun rôle blacklisté.');
      }
      
      const blacklistedRoles = db.blackRoles
        .map(roleId => {
          const role = interaction.guild.roles.cache.get(roleId);
          return role ? `• ${role.name} (${mentionRole(roleId)})` : `• Rôle supprimé (${roleId})`;
        });
      
      const { embed, totalPages, currentPage } = createPaginatedEmbed(
        '🚫 Rôles blacklistés',
        blacklistedRoles,
        10,
        0
      );
      
      const paginationRow = createPaginationButtons(currentPage, totalPages, 'blackroles');
      const components = paginationRow ? [paginationRow] : [];
      
      await interaction.reply({ embeds: [embed], components });
      break;
  }
}

async function handleBlrConfig(interaction, db) {
  const subcommand = interaction.options.getSubcommand();
  const action = interaction.options.getString('action');
  const role = interaction.options.getRole('role');
  
  if (!isSys(db, interaction.user.id)) {
    return interaction.reply(eph('❌ Seuls les SYS et SYS+ peuvent configurer le BLR.'));
  }
  
  const configKey = subcommand === 'keeproles' ? 'blrKeepRoles' : 'blrAddRoles';
  const configName = subcommand === 'keeproles' ? 'rôles à conserver' : 'rôles à ajouter';
  
  switch (action) {
    case 'add':
      if (!role) {
        return interaction.reply(eph('❌ Vous devez spécifier un rôle.'));
      }
      
      if (db[configKey].includes(role.id)) {
        return interaction.reply(eph(`❌ Ce rôle est déjà dans la liste des ${configName}.`));
      }
      
      db[configKey].push(role.id);
      await saveDB(db);
      
      await interaction.reply(`✅ Rôle ${mentionRole(role.id)} ajouté aux ${configName}.`);
      break;
      
    case 'remove':
      if (!role) {
        return interaction.reply(eph('❌ Vous devez spécifier un rôle.'));
      }
      
      const index = db[configKey].indexOf(role.id);
      if (index === -1) {
        return interaction.reply(eph(`❌ Ce rôle n'est pas dans la liste des ${configName}.`));
      }
      
      db[configKey].splice(index, 1);
      await saveDB(db);
      
      await interaction.reply(`✅ Rôle ${mentionRole(role.id)} retiré des ${configName}.`);
      break;
      
    case 'list':
      if (db[configKey].length === 0) {
        return interaction.reply(`📋 Aucun ${configName.slice(0, -1)} configuré.`);
      }
      
      const rolesList = db[configKey]
        .map(roleId => {
          const roleObj = interaction.guild.roles.cache.get(roleId);
          return roleObj ? `• ${roleObj.name} (${mentionRole(roleId)})` : `• Rôle supprimé (${roleId})`;
        });
      
      const { embed, totalPages, currentPage } = createPaginatedEmbed(
        `⚙️ ${configName.charAt(0).toUpperCase() + configName.slice(1)} BLR`,
        rolesList,
        10,
        0
      );
      
      const paginationRow = createPaginationButtons(currentPage, totalPages, `blrconfig_${subcommand}`);
      const components = paginationRow ? [paginationRow] : [];
      
      await interaction.reply({ embeds: [embed], components });
      break;
  }
}

async function handleBlr(interaction, db) {
  const subcommand = interaction.options.getSubcommand();
  
  if (!isSys(db, interaction.user.id)) {
    return interaction.reply(eph('❌ Seuls les SYS et SYS+ peuvent gérer le BLR.'));
  }
  
  switch (subcommand) {
    case 'add':
      const userToAdd = interaction.options.getUser('user');
      
      if (db.blrUsers.includes(userToAdd.id)) {
        return interaction.reply(eph('❌ Cet utilisateur est déjà dans le BLR.'));
      }
      
      const memberToAdd = await interaction.guild.members.fetch(userToAdd.id);
      
      // Appliquer le BLR
      const currentRoles = memberToAdd.roles.cache.filter(role => role.id !== interaction.guild.id);
      const rolesToKeep = currentRoles.filter(role => db.blrKeepRoles.includes(role.id));
      const rolesToAdd = db.blrAddRoles.map(roleId => interaction.guild.roles.cache.get(roleId)).filter(Boolean);
      
      // Retirer tous les rôles sauf ceux à conserver
      await memberToAdd.roles.set([...rolesToKeep.values(), ...rolesToAdd]);
      
      db.blrUsers.push(userToAdd.id);
      await saveDB(db);
      
      await interaction.reply(`✅ ${mentionUser(userToAdd.id)} ajouté au BLR.`);
      await logAction(interaction.guild, 'BLR ajouté', interaction.user, `Utilisateur ${userToAdd.tag} ajouté au BLR`);
      break;
      
    case 'remove':
      const userToRemove = interaction.options.getUser('user');
      const userIndex = db.blrUsers.indexOf(userToRemove.id);
      
      if (userIndex === -1) {
        return interaction.reply(eph('❌ Cet utilisateur n\'est pas dans le BLR.'));
      }
      
      db.blrUsers.splice(userIndex, 1);
      await saveDB(db);
      
      await interaction.reply(`✅ ${mentionUser(userToRemove.id)} retiré du BLR.`);
      await logAction(interaction.guild, 'BLR retiré', interaction.user, `Utilisateur ${userToRemove.tag} retiré du BLR`);
      break;
      
    case 'list':
      if (db.blrUsers.length === 0) {
        return interaction.reply('📋 Aucun utilisateur dans le BLR.');
      }
      
      const blrUsersList = [];
      for (const userId of db.blrUsers) {
        try {
          const user = await client.users.fetch(userId);
          blrUsersList.push(`• ${user.tag} (${mentionUser(userId)})`);
        } catch (error) {
          blrUsersList.push(`• Utilisateur introuvable (${userId})`);
        }
      }
      
      const { embed, totalPages, currentPage } = createPaginatedEmbed(
        '🚫 Utilisateurs BLR',
        blrUsersList,
        10,
        0
      );
      
      const paginationRow = createPaginationButtons(currentPage, totalPages, 'blrusers');
      const components = paginationRow ? [paginationRow] : [];
      
      await interaction.reply({ embeds: [embed], components });
      break;
  }
}

async function handleButtonInteraction(interaction) {
  const [action, direction, currentPageStr] = interaction.customId.split('_');
  const currentPage = parseInt(currentPageStr);
  
  let newPage = currentPage;
  if (direction === 'next') {
    newPage = currentPage + 1;
  } else if (direction === 'prev') {
    newPage = currentPage - 1;
  }
  
  // Récupérer les données selon le type d'action
  let items = [];
  let title = '';
  let itemsPerPage = 10;
  
  switch (action) {
    case 'members':
      const guild = interaction.guild;
      const members = await guild.members.fetch();
      
      items = members.map(member => {
        const roles = member.roles.cache
          .filter(role => role.id !== guild.id)
          .map(role => role.name)
          .join(', ') || 'Aucun rôle';
        
        return `**${member.displayName}** (${member.user.tag})\n└ Rôles: ${roles}`;
      });
      
      title = '👥 Liste des membres et leurs rôles';
      itemsPerPage = 5;
      break;
      
    case 'blackroles':
      const db = await loadDB();
      items = db.blackRoles
        .map(roleId => {
          const role = interaction.guild.roles.cache.get(roleId);
          return role ? `• ${role.name} (${mentionRole(roleId)})` : `• Rôle supprimé (${roleId})`;
        });
      title = '🚫 Rôles blacklistés';
      break;
      
    case 'blrusers':
      const dbBlr = await loadDB();
      items = [];
      for (const userId of dbBlr.blrUsers) {
        try {
          const user = await client.users.fetch(userId);
          items.push(`• ${user.tag} (${mentionUser(userId)})`);
        } catch (error) {
          items.push(`• Utilisateur introuvable (${userId})`);
        }
      }
      title = '🚫 Utilisateurs BLR';
      break;
      
    case 'blrconfig':
      const dbConfig = await loadDB();
      const configType = interaction.customId.includes('keeproles') ? 'blrKeepRoles' : 'blrAddRoles';
      const configName = configType === 'blrKeepRoles' ? 'rôles à conserver' : 'rôles à ajouter';
      
      items = dbConfig[configType]
        .map(roleId => {
          const role = interaction.guild.roles.cache.get(roleId);
          return role ? `• ${role.name} (${mentionRole(roleId)})` : `• Rôle supprimé (${roleId})`;
        });
      title = `⚙️ ${configName.charAt(0).toUpperCase() + configName.slice(1)} BLR`;
      break;
  }
  
  const { embed, totalPages } = createPaginatedEmbed(title, items, itemsPerPage, newPage);
  const paginationRow = createPaginationButtons(newPage, totalPages, action);
  const components = paginationRow ? [paginationRow] : [];
  
  await interaction.update({ embeds: [embed], components });
}

// Gestion des erreurs
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Connexion du bot
client.login(config.token);