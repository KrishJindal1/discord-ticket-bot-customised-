require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    Colors,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

// Server configuration storage
const serverConfigs = {};
const pendingTickets = new Map();
const ticketDetails = new Map();
const ticketCounters = {};

const countersFilePath = path.join(__dirname, 'ticketCounters.json');

async function loadTicketCounters() {
    try {
        const data = await fs.readFile(countersFilePath, 'utf8');
        const counters = JSON.parse(data);
        Object.assign(ticketCounters, counters);
        console.log('✅ Loaded ticket counters:', ticketCounters);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await saveTicketCounters();
            console.log('Created new ticket counters file');
        } else {
            console.error('Error loading ticket counters:', error);
        }
    }
}

async function saveTicketCounters() {
    try {
        await fs.writeFile(countersFilePath, JSON.stringify(ticketCounters));
        console.log('💾 Saved ticket counters:', ticketCounters);
    } catch (error) {
        console.error('Error saving ticket counters:', error);
    }
}

async function getNextTicketNumber(guildId) {
    if (!ticketCounters[guildId]) {
        ticketCounters[guildId] = 0;
    }
    ticketCounters[guildId]++;
    await saveTicketCounters();
    return ticketCounters[guildId];
}

// Improved server config loading with validation
function loadServerConfigs() {
    const serverIds = process.env.SERVER_IDS?.split(',') || [];
    
    for (const serverId of serverIds) {
        const serverIdTrimmed = serverId.trim();
        if (!serverIdTrimmed) continue;

        const panelChannelId = process.env[`${serverIdTrimmed}_PANEL_CHANNEL_ID`]?.trim();
        const categoryId = process.env[`${serverIdTrimmed}_CATEGORY_ID`]?.trim();
        const staffRoleId = process.env[`${serverIdTrimmed}_STAFF_ROLE_ID`]?.trim();
        const logChannelId = process.env[`${serverIdTrimmed}_LOG_CHANNEL_ID`]?.trim();

        const isValidSnowflake = (id) => id && /^\d{17,20}$/.test(id);
        
        if (isValidSnowflake(panelChannelId) && isValidSnowflake(categoryId) && isValidSnowflake(staffRoleId)) {
            serverConfigs[serverIdTrimmed] = {
                panelChannelId,
                categoryId,
                staffRoleId,
                logChannelId: isValidSnowflake(logChannelId) ? logChannelId : null
            };
            console.log(`✅ Loaded valid configuration for server ${serverIdTrimmed}`);
        } else {
            console.log(`❌ Skipping server ${serverIdTrimmed} due to invalid configuration`);
        }
    }
}

// Function to send persistent ticket panel for a server
async function sendPersistentTicketPanel(guildId) {
    const config = serverConfigs[guildId];
    if (!config || !config.panelChannelId) {
        console.log(`No valid panel configuration for server ${guildId}, skipping...`);
        return;
    }

    try {
        const channel = await client.channels.fetch(config.panelChannelId).catch(err => {
            console.error(`Error fetching panel channel ${config.panelChannelId} for server ${guildId}:`, err);
            return null;
        });

        if (!channel) {
            console.error(`Panel channel not found for server ${guildId}`);
            return;
        }

        // Try to find existing panel message
        const messages = await channel.messages.fetch({ limit: 10 }).catch(console.error);
        const panelMessage = messages?.find(m => 
            m.author.id === client.user.id && 
            m.components.length > 0 &&
            m.components[0].components.some(c => c.customId === 'create_ticket')
        );

        const panelEmbed = new EmbedBuilder()
            .setTitle('📩 Support Ticket System')
            .setDescription('Please select the appropriate ticket type below. Our support team will assist you shortly.')
            .setColor(Colors.Blurple)
            .addFields(
                { name: '🎫 General Inquiry', value: 'For any general questions or assistance', inline: true },
                { name: '🎁 Giveaway Claim', value: 'To claim your giveaway prize or reward', inline: true },
                { name: '🆘 Technical Support', value: 'For technical issues or account problems', inline: true }
            )
            .setFooter({ text: 'Response time: Typically within 24 hours' });

        const panelRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('General Inquiry')
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('create_giveaway_ticket')
                    .setLabel('Giveaway/Event Claim')
                    .setEmoji('🎁')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('create_support_ticket')
                    .setLabel('Tech Support')
                    .setEmoji('🆘')
                    .setStyle(ButtonStyle.Danger)
            );

        try {
            if (panelMessage) {
                await panelMessage.edit({
                    embeds: [panelEmbed],
                    components: [panelRow]
                });
                console.log(`Updated ticket panel for server ${guildId}`);
            } else {
                await channel.send({
                    embeds: [panelEmbed],
                    components: [panelRow]
                });
                console.log(`Created new ticket panel for server ${guildId}`);
            }
        } catch (error) {
            console.error('Error updating ticket panel:', error);
        }
    } catch (error) {
        console.error(`Error in sendPersistentTicketPanel for server ${guildId}:`, error);
    }
}

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    await loadTicketCounters();
    loadServerConfigs();
    
    // Send ticket panels only for servers with valid configurations
    for (const guildId in serverConfigs) {
        try {
            await sendPersistentTicketPanel(guildId);
        } catch (error) {
            console.error(`Error sending panel for server ${guildId}:`, error);
        }
    }
});

// Command to send the ticket panel
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ticket') {
        // Check if server is configured
        if (!serverConfigs[interaction.guild.id]) {
            return interaction.reply({
                content: 'This server is not configured for tickets. Please contact an administrator.',
                ephemeral: true
            });
        }

        try {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('create_ticket')
                        .setLabel('Create Ticket')
                        .setEmoji('🎫')
                        .setStyle(ButtonStyle.Primary)
                );

            const embed = new EmbedBuilder()
                .setTitle('Ticket Creation')
                .setDescription('Click the button below to create a new support ticket.')
                .setColor(Colors.Blurple)
                .setFooter({ text: 'You can create multiple tickets if needed' });

            await interaction.reply({ 
                embeds: [embed],
                components: [row],
                ephemeral: true
            });
        } catch (error) {
            console.error('Error handling ticket command:', error);
            if (!interaction.replied) {
                await interaction.reply({
                    content: 'An error occurred while processing your request. Please try again.',
                    ephemeral: true
                }).catch(console.error);
            }
        }
    }
});

async function handleCreateTicket(interaction, presetReason = null) {
    try {
        const guild = interaction.guild;
        const config = serverConfigs[guild.id];
        if (!config) {
            return interaction.reply({
                content: 'This server is not configured for tickets. Please contact an administrator.',
                ephemeral: true
            });
        }

        const user = interaction.user;

        const existingChannel = guild.channels.cache.find(c => 
            c.name.startsWith('ticket-') && 
            c.topic === user.id
        );
        
        if (existingChannel) {
            const embed = new EmbedBuilder()
                .setTitle('Existing Ticket Found')
                .setDescription(`You already have an open ticket: ${existingChannel}\n\nPlease use your existing ticket or close it before creating a new one.`)
                .setColor(Colors.Red);
            
            return interaction.reply({ 
                embeds: [embed],
                ephemeral: true
            });
        }

        const ticketNumber = await getNextTicketNumber(guild.id);
        const channelName = `ticket-${ticketNumber}`;

        const channel = await guild.channels.create({
            name: channelName,
            type: 0,
            parent: config.categoryId,
            topic: user.id,
            permissionOverwrites: [
                { 
                    id: guild.roles.everyone.id, 
                    deny: [PermissionsBitField.Flags.ViewChannel] 
                },
                { 
                    id: user.id, 
                    allow: [PermissionsBitField.Flags.ViewChannel],
                    deny: [PermissionsBitField.Flags.SendMessages]
                },
                {
                    id: config.staffRoleId,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                }
            ]
        });

        pendingTickets.set(channel.id, { 
            userId: user.id,
            ticketNumber: ticketNumber,
            guildId: guild.id
        });

        // Add delete button in case of mistake
        const deleteRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`delete_ticket_${channel.id}`)
                    .setLabel('Cancel Ticket')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Secondary)
            );

        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`Ticket #${ticketNumber}`)
            .setDescription(`${user}, please complete the ticket creation process below.\n\nYou can cancel this ticket using the button below if needed.`)
            .setColor(Colors.Blurple)
            .setFooter({ text: 'This process helps us serve you better' });

        await channel.send({
            embeds: [welcomeEmbed],
            components: [deleteRow]
        });

        // If preset reason was provided, skip the initial selection
        if (presetReason) {
            const ticketData = {
                userId: user.id,
                reason: presetReason,
                details: {},
                guildId: guild.id
            };
            ticketDetails.set(channel.id, ticketData);

            if (presetReason === 'giveaway_reward' || presetReason === 'event_reward') {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`reward_type_${channel.id}`)
                    .setPlaceholder('Select your reward type')
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Gift Card')
                            .setEmoji('💳')
                            .setValue('gift_card'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('PayPal')
                            .setEmoji('💰')
                            .setValue('paypal'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Other Reward')
                            .setEmoji('🎁')
                            .setValue('other_reward'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Go Back')
                            .setEmoji('↩️')
                            .setValue('go_back')
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);

                const embed = new EmbedBuilder()
                    .setTitle('Reward Selection')
                    .setDescription(`What type of reward would you like to receive for ${presetReason === 'giveaway_reward' ? 'your giveaway prize' : 'the event'}?\n\n**Please attach proof of your participation in this channel.**`)
                    .setColor(Colors.Gold);

                await interaction.reply({
                    embeds: [embed],
                    components: [row],
                    ephemeral: true
                });
                return;
            } else if (presetReason === 'support') {
                const modal = new ModalBuilder()
                    .setCustomId(`support_details_${channel.id}`)
                    .setTitle('Support Request Details');

                const supportInput = new TextInputBuilder()
                    .setCustomId('support_details')
                    .setLabel('Please describe your issue')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(20)
                    .setMaxLength(1000)
                    .setPlaceholder('Be as detailed as possible about your technical issue...');

                const firstActionRow = new ActionRowBuilder().addComponents(supportInput);
                modal.addComponents(firstActionRow);

                await interaction.showModal(modal);
                return;
            }
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`ticket_reason_${channel.id}`)
            .setPlaceholder('Select a reason for your ticket')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Giveaway Reward')
                    .setEmoji('🎁')
                    .setValue('giveaway_reward'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Event Reward')
                    .setEmoji('🎉')
                    .setValue('event_reward'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Technical Support')
                    .setEmoji('🛠️')
                    .setValue('support'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Other Inquiry')
                    .setEmoji('❓')
                    .setValue('other')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('Ticket Reason')
            .setDescription('Please select the most appropriate reason for creating this ticket.')
            .setColor(Colors.Blurple);

        await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });
    } catch (error) {
        console.error('Error creating ticket:', error);
        if (!interaction.replied) {
            await interaction.reply({
                content: 'An error occurred while creating your ticket. Please try again.',
                ephemeral: true
            }).catch(console.error);
        } else if (interaction.deferred) {
            await interaction.editReply({
                content: 'An error occurred while creating your ticket. Please try again.'
            }).catch(console.error);
        }
    }
}

// Handle button interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    try {
        // Check if server is configured
        if (!serverConfigs[interaction.guild.id]) {
            return interaction.reply({
                content: 'This server is not configured for tickets. Please contact an administrator.',
                ephemeral: true
            });
        }

        if (interaction.customId === 'create_ticket') {
            await handleCreateTicket(interaction);
        }
        else if (interaction.customId === 'create_giveaway_ticket') {
            await handleCreateTicket(interaction, 'giveaway_reward');
        }
        else if (interaction.customId === 'create_support_ticket') {
            await handleCreateTicket(interaction, 'support');
        }
        else if (interaction.customId.startsWith('delete_ticket_')) {
            await handleDeleteTicket(interaction);
        }
        else if (interaction.customId === 'close_ticket') {
            await handleCloseTicket(interaction);
        }
        else if (interaction.customId.startsWith('confirm_close_')) {
            await handleConfirmClose(interaction);
        }
        else if (interaction.customId === 'cancel_close') {
            await handleCancelClose(interaction);
        }
    } catch (error) {
        console.error('Error handling button interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({
                    content: 'An error occurred while processing your request. Please try again.',
                    ephemeral: true
                });
            } catch (err) {
                console.error('Failed to send error response:', err);
            }
        }
    }
});

async function handleDeleteTicket(interaction) {
    const channelId = interaction.customId.replace('delete_ticket_', '');
    
    try {
        const channel = interaction.guild.channels.cache.get(channelId);
        
        if (!channel) {
            // Channel doesn't exist, clean up our records
            pendingTickets.delete(channelId);
            ticketDetails.delete(channelId);
            
            const embed = new EmbedBuilder()
                .setTitle('Ticket Already Closed')
                .setDescription('This ticket channel has already been deleted.')
                .setColor(Colors.Green);
            
            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }

        // Check if user is ticket creator, admin, or server owner
        const ticketData = pendingTickets.get(channelId) || ticketDetails.get(channelId);
        const isCreator = ticketData && interaction.user.id === ticketData.userId;
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const isOwner = interaction.guild.ownerId === interaction.user.id;
        
        if (!isCreator && !isAdmin && !isOwner) {
            const embed = new EmbedBuilder()
                .setTitle('Permission Denied')
                .setDescription('Only the ticket creator, server admins, or server owner can cancel this ticket.')
                .setColor(Colors.Red);
            
            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }

        try {
            await channel.delete();
        } catch (deleteError) {
            if (deleteError.code !== 10003) { // Ignore "Unknown Channel" errors
                throw deleteError;
            }
        }

        pendingTickets.delete(channelId);
        ticketDetails.delete(channelId);
        
        const embed = new EmbedBuilder()
            .setTitle('Ticket Cancelled')
            .setDescription(`The ticket has been successfully cancelled by ${interaction.user}.`)
            .setColor(Colors.Green);
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                embeds: [embed],
                components: []
            }).catch(console.error);
        } else {
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }

        // If the user who deleted wasn't the creator, notify the creator
        if (!isCreator && ticketData) {
            try {
                const creator = await interaction.guild.members.fetch(ticketData.userId);
                const dmEmbed = new EmbedBuilder()
                    .setTitle('Your Ticket Was Closed')
                    .setDescription(`Your ticket in ${interaction.guild.name} was closed by ${interaction.user}.`)
                    .setColor(Colors.Orange)
                    .addFields(
                        { name: 'Ticket Channel', value: channel.name, inline: true },
                        { name: 'Closed By', value: interaction.user.tag, inline: true }
                    );
                
                await creator.send({ embeds: [dmEmbed] }).catch(console.error);
            } catch (dmError) {
                console.error('Could not send DM to ticket creator:', dmError);
            }
        }
    } catch (error) {
        console.error('Error deleting ticket:', error);
        
        const embed = new EmbedBuilder()
            .setTitle('Error')
            .setDescription('Failed to cancel the ticket. Please try again or contact an admin.')
            .setColor(Colors.Red);
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        } else if (interaction.deferred) {
            await interaction.editReply({
                embeds: [embed]
            }).catch(console.error);
        }
    }
}

async function handleCloseTicket(interaction) {
    if (!interaction.channel.name.startsWith('ticket-')) {
        const embed = new EmbedBuilder()
            .setTitle('Invalid Action')
            .setDescription('This command can only be used in ticket channels.')
            .setColor(Colors.Red);
        
        return interaction.reply({
            embeds: [embed],
            ephemeral: true
        }).catch(console.error);
    }

    // Check if user is ticket creator, admin, or server owner
    const ticketData = pendingTickets.get(interaction.channel.id) || ticketDetails.get(interaction.channel.id);
    const isCreator = ticketData && interaction.user.id === ticketData.userId;
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    
    if (!isCreator && !isAdmin && !isOwner) {
        const embed = new EmbedBuilder()
            .setTitle('Permission Denied')
            .setDescription('Only the ticket creator, server admins, or server owner can close this ticket.')
            .setColor(Colors.Red);
        
        return interaction.reply({
            embeds: [embed],
            ephemeral: true
        }).catch(console.error);
    }

    const confirmRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_close_${interaction.channel.id}`)
                .setLabel('Confirm Close')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_close')
                .setLabel('Cancel')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Secondary)
        );

    const embed = new EmbedBuilder()
        .setTitle('Confirm Ticket Closure')
        .setDescription('Are you sure you want to close this ticket? This action cannot be undone.')
        .setColor(Colors.Orange);
    
    await interaction.reply({
        embeds: [embed],
        components: [confirmRow]
    }).catch(console.error);
}

async function handleConfirmClose(interaction) {
    const channelId = interaction.customId.replace('confirm_close_', '');
    
    try {
        const channel = interaction.guild.channels.cache.get(channelId);
        
        if (!channel) {
            // Channel doesn't exist, clean up our records
            pendingTickets.delete(channelId);
            ticketDetails.delete(channelId);
            
            const embed = new EmbedBuilder()
                .setTitle('Ticket Already Closed')
                .setDescription('This ticket channel has already been deleted.')
                .setColor(Colors.Green);
            
            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }

        try {
            await channel.delete();
        } catch (deleteError) {
            if (deleteError.code !== 10003) { // Ignore "Unknown Channel" errors
                throw deleteError;
            }
        }

        pendingTickets.delete(channelId);
        ticketDetails.delete(channelId);
        
        const embed = new EmbedBuilder()
            .setTitle('Ticket Closed')
            .setDescription('This ticket has been successfully closed.')
            .setColor(Colors.Green);
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                embeds: [embed],
                components: []
            }).catch(console.error);
        } else {
            await interaction.reply({
                embeds: [embed]
            }).catch(console.error);
        }
    } catch (error) {
        console.error('Error closing ticket:', error);
        
        const embed = new EmbedBuilder()
            .setTitle('Error')
            .setDescription('Failed to close the ticket. Please try again or contact an admin.')
            .setColor(Colors.Red);
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        } else if (interaction.deferred) {
            await interaction.editReply({
                embeds: [embed]
            }).catch(console.error);
        }
    }
}

async function handleCancelClose(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('Closure Cancelled')
        .setDescription('The ticket will remain open.')
        .setColor(Colors.Green);
    
    try {
        await interaction.update({
            embeds: [embed],
            components: []
        }).catch(console.error);
    } catch (error) {
        console.error('Error cancelling closure:', error);
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        }).catch(console.error);
    }
}

// Handle select menu interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;

    try {
        // Check if server is configured
        if (!serverConfigs[interaction.guild.id]) {
            return interaction.reply({
                content: 'This server is not configured for tickets. Please contact an administrator.',
                ephemeral: true
            });
        }

        const selectedValue = interaction.values[0];
        const channelId = interaction.customId.split('_').slice(-1)[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        
        if (!channel) {
            const embed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('Ticket channel not found. Please create a new ticket.')
                .setColor(Colors.Red);
            
            return interaction.reply({ 
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }

        // Handle "Go Back" option
        if (selectedValue === 'go_back') {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_reason_${channel.id}`)
                .setPlaceholder('Select a reason for your ticket')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Giveaway Reward')
                        .setEmoji('🎁')
                        .setValue('giveaway_reward'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Event Reward')
                        .setEmoji('🎉')
                        .setValue('event_reward'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Technical Support')
                        .setEmoji('🛠️')
                        .setValue('support'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Other Inquiry')
                        .setEmoji('❓')
                        .setValue('other')
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = new EmbedBuilder()
                .setTitle('Ticket Reason')
                .setDescription('Please select the most appropriate reason for your ticket.')
                .setColor(Colors.Blurple);

            await interaction.update({
                embeds: [embed],
                components: [row]
            }).catch(console.error);
            return;
        }

        if (interaction.customId.startsWith('ticket_reason_')) {
            const reason = selectedValue;
            const user = interaction.user;

            const existingData = ticketDetails.get(channel.id) || {};
            ticketDetails.set(channel.id, {
                ...existingData,
                userId: user.id,
                reason: reason,
                details: existingData.details || {},
                guildId: interaction.guild.id
            });

            if (reason === 'giveaway_reward' || reason === 'event_reward') {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`reward_type_${channel.id}`)
                    .setPlaceholder('Select your reward type')
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Gift Card')
                            .setEmoji('💳')
                            .setValue('gift_card'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('PayPal')
                            .setEmoji('💰')
                            .setValue('paypal'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Other Reward')
                            .setEmoji('🎁')
                            .setValue('other_reward'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Go Back')
                            .setEmoji('↩️')
                            .setValue('go_back')
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);

                const embed = new EmbedBuilder()
                    .setTitle('Reward Selection')
                    .setDescription(`What type of reward would you like to receive for ${reason === 'giveaway_reward' ? 'your giveaway prize' : 'the event'}?\n\n**Please attach proof of your participation in this channel.**`)
                    .setColor(Colors.Gold);

                await interaction.update({
                    embeds: [embed],
                    components: [row]
                }).catch(console.error);
            } 
            else if (reason === 'support') {
                const modal = new ModalBuilder()
                    .setCustomId(`support_details_${channel.id}`)
                    .setTitle('Support Request Details');

                const supportInput = new TextInputBuilder()
                    .setCustomId('support_details')
                    .setLabel('Please describe your issue')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(20)
                    .setMaxLength(1000)
                    .setPlaceholder('Be as detailed as possible about your technical issue...');

                const firstActionRow = new ActionRowBuilder().addComponents(supportInput);
                modal.addComponents(firstActionRow);

                await interaction.showModal(modal).catch(console.error);
            }
            else if (reason === 'other') {
                const modal = new ModalBuilder()
                    .setCustomId(`other_reason_${channel.id}`)
                    .setTitle('Please specify your request');

                const otherInput = new TextInputBuilder()
                    .setCustomId('other_details')
                    .setLabel('Details of your inquiry')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(20)
                    .setMaxLength(1000)
                    .setPlaceholder('Please explain your request in detail...');

                const firstActionRow = new ActionRowBuilder().addComponents(otherInput);
                modal.addComponents(firstActionRow);

                await interaction.showModal(modal).catch(console.error);
            }
        }

        if (interaction.customId.startsWith('reward_type_')) {
            const rewardType = selectedValue;
            const ticketData = ticketDetails.get(channel.id);

            if (!ticketData) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Ticket data not found. Please create a new ticket.')
                    .setColor(Colors.Red);
                
                return interaction.reply({ 
                    embeds: [embed],
                    ephemeral: true
                }).catch(console.error);
            }

            ticketDetails.set(channel.id, {
                ...ticketData,
                details: {
                    ...ticketData.details,
                    rewardType: rewardType
                }
            });

            if (rewardType === 'gift_card') {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`gift_card_type_${channel.id}`)
                    .setPlaceholder('Select gift card type')
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Steam Gift Card')
                            .setEmoji('🎮')
                            .setValue('steam'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Amazon Gift Card')
                            .setEmoji('📦')
                            .setValue('amazon'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Other Gift Card')
                            .setEmoji('💳')
                            .setValue('other_gift_card'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Go Back')
                            .setEmoji('↩️')
                            .setValue('go_back')
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);

                const embed = new EmbedBuilder()
                    .setTitle('Gift Card Type')
                    .setDescription('Please select the type of gift card you would like to receive.\n\n**Please attach proof of your participation in this channel.**')
                    .setColor(Colors.Gold);

                await interaction.update({
                    embeds: [embed],
                    components: [row]
                }).catch(console.error);
            } 
            else if (rewardType === 'paypal') {
                const modal = new ModalBuilder()
                    .setCustomId(`paypal_details_${channel.id}`)
                    .setTitle('PayPal Information');

                const paypalInput = new TextInputBuilder()
                    .setCustomId('paypal_id')
                    .setLabel('Your PayPal email address')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(5)
                    .setMaxLength(100)
                    .setPlaceholder('example@paypal.com');

                const firstActionRow = new ActionRowBuilder().addComponents(paypalInput);
                modal.addComponents(firstActionRow);

                await interaction.showModal(modal).catch(console.error);
            }
            else if (rewardType === 'other_reward') {
                const modal = new ModalBuilder()
                    .setCustomId(`other_reward_details_${channel.id}`)
                    .setTitle('Reward Details');

                const otherInput = new TextInputBuilder()
                    .setCustomId('other_reward_details')
                    .setLabel('Describe your reward request')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(20)
                    .setMaxLength(1000)
                    .setPlaceholder('Please describe the reward you are expecting...');

                const firstActionRow = new ActionRowBuilder().addComponents(otherInput);
                modal.addComponents(firstActionRow);

                await interaction.showModal(modal).catch(console.error);
            }
        }

        if (interaction.customId.startsWith('gift_card_type_')) {
            const giftCardType = selectedValue;
            const ticketData = ticketDetails.get(channel.id);

            if (!ticketData) {
                const embed = new EmbedBuilder()
                    .setTitle('Error')
                    .setDescription('Ticket data not found. Please create a new ticket.')
                    .setColor(Colors.Red);
                
                return interaction.reply({ 
                    embeds: [embed],
                    ephemeral: true
                }).catch(console.error);
            }

            ticketDetails.set(channel.id, {
                ...ticketData,
                details: {
                    ...ticketData.details,
                    giftCardType: giftCardType
                }
            });

            if (giftCardType === 'steam') {
                const modal = new ModalBuilder()
                    .setCustomId(`steam_details_${channel.id}`)
                    .setTitle('Steam Information');

                const steamInput = new TextInputBuilder()
                    .setCustomId('steam_id')
                    .setLabel('Your Steam Profile URL or ID')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(5)
                    .setMaxLength(100)
                    .setPlaceholder('https://steamcommunity.com/id/yourprofile');

                const firstActionRow = new ActionRowBuilder().addComponents(steamInput);
                modal.addComponents(firstActionRow);

                await interaction.showModal(modal).catch(console.error);
            }
            else if (giftCardType === 'amazon') {
                await finalizeTicket(channel.id, interaction);
            }
            else if (giftCardType === 'other_gift_card') {
                const modal = new ModalBuilder()
                    .setCustomId(`other_gift_card_details_${channel.id}`)
                    .setTitle('Gift Card Details');

                const otherInput = new TextInputBuilder()
                    .setCustomId('other_gift_card_details')
                    .setLabel('Specify the gift card you need')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMinLength(10)
                    .setMaxLength(1000)
                    .setPlaceholder('Example: $50 PlayStation Store gift card for US region');

                const firstActionRow = new ActionRowBuilder().addComponents(otherInput);
                modal.addComponents(firstActionRow);

                await interaction.showModal(modal).catch(console.error);
            }
        }
    } catch (error) {
        console.error('Error handling select menu interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
            const embed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while processing your selection. Please try again.')
                .setColor(Colors.Red);
            
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }
    }
});

// Handle modal submissions
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;

    try {
        // Check if server is configured
        if (!serverConfigs[interaction.guild.id]) {
            return interaction.reply({
                content: 'This server is not configured for tickets. Please contact an administrator.',
                ephemeral: true
            });
        }

        const customIdParts = interaction.customId.split('_');
        const channelId = customIdParts[customIdParts.length - 1];
        const ticketData = ticketDetails.get(channelId);
        
        if (!ticketData) {
            const embed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('Ticket data not found. Please create a new ticket.')
                .setColor(Colors.Red);
            
            return interaction.reply({ 
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }

        if (interaction.customId.startsWith('support_details_')) {
            const supportDetails = interaction.fields.getTextInputValue('support_details');
            ticketData.details.supportDetails = supportDetails;
            ticketDetails.set(channelId, ticketData);
            await finalizeTicket(channelId, interaction);
        }
        else if (interaction.customId.startsWith('other_reason_')) {
            const otherDetails = interaction.fields.getTextInputValue('other_details');
            ticketData.details.otherDetails = otherDetails;
            ticketDetails.set(channelId, ticketData);
            await finalizeTicket(channelId, interaction);
        }
        else if (interaction.customId.startsWith('paypal_details_')) {
            const paypalId = interaction.fields.getTextInputValue('paypal_id');
            ticketData.details.paypalId = paypalId;
            ticketDetails.set(channelId, ticketData);
            await finalizeTicket(channelId, interaction);
        }
        else if (interaction.customId.startsWith('steam_details_')) {
            const steamId = interaction.fields.getTextInputValue('steam_id');
            ticketData.details.steamId = steamId;
            ticketDetails.set(channelId, ticketData);
            await finalizeTicket(channelId, interaction);
        }
        else if (interaction.customId.startsWith('other_reward_details_')) {
            const otherRewardDetails = interaction.fields.getTextInputValue('other_reward_details');
            ticketData.details.otherRewardDetails = otherRewardDetails;
            ticketDetails.set(channelId, ticketData);
            await finalizeTicket(channelId, interaction);
        }
        else if (interaction.customId.startsWith('other_gift_card_details_')) {
            const otherGiftCardDetails = interaction.fields.getTextInputValue('other_gift_card_details');
            ticketData.details.otherGiftCardDetails = otherGiftCardDetails;
            ticketDetails.set(channelId, ticketData);
            await finalizeTicket(channelId, interaction);
        }
    } catch (error) {
        console.error('Error handling modal submission:', error);
        if (!interaction.replied && !interaction.deferred) {
            const embed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('An error occurred while processing your submission. Please try again.')
                .setColor(Colors.Red);
            
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }
    }
});

// Finalize ticket function
async function finalizeTicket(channelId, interaction) {
    try {
        const channel = interaction.guild.channels.cache.get(channelId);
        const ticketData = ticketDetails.get(channelId);
        const pendingTicket = pendingTickets.get(channelId);
        
        if (!channel || !ticketData || !pendingTicket) {
            const embed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('Failed to finalize ticket. Please try again.')
                .setColor(Colors.Red);
            
            return interaction.reply({ 
                embeds: [embed],
                ephemeral: true
            }).catch(console.error);
        }

        const config = serverConfigs[interaction.guild.id];
        const user = interaction.guild.members.cache.get(pendingTicket.userId);
        
        await channel.permissionOverwrites.edit(user, {
            ViewChannel: true,
            SendMessages: true
        }).catch(console.error);

        // Create the main ticket embed
        const ticketEmbed = new EmbedBuilder()
            .setTitle(`Ticket #${pendingTicket.ticketNumber}`)
            .setDescription(`A new ticket has been created by ${user}`)
            .setColor(Colors.Blurple)
            .addFields(
                { name: 'Reason', value: formatReason(ticketData.reason), inline: true },
                { name: 'Created At', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }
            )
            .setFooter({ text: `User ID: ${user.id}` });

        // Add instructions for proof if needed
        let proofInstructions = '';
        if (ticketData.reason === 'giveaway_reward' || ticketData.reason === 'event_reward') {
            proofInstructions = '\n\n**Please attach proof of your participation by sending an image in this channel.**';
        }

        const ticketContent = `Hello ${user}, thank you for creating a ticket.${proofInstructions}\n\n**Ticket Details:**\n` +
            `- **Ticket #**: ${pendingTicket.ticketNumber}\n` +
            `- **Reason**: ${formatReason(ticketData.reason)}\n` +
            `${formatTicketDetails(ticketData)}\n` +
            `A staff member will assist you shortly.\n\n` +
            `You can close this ticket when your issue is resolved by clicking the button below.`;

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`delete_ticket_${channel.id}`)
                    .setLabel('Delete Ticket')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Secondary)
            );

        // Remove the delete button message
        try {
            const messages = await channel.messages.fetch().catch(console.error);
            const deleteMessage = messages?.find(m => m.components.length > 0 && m.components[0].components[0]?.customId?.startsWith('delete_ticket_'));
            if (deleteMessage) {
                await deleteMessage.delete().catch(console.error);
            }
        } catch (error) {
            console.error('Error removing delete button:', error);
        }

        // Send the main ticket message
        await channel.send({ 
            content: ticketContent,
            embeds: [ticketEmbed],
            components: [row] 
        }).catch(console.error);

        pendingTickets.delete(channelId);
        ticketDetails.delete(channelId);
        
        const successEmbed = new EmbedBuilder()
            .setTitle('Ticket Created')
            .setDescription(`Your ticket has been successfully created: ${channel}`)
            .setColor(Colors.Green);
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ 
                embeds: [successEmbed],
                components: []
            }).catch(console.error);
        } else {
            await interaction.reply({ 
                embeds: [successEmbed],
                ephemeral: true
            }).catch(console.error);
        }

        // Log ticket creation if log channel is configured
        if (config.logChannelId) {
            try {
                const logChannel = await interaction.guild.channels.fetch(config.logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`Ticket #${pendingTicket.ticketNumber} Created`)
                        .setColor(Colors.Blurple)
                        .addFields(
                            { name: 'User', value: `${user} (${user.user.tag})`, inline: true },
                            { name: 'Channel', value: `${channel}`, inline: true },
                            { name: 'Reason', value: formatReason(ticketData.reason), inline: false }
                        )
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
                }
            } catch (error) {
                console.error('Error logging ticket creation:', error);
            }
        }
    } catch (error) {
        console.error('Error finalizing ticket:', error);
        const embed = new EmbedBuilder()
            .setTitle('Error')
            .setDescription('An error occurred while finalizing your ticket. Please contact staff for assistance.')
            .setColor(Colors.Red);
        
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        }).catch(console.error);
    }
}

// Helper function to format reason
function formatReason(reason) {
    const reasons = {
        'giveaway_reward': '🎁 Giveaway Reward',
        'event_reward': '🎉 Event Reward',
        'support': '🛠️ Technical Support',
        'other': '❓ Other Inquiry'
    };
    return reasons[reason] || reason;
}

// Helper function to format ticket details
function formatTicketDetails(ticketData) {
    let details = '';
    
    switch (ticketData.reason) {
        case 'giveaway_reward':
        case 'event_reward':
            details += `- **Reward Type**: ${formatRewardType(ticketData.details.rewardType)}\n`;
            
            if (ticketData.details.rewardType === 'gift_card') {
                details += `- **Gift Card Type**: ${formatGiftCardType(ticketData.details.giftCardType)}\n`;
                
                if (ticketData.details.giftCardType === 'steam' && ticketData.details.steamId) {
                    details += `- **Steam ID**: ${ticketData.details.steamId}\n`;
                }
                else if (ticketData.details.giftCardType === 'other_gift_card' && ticketData.details.otherGiftCardDetails) {
                    details += `- **Gift Card Details**: ${ticketData.details.otherGiftCardDetails}\n`;
                }
            }
            else if (ticketData.details.rewardType === 'paypal' && ticketData.details.paypalId) {
                details += `- **PayPal Email**: ${ticketData.details.paypalId}\n`;
            }
            else if (ticketData.details.rewardType === 'other_reward' && ticketData.details.otherRewardDetails) {
                details += `- **Reward Details**: ${ticketData.details.otherRewardDetails}\n`;
            }
            break;
            
        case 'support':
            if (ticketData.details.supportDetails) {
                details += `- **Issue Description**: ${ticketData.details.supportDetails}\n`;
            }
            break;
            
        case 'other':
            if (ticketData.details.otherDetails) {
                details += `- **Request Details**: ${ticketData.details.otherDetails}\n`;
            }
            break;
    }
    
    return details;
}

// Helper function to format reward type
function formatRewardType(rewardType) {
    const types = {
        'gift_card': '💳 Gift Card',
        'paypal': '💰 PayPal',
        'other_reward': '🎁 Other Reward'
    };
    return types[rewardType] || rewardType;
}

// Helper function to format gift card type
function formatGiftCardType(giftCardType) {
    const types = {
        'steam': '🎮 Steam',
        'amazon': '📦 Amazon',
        'other_gift_card': '💳 Other Gift Card'
    };
    return types[giftCardType] || giftCardType;
}

// Prevent messages in ticket channels without a reason
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    if (message.channel.name.startsWith('ticket-')) {
        const channelId = message.channel.id;
        
        if (pendingTickets.has(channelId)) {
            try {
                await message.delete().catch(console.error);
                
                const warningEmbed = new EmbedBuilder()
                    .setTitle('Please Complete Ticket Creation')
                    .setDescription(`${message.author}, please finish setting up your ticket before sending messages.`)
                    .setColor(Colors.Orange);
                
                const reply = await message.channel.send({
                    embeds: [warningEmbed]
                }).catch(console.error);
                
                setTimeout(() => reply?.delete().catch(console.error), 5000);
            } catch (error) {
                console.error('Error handling message in pending ticket:', error);
            }
        }
    }
});

// Register Slash Command (/ticket)
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('⏳ Registering slash command...');
        
        // Register commands only for configured servers
        for (const guildId in serverConfigs) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.APPLICATION_ID, guildId),
                    {
                        body: [
                            new SlashCommandBuilder()
                                .setName('ticket')
                                .setDescription('Create a new support ticket')
                                .toJSON()
                        ]
                    }
                );
                console.log(`✅ Slash command registered for server ${guildId}`);
            } catch (error) {
                console.error(`Error registering slash command for server ${guildId}:`, error);
            }
        }
    } catch (error) {
        console.error('Error registering slash command:', error);
    }
})();

// Login bot
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});

// Handle uncaught errors
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});