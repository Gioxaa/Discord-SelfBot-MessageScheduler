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
  
  static async createWorkspace(client: Client, guildId: String, userId: string, durationDays: number) {
    const guild = client.guilds.cache.get(guildId.toString());
    if (!guild) throw new Error('Guild not found');

    const user = await client.users.fetch(userId);
    if (!user) throw new Error('User not found');

    // 1. Calculate Expiry
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + durationDays);

    // 2. Check if user already exists in DB
    let dbUser = await prisma.user.findUnique({ where: { id: userId } });
    
    // If user has existing workspace, check if channel still exists
    let existingChannel = dbUser?.workspaceChannelId ? guild.channels.cache.get(dbUser.workspaceChannelId) : null;

    if (existingChannel) {
        // Just extend duration
        await prisma.user.update({
            where: { id: userId },
            data: { expiryDate: expiryDate }
        });
        const channel = existingChannel as TextChannel;
        await channel.send(`✅ **Extension Successful!** Your plan has been extended until ${expiryDate.toLocaleString()}`);
        
        // Resend Dashboard to ensure UI is up to date
        await this.sendDashboard(channel, userId);
        return;
    }

    // 3. Create Private Channel
    const channelName = `workspace-${user.username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
    
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
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

    // 5. Update Database
    await prisma.user.upsert({
      where: { id: userId },
      update: {
        workspaceChannelId: channel.id,
        logThreadId: thread.id,
        expiryDate: expiryDate,
        username: user.tag
      },
      create: {
        id: userId,
        workspaceChannelId: channel.id,
        logThreadId: thread.id,
        expiryDate: expiryDate,
        username: user.tag
      }
    });

    // 6. Send Dashboard Panel to Channel
    await this.sendDashboard(channel, user.id); // Passing ID now as renderDashboard needs ID
    
    return channel;
  }

  static async sendDashboard(channel: TextChannel, userId: string) {
    const dashboard = await renderControlPanel(userId);
    
    // Safety check if dashboard is empty (shouldn't happen on new workspace usually, but good practice)
    const content = dashboard.content || `Welcome to your workspace!`;
    
    await channel.send({ 
        content: content,
        embeds: dashboard.embeds, 
        components: dashboard.components 
    });
  }
}
