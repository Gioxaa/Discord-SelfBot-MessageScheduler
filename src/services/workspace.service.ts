import { 
  Client, 
  ChannelType, 
  PermissionFlagsBits, 
  TextChannel, 
  User as DiscordUser
} from 'discord.js';
import prisma from '../database/client';
import { renderControlPanel } from '../views/controlPanel.view';

export class WorkspaceService {
  
  static async createWorkspace(client: Client, guildId: String, userId: string) {
    const guild = client.guilds.cache.get(guildId.toString());
    if (!guild) throw new Error('Guild not found');

    const user = await client.users.fetch(userId);
    if (!user) throw new Error('User not found');

    // 1. Get User Data (Expiry is already updated by AdminService)
    let dbUser = await prisma.user.findUnique({ where: { id: userId } });
    const expiryDate = dbUser?.expiryDate || new Date(); // Fallback to now if missing

    
    // If user has existing workspace, check if channel still exists
    let existingChannel = dbUser?.workspaceChannelId ? guild.channels.cache.get(dbUser.workspaceChannelId) : null;

    if (existingChannel) {
        // Just extend duration (Data already updated in AdminService, just notify)
        const channel = existingChannel as TextChannel;
        await channel.send(`✅ **Extension Successful!** Your plan is active until ${expiryDate.toLocaleString()}`);
        
        // Resend Dashboard to ensure UI is up to date
        await this.sendDashboard(channel, userId);
        return;
    }

    // 3. Ensure Category Exists
    let category = guild.channels.cache.find(c => c.name === 'Workspaces' && c.type === ChannelType.GuildCategory);
    
    if (!category) {
        category = await guild.channels.create({
            name: 'Workspaces',
            type: ChannelType.GuildCategory
        });
    }

    // 4. Create Private Channel
    const channelName = `workspace-${user.username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
    
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.id, // @everyone
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: client.user!.id, // Bot
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages],
        },
        {
          id: userId, // The Customer
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
      ],
      topic: `Private Workspace for ${user.tag}. Expires: ${expiryDate.toLocaleString()}`,
    });

    // 4. Create Log Thread
    const thread = await channel.threads.create({
      name: '📜-live-logs',
      autoArchiveDuration: 1440,
      reason: 'Logs for selfbot activity',
    });

    // 5. Update Database (Do NOT overwrite expiryDate)
    await prisma.user.upsert({
      where: { id: userId },
      update: {
        workspaceChannelId: channel.id,
        logThreadId: thread.id,
        username: user.tag
      },
      create: {
        id: userId,
        workspaceChannelId: channel.id,
        logThreadId: thread.id,
        expiryDate: expiryDate, // Only set on create if new
        username: user.tag
      }
    });

    // 6. Send Dashboard Panel to Channel
    await this.refreshControlPanel(client, user.id); 
    
    return channel;
  }

  static async refreshControlPanel(client: Client, userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.workspaceChannelId) return;

    const channel = client.channels.cache.get(user.workspaceChannelId) as TextChannel;
    if (!channel) return;

    const dashboard = await renderControlPanel(userId);
    const content = dashboard.content || `Welcome to your workspace!`;
    const payload = { 
        content: content,
        embeds: dashboard.embeds, 
        components: dashboard.components 
    };

    try {
        if (user.controlPanelMessageId) {
            try {
                const msg = await channel.messages.fetch(user.controlPanelMessageId);
                if (msg) {
                    await msg.edit(payload);
                    return;
                }
            } catch (e) {
                // Message likely deleted, send new one
            }
        } else {
            // Smart Discovery: Try to find existing panel
            try {
                const messages = await channel.messages.fetch({ limit: 20 });
                const existingPanel = messages.find(m => 
                    m.author.id === client.user?.id && 
                    m.embeds.length > 0 && 
                    m.embeds[0].description?.includes('Control Panel')
                );

                if (existingPanel) {
                    await existingPanel.edit(payload);
                    await prisma.user.update({
                        where: { id: userId },
                        data: { controlPanelMessageId: existingPanel.id }
                    });
                    return;
                }
            } catch (e) {
                // Ignore fetch error, proceed to send new
            }
        }
        
        // If no message or fetch failed, send new one
        const newMsg = await channel.send(payload);
        
        await prisma.user.update({
            where: { id: userId },
            data: { controlPanelMessageId: newMsg.id }
        });

    } catch (e) {
        console.error('[WorkspaceService] Failed to refresh panel', e);
    }
  }

  // Legacy wrapper if needed, but better to use refreshControlPanel directly
  static async sendDashboard(channel: TextChannel, userId: string) {
     // Replaced by refreshControlPanel logic to track ID, but kept for compatibility if called elsewhere
     // We can just call the new logic assuming we have client access, but here we only have channel.
     // Let's try to get client from channel.client
     await this.refreshControlPanel(channel.client as Client, userId);
  }

  static async syncPanelsOnStartup(client: Client) {
      console.log('[WorkspaceService] Syncing control panels...');
      const users = await prisma.user.findMany({
          where: {
              workspaceChannelId: { not: null }
          }
      });

      for (const user of users) {
          await this.refreshControlPanel(client, user.id);
          // Small delay to avoid rate limits
          await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`[WorkspaceService] Synced panels for ${users.length} users.`);
  }
}
